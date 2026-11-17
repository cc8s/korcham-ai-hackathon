// MSK-01~03: LLM 출력의 정답 숫자 마스킹. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { answerNumbers, maskAnswers, maskNumbers, MASK_MIN } from "../../src/mask.ts";

const k01 = getScenario("01")!.answerKey;
const k02 = getScenario("02")!.answerKey;

test("MSK-01 answer_key 숫자 잎 전부, 1만 미만 제외", () => {
  const n01 = answerNumbers(k01);
  assert.ok(n01.includes(580300000) && n01.includes(9480000) && n01.includes(153250000));
  assert.ok(!n01.includes(0)); // 허용오차
  const n02 = answerNumbers(k02);
  for (const v of [58030000, 1769000, 3459242, 5228242, 52801758, 300000, 3021700]) assert.ok(n02.includes(v), String(v));
  assert.ok(answerNumbers({ a: [9999, 10000, { b: 123456 }] }).every((v) => v >= MASK_MIN));
  // 03 은 발주 수량이 두세 자리라 가릴 숫자가 없음 (임계값의 한계)
  assert.equal(answerNumbers(getScenario("03")!.answerKey).length, 0);
});

test("MSK-02 여러 표기를 가림: 쉼표 유무, 원, 만원, 억+만", () => {
  const cases: [string, string][] = [
    ["총매출은 580,300,000원이에요.", "총매출은 ○○○원이에요."],
    ["580300000 맞아요", "○○○ 맞아요"],
    ["58,030만원 정도", "○○○원 정도"],
    ["5억 8,030만 원입니다", "○○○원입니다"],
    ["대략 5.803억", "대략 ○○○"],
    ["납부세액 52,801,758, 수입 3,459,242원", "납부세액 ○○○, 수입 ○○○원"],
    ["1769000,3459242", "○○○,○○○"],
  ];
  const both = [...answerNumbers(k01), ...answerNumbers(k02)];
  for (const [src, want] of cases) assert.equal(maskNumbers(src, both), want, src);
});

test("MSK-03 정답이 아닌 숫자·작은 숫자·숫자 일부는 그대로", () => {
  const src = "거래처 10곳, 124행, 2026년 10월, 오디 결과 584,030,000원, 주문 ORD-20261095, 26.4%";
  assert.equal(maskAnswers(src, k01), src);
  // 정답 숫자를 포함하는 더 긴 숫자는 안 가림
  assert.equal(maskNumbers("1580300000", [580300000]), "1580300000");
  assert.equal(maskNumbers("5803000001", [580300000]), "5803000001");
  assert.equal(maskNumbers("아무 숫자 없음", []), "아무 숫자 없음");
});
