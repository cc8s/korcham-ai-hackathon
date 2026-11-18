// EVL-09~12: 평가 코드 채점 = 골든셋 기대값 (eval/golden/cases.json). 실행: npm run test:unit
// 골든셋 로그를 Evidence 로 바꿔 scoreCode 를 돌리고, B-코드·C·D·E·함정 경로가 기대값과 정확히 같아야 한다.
// E 의 "팀장에게 데이터 질문" 은 LLM 몫이라 여기선 mock 분류(얼마|몇 원|정답)를 쓴다
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario, type Scenario, type NpcId } from "../../src/scenarios.ts";
import { grade, expectedValue } from "../../src/grading.ts";
import { odiToolsFor, type OdiToolLog } from "../../src/tools/index.ts";
import type { Evidence } from "../../src/evaluation/evidence.ts";
import { golden, evidenceOf } from "../golden_harness.ts";
import { scoreCode, redundantScore } from "../../src/evaluation/score.ts";
import { judgeMock, quoteOk, logText, NONE } from "../../src/evaluation/judge.ts";
import { buildReport, GRADE_CAP_NOTE } from "../../src/evaluation/report.ts";

for (const c of golden.cases) {
  test(`EVL-09 골든셋 코드 채점 ${c.id} (${c.behavior})`, () => {
    const { sc, ev, subs } = evidenceOf(c);
    for (const s of subs) assert.equal(s.decision, s.expectedResult, `${c.id} ${s.attempt}차 판정`);

    const code = scoreCode(ev, sc);
    const redundant = judgeMock(ev).redundant_npc.length;
    const E = code.E_partial.odi_score + redundantScore(redundant);
    const got = {
      B_code: code.B.total,
      C: code.C.total,
      D: code.D.total,
      E,
      F: code.F.total,
      trap_paths: Object.fromEntries(code.C.traps.map((t) => [t.id, t.path])),
    };
    assert.deepEqual(got, c.expected.code, `${c.id} B=${JSON.stringify(code.B)}`);

    // 등급: 코드 합 + LLM 범위 양 끝을 넣어도 기대 등급 목록 안에 들어야 함 (B 상한 포함)
    for (const end of [0, 1]) {
      const A = Object.values(c.expected.llm.A as Record<string, number[]>).reduce((s, v) => s + v[end], 0);
      const judge = {
        ...judgeMock(ev),
        A: {
          specificity: { score: (c.expected.llm.A.구체성 as number[])[end], quote: NONE },
          context: { score: (c.expected.llm.A.맥락 as number[])[end], quote: NONE },
          iteration: { score: (c.expected.llm.A.반복개선 as number[])[end], quote: NONE },
          role_split: { score: (c.expected.llm.A.역할분리 as number[])[end], quote: NONE },
        },
        B: { score: (c.expected.llm.B_llm as number[])[end], quote: NONE },
      };
      const rep = buildReport({ runId: c.id, sc, ev, code, judge });
      assert.equal(rep.axes.A_instruction.score, A);
      assert.equal(rep.total, Math.round(c.expected.total[end]), `${c.id} total`);
      assert.ok(c.expected.grade.includes(rep.grade), `${c.id} grade ${rep.grade} not in ${c.expected.grade}`);
    }
  });
}

test("EVL-10 인용 검증: 오디 지시의 부분 문자열(공백 무시)만 통과", () => {
  const { ev } = evidenceOf(golden.cases[0]);
  const first = ev.odi[0].text;
  assert.ok(quoteOk(first, ev));
  assert.ok(quoteOk(first.slice(0, 20).replace(/ /g, "  "), ev));
  assert.ok(quoteOk(NONE, ev));
  assert.ok(!quoteOk("매출을 정확히 집계해 달라고 요청함", ev)); // 의역
  assert.ok(!quoteOk("10", ev)); // 너무 짧음
});

test("EVL-11 AI 최소 조건 미충족이면 A 이상이라도 B 로 제한 + 안내 문구", () => {
  const g = golden.cases.find((x: { id: string }) => x.id === "G01-05");
  const { sc, ev } = evidenceOf(g);
  const code = scoreCode(ev, sc);
  assert.equal(code.aiMinMet, false);
  const perfect = { ...judgeMock(ev), A: { specificity: { score: 5, quote: NONE }, context: { score: 5, quote: NONE }, iteration: { score: 5, quote: NONE }, role_split: { score: 5, quote: NONE } }, B: { score: 10, quote: NONE } };
  const rep = buildReport({ runId: "x", sc, ev, code, judge: perfect });
  assert.ok(rep.total >= 85);
  assert.equal(rep.grade, "B");
  assert.equal(rep.grade_note, GRADE_CAP_NOTE);
  // 조건을 충족한 모범 사례는 상한 없음
  const best = evidenceOf(golden.cases[0]);
  const rep2 = buildReport({ runId: "y", sc: best.sc, ev: best.ev, judge: perfect });
  assert.equal(rep2.grade, "S");
  assert.equal(rep2.grade_note, undefined);
});

test("EVL-12 평가 에이전트 실패 시 부분 리포트: A·B-LLM 0, 코드 점수는 그대로, 정답 숫자 없음", () => {
  const { sc, ev } = evidenceOf(golden.cases[0]);
  const rep = buildReport({ runId: "z", sc, ev, judge: null });
  assert.equal(rep.partial, true);
  assert.equal(rep.axes.A_instruction.score, 0);
  assert.equal(rep.axes.B_verification.llm.score, 0);
  assert.equal(rep.axes.C_traps.score, 25);
  assert.ok(!JSON.stringify(rep).includes("580300000") && !JSON.stringify(rep).includes("580,300,000"));
});

// ---- EVL-13~18: 오디가 먼저 경고한 함정 (발견 경로 ai_warned, 경고 무시) ----
const s01 = getScenario("01")!;
const oTurn = (at: number, text: string, aiWarned: string[] = []) => ({ at, text, reply: "", toolCalls: [] as OdiToolLog[], aiWarned });
const askLee = (at: number) => ({ at, to: "lee" as NpcId, text: "어디부터 보면 좋을까요?", hint: false });
const subAt = (at: number, caught: Record<string, boolean>, decision: "approve" | "reject" = "approve") => ({
  at,
  attempt: 1,
  memo: "",
  basket: "",
  decision,
  trapCaught: caught,
  checks: null,
  values: null,
  email: null,
});
const evOf = (o: Partial<Evidence>): Evidence => ({ startedAt: 0, odi: [], npc: [], views: [], subs: [], odiCallsUsed: 0, hintLevel: 0, rejectCount: 0, ...o });
const trapOf = (ev: Evidence, id: string) => scoreCode(ev, s01).C.traps.find((t) => t.id === id)!;
const BOTH = { T1: true, T2: true };

test("EVL-13 오디가 먼저 경고 → 사용자가 확인해 잡으면 경로 ai_warned, 계수 0.7", () => {
  const ev = evOf({ odi: [oTurn(1, "거래처별 합계표 만들어 줘", ["T2"]), oTurn(2, "중복 빼고 띄어쓰기 정리해서 다시 해 줘")], subs: [subAt(3, BOTH)] });
  const t2 = trapOf(ev, "T2");
  assert.deepEqual([t2.path, t2.coef, t2.score, t2.warned_ignored], ["ai_warned", 0.7, 12.5 * 0.7, undefined]);
  assert.equal(trapOf(ev, "T1").path, "self", "경고 안 받은 함정은 그대로 self");
});

test("EVL-14 경고했는데 못 잡은 함정은 warned_ignored, 평가 로그에 무시함으로 표시", () => {
  const ev = evOf({ odi: [oTurn(1, "합계표 만들어 줘", ["T1"]), oTurn(2, "띄어쓰기 정리해서 다시")], subs: [subAt(3, { T1: false, T2: true })] });
  const code = scoreCode(ev, s01);
  const [t1, t2] = code.C.traps;
  assert.deepEqual([t1.found, t1.path, t1.score, t1.warned_ignored], [false, "none", 0, true]);
  assert.equal(t2.warned_ignored, undefined);
  assert.ok(logText(ev, s01, code).includes("[오디가 먼저 경고한 함정] T1(무시함)"));
  // 경고가 없으면 (없음)
  assert.ok(logText(evOf({ subs: [subAt(3, BOTH)] }), s01, scoreCode(evOf({ subs: [subAt(3, BOTH)] }), s01)).includes("[오디가 먼저 경고한 함정] (없음)"));
});

test("EVL-15 사용자가 이미 짚은 뒤의 경고는 발견 경로로 치지 않음", () => {
  const ev = evOf({ odi: [oTurn(1, "거래처명 띄어쓰기 정리해 줘"), oTurn(2, "다시 보여 줘", ["T2"])], subs: [subAt(3, BOTH)] });
  assert.equal(trapOf(ev, "T2").path, "self");
  assert.equal(trapOf(ev, "T2").coef, 1);
});

test("EVL-16 이하늘(사수)에게 물어도 발견 경로·점수 그대로 (힌트 제거, 감점 없음)", () => {
  const odi = [oTurn(1, "합계표 만들어 줘", ["T2"]), oTurn(5, "띄어쓰기 정리해서 다시")];
  const asked = trapOf(evOf({ odi, npc: [askLee(2), askLee(3)], subs: [subAt(6, BOTH)] }), "T2");
  assert.deepEqual([asked.path, asked.coef], ["ai_warned", 0.7]);
  const self = trapOf(evOf({ odi: [oTurn(5, "띄어쓰기 정리해서 다시")], npc: [askLee(2), askLee(3), askLee(4)], subs: [subAt(6, BOTH)] }), "T2");
  assert.deepEqual([self.path, self.coef], ["self", 1]);
  const e = (npc: ReturnType<typeof askLee>[]) => scoreCode(evOf({ npc, subs: [subAt(6, BOTH)] }), s01).E_partial.odi_score;
  assert.equal(e([askLee(1), askLee(2), askLee(3), askLee(4)]), e([]));
});

test("EVL-17 반려 뒤 발견은 경고가 있어도 reject (0.5 가 더 낮음)", () => {
  const ev = evOf({
    odi: [oTurn(1, "합계표 만들어 줘", ["T2"]), oTurn(5, "띄어쓰기 정리해서 다시")],
    subs: [subAt(3, { T1: false, T2: false }, "reject"), subAt(6, BOTH)],
    rejectCount: 1,
  });
  assert.deepEqual([trapOf(ev, "T2").path, trapOf(ev, "T2").coef], ["reject", 0.5]);
});

test("EVL-18 경고 없이 제출로만 잡은 경우는 예전과 같음 (self)", () => {
  const ev = evOf({ odi: [oTurn(1, "합계표 만들어 줘")], subs: [subAt(3, BOTH)] });
  assert.deepEqual(scoreCode(ev, s01).C.traps.map((t) => [t.path, t.coef, t.warned_ignored]), [["self", 1, undefined], ["self", 1, undefined]]);
});
