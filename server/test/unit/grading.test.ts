// GRD-01~09: 구조화 제출 채점 (01·02·03 submission.json). 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { grade, parseFields, parseFieldValue, publicFields, expectedValue, validateSpec } from "../../src/grading.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;
const s03 = getScenario("03")!;

function run(s: typeof s01, values: Record<string, number | string>, basket = "거래처별 합계표, 비중 % 포함, 분개 정리", memo = "원본 대조했습니다") {
  return grade({ spec: s.submission!, answerKey: s.answerKey, traps: s.prompts.traps, values, basket, memo });
}

const ok01 = { total_sales: 580300000, customer_count: 10, min_customer_sales: 9480000 };
const ok02 = { output_vat: 58030000, input_vat_expense: 1769000, input_vat_import: 3459242, payable_vat: 52801758 };

test("GRD-01 01~05 모두 submission.json, 01 파생 정답", () => {
  assert.ok(s01.submission && s02.submission && s03.submission);
  for (const id of ["04", "05"]) assert.ok(getScenario(id)!.submission, id);
  // 파생 정답: 거래처 수 = 키 개수, 최소 = 마켓C
  const f = Object.fromEntries(s01.submission!.fields.map((x) => [x.id, expectedValue(x, s01.answerKey)]));
  assert.deepEqual(f, ok01);
});

test("GRD-02 공개 칸 정의에 정답·허용오차·함정 없음", () => {
  for (const s of [s01, s02, s03]) {
    const pub = JSON.stringify(publicFields(s.submission!));
    for (const banned of ["answer", "tolerance", "proves", "reject_area", "range", "허용범위", "580300000", "52801758", "T1", "1319", "ea", "낱개", "box"]) {
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

// 03: SKU 10개 발주량(허용범위 안이면 정답) + 현재고 합계. 정답·오디 기본값은 order_quantity 도구와 같은 숫자 (tools.test.ts)
const ans03: Record<string, number> = {
  order_vn_001: 125, order_vn_002: 97, order_vn_003: 68, order_vn_004: 409, order_vn_005: 43,
  order_th_001: 500, order_th_002: 682, order_th_003: 418, order_th_004: 466, order_th_005: 293,
  stock_total: 1319,
};
// 오디 도구 기본값 그대로 (시즌 무시 + 입고 전 소진 누락 + TH-003 60 을 ea 로)
const odi03: Record<string, number> = {
  order_vn_001: 181, order_vn_002: 137, order_vn_003: 126, order_vn_004: 186, order_vn_005: 82,
  order_th_001: 87, order_th_002: 131, order_th_003: 278, order_th_004: 95, order_th_005: 70,
  stock_total: 659,
};
const basket03 = "SKU별 발주량 표. 근거: 전년 동월 × 1.1 + 안전재고 − 현재고";
const caught = (g: ReturnType<typeof run>) => g.trap_caught.map((t) => t.caught);

test("GRD-08 03 결정 테이블: 범위 안 승인, T1·T2 는 각자 칸으로 판정", () => {
  const ok = run(s03, ans03, basket03);
  assert.equal(ok.decision, "approve");
  assert.deepEqual(caught(ok), [true, true]);
  // 허용범위 양끝은 정답, 한 칸 밖은 오답 (VN-002 [77, 116]: ±20% 를 소수점 버림한 비대칭 범위)
  assert.equal(run(s03, { ...ans03, order_vn_002: 77 }, basket03).decision, "approve");
  assert.equal(run(s03, { ...ans03, order_vn_002: 116 }, basket03).decision, "approve");
  assert.deepEqual(run(s03, { ...ans03, order_vn_002: 76 }, basket03).wrong_areas, ["시즌 무시"]);
  assert.deepEqual(run(s03, { ...ans03, order_vn_002: 117 }, basket03).wrong_areas, ["시즌 무시"]);

  // 오디 기본값 그대로 → 두 함정 다 미발견. TH-003 칸은 derived 라 다른 칸이 틀렸을 땐 영역을 안 보탬
  const raw = run(s03, odi03, basket03);
  assert.deepEqual(raw.wrong_areas, ["시즌 무시", "입고 전 소진 누락", "단위 오류"]);
  assert.deepEqual(caught(raw), [false, false]);

  // T2 만 풀고 단위는 놓침: TH-003 1,078 + 재고 합계 659 → 단위 오류 만, T1 미발견·T2 발견
  const unit = run(s03, { ...ans03, order_th_003: 1078, stock_total: 659 }, basket03);
  assert.deepEqual(unit.wrong_areas, ["단위 오류"]);
  assert.deepEqual(caught(unit), [false, true]);

  // T1 만 풀고 시즌·입고 전 소진은 놓침: 재고 합계 1,319 맞음, 발주량은 오디 방식 (TH-003 은 0) → T1 발견·T2 미발견
  const season = run(s03, { ...odi03, order_th_003: 0, stock_total: 1319 }, basket03);
  assert.deepEqual(season.wrong_areas, ["시즌 무시", "입고 전 소진 누락"]);
  assert.deepEqual(caught(season), [true, false]);

  // T2 반쪽 (입고 전 소진만 반영): 비시즌 VN-004 만 맞고 나머지는 시즌 무시
  const preOnly = { ...ans03, order_vn_001: 333, order_vn_002: 257, order_vn_003: 266, order_vn_004: 368, order_vn_005: 170, order_th_001: 179, order_th_002: 255, order_th_003: 0, order_th_004: 185, order_th_005: 126 };
  const p = run(s03, preOnly, basket03);
  assert.deepEqual(p.wrong_areas, ["시즌 무시"]);
  assert.deepEqual(caught(p), [true, false]);

  // TH-003 만 틀림 (다른 칸 다 맞음) → derived 칸이 자기 영역 보고. 함정 판정엔 영향 없음
  const th3 = run(s03, { ...ans03, order_th_003: 900 }, basket03);
  assert.deepEqual(th3.wrong_areas, ["단위 오류"]);
  assert.deepEqual(caught(th3), [true, true]);

  // 숫자 다 맞아도 근거가 없으면 반려 (메모가 아니라 결과물에 있어야 함)
  const noBasis = run(s03, ans03, "SKU별 발주량 표", "원본 대조, 전년 동월 기준");
  assert.deepEqual(noBasis.wrong_areas, ["근거 없음"]);
  assert.deepEqual(caught(noBasis), [true, true]);
});

test("GRD-09 range_path·sum 정의 검증: 범위가 [하한, 상한] 숫자 쌍이 아니면 로드 때 throw", () => {
  const base = s03.submission!;
  const bad = (answer: object) => ({ ...base, fields: [{ ...base.fields[0], answer }] });
  assert.throws(() => validateSpec(bad({ path: "정답.VN-001.발주량", range_path: "정답.VN-001.현재고" }), s03.prompts, s03.answerKey, "t"));
  assert.throws(() => validateSpec(bad({ path: "정답.VN-001.발주량", range_path: "정답.없음.허용범위" }), s03.prompts, s03.answerKey, "t"));
  assert.throws(() => validateSpec(bad({ path: "정답", derive: "sum", pick: "없는키" }), s03.prompts, s03.answerKey, "t"));
  assert.doesNotThrow(() => validateSpec(base, s03.prompts, s03.answerKey, "t"));
  const stock = base.fields.find((f) => f.id === "stock_total")!;
  assert.equal(expectedValue(stock, s03.answerKey), 1319);
});

// ---- 선택 칸 (choice). 04·05 는 회신·일정표 본문 대신 판단을 보기로 받아 코드가 채점 ----
const s04 = getScenario("04")!;
const s05 = getScenario("05")!;
const ok04 = { damage_qty: 18, risk_transfer: "hamburg_on_board", claim_route: "oreum_insurance" };
const basket04 = "Dear Mr. Weber, ... please send the packing list and B/L ... Best regards";
const ok05 = { lh276_departure_kst: "t1810", expo_meeting_kst: "t2200", hausmann_call_kst: "t2100", payment_terms_status: "pending" };
const basket05 = "일정표 ... 액션: 결제 조건 회신 확인 (무역팀)";

test("GRD-08 선택 칸 공개 정의: 보기(id·label)만, 정답은 없음", () => {
  for (const s of [s04, s05]) {
    const pub = publicFields(s.submission!);
    for (const f of pub.filter((x) => x.type === "choice")) assert.ok(Array.isArray(f.options) && f.options.length >= 2, f.id);
    const txt = JSON.stringify(pub);
    for (const banned of ["answer", "proves", "reject_area", "제출_칸_정답"]) assert.ok(!txt.includes(banned), `${s.id} ${banned}`);
  }
});

test("GRD-09 04: 정답 승인, 24ea 는 수량 오류(T1 미발견), FOB 오해는 조건 오류(T2 미발견), 서류 요청 없으면 반려", () => {
  const g = run(s04, ok04, basket04);
  assert.equal(g.decision, "approve", JSON.stringify(g));
  assert.deepEqual(g.trap_caught.map((t) => [t.id, t.caught]), [["T1", true], ["T2", true]]);

  const qty = run(s04, { ...ok04, damage_qty: 24 }, basket04);
  assert.equal(qty.decision, "reject");
  assert.equal(qty.area, "수량 오류");
  assert.deepEqual(qty.trap_caught.map((t) => [t.id, t.caught]), [["T1", false], ["T2", true]]);

  // 오디 기본 초안(FOB 를 매도인 보험으로 오해)을 따른 경우. 두 칸 중 하나만 맞아도 T2 미발견
  const fob = run(s04, { ...ok04, claim_route: "hausmann_insurance" }, basket04);
  assert.equal(fob.area, "조건 오류");
  assert.deepEqual(fob.trap_caught.map((t) => [t.id, t.caught]), [["T1", true], ["T2", false]]);
  assert.equal(run(s04, { ...ok04, risk_transfer: "busan_discharge" }, basket04).trap_caught[1].caught, false);

  const noDocs = run(s04, ok04, "Dear Mr. Weber, we are sorry. Best regards");
  assert.equal(noDocs.decision, "reject");
  assert.equal(noDocs.area, "서류 요청 없음");
});

test("GRD-10 05: 정답 승인, LH276 은 T1·전시장 미팅은 T2 만 가름, 보고 전화는 시차 칸이 맞을 때만 자기 영역", () => {
  const g = run(s05, ok05, basket05);
  assert.equal(g.decision, "approve", JSON.stringify(g));
  assert.deepEqual(g.trap_caught.map((t) => [t.id, t.caught]), [["T1", true], ["T2", true]]);

  // 오디 도구 기본값 그대로: LH276 16:10, 미팅 21:00, 보고 전화 20:00
  const dflt = run(s05, { ...ok05, lh276_departure_kst: "t1610", expo_meeting_kst: "t2100", hausmann_call_kst: "t2000" }, basket05);
  assert.equal(dflt.decision, "reject");
  assert.deepEqual(dflt.trap_caught.map((t) => [t.id, t.caught]), [["T1", false], ["T2", false]]);
  assert.ok(!dflt.wrong_areas.includes("보고 전화 오류"), "시차가 틀려서 생긴 보고 전화 오답은 따로 보고하지 않음");

  // 시각기준(UTC)만 놓침: 서머타임은 반영해서 17:10
  const t1 = run(s05, { ...ok05, lh276_departure_kst: "t1710" }, basket05);
  assert.deepEqual([t1.area, t1.trap_caught[0].caught, t1.trap_caught[1].caught], ["항공편 오류", false, true]);

  // 시차 칸은 다 맞는데 보고 전화만 틀림 (+1h 누락) → 보고 전화 오류
  const call = run(s05, { ...ok05, hausmann_call_kst: "t2000" }, basket05);
  assert.equal(call.area, "보고 전화 오류");

  // 회의록: '검토하겠다'를 합의로 요약
  assert.equal(run(s05, { ...ok05, payment_terms_status: "decided" }, basket05).area, "회의록 왜곡");
  // 액션 담당 없음
  assert.equal(run(s05, ok05, "일정표만 있음").area, "액션 담당 없음");
});

test("GRD-11 선택 칸 입력 해석: 보기 id 만 받음 (label·순번·숫자는 거부)", () => {
  const spec = s05.submission!;
  const ok = parseFields(spec, { ...ok05, lh276_departure_kst: " t1810 " });
  assert.ok("values" in ok && ok.values.lh276_departure_kst === "t1810");
  for (const bad of ["10/30 18:10", "2", 1810, "t9999"]) {
    const r = parseFields(spec, { ...ok05, lh276_departure_kst: bad });
    assert.ok("error" in r, String(bad));
  }
});

test("GRD-12 잘못된 선택 칸 정의는 로드 때 throw (보기 부족·id 중복·정답이 보기에 없음·숫자 칸에 options)", () => {
  const base = s05.submission!;
  const f0 = base.fields[0];
  const mk = (patch: object) => ({ ...base, fields: [{ ...f0, ...patch }, ...base.fields.slice(1)] });
  const bad = [
    mk({ options: [{ id: "t1810", label: "18:10" }] }),
    mk({ options: [{ id: "t1810", label: "a" }, { id: "t1810", label: "b" }] }),
    mk({ answer: { value: "t0000" } }),
    mk({ type: "integer", answer: { value: 1810 } }), // 숫자 칸인데 options 가 남아 있음
  ];
  for (const spec of bad) assert.throws(() => validateSpec(spec as typeof base, s05.prompts, s05.answerKey, "test"));
});
