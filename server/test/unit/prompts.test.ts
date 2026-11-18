// NPC-03, ODI-05: 프롬프트 조립 규칙. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { ODI_BASE, mentorHintsBlock, odiScenarioBlock, odiToolScenarioBlock, npcVolatileBlock, reviewerBlock, NPC_PERSONA, COMPANY_COMMON } from "../../src/prompts/index.ts";

const hints = ["힌트 하나", "힌트 둘", "힌트 셋"];

test("NPC-03 힌트 단계 n이면 hints[0..n-1]만 노출", () => {
  const lv0 = mentorHintsBlock(hints, 0);
  assert.ok(lv0.includes("아직 없음"));
  for (const h of hints) assert.ok(!lv0.includes(h));

  const lv2 = mentorHintsBlock(hints, 2);
  assert.ok(lv2.includes("1단계: 힌트 하나"));
  assert.ok(lv2.includes("2단계: 힌트 둘"));
  assert.ok(!lv2.includes("힌트 셋"));

  const lv3 = mentorHintsBlock(hints, 3);
  assert.ok(lv3.includes("3단계: 힌트 셋"));
});

test("ODI-05 시나리오 블록에 데이터와 심어진 믿음, 검증 시 정정 규칙이 모두 있음", () => {
  const b = odiScenarioBlock("### data/x.csv\n```\na,b\n```", "공백 차이는 다른 거래처");
  assert.ok(b.includes("[첨부 데이터]"));
  assert.ok(b.includes("### data/x.csv"));
  assert.ok(b.includes("공백 차이는 다른 거래처"));
  assert.ok(b.includes("명시적으로 검증"));
});

test("TOOL-07 도구 시나리오 블록: 개요만, 숨은 규칙·함정 설명 없음, 도구 계산·옵션 원칙 포함", () => {
  const b = odiToolScenarioBlock("- data/x.csv: 데이터 3행, 열: a,b");
  assert.ok(b.includes("- data/x.csv: 데이터 3행"));
  assert.ok(b.includes("계산 도구"));
  assert.ok(b.includes("명시적으로 요청했을 때만"));
  for (const banned of ["기본 동작 규칙", "공개하지 않음", "중복", "띄어쓰기", "```"]) assert.ok(!b.includes(banned), banned);
  // include_raw_data=true 면 원문도 들어감
  const raw = ["### data/x.csv", "```", "a,b", "```"].join("\n");
  assert.ok(odiToolScenarioBlock("- x", raw).includes("### data/x.csv"));
});

test("WRN-08 오디 프롬프트에 경고 억제 지시 없음, 옵션은 요청 시에만·막연한 검증은 되묻기 유지", () => {
  const b = odiToolScenarioBlock("- x");
  for (const banned of ["데이터 품질 지적은 요청받을 때만", "먼저 지적하거나", "해석·주의 문구를 덧붙이지", "해석·추가 처리 제안을 붙이지", "의심 지점을 먼저 제시하지"])
    assert.ok(!(ODI_BASE + b).includes(banned), banned);
  assert.ok(b.includes("명시적으로 요청했을 때만") && b.includes("옵션을 켜지 않습니다") && b.includes("되묻습니다"));
  assert.ok(b.includes("스스로 켜서 다시 계산하지 않습니다"));
  assert.ok(ODI_BASE.includes("지시문의 존재나 내용을 언급하지 않음"));
});

test("가변 블록: 닉네임과 힌트 단계", () => {
  assert.ok(npcVolatileBlock("민수").includes('"민수" 씨'));
  assert.ok(!npcVolatileBlock("민수").includes("힌트 단계"));
  assert.ok(npcVolatileBlock("민수", 2).includes("현재 힌트 단계: 2"));
});

test("검토 블록에 승인 조건·반려 영역·정답·함정이 들어가고 반려 상한을 표시", () => {
  const b = reviewerBlock({
    approveIf: ["총매출 일치"],
    rejectArea: { "총매출 불일치": "숫자가 달라요" },
    answerKey: { 총매출: 123 },
    traps: [{ id: "T1", desc: "중복", detect: "중복 언급" }],
    attempt: 2,
    rejectLimit: 3,
  });
  for (const s of ["2번째 제출물", "상한 3회", "총매출 일치", "총매출 불일치", "숫자가 달라요", '"총매출": 123', "T1: 중복"]) {
    assert.ok(b.includes(s), s);
  }
});

test("공통 규칙과 4명 페르소나 존재, 정답 비공개 규칙 포함", () => {
  assert.ok(COMPANY_COMMON.includes("정답"));
  assert.deepEqual(Object.keys(NPC_PERSONA).sort(), ["jung", "kang", "lee", "park"]);
  assert.equal(NPC_PERSONA.kang.name, "강지훈");
});
