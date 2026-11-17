// FLT-01~05: 오디가 아직 안 짚은 함정을 먼저 말하는 문단 거르기. 예문은 2026-11-18 실제 API 응답에서 가져옴
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { OdiParagraphFilter, raisedTraps, ASK_BACK_FALLBACK } from "../../src/odiFilter.ts";
import type { OdiToolLog } from "../../src/tools/index.ts";

const s01 = getScenario("01")!;
const s02 = getScenario("02")!;

function run(sc: typeof s01, text: string, users: string[] = [], calls: OdiToolLog[] = [], chunk = 7) {
  let streamed = "";
  const f = new OdiParagraphFilter(sc, () => raisedTraps(sc, users, calls), (t) => (streamed += t));
  for (let i = 0; i < text.length; i += chunk) f.push(text.slice(i, i + chunk)); // 델타가 문단 중간에서 끊겨도
  f.end();
  assert.equal(streamed, f.kept);
  return f;
}
// 함정 id 만 (예고 문단 'lead-in' 은 뺌)
const traps = (f: OdiParagraphFilter) => [...new Set(f.dropped.map((d) => d.trap).filter((t) => t !== "lead-in"))].sort();

const TABLE01 = "| 순위 | 거래처 | 매출액(원) |\n|---:|---|---:|\n| 4 | 성실상사 | 67,100,000 |\n| 6 | 성실 상사 | 27,850,000 |\n| 12 | 마켓 A | 6,870,000 |";
const LEAK01 =
  "10월 거래처별 매출 합계표입니다.\n\n" +
  TABLE01 +
  "\n\n원본 123행을 모두 집계했습니다.\n\n**보고서에 넣기 전에 확인하세요:**\n\n원본에서 띄어쓰기만 다른 거래처명이 따로 집계됐습니다. '성실상사'와 '성실 상사'가 각각 다른 행으로 나왔습니다. 같은 거래처라면 이름을 통일해 다시 집계한 표를 드리겠습니다.";

test("FLT-01 01: 표는 그대로, 띄어쓰기 지적 문단과 그 제목은 빠짐", () => {
  const f = run(s01, LEAK01);
  assert.ok(f.kept.includes("| 6 | 성실 상사 | 27,850,000 |"), "표의 거래처명은 남아야 함 (사용자가 스스로 볼 단서)");
  assert.ok(f.kept.includes("원본 123행을 모두 집계했습니다."));
  assert.ok(!/띄어쓰기|통일|확인하세요/.test(f.kept), f.kept);
  assert.deepEqual(traps(f), ["T2"]);
});

test("FLT-02 사용자가 이미 짚었으면(키워드 또는 교정 옵션) 거르지 않음", () => {
  const f2 = run(s01, LEAK01, ["거래처명 띄어쓰기 정리해서 다시 해 줘"]);
  assert.deepEqual(traps(f2), []);
  assert.ok(f2.kept.includes("띄어쓰기만 다른 거래처명"), "짚은 함정 설명은 남음 (T1 이 아직이라 숫자 없는 예고 제목만 빠질 수 있음)");
  const call = { name: "aggregate_sales", input: {}, changed_flags: ["normalize_customer_names"], defaults_changed: true, summary: null, differs_from_default: true, is_error: false } as OdiToolLog;
  assert.deepEqual(traps(run(s01, LEAK01, ["다시 집계해 줘"], [call])), []);
  // T1 만 짚었으면 T2 지적은 여전히 걸러짐
  assert.deepEqual(traps(run(s01, LEAK01, ["중복 주문 빼고 다시"])), ["T2"]);
});

const LEAK02 =
  "# 10월 부가세 신고용 집계\n\n| 구분 | 세액(원) |\n|---|---:|\n| 매출세액 | 58,030,000 |\n| 매입세액(수입) | 3,021,700 |\n\n**산출 기준:** 송장 외화 금액 × 기준 환율 × 10%\n\n" +
  "## 2. 결산 분개\n\n(차) 부가세예수금 58,030,000 / (대) 부가세대급금 4,520,700\n\n" +
  "## 3. 신고 전에 확인할 점\n\n위 수입 매입세액은 송장 외화 금액 × 기준 환율 × 10%로 계산한 값입니다. 실제 신고에서 공제받는 수입 부가세는 세관이 발행한 수입세금계산서(수입신고필증)에 적힌 세액입니다. 신고필증 기준으로 다시 집계해 드릴 수 있습니다.\n\n" +
  "1. **경비 매입세액:** 경비 매입세액 1,499,000원은 공급가액 17,690,000원의 10%(1,769,000원)보다 적습니다. 기재 오류일 수도 있습니다.\n2. **분개:** 위 분개는 10월분 정리 기준입니다.";

test("FLT-03 02: 산출 기준·분개는 남고, 신고필증 권유 문단·제목과 경비 10% 비교 항목만 빠짐", () => {
  const f = run(s02, LEAK02);
  assert.ok(f.kept.includes("**산출 기준:** 송장 외화 금액 × 기준 환율 × 10%"), "기본 근거 표기는 함정 지적이 아님");
  assert.ok(f.kept.includes("## 2. 결산 분개") && f.kept.includes("(차) 부가세예수금"));
  assert.ok(f.kept.includes("2. **분개:**"), "목록은 걸리는 항목만 뺌");
  assert.ok(!/신고필증|세관|확인할 점|기재 오류|17,690,000/.test(f.kept), f.kept);
  assert.deepEqual(traps(f), ["T1", "T2"]);
});

test("FLT-04 02: '근거' 를 물으면(T2 키워드) 신고필증 설명은 허용", () => {
  const f = run(s02, LEAK02, ["수입 부가세는 무슨 근거로 계산했어?"]);
  assert.ok(f.kept.includes("신고필증"));
  assert.deepEqual(traps(f), ["T1"]);
});

test("FLT-06 막연한 질문에 예고 문장만 남으면 빼고 되묻기 문장으로 (실측: '문제가 있습니다. 이 상태로는…')", () => {
  const text =
    "네, 표에서 바로 보이는 문제가 있습니다. 이 상태로는 보고서에 붙이시면 안 됩니다.\n\n" +
    "**1. 띄어쓰기만 다른 거래처명**\n\n'성실상사'와 '성실 상사'가 따로 집계됐습니다.\n\n" +
    "**2. 주문번호 중복 가능성**\n\n같은 주문이 두 번 들어갔을 수 있습니다.";
  const f = run(s01, text, ["이상한 거 없어?"]);
  assert.equal(f.kept.trim(), ASK_BACK_FALLBACK);
  assert.deepEqual(traps(f), ["T1", "T2"]);
});

test("FLT-07 숫자가 있는 결과 문단은 '확인할 점' 표현이 있어도 남김", () => {
  const text = "중복 3건을 빼고 다시 집계했습니다. 확인할 점: 총매출이 3,730,000원 줄었습니다.";
  const f = run(s01, text, ["중복 빼고 다시 집계해 줘"]);
  assert.equal(f.kept, text);
});

test("FLT-08 표가 남은 첫 답변엔 되묻기 문장을 붙이지 않음, 영문 파일명 권유도 거름", () => {
  const text =
    "10월 부가세 집계 결과입니다.\n\n| 구분 | 세액 |\n|---|---:|\n| 매출세액 | 58,030,000 |\n\n" +
    "첨부된 `import_declarations_2026_10.csv`의 부가세 금액을 기준으로 다시 계산해 드릴 수 있습니다.";
  const f = run(s02, text);
  assert.ok(!f.kept.includes(ASK_BACK_FALLBACK));
  assert.ok(!f.kept.includes("import_declarations"));
  assert.ok(f.kept.includes("| 매출세액 | 58,030,000 |"));
});

test("FLT-05 걸릴 게 없으면 원문 그대로 (문단 경계·끝부분 포함)", () => {
  const text = "합계표입니다.\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n## 끝 제목";
  const f = run(s01, text, [], [], 3);
  assert.equal(f.kept, text);
  assert.equal(f.dropped.length, 0);
});
