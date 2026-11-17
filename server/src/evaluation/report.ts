import { limits } from "../config.js";
import { maskAnswers } from "../mask.js";
import type { Scenario } from "../scenarios.js";
import type { Evidence } from "./evidence.js";
import { scoreCode, redundantScore, gradeOf, type CodeScore } from "./score.js";
import { A_NAMES, NONE, npcQuestions, type Judge } from "./judge.js";

// 06 문서 6절 리포트 JSON. web/src/types.ts 의 Report 와 맞춤
export interface Report {
  run_id: string;
  scenario: { id: string; title: string; cert: string };
  total: number;
  grade: "S" | "A" | "B" | "C";
  grade_note?: string; // 등급 상한이 걸린 이유
  partial?: boolean; // 평가 에이전트 실패로 코드 점수만 있는 리포트 (저장 안 함)
  summary: string;
  axes: {
    A_instruction: { score: number; max: 20; items: { name: string; score: number; quote: string }[] };
    B_verification: {
      score: number;
      max: 25;
      code: { data_viewed: number; active_explore: number; ask_back: number; memo_consistent: number };
      llm: { score: number; quote: string };
    };
    C_traps: { score: number; max: 25; traps: CodeScore["C"]["traps"] };
    D_deliverable: { score: number; max: 20; approved: boolean; reject_count: number; format_ok: boolean };
    E_efficiency: { score: number; max: 10; odi_calls: number; hints: number; redundant_questions: number };
  };
  highlights: { good: { quote: string; why: string }; improve: { quote: string; why: string } };
  next_steps: string[];
  resources: { odi_calls: string; hints: string; rejects: string; duration_min: number };
}

export const GRADE_CAP_NOTE =
  "오디가 낸 결과를 되묻거나 계산 조건을 바꿔서 숫자가 실제로 달라진 기록이 없어 등급을 B로 제한했습니다. 점수는 그대로입니다.";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : 0));
const r1 = (x: number) => Math.round(x * 10) / 10;

export function buildReport(args: { runId: string; sc: Scenario; ev: Evidence; code?: CodeScore; judge: Judge | null }): Report {
  const { sc, ev, judge } = args;
  const code = args.code ?? scoreCode(ev, sc);
  const mask = (s: string) => maskAnswers(s, sc.answerKey);

  const items = (Object.keys(A_NAMES) as (keyof Judge["A"])[]).map((k) => ({
    name: A_NAMES[k],
    score: judge ? Math.round(clamp(judge.A[k].score, 0, 5)) : 0,
    quote: judge ? judge.A[k].quote : NONE,
  }));
  const A = items.reduce((s, i) => s + i.score, 0);
  const bLlm = judge ? Math.round(clamp(judge.B.score, 0, 10)) : 0;

  // 팀장 등에게 한 중복 질문: LLM 이 고른 번호 중 실제 있는 것만
  const qCount = npcQuestions(ev).length;
  const redundant = judge ? new Set(judge.redundant_npc.filter((i) => Number.isInteger(i) && i >= 0 && i < qCount)).size : 0;
  const E = code.E_partial.odi_score + code.E_partial.hint_score + redundantScore(redundant);

  const C = r1(code.C.total);
  const total = Math.round(A + code.B.total + bLlm + C + code.D.total + E);
  let grade = gradeOf(total);
  let grade_note: string | undefined;
  if (!code.aiMinMet && (grade === "S" || grade === "A")) {
    grade = "B";
    grade_note = GRADE_CAP_NOTE;
  }

  return {
    run_id: args.runId,
    scenario: { id: sc.id, title: sc.prompts.title, cert: sc.prompts.cert },
    total,
    grade,
    ...(grade_note ? { grade_note } : {}),
    ...(judge ? {} : { partial: true }),
    summary: judge ? mask(judge.summary) : "코칭 문장을 만들지 못해 코드로 계산한 점수만 보여 드려요. 잠시 뒤 다시 열면 전체 리포트를 받을 수 있어요.",
    axes: {
      A_instruction: { score: A, max: 20, items: items.map((i) => ({ ...i, quote: mask(i.quote) })) },
      B_verification: {
        score: code.B.total + bLlm,
        max: 25,
        code: {
          data_viewed: code.B.data_viewed,
          active_explore: code.B.active_explore,
          ask_back: code.B.ask_back,
          memo_consistent: code.B.memo_consistent,
        },
        llm: { score: bLlm, quote: mask(judge?.B.quote ?? NONE) },
      },
      // 함정별은 소수 둘째 자리까지 (6.25 를 6.3 으로 올리면 합 12.5 와 안 맞아 보임)
      C_traps: { score: C, max: 25, traps: code.C.traps.map((t) => ({ ...t, score: Math.round(t.score * 100) / 100 })) },
      D_deliverable: {
        score: code.D.total,
        max: 20,
        approved: code.D.approved,
        reject_count: code.D.reject_count,
        format_ok: code.D.format_ok,
      },
      E_efficiency: { score: E, max: 10, odi_calls: code.E_partial.odi_calls, hints: code.E_partial.hints, redundant_questions: redundant },
    },
    highlights: {
      good: { quote: mask(judge?.good.quote ?? NONE), why: mask(judge?.good.why ?? "") },
      improve: { quote: mask(judge?.improve.quote ?? NONE), why: mask(judge?.improve.why ?? "") },
    },
    next_steps: (judge?.next_steps ?? []).slice(0, 2).map(mask),
    resources: {
      odi_calls: `${ev.odiCallsUsed}/${limits.odiCalls}`,
      hints: `${ev.hintLevel}/${limits.hints}`,
      rejects: `${ev.rejectCount}/${limits.rejects}`,
      duration_min: code.durationMin,
    },
  };
}
