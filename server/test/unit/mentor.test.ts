// MNT: 이하늘(사수) 고정 대사·추천 질문·수습 흐름. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { mentorFile, mentorIntro, mentorQuestions, mentorAnswer, leaderBrief, flowOf, mentorContextBlock } from "../../src/mentor.ts";
import { maskAnswers } from "../../src/mask.ts";
import { NPC_PERSONA } from "../../src/prompts/index.ts";
import type { MessageRow } from "../../src/db.ts";

const IDS = ["01", "02", "03", "04", "05"];
const msg = (agent: string, role: "user" | "assistant", meta?: object): MessageRow => ({
  id: 0,
  run_id: "r",
  agent,
  role,
  content: "x",
  meta: meta ? JSON.stringify(meta) : null,
  created_at: "",
});

test("MNT-01 고정 대사·추천 답에 함정 키워드와 정답 숫자가 없음 (5개 시나리오)", () => {
  for (const id of IDS) {
    const sc = getScenario(id)!;
    const texts = [mentorIntro(sc, "민수"), ...mentorQuestions(sc, "민수").map((q) => mentorAnswer(sc, "민수", q.id)!.a)];
    for (const t of texts) {
      for (const [tid, cfg] of Object.entries(sc.evalCfg.traps)) {
        const hit = new RegExp(cfg.keywords).exec(t);
        assert.equal(hit, null, `${id} ${tid} 키워드 '${hit?.[0]}' 가 하늘 고정 문장에 있음: ${t.slice(0, 40)}`);
      }
      assert.equal(maskAnswers(t, sc.answerKey), t, `${id} 정답 숫자가 하늘 고정 문장에 있음`);
    }
  }
});

test("MNT-02 자리표시자가 모두 채워지고, 담당 팀장 이름·첨부 파일이 들어감", () => {
  for (const id of IDS) {
    const sc = getScenario(id)!;
    const intro = mentorIntro(sc, "민수");
    assert.ok(!/\{\w+\}/.test(intro), `${id} intro`);
    assert.ok(intro.includes(NPC_PERSONA[sc.ownerNpcId].name), `${id} 팀장 이름`);
    for (const q of mentorQuestions(sc, "민수")) {
      const a = mentorAnswer(sc, "민수", q.id)!;
      assert.ok(!/\{\w+\}/.test(a.q + a.a), `${id} ${q.id}`);
    }
    const where = mentorAnswer(sc, "민수", "data_where")!.a;
    for (const f of sc.prompts.task_card.attachments) assert.ok(where.includes(f.split("/").pop()!), `${id} ${f}`);
    // 팀장 성향 답은 그 시나리오 담당 팀장 것
    assert.equal(mentorAnswer(sc, "민수", "leader_focus")!.a, mentorFile.faq.find((f) => f.id === "leader_focus")!.by_owner![sc.ownerNpcId]);
  }
  assert.equal(mentorAnswer(getScenario("01")!, "민수", "없는질문"), null);
});

test("MNT-03 하늘 자유 대화 맥락에 함정이 든 scenario_context_for_npc·심어진 믿음이 없음", () => {
  for (const id of IDS) {
    const sc = getScenario(id)!;
    const b = mentorContextBlock(sc, "민수");
    assert.ok(!b.includes(sc.prompts.scenario_context_for_npc), id);
    assert.ok(b.includes(leaderBrief(sc, "민수")), id);
    assert.ok(b.includes("모릅니다"), id);
  }
  assert.ok(!NPC_PERSONA.lee.block.includes("힌트"));
  assert.ok(NPC_PERSONA.lee.block.includes("모르는 것"));
});

test("MNT-04 흐름: 고정 대사 기록으로만 진행", () => {
  assert.deepEqual(flowOf([], "park"), { met_mentor: false, briefed: false });
  const intro = msg("lee", "assistant", { scripted: "intro" });
  assert.deepEqual(flowOf([intro], "park"), { met_mentor: true, briefed: false });
  // 다른 팀장의 brief 는 안 침
  assert.deepEqual(flowOf([intro, msg("kang", "assistant", { scripted: "brief" })], "park"), { met_mentor: true, briefed: false });
  assert.deepEqual(flowOf([intro, msg("park", "assistant", { scripted: "brief" })], "park"), { met_mentor: true, briefed: true });
  // 고정 대사 기록이 없으면 대화가 있어도 처음부터 (이 기능 전 도전)
  assert.deepEqual(flowOf([msg("odi", "user"), msg("odi", "assistant")], "park"), { met_mentor: false, briefed: false });
});
