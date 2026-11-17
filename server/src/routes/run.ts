import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  getRun,
  getSession,
  updateRun,
  addMessage,
  listMessages,
  addDataView,
  listDataViews,
  addSubmission,
  setSubmissionReview,
  listSubmissions,
  getEvaluation,
  type RunRow,
} from "../db.js";
import { getScenario, readAttachment, attachedDataBlock, type Scenario, type NpcId } from "../scenarios.js";
import {
  COMPANY_COMMON,
  NPC_PERSONA,
  npcVolatileBlock,
  mentorHintsBlock,
  ODI_BASE,
  odiScenarioBlock,
  reviewerBlock,
} from "../prompts/index.js";
import { chat, chatStream, structured, describeLlmError, models, type ChatTurn, type SystemBlock } from "../llm.js";
import { config, limits } from "../config.js";
import { emit } from "../events.js";
import { checkBudget, recordSpend, npcCallsForRun, trimTurns } from "../guard.js";

export const runRouter = Router();

const NPC_IDS: NpcId[] = ["kang", "park", "jung", "lee"];

// run + session + scenario 를 한 번에 해석. 없으면 404 응답하고 undefined
function resolve(req: Request, res: Response): { run: RunRow; nickname: string; sc: Scenario } | undefined {
  const run = getRun(String(req.params.rid));
  if (!run) {
    res.status(404).json({ error: "run 없음" });
    return;
  }
  const session = getSession(run.session_id)!;
  const sc = getScenario(run.scenario_id)!;
  return { run, nickname: session.nickname, sc };
}

function isClosed(run: RunRow): boolean {
  return run.state === "approved" || run.state === "evaluated" || run.reject_count >= limits.rejects;
}

function toTurns(runId: string, agent: string): ChatTurn[] {
  return listMessages(runId, agent).map((m) => ({ role: m.role, content: m.content }));
}

// GET /run/:rid → 복구용 전체 상태
runRouter.get("/run/:rid", (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const { run, sc, nickname } = ctx;
  res.json({
    run: {
      id: run.id,
      state: run.state,
      reject_count: run.reject_count,
      hint_level: run.hint_level,
      odi_calls_used: run.odi_calls_used,
      odi_calls_limit: limits.odiCalls,
      basket_text: run.basket_text,
      closed: isClosed(run),
    },
    scenario: { id: sc.id, title: sc.prompts.title, owner_npc_id: sc.ownerNpcId },
    task_card: { ...sc.prompts.task_card, body: sc.prompts.task_card.body.replaceAll("{nickname}", nickname) },
    messages: listMessages(run.id).map((m) => ({ id: m.id, agent: m.agent, role: m.role, content: m.content, at: m.created_at })),
    submissions: listSubmissions(run.id).map((s) => ({
      attempt: s.attempt,
      verify_memo: s.verify_memo,
      review: s.review_json ? JSON.parse(s.review_json) : null,
      at: s.created_at,
    })),
    evaluation: getEvaluation(run.id) ?? null,
  });
});

// GET /run/:rid/data/:file?sort=1&search=1 → 첨부 원문. 열람 기록 (평가 B축 입력)
// :file 은 "data/xxx.csv" 처럼 슬래시 포함이라 와일드카드로 받음
runRouter.get("/run/:rid/data/*file", (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const parts = req.params.file as unknown as string[] | string;
  const rel = Array.isArray(parts) ? parts.join("/") : String(parts);
  let text: string;
  try {
    text = readAttachment(ctx.sc, rel);
  } catch {
    res.status(404).json({ error: "첨부 없음" });
    return;
  }
  addDataView(ctx.run.id, rel, req.query.sort === "1", req.query.search === "1");
  res.json({ file: rel, text });
});

// PUT /run/:rid/basket { text } → 결과물 바구니 저장
runRouter.put("/run/:rid/basket", (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const text = typeof req.body?.text === "string" ? req.body.text : "";
  if (text.length > 20000) {
    res.status(400).json({ error: "바구니 20,000자 초과" });
    return;
  }
  updateRun(ctx.run.id, { basket_text: text });
  res.json({ ok: true });
});

// POST /run/:rid/odi { message } → SSE 스트리밍. 호출 상한 적용
runRouter.post("/run/:rid/odi", async (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const { run, sc } = ctx;
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (!message) {
    res.status(400).json({ error: "message 필요" });
    return;
  }
  if (isClosed(run)) {
    res.status(409).json({ error: "종료된 시나리오" });
    return;
  }
  if (run.odi_calls_used >= limits.odiCalls) {
    res.status(429).json({ error: `오디 호출 상한 ${limits.odiCalls}회 소진`, odi_calls_used: run.odi_calls_used });
    return;
  }
  if (!checkBudget(res)) return;

  const system: SystemBlock[] = [
    { text: ODI_BASE, cache: false },
    { text: odiScenarioBlock(attachedDataBlock(sc), sc.prompts.planted_belief_for_odi), cache: true },
  ];
  const turns = trimTurns([...toTurns(run.id, "odi"), { role: "user" as const, content: message }], config.guard.odiHistoryChars);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  const ac = new AbortController();
  // req 의 close 는 본문 수신 완료 시점에도 발생하므로 res 기준으로 끊김을 감지
  res.on("close", () => {
    if (!res.writableFinished) ac.abort();
  });

  emit({ type: "odi.call.begin", run_id: run.id });
  try {
    const out = await chatStream({
      model: models.main,
      system,
      turns,
      maxTokens: config.maxTokens.odi,
      effort: "medium",
      onText: (d) => send("delta", { text: d }),
      signal: ac.signal,
    });
    recordSpend({ runId: run.id, kind: "odi", model: models.main, usage: out.usage });
    // 성공한 호출만 차감. 실패는 차감 안 함 (04 문서 7절)
    addMessage(run.id, "odi", "user", message);
    addMessage(run.id, "odi", "assistant", out.text, { usage: out.usage, stop_reason: out.stopReason });
    const updated = updateRun(run.id, {
      odi_calls_used: run.odi_calls_used + 1,
      ...(run.state === "assigned" ? { state: "working" as const } : {}),
    });
    send("done", {
      odi_calls_used: updated.odi_calls_used,
      odi_calls_limit: limits.odiCalls,
      truncated: out.stopReason === "max_tokens",
      usage: out.usage,
    });
  } catch (err) {
    if (!ac.signal.aborted) send("error", describeLlmError(err));
  } finally {
    emit({ type: "odi.call.end", run_id: run.id });
    res.end();
  }
});

// POST /run/:rid/npc/:npc { message, hint_request? } → NPC 응답 (비스트리밍)
runRouter.post("/run/:rid/npc/:npc", async (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const { run, sc, nickname } = ctx;
  const npc = req.params.npc as NpcId;
  if (!NPC_IDS.includes(npc)) {
    res.status(404).json({ error: "NPC 없음" });
    return;
  }
  const hintRequest = req.body?.hint_request === true;
  let message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  if (hintRequest && npc !== "lee") {
    res.status(400).json({ error: "힌트는 이하늘에게만" });
    return;
  }
  if (hintRequest && run.hint_level >= limits.hints) {
    res.status(429).json({ error: `힌트 상한 ${limits.hints}회 소진`, hint_level: run.hint_level });
    return;
  }
  if (!message && !hintRequest) {
    res.status(400).json({ error: "message 필요" });
    return;
  }
  if (hintRequest && !message) message = "힌트 좀 주세요.";
  if (npcCallsForRun(run.id) >= config.guard.npcCallsPerRun) {
    res.status(429).json({ error: "오늘은 팀원들이 바빠요. 지금까지 확인한 내용으로 마무리해 보세요.", code: "npc_calls" });
    return;
  }
  if (!checkBudget(res)) return;

  // 힌트 요청이면 단계를 먼저 올리고, 그 단계까지의 힌트만 프롬프트에 공개
  const hintLevel = hintRequest ? run.hint_level + 1 : run.hint_level;
  const persona = NPC_PERSONA[npc];
  const system: SystemBlock[] = [
    { text: `${COMPANY_COMMON}\n\n${persona.block}`, cache: false },
    { text: `[현재 시나리오]\n${sc.prompts.scenario_context_for_npc}`, cache: true },
  ];
  if (npc === "lee") {
    system.push({ text: mentorHintsBlock(sc.prompts.hints, hintLevel), cache: false });
    system.push({ text: npcVolatileBlock(nickname, hintLevel), cache: false });
  } else {
    system.push({ text: npcVolatileBlock(nickname), cache: false });
  }
  const turns = trimTurns([...toTurns(run.id, npc), { role: "user" as const, content: message }], config.guard.npcHistoryChars);
  const model = npc === "lee" ? models.mentor : models.npc;

  emit({ type: "npc.call.begin", run_id: run.id, npc_id: npc });
  try {
    const out = await chat({
      model,
      system,
      turns,
      maxTokens: config.maxTokens.npc,
      effort: "low",
    });
    recordSpend({ runId: run.id, kind: "npc", model, usage: out.usage });
    addMessage(run.id, npc, "user", message, hintRequest ? { hint_request: true, hint_level: hintLevel } : undefined);
    addMessage(run.id, npc, "assistant", out.text, { usage: out.usage });
    const updated = updateRun(run.id, {
      ...(hintRequest ? { hint_level: hintLevel } : {}),
      ...(run.state === "assigned" ? { state: "working" as const } : {}),
    });
    emit({ type: "npc.call.end", run_id: run.id, npc_id: npc, text: out.text.split(/(?<=[.!?。])\s/)[0] });
    res.json({ npc, name: persona.name, text: out.text, hint_level: updated.hint_level, hint_limit: limits.hints });
  } catch (err) {
    emit({ type: "npc.call.end", run_id: run.id, npc_id: npc });
    const e = describeLlmError(err);
    res.status(e.status).json({ error: e.message });
  }
});

// 팀장 검토 구조화 출력 스키마 (04 문서 S4 + 06 문서 trap_caught)
const ReviewSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  area: z.string().nullable().describe("반려 영역 이름. 승인이면 null"),
  message: z.string().describe("팀장 말투의 검토 코멘트 3~5문장"),
  trap_caught: z
    .array(
      z.object({
        id: z.string(),
        caught: z.boolean(),
        evidence: z.string().describe("제출물·메모에서 근거가 된 문장. 없으면 빈 문자열"),
      }),
    )
    .describe("함정별 발견 여부"),
});
export type Review = z.infer<typeof ReviewSchema>;

// LLM_MOCK=1 용 규칙 검토: 제출물에 "반려" 또는 "12곳"/"12개" 가 있으면 반려, 아니면 승인
export function reviewMock(turns: ChatTurn[]): Review {
  const text = turns.at(-1)?.content ?? "";
  const reject = /반려|12곳|12개/.test(text);
  return {
    decision: reject ? "reject" : "approve",
    area: reject ? "거래처 초과" : null,
    message: reject ? "[mock] 거래처가 왜 12개예요? 다시 보세요." : "[mock] 확인했습니다. 이 정도면 올려도 되겠네요.",
    trap_caught: [
      { id: "T1", caught: /중복/.test(text), evidence: /중복/.test(text) ? "중복" : "" },
      { id: "T2", caught: !reject, evidence: reject ? "" : "거래처 10곳" },
    ],
  };
}

// POST /run/:rid/submit { verify_memo } → 팀장 검토 → 승인/반려
runRouter.post("/run/:rid/submit", async (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const { run, sc, nickname } = ctx;
  const memo = typeof req.body?.verify_memo === "string" ? req.body.verify_memo.trim() : "";
  if (memo.length < 10) {
    res.status(400).json({ error: "검증 메모는 10자 이상 (무엇을 어떻게 확인했는지)" });
    return;
  }
  if (!run.basket_text.trim()) {
    res.status(400).json({ error: "바구니가 비어 있음" });
    return;
  }
  if (isClosed(run) || run.state === "reviewing") {
    res.status(409).json({ error: "제출할 수 없는 상태", state: run.state });
    return;
  }
  if (!checkBudget(res)) return;

  const attempt = run.reject_count + 1;
  const subId = addSubmission(run.id, attempt, run.basket_text, memo);
  updateRun(run.id, { state: "reviewing" });
  emit({ type: "submit", run_id: run.id, npc_id: sc.ownerNpcId });

  const persona = NPC_PERSONA[sc.ownerNpcId];
  const system: SystemBlock[] = [
    { text: `${COMPANY_COMMON}\n\n${persona.block}`, cache: false },
    { text: `[현재 시나리오]\n${sc.prompts.scenario_context_for_npc}`, cache: true },
    {
      text: reviewerBlock({
        approveIf: sc.prompts.review_rules.approve_if,
        rejectArea: sc.prompts.review_rules.reject_area,
        answerKey: sc.answerKey,
        traps: sc.prompts.traps,
        attempt,
        rejectLimit: limits.rejects,
      }),
      cache: false,
    },
    { text: npcVolatileBlock(nickname), cache: false },
  ];
  const turns: ChatTurn[] = [
    {
      role: "user",
      content: `[제출물]\n${run.basket_text}\n\n[검증 메모]\n${memo}`,
    },
  ];

  try {
    const { parsed: review, usage } = await structured({
      model: models.main,
      system,
      turns,
      schema: ReviewSchema,
      maxTokens: config.maxTokens.review,
      effort: "high",
      mock: reviewMock,
    });
    recordSpend({ runId: run.id, kind: "review", model: models.main, usage });
    setSubmissionReview(subId, { ...review, usage });
    addMessage(run.id, sc.ownerNpcId, "user", `(제출 ${attempt}차) ${memo}`, { submission: attempt });
    addMessage(run.id, sc.ownerNpcId, "assistant", review.message, { review: review.decision, area: review.area });

    let updated: RunRow;
    if (review.decision === "approve") {
      updated = updateRun(run.id, { state: "approved" });
      emit({ type: "review.approve", run_id: run.id, npc_id: sc.ownerNpcId, text: review.message });
    } else {
      updated = updateRun(run.id, { state: "rejected", reject_count: run.reject_count + 1 });
      emit({ type: "review.reject", run_id: run.id, npc_id: sc.ownerNpcId, text: review.message });
    }
    res.json({
      attempt,
      decision: review.decision,
      area: review.area,
      message: review.message,
      state: updated.state,
      reject_count: updated.reject_count,
      closed: isClosed(updated),
    });
  } catch (err) {
    updateRun(run.id, { state: run.state }); // reviewing 해제. 제출 기록은 남음
    const e = describeLlmError(err);
    res.status(e.status).json({ error: e.message });
  }
});

// POST /run/:rid/evaluate → 평가 리포트. 06 문서 파이프라인. 다음 단계에서 구현
runRouter.post("/run/:rid/evaluate", (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  if (!isClosed(ctx.run)) {
    res.status(409).json({ error: "승인되거나 반려 상한에 도달해야 평가 가능", state: ctx.run.state });
    return;
  }
  const existing = getEvaluation(ctx.run.id);
  if (existing) {
    res.json(existing);
    return;
  }
  res.status(501).json({
    error: "평가 파이프라인 미구현",
    inputs_ready: {
      messages: listMessages(ctx.run.id).length,
      data_views: listDataViews(ctx.run.id).length,
      submissions: listSubmissions(ctx.run.id).length,
    },
  });
});
