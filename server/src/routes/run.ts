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
  addEvaluation,
  type RunRow,
} from "../db.js";
import { collectEvidence } from "../evaluation/evidence.js";
import { scoreCode } from "../evaluation/score.js";
import { runJudge, type Judge } from "../evaluation/judge.js";
import { buildReport } from "../evaluation/report.js";
import { aiWarnedTraps, raisedTraps } from "../aiWarn.js";
import { getScenario, readAttachment, attachedDataBlock, attachmentOverview, type Scenario, type NpcId } from "../scenarios.js";
import {
  COMPANY_COMMON,
  NPC_PERSONA,
  npcVolatileBlock,
  mentorHintsBlock,
  ODI_BASE,
  odiScenarioBlock,
  odiToolScenarioBlock,
  reviewerBlock,
  reviewCommentBlock,
} from "../prompts/index.js";
import { publicFields, parseFields, grade, areaLine, displayValue, type FieldValue, type Grading } from "../grading.js";
import { maskAnswers } from "../mask.js";
import { chat, chatStream, chatStreamTools, structured, describeLlmError, models, type ChatTurn, type SystemBlock, type Usage } from "../llm.js";
import { config, limits } from "../config.js";
import { emit } from "../events.js";
import { checkBudget, recordSpend, npcCallsForRun, trimTurns } from "../guard.js";
import { odiToolsFor, mockToolInput, TOOL_REGISTRY, type OdiToolLog } from "../tools/index.js";

export const runRouter = Router();

// 오디 한 턴 안의 도구 라운드 상한. 01·02 는 한 번 부르면 충분하고, 옵션을 바꿔 비교해도 2~3번
const ODI_MAX_TOOL_ROUNDS = 3;

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
    // 구조화 제출 칸 (submission.json 있는 시나리오만). 정답·허용오차·함정은 빼고 보냄
    submission_fields: sc.submission ? publicFields(sc.submission) : null,
    task_card: { ...sc.prompts.task_card, body: sc.prompts.task_card.body.replaceAll("{nickname}", nickname) },
    messages: listMessages(run.id).map((m) => ({ id: m.id, agent: m.agent, role: m.role, content: m.content, at: m.created_at })),
    submissions: listSubmissions(run.id).map((s) => ({
      attempt: s.attempt,
      verify_memo: s.verify_memo,
      fields: s.fields_json ? JSON.parse(s.fields_json) : null,
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

  // 사용자 발화 (이전 턴 + 이번). 도구 옵션은 사용자가 실제로 말한 기준만 켠다 (src/tools/index.ts)
  const odiHistory = listMessages(run.id, "odi");
  const userTexts = [...odiHistory.filter((m) => m.role === "user").map((m) => m.content), message];
  // 도구 시나리오(odi_tools.json 있음)는 함정이 도구 기본값에 있으므로 planted_belief 를 넣지 않는다
  const toolset = odiToolsFor(sc, { userTexts });
  const scenarioBlock = toolset
    ? odiToolScenarioBlock(attachmentOverview(sc), sc.odiTools?.include_raw_data ? attachedDataBlock(sc) : undefined)
    : odiScenarioBlock(attachedDataBlock(sc), sc.prompts.planted_belief_for_odi);
  const system: SystemBlock[] = [
    { text: ODI_BASE, cache: false },
    { text: scenarioBlock, cache: true },
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
    // 도구 호출 기록. 평가에서 "교정 옵션으로 다시 계산했고 숫자가 바뀌었나"를 발견 증거로 쓴다
    const toolCalls: OdiToolLog[] = [];
    // 오디가 사용자보다 먼저 함정을 경고했는지는 답변이 끝난 뒤 기록만 한다 (src/aiWarn.ts). 답변은 그대로 내보냄
    const history = odiHistory;
    const pastCalls = history.flatMap((m) => {
      try {
        return ((m.meta ? JSON.parse(m.meta) : {}) as { tool_calls?: OdiToolLog[] }).tool_calls ?? [];
      } catch {
        return [];
      }
    });
    let requests = 1;
    let out: { text: string; usage: Usage; stopReason: string | null };
    if (toolset) {
      const r = await chatStreamTools({
        model: models.odi,
        system,
        turns,
        tools: toolset.defs,
        runTool: (name, input) => {
          const t = toolset.run(name, input);
          toolCalls.push(t.log);
          return t;
        },
        maxToolRounds: ODI_MAX_TOOL_ROUNDS,
        maxTokens: config.maxTokens.odi,
        effort: "medium",
        onText: (d) => send("delta", { text: d }),
        // 옵션 값은 보내지 않는다 (사용자에게 함정을 알려 주는 셈이라). "계산 중" 표시용 신호만
        onToolStart: () => send("tool", { phase: "start" }),
        // API 요청마다 지출 기록 (한 턴에 여러 번일 수 있음)
        onUsage: (u) => recordSpend({ runId: run.id, kind: "odi", model: models.odi, usage: u }),
        signal: ac.signal,
        // mock 오디는 사용자 문장을 그대로 계산 기준으로 넘긴다 (실제 오디에게 시키는 것과 같은 모양)
        mockInput: (_name, text) => ({ criteria: text }),
      });
      out = r;
      requests = r.requests;
    } else {
      out = await chatStream({
        model: models.odi,
        system,
        turns,
        maxTokens: config.maxTokens.odi,
        effort: "medium",
        onText: (d) => send("delta", { text: d }),
        signal: ac.signal,
      });
      recordSpend({ runId: run.id, kind: "odi", model: models.odi, usage: out.usage });
    }
    // 이 답변까지의 사용자 발화·도구 옵션 기준으로 아직 안 짚은 함정 중 오디가 경고한 것
    const aiWarned = aiWarnedTraps(sc, out.text, raisedTraps(sc, userTexts, [...pastCalls, ...toolCalls]));
    // 성공한 호출만 차감. 실패는 차감 안 함 (04 문서 7절). 도구 루프 전체가 1회
    // 이력은 글만 저장 (다음 턴에 도구 블록·thinking 은 다시 보내지 않음)
    addMessage(run.id, "odi", "user", message);
    addMessage(run.id, "odi", "assistant", out.text, {
      usage: out.usage,
      stop_reason: out.stopReason,
      ...(toolset ? { tool_calls: toolCalls, api_requests: requests } : {}),
      ...(aiWarned.length > 0 ? { ai_warned: aiWarned } : {}),
    });
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
    // 정답 숫자 마스킹. 저장도 가린 문장으로 해서 새로고침 복구·다음 턴 이력에도 안 남게
    const text = maskAnswers(out.text, sc.answerKey);
    addMessage(run.id, npc, "user", message, hintRequest ? { hint_request: true, hint_level: hintLevel } : undefined);
    addMessage(run.id, npc, "assistant", text, { usage: out.usage, ...(text !== out.text ? { masked: true } : {}) });
    const updated = updateRun(run.id, {
      ...(hintRequest ? { hint_level: hintLevel } : {}),
      ...(run.state === "assigned" ? { state: "working" as const } : {}),
    });
    emit({ type: "npc.call.end", run_id: run.id, npc_id: npc, text: text.split(/(?<=[.!?。])\s/)[0] });
    res.json({ npc, name: persona.name, text, hint_level: updated.hint_level, hint_limit: limits.hints });
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

// 구조화 제출 시나리오의 팀장 멘트 스키마. 판정은 코드가 하므로 message 만 받는다
const CommentSchema = z.object({
  message: z.string().describe("팀장 말투의 검토 코멘트 2~4문장. 정답 숫자 언급 금지"),
});

// 코드 판정을 받아 쓰는 멘트의 대체문. LLM_MOCK=1 과 LLM 실패 시 공용
// mock 은 메모 앞부분을 인용해서, 메모에 쓴 정답 숫자가 마스킹되는지 테스트할 수 있게 함
export function commentFallback(lines: string[], memo?: string): string {
  const base = lines.length === 0 ? "확인했습니다. 숫자 맞네요. 이대로 올리죠." : lines.join(" ");
  return memo === undefined ? base : `[mock] ${base} (메모: ${memo.slice(0, 60)})`;
}

type SubmitOutcome = { review: Record<string, unknown> & { decision: "approve" | "reject"; area: string | null; message: string }; wrongAreas?: string[] };

// POST /run/:rid/submit { verify_memo, fields? } → 채점·검토 → 승인/반려
// submission.json 이 있으면 fields 를 코드가 채점하고 팀장 LLM 은 멘트만. 없으면 기존 LLM 검토
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
  let values: Record<string, FieldValue> | undefined;
  if (sc.submission) {
    const parsed = parseFields(sc.submission, req.body?.fields);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error, code: "fields" });
      return;
    }
    values = parsed.values;
  }
  if (isClosed(run) || run.state === "reviewing") {
    res.status(409).json({ error: "제출할 수 없는 상태", state: run.state });
    return;
  }
  if (!checkBudget(res)) return;

  const attempt = run.reject_count + 1;
  const persona = NPC_PERSONA[sc.ownerNpcId];
  let outcome: SubmitOutcome;
  let subId: number;

  if (sc.submission && values) {
    // ---- 구조화 제출: 코드 채점 → 팀장은 멘트만 ----
    const spec = sc.submission;
    const vals = values;
    const g: Grading = grade({
      spec,
      answerKey: sc.answerKey,
      traps: sc.prompts.traps,
      values,
      basket: run.basket_text,
      memo,
    });
    subId = addSubmission(run.id, attempt, run.basket_text, memo, values, g);
    updateRun(run.id, { state: "reviewing" });
    emit({ type: "submit", run_id: run.id, npc_id: sc.ownerNpcId });

    const wrongAreas = g.wrong_areas.map((area) => ({ area, line: areaLine(spec, sc.prompts, area) }));
    // 정답이 들어 있는 scenario_context_for_npc·answer_key 는 넣지 않는다
    const system: SystemBlock[] = [
      { text: `${COMPANY_COMMON}\n\n${persona.block}`, cache: false },
      {
        text: reviewCommentBlock({
          decision: g.decision,
          wrongAreas,
          taskTitle: sc.prompts.task_card.title,
          deliverable: sc.prompts.task_card.deliverable,
          attempt,
          rejectLimit: limits.rejects,
        }),
        cache: false,
      },
      { text: npcVolatileBlock(nickname), cache: false },
    ];
    const fieldLines = spec.fields.map((f) => `- ${f.label}: ${displayValue(f, vals[f.id])}`);
    const turns: ChatTurn[] = [
      {
        role: "user",
        content: `[제출 칸]\n${fieldLines.join("\n")}\n\n[제출물]\n${run.basket_text.slice(0, 4000)}\n\n[검증 메모]\n${memo}`,
      },
    ];
    let message: string;
    let usage: unknown = null;
    let fallback = false;
    try {
      const out = await structured({
        model: models.review,
        system,
        turns,
        schema: CommentSchema,
        maxTokens: config.maxTokens.review,
        effort: "medium",
        mock: () => ({ message: commentFallback(wrongAreas.map((w) => w.line), memo) }),
      });
      recordSpend({ runId: run.id, kind: "review", model: models.review, usage: out.usage });
      message = out.parsed.message;
      usage = out.usage;
    } catch {
      // 판정은 이미 코드가 냈으므로 멘트만 대체문으로. 제출을 날리지 않는다
      message = commentFallback(wrongAreas.map((w) => w.line));
      fallback = true;
    }
    outcome = {
      review: {
        decision: g.decision,
        area: g.area,
        wrong_areas: g.wrong_areas,
        message: maskAnswers(message, sc.answerKey),
        trap_caught: g.trap_caught,
        graded_by: "code",
        ...(fallback ? { comment_fallback: true } : {}),
        usage,
      },
      wrongAreas: g.wrong_areas,
    };
  } else {
    // ---- 기존 경로 (submission.json 없는 시나리오): 팀장 LLM 이 판정까지 ----
    subId = addSubmission(run.id, attempt, run.basket_text, memo);
    updateRun(run.id, { state: "reviewing" });
    emit({ type: "submit", run_id: run.id, npc_id: sc.ownerNpcId });

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
        model: models.review,
        system,
        turns,
        schema: ReviewSchema,
        maxTokens: config.maxTokens.review,
        effort: "high",
        mock: reviewMock,
      });
      recordSpend({ runId: run.id, kind: "review", model: models.review, usage });
      outcome = { review: { ...review, message: maskAnswers(review.message, sc.answerKey), graded_by: "llm", usage } };
    } catch (err) {
      updateRun(run.id, { state: run.state }); // reviewing 해제. 제출 기록은 남음
      const e = describeLlmError(err);
      res.status(e.status).json({ error: e.message });
      return;
    }
  }

  const { review } = outcome;
  setSubmissionReview(subId, review);
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
    ...(outcome.wrongAreas ? { wrong_areas: outcome.wrongAreas } : {}),
    message: review.message,
    state: updated.state,
    reject_count: updated.reject_count,
    closed: isClosed(updated),
  });
});

// 같은 run 평가가 동시에 두 번 돌면 비용이 두 배라 막는다
const evaluating = new Set<string>();

// POST /run/:rid/evaluate → 평가 리포트 (06 문서 4절). 한 번 만들면 저장된 걸 돌려줌
runRouter.post("/run/:rid/evaluate", async (req, res) => {
  const ctx = resolve(req, res);
  if (!ctx) return;
  const { run, sc, nickname } = ctx;
  if (!isClosed(run)) {
    res.status(409).json({ error: "승인되거나 반려 상한에 도달해야 평가 가능", state: run.state });
    return;
  }
  const existing = getEvaluation(run.id);
  if (existing) {
    res.json(existing);
    return;
  }
  if (evaluating.has(run.id)) {
    res.status(409).json({ error: "평가 중입니다. 잠시 뒤 다시 열어 주세요" });
    return;
  }
  if (!checkBudget(res)) return;
  evaluating.add(run.id);
  try {
    const { ev } = collectEvidence(run.id);
    const code = scoreCode(ev, sc);
    let judge: Judge | null = null;
    try {
      const out = await runJudge({ ev, sc, code, nickname });
      for (const usage of out.usages) recordSpend({ runId: run.id, kind: "evaluate", model: models.main, usage });
      judge = out.judge;
    } catch (err) {
      // 코드 점수는 이미 확정. 코칭 없이 부분 리포트만 보여 주고 저장하지 않는다 (다시 열면 재시도)
      console.error("[evaluate]", describeLlmError(err).message, err);
    }
    const report = buildReport({ runId: run.id, sc, ev, code, judge });
    if (judge) {
      addEvaluation(run.id, report);
      updateRun(run.id, { state: "evaluated" });
      emit({ type: "evaluated", run_id: run.id });
    }
    res.json(report);
  } finally {
    evaluating.delete(run.id);
  }
});
