import { z } from "zod";
import { structured, models, type ChatTurn, type Usage } from "../llm.js";
import { config } from "../config.js";
import { evaluatorBlock } from "../prompts/index.js";
import type { Scenario } from "../scenarios.js";
import type { Evidence } from "./evidence.js";
import { ASK_BACK, type CodeScore } from "./score.js";

// 평가 에이전트 (06 문서 4절 [2]·[3]). A·B-LLM 점수와 인용·코칭 문장만 만든다

export const NONE = "해당 없음";
const Quoted = z.object({ score: z.number(), quote: z.string() });
const Highlight = z.object({ quote: z.string(), why: z.string() });
export const JudgeSchema = z.object({
  A: z.object({ specificity: Quoted, context: Quoted, iteration: Quoted, role_split: Quoted }),
  B: Quoted,
  good: Highlight,
  improve: Highlight,
  next_steps: z.array(z.string()),
  summary: z.string(),
  redundant_npc: z.array(z.number()),
});
export type Judge = z.infer<typeof JudgeSchema>;

export const A_NAMES: Record<keyof Judge["A"], string> = {
  specificity: "구체성",
  context: "맥락 제공",
  iteration: "반복 개선",
  role_split: "역할 분리",
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + " …(생략)" : s);

// 인용은 오디에게 보낸 사용자 지시의 일부(공백 차이 무시)여야 한다
export function quoteOk(quote: string, ev: Evidence): boolean {
  const q = norm(quote);
  if (q === NONE) return true;
  if (q.length < 4) return false;
  return ev.odi.some((t) => norm(t.text).includes(q));
}

function badQuotes(j: Judge, ev: Evidence): string[] {
  const all: [string, string][] = [
    ...Object.entries(j.A).map(([k, v]) => [`A.${k}`, v.quote] as [string, string]),
    ["B", j.B.quote],
    ["good", j.good.quote],
    ["improve", j.improve.quote],
  ];
  return all.filter(([, q]) => !quoteOk(q, ev)).map(([k]) => k);
}

// 끝까지 로그에 없는 인용은 "해당 없음"으로. 점수는 그대로 둔다 (06 문서 9절)
function dropBadQuotes(j: Judge, ev: Evidence): Judge {
  const fix = (q: string) => (quoteOk(q, ev) ? q : NONE);
  return {
    ...j,
    A: {
      specificity: { ...j.A.specificity, quote: fix(j.A.specificity.quote) },
      context: { ...j.A.context, quote: fix(j.A.context.quote) },
      iteration: { ...j.A.iteration, quote: fix(j.A.iteration.quote) },
      role_split: { ...j.A.role_split, quote: fix(j.A.role_split.quote) },
    },
    B: { ...j.B, quote: fix(j.B.quote) },
    good: { ...j.good, quote: fix(j.good.quote) },
    improve: { ...j.improve, quote: fix(j.improve.quote) },
  };
}

const NPC_NAME: Record<string, string> = { kang: "강지훈", park: "박소연", jung: "정우진", lee: "이하늘" };

// 이하늘(사수)에게 묻는 건 감점하지 않으므로 제외. 번호는 이 목록의 인덱스
export const npcQuestions = (ev: Evidence) => ev.npc.filter((n) => n.to !== "lee");

export function logText(ev: Evidence, sc: Scenario, code: CodeScore): string {
  const odi = ev.odi
    .map((t, i) => {
      const tools = t.toolCalls.length > 0 ? `\n  (계산 도구: ${t.toolCalls.map((c) => c.summary).join(" / ")})` : "";
      return `[${i + 1}] 사용자: ${t.text}\n  오디: ${clip(t.reply, 1200)}${tools}`;
    })
    .join("\n");
  const npc = npcQuestions(ev)
    .map((n, i) => `[${i}] → ${n.to}: ${n.text}`)
    .join("\n");
  const views = ev.views.map((v) => `${v.file}${v.sort ? " (정렬)" : ""}${v.search ? " (검색)" : ""}`).join(", ");
  const subs = ev.subs.map((s) => `- ${s.attempt}차: ${s.decision ?? "검토 실패"} / 메모: ${s.memo}`).join("\n");
  const last = ev.subs.at(-1);
  // 오디가 사용자보다 먼저 경고한 함정. 잡았으면 확인함, 끝내 못 잡았으면 무시함
  const warned = [...new Set(ev.odi.flatMap((t) => t.aiWarned))]
    .sort()
    .map((id) => `${id}(${code.C.traps.find((t) => t.id === id)?.found ? "확인함" : "무시함"})`)
    .join(", ");
  return [
    `[오디 지시] (인용은 여기 "사용자:" 뒤 문장에서만)\n${odi || "(없음)"}`,
    `[팀원 대화] (redundant_npc 번호)\n${npc || "(없음)"}`,
    `[첨부 열람] ${views || "(없음)"} / 첨부 목록: ${sc.prompts.task_card.attachments.join(", ")}`,
    `[제출 이력]\n${subs || "(없음)"}`,
    `[최종 제출물]\n${clip(last?.basket ?? "", 3000)}`,
    `[보고 메일] (인용 대상 아님)\n${
      last?.email
        ? `받는 사람: ${last.email.to.map((n) => NPC_NAME[n]).join(", ")} / 참조: ${last.email.cc.map((n) => NPC_NAME[n]).join(", ") || "없음"} / 결과물 첨부: ${last.email.attach_result ? "함" : "안 함"}\n제목: ${last.email.subject}\n${clip(last.email.body, 1500)}`
        : "(없음)"
    }`,
    `[AI 결과를 고치게 한 기록] ${code.aiMinMet ? "있음" : "없음"}`,
    `[오디가 먼저 경고한 함정] ${warned || "(없음)"}`,
  ].join("\n\n");
}

// LLM_MOCK 용 규칙 기반 대체. 결정적이고, 인용은 항상 로그 원문
export function judgeMock(ev: Evidence): Judge {
  const users = ev.odi.map((t) => t.text);
  const first = users[0] ?? NONE;
  const verify = users.find((u) => ASK_BACK.test(u)) ?? NONE;
  const longest = users.reduce((a, b) => (b.length > a.length ? b : a), NONE);
  const shortest = users.reduce((a, b) => (b.length < a.length ? b : a), users[0] ?? NONE);
  const ctx = users.find((u) => /보고|목적|때문|용도|정확/.test(u));
  const role = users.find((u) => /내가|제가|직접/.test(u));
  return {
    A: {
      specificity: { score: first.length >= 25 ? 4 : first.length >= 10 ? 3 : 1, quote: first },
      context: { score: ctx ? 4 : 1, quote: ctx ?? NONE },
      iteration: { score: users.length >= 2 ? (verify !== NONE ? 4 : 2) : 0, quote: users.length >= 2 ? (users[1] ?? NONE) : NONE },
      role_split: { score: role ? 4 : 2, quote: role ?? NONE },
    },
    B: { score: Math.min(10, users.filter((u) => ASK_BACK.test(u)).length * 4), quote: verify },
    good: { quote: longest, why: "결과를 보고 지시를 좁혀 가는 흐름이 보입니다. (mock)" },
    improve: { quote: shortest ?? NONE, why: "범위·형식이 없어 오디가 추측해야 했습니다. (mock)" },
    next_steps: ["첫 지시에 대상·범위·형식을 한 문장에 넣어 보세요.", "결과를 받으면 원본 행 수·합계와 먼저 대조해 보세요."],
    summary: "검증 시도가 기록에 남아 있습니다. 지시를 더 구체적으로 주면 호출을 줄일 수 있어요. (mock)",
    redundant_npc: npcQuestions(ev).flatMap((n, i) => (/얼마|몇 ?원|정답/.test(n.text) ? [i] : [])),
  };
}

export async function runJudge(args: {
  ev: Evidence;
  sc: Scenario;
  code: CodeScore;
  nickname: string;
}): Promise<{ judge: Judge; usages: Usage[]; quoteRetry: boolean }> {
  const { ev, sc, code } = args;
  const ePartial = code.E_partial.odi_score;
  const F = code.F;
  const system = [
    {
      text: evaluatorBlock({
        nickname: args.nickname,
        scenarioTitle: sc.prompts.title,
        traps: sc.prompts.traps,
        fixed: {
          b_code: code.B.total,
          c: Math.round(code.C.total * 10) / 10,
          d: code.D.total,
          e_partial: ePartial,
          f: F.total,
          f_detail: `받는 사람 ${F.to}/2, 참조 ${F.cc}/2, 첨부 ${F.attach}/2, 제목 ${F.subject}/1, 두괄식 ${F.lead}/3`,
          trap_paths: code.C.traps.map((t) => `${t.id}=${t.path}`).join(", "),
        },
      }),
      cache: false,
    },
  ];
  const turns: ChatTurn[] = [{ role: "user", content: logText(ev, sc, code) }];
  const call = (t: ChatTurn[]) =>
    structured({
      model: models.main,
      system,
      turns: t,
      schema: JudgeSchema,
      maxTokens: config.maxTokens.evaluate,
      effort: "high",
      mock: () => judgeMock(ev),
    });

  const usages: Usage[] = [];
  const first = await call(turns);
  usages.push(first.usage);
  let judge = first.parsed;
  let quoteRetry = false;
  const bad = badQuotes(judge, ev);
  if (bad.length > 0) {
    // 1회 재요청: 어떤 인용이 로그에 없었는지 알려 준다
    quoteRetry = true;
    try {
      const again = await call([
        ...turns,
        { role: "assistant", content: JSON.stringify(judge) },
        {
          role: "user",
          content: `다음 인용이 [오디 지시] 원문에 없습니다: ${bad.join(", ")}. 원문을 한 글자도 바꾸지 말고 다시 인용하거나 "${NONE}"으로 바꿔 전체 JSON 을 다시 내 주세요.`,
        },
      ]);
      usages.push(again.usage);
      judge = again.parsed;
    } catch {
      // 재요청이 실패하면 첫 결과에서 틀린 인용만 지운다
    }
  }
  return { judge: dropBadQuotes(judge, ev), usages, quoteRetry };
}
