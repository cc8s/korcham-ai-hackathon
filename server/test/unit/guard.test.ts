// 비용 방어: 단가 계산, 이력 자르기, 지출 집계, 팀원 대화 수. 실행: npm run test:unit
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dbFile = path.resolve("data", "unit_guard.db");
process.env.DB_PATH = dbFile;
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const db = await import("../../src/db.ts");
const g = await import("../../src/guard.ts");

after(() => {
  db.db.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
});

const u = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite });

test("단가: Opus 5.5 입력 100만 + 출력 100만 = $24", () => {
  assert.equal(g.costUsd("claude-opus-5-5", u(1e6, 1e6)), 24);
});

test("단가: 캐시 읽기는 싸고 캐시 쓰기는 입력가 1.25배", () => {
  assert.equal(g.costUsd("claude-opus-5-5", u(0, 0, 1e6)), 0.2);
  assert.equal(g.costUsd("claude-opus-5-5", u(0, 0, 0, 1e6)), 5);
});

test("단가: 표에 없는 모델은 비싸게 잡는다", () => {
  assert.ok(g.costUsd("claude-unknown-9", u(1e6, 0)) > g.costUsd("claude-opus-5-5", u(1e6, 0)));
});

test("지출 기록이 오늘 합계에 더해진다", () => {
  const before = g.spentToday();
  g.recordSpend({ kind: "odi", model: "claude-opus-5-5", usage: u(1e6, 0) });
  assert.equal(Math.round((g.spentToday() - before) * 100) / 100, 4);
});

test("이력 자르기: 상한 이하면 그대로", () => {
  const turns = [
    { role: "user" as const, content: "a".repeat(10) },
    { role: "assistant" as const, content: "b".repeat(10) },
    { role: "user" as const, content: "c" },
  ];
  assert.equal(g.trimTurns(turns, 100), turns);
});

test("이력 자르기: 오래된 쌍부터 버리고 user 로 시작, 마지막 질문은 유지", () => {
  const turns = [];
  for (let i = 0; i < 10; i++) {
    turns.push({ role: "user" as const, content: `q${i}`.padEnd(100, ".") });
    turns.push({ role: "assistant" as const, content: `a${i}`.padEnd(100, ".") });
  }
  turns.push({ role: "user" as const, content: "now" });
  const out = g.trimTurns(turns, 1000);
  assert.equal(out[0].role, "user");
  assert.equal(out.at(-1)!.content, "now");
  assert.ok(out.reduce((n, t) => n + t.content.length, 0) <= 1000);
});

test("이력 자르기: 한 쌍 늘어도 자르는 위치가 매번 바뀌지 않는다 (캐시 유지)", () => {
  const mk = (pairs: number) => {
    const t = [];
    for (let i = 0; i < pairs; i++) {
      t.push({ role: "user" as const, content: `q${i}`.padEnd(100, ".") });
      t.push({ role: "assistant" as const, content: `a${i}`.padEnd(100, ".") });
    }
    t.push({ role: "user" as const, content: "now" });
    return t;
  };
  const first = (pairs: number) => g.trimTurns(mk(pairs), 1000)[0].content.slice(0, 3);
  // 상한 1000, 40% 단위(400자=2쌍)로 자른다. 7쌍(초과 403자)·8쌍(603자)은 둘 다 800자를 버려 같은 위치,
  // 9쌍(803자)부터 1200자를 버려 위치가 바뀐다
  assert.equal(first(7), first(8));
  assert.notEqual(first(8), first(9));
});

test("팀원 대화 수: 제출 기록은 세지 않는다", () => {
  const s = db.createSession("민수", "1.2.3.4");
  const r = db.createRun(s.id, "01", "1.2.3.4");
  db.addMessage(r.id, "lee", "user", "힌트 주세요");
  db.addMessage(r.id, "lee", "assistant", "...");
  db.addMessage(r.id, "park", "user", "(제출 1차) 메모", { submission: 1 });
  db.addMessage(r.id, "odi", "user", "표 만들어 줘");
  assert.equal(g.npcCallsForRun(r.id), 1);
});

test("IP·세션별 오늘 횟수", () => {
  const s = db.createSession("지수", "9.9.9.9");
  db.createRun(s.id, "01", "9.9.9.9");
  db.createRun(s.id, "02", "9.9.9.9");
  assert.equal(g.sessionsFromIpToday("9.9.9.9"), 1);
  assert.equal(g.runsFromIpToday("9.9.9.9"), 2);
  assert.equal(g.runsForSessionToday(s.id), 2);
  assert.equal(g.runsFromIpToday("8.8.8.8"), 0);
});
