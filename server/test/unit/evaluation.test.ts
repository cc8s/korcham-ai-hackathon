// EVL-09~12: 평가 코드 채점 = 골든셋 기대값 (eval/golden/cases.json). 실행: npm run test:unit
// 골든셋 로그를 Evidence 로 바꿔 scoreCode 를 돌리고, B-코드·C·D·E·함정 경로가 기대값과 정확히 같아야 한다.
// E 의 "팀장에게 데이터 질문" 은 LLM 몫이라 여기선 mock 분류(얼마|몇 원|정답)를 쓴다
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScenario, type Scenario, type NpcId } from "../../src/scenarios.ts";
import { grade, expectedValue } from "../../src/grading.ts";
import { odiToolsFor, type OdiToolLog } from "../../src/tools/index.ts";
import type { Evidence } from "../../src/evaluation/evidence.ts";
import { scoreCode, redundantScore } from "../../src/evaluation/score.ts";
import { judgeMock, quoteOk, NONE } from "../../src/evaluation/judge.ts";
import { buildReport, GRADE_CAP_NOTE } from "../../src/evaluation/report.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(fs.readFileSync(path.join(here, "../../../eval/golden/cases.json"), "utf8"));

type Flags = Record<string, boolean>;
interface GOdi { user: string; tool: Flags | null; changed: boolean; after?: string }
interface GNpc { to: NpcId; user: string; hint?: boolean; after?: string }
interface GView { file: string; sort: boolean; search: boolean; after?: string }
interface GSub { fields: string | Record<string, string>; memo: string; result: "approve" | "reject"; basket?: string }

// 시점: (앞선 반려 수, 앞선 힌트 수, 종류) 를 숫자 하나로. after="reject1,hint2" 면 반려 1·힌트 2 다음
const parseAfter = (after?: string) => ({
  r: Math.max(0, ...[...(after ?? "").matchAll(/reject(\d)/g)].map((m) => Number(m[1]))),
  h: Math.max(0, ...[...(after ?? "").matchAll(/hint(\d)/g)].map((m) => Number(m[1]))),
});
const at = (r: number, h: number, kind: number) => r * 1000 + h * 10 + kind;

const BASKETS: Record<string, string> = {
  tool_result_with_share: "거래처별 합계표 (금액 내림차순), 비중 % 포함",
  user_written_with_share: "직접 만든 피벗 합계표, 비중 % 포함",
  tool_result_with_journal: "부가세 집계표 + 분개 요약 (차) 부가세대급금 (대) 미지급금",
  tool_result_without_journal: "부가세 집계표",
};
const defaultBasket = (sc: Scenario) => (sc.id === "01" ? BASKETS.tool_result_with_share : BASKETS.tool_result_with_journal);

// 도구 결과 → 제출 칸 값
function fieldsFromTool(sc: Scenario, flags: Flags): Record<string, number> {
  const tools = odiToolsFor(sc)!;
  const name = sc.id === "01" ? "aggregate_sales" : "vat_summary";
  const out = tools.run(name, flags);
  assert.ok(!out.isError, out.content);
  const r = JSON.parse(out.content);
  if (sc.id === "01") {
    return {
      total_sales: r.총매출,
      customer_count: r.거래처_수,
      min_customer_sales: Math.min(...r.거래처별.map((x: { 금액: number }) => x.금액)),
    };
  }
  return { output_vat: r.매출.매출세액, input_vat_expense: r.경비.매입세액, input_vat_import: r.수입.매입세액, payable_vat: r.납부세액 };
}

const VARIANT_FLAGS: Record<string, Flags> = { default: {}, normalized_only: { normalize_customer_names: true } };

function fieldValues(sc: Scenario, spec: GSub["fields"]): Record<string, number> {
  const fields = sc.submission!.fields;
  const pick = (id: string, variant: string) => {
    if (variant === "correct") return expectedValue(fields.find((f) => f.id === id)!, sc.answerKey);
    const flags = VARIANT_FLAGS[variant];
    assert.ok(flags, `모르는 값 종류 ${variant}`);
    return fieldsFromTool(sc, flags)[id];
  };
  return Object.fromEntries(fields.map((f) => [f.id, pick(f.id, typeof spec === "string" ? spec : spec[f.id])]));
}

function evidenceOf(c: { scenario: string; log: { odi: GOdi[]; npc: GNpc[]; data_views: GView[]; submissions: GSub[] } }) {
  const sc = getScenario(c.scenario)!;
  const tools = odiToolsFor(sc)!;
  const toolName = sc.id === "01" ? "aggregate_sales" : "vat_summary";

  // 골든셋 'changed' = 직전 도구 결과 대비 숫자가 바뀌었는가 (첫 호출은 기본값 대비)
  let prev = JSON.stringify(tools.run(toolName, {}).log.summary);
  // after 가 없는 턴은 직전 턴과 같은 구간 (대화는 순서대로 쌓이므로 시각이 앞 턴보다 앞설 수 없음)
  let lastAt = 0;
  const odi = c.log.odi.map((t) => {
    const p = parseAfter(t.after);
    const prevR = Math.floor(lastAt / 1000);
    const prevH = Math.floor((lastAt % 1000) / 10);
    const { r, h } = t.after ? p : { r: prevR, h: prevH };
    lastAt = Math.max(lastAt, at(r, h, 1));
    let toolCalls: OdiToolLog[] = [];
    if (t.tool) {
      const log = tools.run(toolName, t.tool).log;
      const now = JSON.stringify(log.summary);
      assert.equal(now !== prev, t.changed, `도구 결과 변화가 골든셋 'changed' 와 다름: ${t.user}`);
      prev = now;
      toolCalls = [log];
    }
    return { at: lastAt, text: t.user, reply: "", toolCalls };
  });

  let hintNo = 0;
  const npc = c.log.npc.map((n) => {
    const { r, h } = parseAfter(n.after);
    if (n.hint) {
      hintNo++;
      return { at: at(r, hintNo - 1, 2), to: n.to, text: n.user, hint: true };
    }
    return { at: at(r, h, 1), to: n.to, text: n.user, hint: false };
  });

  const views = c.log.data_views.map((v) => {
    const { r, h } = parseAfter(v.after);
    return { at: at(r, h, 1), file: v.file, sort: v.sort, search: v.search };
  });

  const subs = c.log.submissions.map((s, i) => {
    const values = fieldValues(sc, s.fields);
    const basket = s.basket ? BASKETS[s.basket] : defaultBasket(sc);
    assert.ok(basket, `모르는 basket ${s.basket}`);
    const g = grade({ spec: sc.submission!, answerKey: sc.answerKey, traps: sc.prompts.traps, values, basket, memo: s.memo });
    return {
      at: at(i, 99, 3),
      attempt: i + 1,
      memo: s.memo,
      basket,
      decision: g.decision,
      trapCaught: Object.fromEntries(g.trap_caught.map((t) => [t.id, t.caught])),
      checks: g.checks,
      expectedResult: s.result,
    };
  });

  const ev: Evidence = {
    startedAt: 0,
    odi,
    npc,
    views,
    subs,
    odiCallsUsed: odi.length,
    hintLevel: hintNo,
    rejectCount: subs.filter((s) => s.decision === "reject").length,
  };
  return { sc, ev, subs };
}

for (const c of golden.cases) {
  test(`EVL-09 골든셋 코드 채점 ${c.id} (${c.behavior})`, () => {
    const { sc, ev, subs } = evidenceOf(c);
    for (const s of subs) assert.equal(s.decision, s.expectedResult, `${c.id} ${s.attempt}차 판정`);

    const code = scoreCode(ev, sc);
    const redundant = judgeMock(ev).redundant_npc.length;
    const E = code.E_partial.odi_score + code.E_partial.hint_score + redundantScore(redundant);
    const got = {
      B_code: code.B.total,
      C: code.C.total,
      D: code.D.total,
      E,
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
