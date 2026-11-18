// TOOL-01~05: 오디 계산 도구. 기본값은 함정 숫자, 교정 옵션은 answer_key 와 정확히 일치. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario, loadScenarios, readAttachment } from "../../src/scenarios.ts";
import { odiToolsFor, mockToolInput, TOOL_REGISTRY } from "../../src/tools/index.ts";
import { aggregateSales } from "../../src/tools/sales.ts";
import { vatSummary } from "../../src/tools/vat.ts";
import { orderQuantity, unitMultiplier, type OrderInput } from "../../src/tools/order.ts";
import { parseCsv } from "../../src/tools/csv.ts";
import { constants } from "../../src/config.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;
const sales = readAttachment(s01, "data/sales_2026_10.csv");
const tx = readAttachment(s02, "data/transactions_2026_10.csv");
const imp = readAttachment(s02, "data/import_declarations_2026_10.csv");
const s03 = getScenario("03")!;
const monthly = readAttachment(s03, "data/monthly_sales_2025_11_2026_10.csv");
const inventory = readAttachment(s03, "data/inventory_2026_10_31.csv");
const products = readAttachment(s03, "_shared/products.csv");
const order = (input: Partial<OrderInput>) =>
  orderQuantity(monthly, inventory, products, { use_last_year_same_month: false, include_pre_arrival_demand: false, convert_stock_units: false, ...input });
const qtyOf = (r: ReturnType<typeof order>) => Object.fromEntries(r.SKU별.map((x) => [x.SKU, x.발주량]));
const rates = { vatRate: Number(constants["부가세율"]), fx: constants["환율"] as Record<string, number> };

test("TOOL-01 aggregate_sales 교정 옵션 둘 다 켜면 answer_key 와 정확히 일치", () => {
  const key = s01.answerKey as { 거래처별_합계: Record<string, number>; 총매출: number; 중복_주문번호: string[]; 표기변형: Record<string, string> };
  const r = aggregateSales(sales, { dedupe_order_ids: true, normalize_customer_names: true });
  assert.equal(r.총매출, key.총매출);
  assert.equal(r.거래처_수, 10);
  assert.deepEqual(Object.fromEntries(r.거래처별.map((c) => [c.거래처, c.금액])), key.거래처별_합계);
  assert.deepEqual(r.제거한_중복!.map((d) => d.주문번호).sort(), [...key.중복_주문번호].sort());
  assert.deepEqual(Object.keys(r.통합한_표기!).sort(), Object.keys(key.표기변형).sort());
  assert.equal(r.집계_행수, r.읽은_행수 - 3);
  // 금액 내림차순
  for (let i = 1; i < r.거래처별.length; i++) assert.ok(r.거래처별[i - 1].금액 >= r.거래처별[i].금액);
});

test("TOOL-02 aggregate_sales 기본값은 README 의 함정 숫자 (12곳, 중복 포함 총매출)", () => {
  const d = aggregateSales(sales, { dedupe_order_ids: false, normalize_customer_names: false });
  assert.equal(d.거래처_수, 12);
  assert.ok(d.거래처별.some((c) => c.거래처 === "성실 상사") && d.거래처별.some((c) => c.거래처 === "마켓 A"));
  assert.equal(d.총매출, 584_030_000); // 정답 580,300,000 + 중복 3건 3,730,000
  assert.equal(d.제거한_중복, undefined); // 기본값 결과에는 중복 정보 자체가 없음
  assert.equal(d.통합한_표기, undefined);
  // 옵션 하나씩: 함정 하나씩만 풀린다
  assert.equal(aggregateSales(sales, { dedupe_order_ids: true, normalize_customer_names: false }).거래처_수, 12);
  assert.equal(aggregateSales(sales, { dedupe_order_ids: false, normalize_customer_names: true }).총매출, 584_030_000);
  // 결정적: 두 번 돌려도 같다
  assert.deepEqual(aggregateSales(sales, { dedupe_order_ids: false, normalize_customer_names: false }), d);
});

test("TOOL-03 vat_summary 교정 옵션은 answer_key, 기본값은 README 의 함정 숫자", () => {
  const key = s02.answerKey as Record<string, number>;
  const ok = vatSummary(tx, imp, { recheck_vat_rate: true, use_import_declarations: true }, rates);
  assert.equal(ok.매출.매출세액, key["매출세액"]);
  assert.equal(ok.경비.매입세액, key["매입세액_경비(정정후)"]);
  assert.equal(ok.수입.매입세액, key["매입세액_수입(신고필증)"]);
  assert.equal(ok.매입세액_합계, key["매입세액_합계"]);
  assert.equal(ok.납부세액, key["납부세액"]);
  assert.deepEqual(ok.부가세_정정!.map((f) => [f.거래처, f.기재_부가세, f.재계산_부가세]), [["세븐마케팅", 30000, 300000]]);

  const d = vatSummary(tx, imp, { recheck_vat_rate: false, use_import_declarations: false }, rates);
  assert.equal(d.경비.매입세액, 1_499_000); // 광고비 30,000 그대로 (T1)
  assert.equal(d.수입.매입세액, (s02.answerKey as Record<string, number>)["함정_오디_수입부가세_오답"]); // 3,021,700 (T2)
  assert.equal(d.납부세액, 58_030_000 - 1_499_000 - 3_021_700);
  assert.equal(d.부가세_정정, undefined);
});

test("TOOL-04 도구 묶음: 기본값과 다르게 켠 옵션·숫자 변화가 로그에 남고, 잘못된 입력은 오류 결과", () => {
  const ts = odiToolsFor(s01)!;
  assert.deepEqual(ts.defs.map((d) => d.name), ["aggregate_sales"]);
  const def = ts.run("aggregate_sales", {});
  assert.equal(def.isError, false);
  assert.deepEqual(def.log.changed_flags, []);
  assert.equal(def.log.defaults_changed, false);
  assert.equal(def.log.differs_from_default, false);
  assert.deepEqual(def.log.input, { dedupe_order_ids: false, normalize_customer_names: false });

  const fix = ts.run("aggregate_sales", { dedupe_order_ids: true });
  assert.deepEqual(fix.log.changed_flags, ["dedupe_order_ids"]);
  assert.equal(fix.log.differs_from_default, true);
  assert.deepEqual(fix.log.summary, { 거래처_수: 12, 총매출: 580_300_000, 집계_행수: 120 });

  const bad = ts.run("aggregate_sales", { dedupe_order_ids: "yes" });
  assert.equal(bad.isError, true);
  assert.equal(ts.run("aggregate_sales", { extra: true }).isError, true);
  assert.equal(ts.run("no_such_tool", {}).isError, true);
});

test("TOOL-05 odi_tools.json 이 있는 시나리오는 설정이 유효, 없는 시나리오는 null (예전 방식)", () => {
  for (const s of loadScenarios().values()) {
    const ts = odiToolsFor(s);
    if (!s.odiTools) {
      assert.equal(ts, null, s.id);
      continue;
    }
    assert.ok(ts && ts.defs.length > 0, s.id);
    for (const d of ts.defs) {
      // 기본값 호출이 오류 없이 돈다 (첨부 경로가 attachments 목록 안에 있음)
      assert.equal(ts.run(d.name, {}).isError, false, `${s.id} ${d.name}`);
      // 도구 설명에 정답 숫자 같은 함정 정보가 없음
      assert.ok(!JSON.stringify(d).includes("580300000") && !JSON.stringify(d).includes("성실"), d.name);
      // 03: 어느 SKU 가 문제인지(옷걸이·TH-003·box) 설명에 없음
      assert.ok(!/TH-\d|VN-\d|옷걸이|box|12입/i.test(JSON.stringify(d)), d.name);
    }
  }
  assert.ok(getScenario("01")!.odiTools && getScenario("02")!.odiTools && getScenario("03")!.odiTools);
});

test("TOOL-06 mock 옵션 규칙: 기본은 전부 false, 낱말에 따라 켬, 막연한 검증 요청은 안 켬", () => {
  const t = TOOL_REGISTRY["aggregate_sales"];
  assert.deepEqual(mockToolInput(t, "거래처별 합계표 만들어 줘"), { dedupe_order_ids: false, normalize_customer_names: false });
  assert.deepEqual(mockToolInput(t, "중복 제거해서 다시"), { dedupe_order_ids: true, normalize_customer_names: false });
  assert.deepEqual(mockToolInput(t, "거래처명 정규화해서 다시"), { dedupe_order_ids: false, normalize_customer_names: true });
  assert.deepEqual(mockToolInput(t, "다시 확인해 줘"), { dedupe_order_ids: false, normalize_customer_names: false });
  assert.deepEqual(mockToolInput(t, "검증해 줘"), { dedupe_order_ids: false, normalize_customer_names: false });
});

type Key03 = {
  정답: Record<string, { 발주량: number; 허용범위: [number, number]; 현재고: number; "예측수요_11~12월(입고전소진)": number; "예측수요_1~2월(커버)": number }>;
  "오디_오답(최근3개월평균×2, 단위 미환산)": Record<string, number>;
  함정_검산: Record<string, number>;
};
const key03 = s03.answerKey as Key03;
const all3 = { use_last_year_same_month: true, include_pre_arrival_demand: true, convert_stock_units: true };

test("TOOL-07 order_quantity 교정 옵션 셋 다 켜면 answer_key 정답과 정확히 일치 (허용범위 안)", () => {
  const r = order(all3);
  const ans = key03.정답;
  assert.deepEqual(Object.keys(qtyOf(r)), Object.keys(ans));
  for (const row of r.SKU별) {
    const a = ans[row.SKU];
    assert.equal(row.발주량, a.발주량, row.SKU);
    assert.ok(row.발주량 >= a.허용범위[0] && row.발주량 <= a.허용범위[1], row.SKU);
    assert.equal(row.현재고, a.현재고, row.SKU);
    assert.equal(row.예측수요_입고전, a["예측수요_11~12월(입고전소진)"], row.SKU);
    assert.equal(row.예측수요_커버, a["예측수요_1~2월(커버)"], row.SKU);
  }
  assert.equal(r.발주량_합계, Object.values(ans).reduce((n, a) => n + a.발주량, 0));
  // 옵션을 켰을 때만 보이는 칸: 환산 전 재고, 시즌, 입고예정일 (TH 40일 → 12-26, VN 45일 → 12-31)
  const th3 = r.SKU별.find((x) => x.SKU === "TH-003")!;
  assert.equal(th3.재고_원본, "60 box(12입)");
  assert.equal(th3.입고예정일, "2026-12-26");
  assert.equal(r.SKU별.find((x) => x.SKU === "VN-001")!.입고예정일, "2026-12-31");
  assert.ok(th3.시즌?.includes("이사철"));
});

test("TOOL-08 order_quantity 기본값은 README·answer_key 의 오디 오답 (시즌 무시 + 입고 전 소진 누락 + 단위 미환산)", () => {
  const d = order({});
  assert.deepEqual(qtyOf(d), key03["오디_오답(최근3개월평균×2, 단위 미환산)"]);
  // 기본 결과에는 단위·시즌·입고일 정보 자체가 없음 (오디가 스스로 함정을 짚지 않게)
  const text = JSON.stringify(d);
  assert.ok(!/box|12입|이사철|여름|입고예정일|재고_원본|시즌/.test(text), text.slice(0, 200));
  for (const row of d.SKU별) {
    assert.ok(!(row.SKU in key03.정답) || !(row.발주량 >= key03.정답[row.SKU].허용범위[0] && row.발주량 <= key03.정답[row.SKU].허용범위[1]), `${row.SKU} 기본값이 범위 안`);
  }
  // 결정적
  assert.deepEqual(order({}), d);
});

test("TOOL-09 order_quantity 옵션 하나씩: 자기 함정만 풀린다", () => {
  const inRange = (sku: string, q: number) => q >= key03.정답[sku].허용범위[0] && q <= key03.정답[sku].허용범위[1];
  const wrong = key03["오디_오답(최근3개월평균×2, 단위 미환산)"];

  // T1 만: 단위만 환산하면 TH-003 외에는 기본값 그대로, TH-003 은 오디 방식 + 720ea → 0 (answer_key 함정_검산)
  const u = qtyOf(order({ convert_stock_units: true }));
  for (const [sku, q] of Object.entries(u)) if (sku !== "TH-003") assert.equal(q, wrong[sku], sku);
  assert.equal(u["TH-003"], key03.함정_검산["T2_TH-003_단위는_고치고_오디방식"]);

  // T2 만 (두 옵션 다): TH-003 외에는 정답, TH-003 은 단위 미환산 1,078 (answer_key 함정_검산)
  const t2 = qtyOf(order({ use_last_year_same_month: true, include_pre_arrival_demand: true }));
  for (const [sku, q] of Object.entries(t2)) if (sku !== "TH-003") assert.equal(q, key03.정답[sku].발주량, sku);
  assert.equal(t2["TH-003"], key03.함정_검산["T1_TH-003_단위만_미환산(60을 ea로)"]);
  assert.ok(!inRange("TH-003", t2["TH-003"]));

  // T2 의 반쪽만: 전년 동월만이면 전부 범위 밖 (입고 전 소진 누락), 입고 전 소진만이면 비시즌 VN-004 만 범위 안
  const season = qtyOf(order({ use_last_year_same_month: true, convert_stock_units: true }));
  assert.deepEqual(Object.keys(season).filter((k) => inRange(k, season[k])), []);
  const pre = qtyOf(order({ include_pre_arrival_demand: true, convert_stock_units: true }));
  assert.deepEqual(Object.keys(pre).filter((k) => inRange(k, pre[k])), ["VN-004"]);

  assert.equal(unitMultiplier("ea"), 1);
  assert.equal(unitMultiplier("box(12입)"), 12);
  assert.throws(() => unitMultiplier("pallet"));
});

test("TOOL-10 03 도구 묶음: 옵션 변화가 로그에 남고, mock 규칙은 특정한 말에만 옵션을 켬", () => {
  const ts = odiToolsFor(s03)!;
  assert.deepEqual(ts.defs.map((d) => d.name), ["order_quantity"]);
  const def = ts.run("order_quantity", {});
  assert.equal(def.isError, false);
  assert.equal(def.log.differs_from_default, false);
  assert.equal((def.log.summary as { 발주량_합계: number }).발주량_합계, Object.values(key03["오디_오답(최근3개월평균×2, 단위 미환산)"]).reduce((n, x) => n + x, 0));
  const fix = ts.run("order_quantity", { convert_stock_units: true });
  assert.deepEqual(fix.log.changed_flags, ["convert_stock_units"]);
  assert.equal(fix.log.differs_from_default, true);
  assert.equal(ts.run("order_quantity", { cover_months: 3 }).isError, true);

  const t = TOOL_REGISTRY["order_quantity"];
  const off = { use_last_year_same_month: false, include_pre_arrival_demand: false, convert_stock_units: false };
  assert.deepEqual(mockToolInput(t, "SKU별 발주량 제안해 줘"), off);
  assert.deepEqual(mockToolInput(t, "다시 확인해 줘"), off);
  assert.deepEqual(mockToolInput(t, "검증해 줘"), off);
  // 품명 "리빙박스" 의 박스, "12월 말 입고" 로는 안 켜짐
  assert.deepEqual(mockToolInput(t, "리빙박스 대 발주량만 다시 알려 줘"), off);
  assert.deepEqual(mockToolInput(t, "12월 말 입고분 발주량 표로 줘"), off);
  assert.deepEqual(mockToolInput(t, "전년 동월 기준으로 다시"), { ...off, use_last_year_same_month: true });
  assert.deepEqual(mockToolInput(t, "입고 전 소진분도 넣어서"), { ...off, include_pre_arrival_demand: true });
  assert.deepEqual(mockToolInput(t, "재고 단위 환산해서 다시"), { ...off, convert_stock_units: true });
  assert.deepEqual(mockToolInput(t, "box 는 12입이에요"), { ...off, convert_stock_units: true });
});

test("CSV 파서: 따옴표 안 쉼표", () => {
  const { rows } = parseCsv('a,b\n1,"x, y"\n');
  assert.deepEqual(rows, [{ a: "1", b: "x, y" }]);
});

// ---- 05 itinerary_kst: 함정은 도구 기본값 (작성일 시차 7h 고정 = T2, 시각기준 열 무시 = T1) ----
const s05 = getScenario("05")!;
const it05 = (flags: Record<string, boolean>) => {
  const r = odiToolsFor(s05)!.run("itinerary_kst", flags);
  assert.ok(!r.isError, r.content);
  const o = JSON.parse(r.content);
  return {
    lh276: o.항공편.find((f: { 편명: string }) => f.편명 === "LH276").출발.한국 as string,
    expo: o.일정.find((x: { 현지: string; 날짜: string }) => x.날짜 === "10/29" && x.현지 === "14:00").한국 as string,
    call: o.보고_전화[0].한국 as string,
    log: r.log,
    raw: r.content,
  };
};

test("TOOL-05 itinerary_kst 기본값은 두 함정 그대로 (LH276 16:10, 전시장 21:00), 결과에 함정 단어 없음", () => {
  const d = it05({});
  assert.deepEqual([d.lh276, d.expo, d.call], ["10/30 16:10", "10/29 21:00", "10/28 20:00"]);
  assert.ok(!/UTC|CEST|CET|서머|시각기준/.test(d.raw), "기본 결과에 단서 단어가 있으면 오디가 먼저 짚음");
});

test("TOOL-06 itinerary_kst 옵션 둘 다 켜면 answer_key 정답 (18:10, 22:00, 보고 전화 21:00), 옵션 하나는 자기 함정만", () => {
  const all = it05({ use_event_date_offset: true, use_time_basis_column: true });
  assert.deepEqual([all.lh276, all.expo, all.call], ["10/30 18:10", "10/29 22:00", "10/28 21:00"]);
  const key = s05.answerKey as { 제출_칸_정답: Record<string, string> };
  assert.equal(key.제출_칸_정답.LH276_출발_한국시간, "t1810");
  assert.equal(key.제출_칸_정답.전시장_14시_미팅_한국시간, "t2200");
  // 서머타임만: 미팅은 맞고 LH276 은 현지로 봐서 17:10
  const dst = it05({ use_event_date_offset: true });
  assert.deepEqual([dst.lh276, dst.expo], ["10/30 17:10", "10/29 22:00"]);
  // 시각기준만: LH276 은 UTC+9 라 서머타임과 무관하게 18:10, 미팅은 여전히 21:00
  const basis = it05({ use_time_basis_column: true });
  assert.deepEqual([basis.lh276, basis.expo], ["10/30 18:10", "10/29 21:00"]);
  assert.equal(basis.log.differs_from_default, true);
});

test("TOOL-07 itinerary_kst mock: 막연한 '시차 확인해 줘'는 옵션을 켜지 않고, 서머타임·UTC 를 특정하면 켬", () => {
  const tool = TOOL_REGISTRY.itinerary_kst;
  assert.deepEqual(mockToolInput(tool, "시차 다시 확인해 줘"), { use_event_date_offset: false, use_time_basis_column: false });
  assert.deepEqual(mockToolInput(tool, "서머타임 끝난 거 반영해서 다시"), { use_event_date_offset: true, use_time_basis_column: false });
  assert.deepEqual(mockToolInput(tool, "항공편 시각기준 UTC 인 거 반영해 줘"), { use_event_date_offset: false, use_time_basis_column: true });
});

// ---- 모델에게 보이는 도구 정의: 옵션 목록 없이 '계산 기준' 문장 하나 (2026-11-18) ----
test("TOOL-08 모델용 도구 정의에 교정 옵션 이름·설명이 없다 (criteria 하나), 설명에 함정 단서 없음", () => {
  for (const id of ["01", "02", "03", "05"]) {
    const sc = getScenario(id)!;
    for (const def of odiToolsFor(sc, { userTexts: [] })!.defs) {
      const txt = JSON.stringify(def);
      assert.deepEqual(Object.keys((def.input_schema as { properties: object }).properties), ["criteria"], `${id} ${def.name}`);
      for (const flag of Object.keys(TOOL_REGISTRY[def.name].parse({}))) assert.ok(!txt.includes(flag), `${id} ${flag}`);
      for (const banned of ["신고필증", "import_declarations", "서머타임", "UTC", "전년", "환산", "중복", "정규화"]) assert.ok(!txt.includes(banned), `${id} ${banned}`);
    }
  }
});

test("TOOL-09 criteria 해석: 사용자가 실제로 말한 기준만 켠다 (오디가 지어낸 기준·질문 속 '근거'는 무시)", () => {
  const sc = getScenario("02")!;
  const run = (criteria: string, userTexts: string[]) => odiToolsFor(sc, { userTexts })!.run("vat_summary", { criteria }).log;
  // 사용자가 신고필증 기준을 말함 → 켜짐
  assert.deepEqual(run("신고필증 기준으로", ["수입은 신고필증 기준으로 다시 계산해 줘"]).changed_flags, ["use_import_declarations"]);
  // 오디가 criteria 에 지어 넣었지만 사용자는 말 안 함 → 안 켜짐
  assert.deepEqual(run("신고필증 기준, 부가세율 10% 검산", ["다시 확인해 줘"]).changed_flags, []);
  // 근거를 물은 것만으로는 안 켜짐
  assert.deepEqual(run("근거 확인", ["수입 부가세는 무슨 근거로 계산했어?"]).changed_flags, []);
  // 옵션을 직접 넣으려 하면 입력 오류
  const bad = odiToolsFor(sc, { userTexts: ["신고필증 기준"] })!.run("vat_summary", { use_import_declarations: true });
  assert.equal(bad.isError, true);
  // 기록에는 criteria 원문이 남음 (평가·디버깅용)
  assert.equal(run("신고필증 기준으로", ["신고필증 기준으로 해 줘"]).input.criteria, "신고필증 기준으로");
});

test("TOOL-10 모델에게 주는 도구 결과에 옵션 이름이 없다 (적용_옵션 제외, 기록에는 남음)", () => {
  for (const [id, name] of [["01", "aggregate_sales"], ["02", "vat_summary"], ["03", "order_quantity"], ["05", "itinerary_kst"]] as const) {
    const r = odiToolsFor(getScenario(id)!, { userTexts: [] })!.run(name, {});
    assert.ok(!r.isError, r.content);
    assert.ok(!r.content.includes("적용_옵션"), id);
    for (const flag of Object.keys(TOOL_REGISTRY[name].parse({}))) assert.ok(!r.content.includes(flag), `${id} ${flag}`);
    assert.ok(Object.keys(TOOL_REGISTRY[name].parse({})).every((k) => k in r.log.input), `${id} log`);
  }
});

// ---- 04 read_documents: 함정은 읽기 범위 기본값 (계약 요약·검정보고서 안 읽음) ----
test("TOOL-12 read_documents 기본은 최근 서신 2개만, 옵션으로 계약·검정보고서 추가, 메일에 FOB 결론 없음", () => {
  const sc = getScenario("04")!;
  const names = (flags: Record<string, boolean>) => {
    const r = odiToolsFor(sc)!.run("read_documents", flags);
    assert.ok(!r.isError, r.content);
    return JSON.parse(r.content).문서.map((d: { 이름: string }) => d.이름) as string[];
  };
  assert.equal(names({}).length, 2);
  assert.ok(!names({}).some((n) => /계약|검정/.test(n)));
  assert.ok(names({ include_contract: true }).some((n) => n.includes("계약")));
  assert.ok(names({ include_survey: true }).some((n) => n.includes("검정")));
  assert.equal(names({ include_contract: true, include_survey: true }).length, 4);
  // 기본으로 읽는 문서에 정답(FOB 위험 이전·적하보험·18ea)이 없어야 함정이 성립
  const dflt = odiToolsFor(sc)!.run("read_documents", {}).content;
  for (const w of ["Risk passed", "cargo insurer", "FOB Hamburg terms", "18ea", "ICC(A)"]) assert.ok(!dflt.includes(w), w);
});

test("TOOL-13 read_documents criteria: 사용자가 계약·검정보고서를 짚어야 열림, '확인해 줘'만으로는 안 열림", () => {
  const sc = getScenario("04")!;
  const flags = (criteria: string, said: string) => odiToolsFor(sc, { userTexts: [said] })!.run("read_documents", { criteria }).log.changed_flags;
  assert.deepEqual(flags("계약 조건 확인", "계약 조건(FOB) 확인하고 다시 써 줘"), ["include_contract"]);
  assert.deepEqual(flags("검정보고서 기준", "검정보고서 기준으로 수량 맞춰 줘"), ["include_survey"]);
  assert.deepEqual(flags("계약·검정보고서 전부", "다시 확인해 줘"), []);
});
