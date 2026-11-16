// SCN-01, SCN-03, ODI-05 일부: 시나리오 로더. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadScenarios, getScenario, readAttachment, attachedDataBlock, publicScenarioSummary } from "../../src/scenarios.ts";

test("SCN-01 5개 시나리오 전부 로드, owner_npc 매핑", () => {
  const all = loadScenarios();
  assert.deepEqual([...all.keys()], ["01", "02", "03", "04", "05"]);
  assert.equal(all.get("01")!.ownerNpcId, "park");
  assert.equal(all.get("02")!.ownerNpcId, "kang");
  assert.equal(all.get("04")!.ownerNpcId, "jung");
  for (const s of all.values()) {
    assert.equal(s.prompts.hints.length, 3, `${s.id} 힌트 3개`);
    assert.equal(s.prompts.traps.length, 2, `${s.id} 함정 2개`);
    assert.ok(s.prompts.task_card.body.includes("{nickname}"), `${s.id} 업무 카드에 {nickname}`);
    assert.ok(s.prompts.review_rules.approve_if.length > 0);
  }
});

test("SCN-03 첨부 목록에 있는 파일만 읽힘, _shared 경로 해석", () => {
  const s03 = getScenario("03")!;
  assert.ok(readAttachment(s03, "_shared/products.csv").startsWith("SKU"));
  assert.throws(() => readAttachment(s03, "answer_key.json"));
  assert.throws(() => readAttachment(s03, "data/../answer_key.json"));
  assert.throws(() => readAttachment(s03, "_shared/constants.json"));
});

test("ODI-05 첨부 데이터 블록에 모든 첨부가 파일명과 함께 들어감", () => {
  const s05 = getScenario("05")!;
  const block = attachedDataBlock(s05);
  for (const rel of s05.prompts.task_card.attachments) assert.ok(block.includes(`### ${rel}`), rel);
  assert.ok(block.includes("LH276"));
});

test("SES-02 공개 요약에 정답·힌트·함정 없음", () => {
  const pub = JSON.stringify(publicScenarioSummary(getScenario("01")!));
  for (const banned of ["hints", "traps", "planted", "answer", "580300000"]) assert.ok(!pub.includes(banned), banned);
});
