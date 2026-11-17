// GRD-01~05: 구조화 제출 채점 (01·02 submission.json). 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { grade, parseFields, parseFieldValue, publicFields, expectedValue, validateSpec } from "../../src/grading.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;

function run(s: typeof s01, values: Record<string, number>, basket = "거래처별 합계표, 비중 % 포함, 분개 정리", memo = "원본 대조했습니다") {
  return grade({ spec: s.submission!, answerKey: s.answerKey, traps: s.prompts.traps, values, basket, memo });
}

const ok01 = { total_sales: 580300000, customer_count: 10, min_customer_sales: 9480000 };
const ok02 = { output_vat: 58030000, input_vat_expense: 1769000, input_vat_import: 3459242, payable_vat: 52801758 };

test("GRD-01 01·02 만 submission.json, 03~05 는 없음", () => {
  assert.ok(s01.submission && s02.submission);
  for (const id of ["03", "04", "05"]) assert.equal(getScenario(id)!.submission, undefined, id);
  // 파생 정답: 거래처 수 = 키 개수, 최소 = 마켓C
  const f = Object.fromEntries(s01.submission!.fields.map((x) => [x.id, expectedValue(x, s01.answerKey)]));
  assert.deepEqual(f, ok01);
});

test("GRD-02 공개 칸 정의에 정답·허용오차·함정 없음", () => {
  for (const s of [s01, s02]) {
    const pub = JSON.stringify(publicFields(s.submission!));
    for (const banned of ["answer", "tolerance", "proves", "reject_area", "580300000", "52801758", "T1"]) {
      assert.ok(!pub.includes(banned), `${s.id} ${banned}`);
    }
  }
});

test("GRD-03 01 결정 테이블: 정답 승인, 중복 미제거·정규화 미적용·차트 없음은 해당 영역 반려", () => {
  const ok = run(s01, ok01);
  assert.equal(ok.decision, "approve");
  assert.equal(ok.area, null);
  assert.deepEqual(ok.trap_caught.map((t) => t.caught), [true, true]);

  // 중복 3건 그대로 (총합만 틀림) → T1 미발견, T2 발견
  const dup = run(s01, { ...ok01, total_sales: 584030000 });
  assert.equal(dup.decision, "reject");
  assert.equal(dup.area, "총매출 불일치");
  assert.deepEqual(dup.trap_caught.map((t) => t.caught), [false, true]);

  // 오디 기본 집계 (12곳, 최소 마켓 A 6,870,000, 중복 포함) → 두 영역, 둘 다 미발견
  const raw = run(s01, { total_sales: 584030000, customer_count: 12, min_customer_sales: 6870000 });
  assert.deepEqual(raw.wrong_areas, ["총매출 불일치", "거래처 초과"]);
  assert.deepEqual(raw.trap_caught.map((t) => t.caught), [false, false]);

  // "10곳" 만 맞추고 최솟값은 틀림 → T2 는 미발견 (힌트에 공개된 숫자만으로는 발견 아님)
  const onlyCount = run(s01, { ...ok01, min_customer_sales: 6870000 });
  assert.equal(onlyCount.area, "거래처 초과");
  assert.equal(onlyCount.trap_caught[1].caught, false);

  // 숫자 다 맞아도 비중·차트가 없으면 반려 (함정은 발견)
  const noChart = run(s01, ok01, "거래처별 합계표");
  assert.equal(noChart.decision, "reject");
  assert.equal(noChart.area, "차트 없음");
  assert.deepEqual(noChart.trap_caught.map((t) => t.caught), [true, true]);
});

test("GRD-04 02: 경비·수입 오답은 각 영역, 납부세액은 다른 칸이 맞을 때만 자기 영역", () => {
  assert.equal(run(s02, ok02).decision, "approve");

  const odi = run(s02, { ...ok02, input_vat_import: 3021700, payable_vat: 53239300 });
  assert.deepEqual(odi.wrong_areas, ["수입 불일치"]); // 납부세액 계산 은 따라 틀린 것이라 안 보고
  assert.deepEqual(odi.trap_caught.map((t) => t.caught), [true, false]);

  const ad = run(s02, { ...ok02, input_vat_expense: 1499000, payable_vat: 53071758 });
  assert.deepEqual(ad.wrong_areas, ["경비 불일치"]);
  assert.deepEqual(ad.trap_caught.map((t) => t.caught), [false, true]);

  const calc = run(s02, { ...ok02, payable_vat: 52801000 });
  assert.deepEqual(calc.wrong_areas, ["납부세액 계산"]);
  assert.deepEqual(calc.trap_caught.map((t) => t.caught), [true, true]);

  assert.equal(run(s02, ok02, "부가세 집계표만").area, "분개 없음");
});

test("GRD-05 키워드만 입력: 메모·결과물에 '중복 제거, 정규화, 신고필증' 을 써도 숫자가 틀리면 미발견", () => {
  const kw = "중복 3건 제거, 거래처명 정규화, 10곳, 비중 차트";
  const g = run(s01, { total_sales: 584030000, customer_count: 10, min_customer_sales: 6870000 }, kw, kw);
  assert.deepEqual(g.trap_caught.map((t) => t.caught), [false, false]);
  const g2 = run(s02, { ...ok02, input_vat_import: 3021700 }, "신고필증 기준, 분개", "신고필증 대조, 광고비 300,000 정정");
  assert.equal(g2.trap_caught[1].caught, false);
});

test("GRD-06 입력 해석: 쉼표·공백·원 허용, 소수·문자·누락·모르는 칸은 거부", () => {
  assert.equal(parseFieldValue("580,300,000원", "integer"), 580300000);
  assert.equal(parseFieldValue(" 9 480 000 ", "integer"), 9480000);
  assert.equal(parseFieldValue("10곳", "integer"), 10);
  assert.equal(parseFieldValue(10, "integer"), 10);
  assert.equal(parseFieldValue("1.5", "integer"), null);
  assert.equal(parseFieldValue("1.5", "number"), 1.5);
  assert.equal(parseFieldValue("약 5억", "integer"), null);
  assert.equal(parseFieldValue(true, "integer"), null);
  assert.equal(parseFieldValue("1e20", "number"), null);

  const spec = s01.submission!;
  assert.deepEqual(parseFields(spec, { total_sales: "580,300,000", customer_count: 10, min_customer_sales: "9,480,000원" }), { values: ok01 });
  assert.ok("error" in parseFields(spec, { total_sales: "580,300,000", customer_count: 10 }));
  assert.ok("error" in parseFields(spec, { ...ok01, extra: 1 }));
  assert.ok("error" in parseFields(spec, { ...ok01, customer_count: "열 곳" }));
  assert.ok("error" in parseFields(spec, [1, 2]));
  assert.ok("error" in parseFields(spec, undefined));
});

test("GRD-07 잘못된 submission.json 은 로드 때 throw", () => {
  const base = s01.submission!;
  const bad = (patch: object) => ({ ...base, fields: [{ ...base.fields[0], ...patch }] });
  assert.throws(() => validateSpec(bad({ answer: { path: "없는키" } }), s01.prompts, s01.answerKey, "t"));
  assert.throws(() => validateSpec(bad({ reject_area: "없는 영역" }), s01.prompts, s01.answerKey, "t"));
  assert.throws(() => validateSpec(bad({ proves: ["T9"] }), s01.prompts, s01.answerKey, "t"));
  assert.throws(() => validateSpec(bad({ answer: { path: "중복_주문번호" } }), s01.prompts, s01.answerKey, "t"));
  assert.doesNotThrow(() => validateSpec(base, s01.prompts, s01.answerKey, "t"));
});
