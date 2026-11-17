// TOOL-01~05: 오디 계산 도구. 기본값은 함정 숫자, 교정 옵션은 answer_key 와 정확히 일치. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario, loadScenarios, readAttachment } from "../../src/scenarios.ts";
import { odiToolsFor, mockToolInput, TOOL_REGISTRY } from "../../src/tools/index.ts";
import { aggregateSales } from "../../src/tools/sales.ts";
import { vatSummary } from "../../src/tools/vat.ts";
import { parseCsv } from "../../src/tools/csv.ts";
import { constants } from "../../src/config.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;
const sales = readAttachment(s01, "data/sales_2026_10.csv");
const tx = readAttachment(s02, "data/transactions_2026_10.csv");
const imp = readAttachment(s02, "data/import_declarations_2026_10.csv");
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
    }
  }
  assert.ok(getScenario("01")!.odiTools && getScenario("02")!.odiTools);
  assert.equal(getScenario("03")!.odiTools, undefined);
});

test("TOOL-06 mock 옵션 규칙: 기본은 전부 false, 낱말에 따라 켬, 검증 요청은 전부", () => {
  const t = TOOL_REGISTRY["aggregate_sales"];
  assert.deepEqual(mockToolInput(t, "거래처별 합계표 만들어 줘"), { dedupe_order_ids: false, normalize_customer_names: false });
  assert.deepEqual(mockToolInput(t, "중복 제거해서 다시"), { dedupe_order_ids: true, normalize_customer_names: false });
  assert.deepEqual(mockToolInput(t, "거래처명 정규화해서 다시"), { dedupe_order_ids: false, normalize_customer_names: true });
  assert.deepEqual(mockToolInput(t, "다시 확인해 줘"), { dedupe_order_ids: true, normalize_customer_names: true });
});

test("CSV 파서: 따옴표 안 쉼표", () => {
  const { rows } = parseCsv('a,b\n1,"x, y"\n');
  assert.deepEqual(rows, [{ a: "1", b: "x, y" }]);
});
