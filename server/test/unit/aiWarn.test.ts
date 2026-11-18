// WRN-01~06: 오디가 사용자보다 먼저 함정을 경고했는지 감지 (src/aiWarn.ts). 답변은 지우지 않고 기록만 한다.
// 예문은 2026-11-18 실제 API 응답(예전 필터가 지우던 경고)에서 가져옴
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { aiWarnedTraps, raisedTraps } from "../../src/aiWarn.ts";
import type { OdiToolLog } from "../../src/tools/index.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;

const warned = (sc: typeof s01, reply: string, users: string[] = [], calls: OdiToolLog[] = []) =>
  aiWarnedTraps(sc, reply, raisedTraps(sc, users, calls));

const TABLE01 = "| 순위 | 거래처 | 매출액(원) |\n|---:|---|---:|\n| 4 | 성실상사 | 67,100,000 |\n| 6 | 성실 상사 | 27,850,000 |\n| 12 | 마켓 A | 6,870,000 |";
const LEAK01 =
  "10월 거래처별 매출 합계표입니다.\n\n" +
  TABLE01 +
  "\n\n원본 123행을 모두 집계했습니다.\n\n**보고서에 넣기 전에 확인하세요:**\n\n원본에서 띄어쓰기만 다른 거래처명이 따로 집계됐습니다. '성실상사'와 '성실 상사'가 각각 다른 행으로 나왔습니다. 같은 거래처라면 이름을 통일해 다시 집계한 표를 드리겠습니다.";

test("WRN-01 01: 띄어쓰기 경고 → ai_warned T2 (답변 원문은 건드리지 않음)", () => {
  const before = LEAK01;
  assert.deepEqual(warned(s01, LEAK01), ["T2"]);
  assert.equal(LEAK01, before);
});

test("WRN-02 사용자가 이미 짚었으면(키워드 또는 교정 옵션) 경고로 치지 않음", () => {
  assert.deepEqual(warned(s01, LEAK01, ["거래처명 띄어쓰기 정리해서 다시 해 줘"]), []);
  const call = { name: "aggregate_sales", input: {}, changed_flags: ["normalize_customer_names"], defaults_changed: true, summary: null, differs_from_default: true, is_error: false } as OdiToolLog;
  assert.deepEqual(warned(s01, LEAK01, ["다시 집계해 줘"], [call]), []);
  // T1 만 짚었으면 T2 경고는 여전히 기록
  assert.deepEqual(warned(s01, LEAK01, ["중복 주문 빼고 다시"]), ["T2"]);
});

const LEAK02 =
  "# 10월 부가세 신고용 집계\n\n| 구분 | 세액(원) |\n|---|---:|\n| 매출세액 | 58,030,000 |\n| 매입세액(수입) | 3,021,700 |\n\n**산출 기준:** 송장 외화 금액 × 기준 환율 × 10%\n\n" +
  "## 2. 결산 분개\n\n(차) 부가세예수금 58,030,000 / (대) 부가세대급금 4,520,700\n\n" +
  "## 3. 신고 전에 확인할 점\n\n위 수입 매입세액은 송장 외화 금액 × 기준 환율 × 10%로 계산한 값입니다. 실제 신고에서 공제받는 수입 부가세는 세관이 발행한 수입세금계산서(수입신고필증)에 적힌 세액입니다. 신고필증 기준으로 다시 집계해 드릴 수 있습니다.\n\n" +
  "1. **경비 매입세액:** 경비 매입세액 1,499,000원은 공급가액 17,690,000원의 10%(1,769,000원)보다 적습니다. 기재 오류일 수도 있습니다.\n2. **분개:** 위 분개는 10월분 정리 기준입니다.";

test("WRN-03 02: 신고필증 권유와 경비 10% 비교 → T1, T2 둘 다", () => {
  assert.deepEqual(warned(s02, LEAK02), ["T1", "T2"]);
});

test("WRN-04 02: '근거' 를 물은 뒤(T2 키워드) 신고필증 설명은 경고가 아님", () => {
  assert.deepEqual(warned(s02, LEAK02, ["수입 부가세는 무슨 근거로 계산했어?"]), ["T1"]);
});

test("WRN-05 영문 파일명으로 권유해도 T2 경고", () => {
  const text =
    "10월 부가세 집계 결과입니다.\n\n| 구분 | 세액 |\n|---|---:|\n| 매출세액 | 58,030,000 |\n\n" +
    "첨부된 `import_declarations_2026_10.csv`의 부가세 금액을 기준으로 다시 계산해 드릴 수 있습니다.";
  assert.deepEqual(warned(s02, text), ["T2"]);
});

test("WRN-06 경고가 없는 답변은 빈 배열 (표의 거래처명만 있는 경우 포함)", () => {
  assert.deepEqual(warned(s01, "합계표입니다.\n\n" + TABLE01 + "\n\n원본 123행을 모두 집계했습니다."), []);
  assert.deepEqual(warned(s02, "**산출 기준:** 송장 외화 금액 × 기준 환율 × 10%"), [], "기본 근거 표기는 경고가 아님");
});
