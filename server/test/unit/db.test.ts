// DB 계층: 상태 갱신, 이력 분리, 열람 기록. 실행: npm run test:unit
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dbFile = path.resolve("data", "unit.db");
process.env.DB_PATH = dbFile;
for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });

const db = await import("../../src/db.ts");

after(() => {
  db.db.close();
  for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) fs.rmSync(f, { force: true });
});

test("세션·run 생성과 기본값", () => {
  const s = db.createSession("민수");
  const r = db.createRun(s.id, "01");
  assert.equal(r.state, "assigned");
  assert.equal(r.reject_count, 0);
  assert.equal(r.hint_level, 0);
  assert.equal(r.odi_calls_used, 0);
  assert.equal(r.basket_text, "");
  assert.equal(db.listRunsForSession(s.id).length, 1);
});

test("updateRun 은 준 필드만 바꾸고 updated_at 갱신", () => {
  const s = db.createSession("민수");
  const r = db.createRun(s.id, "02");
  const u = db.updateRun(r.id, { state: "working", odi_calls_used: 3 });
  assert.equal(u.state, "working");
  assert.equal(u.odi_calls_used, 3);
  assert.equal(u.hint_level, 0);
  assert.deepEqual(db.updateRun(r.id, {}), u);
});

test("NPC-04 메시지 이력은 agent 별로 분리 조회", () => {
  const s = db.createSession("민수");
  const r = db.createRun(s.id, "01");
  db.addMessage(r.id, "odi", "user", "표 만들어 줘");
  db.addMessage(r.id, "odi", "assistant", "표입니다");
  db.addMessage(r.id, "lee", "user", "힌트", { hint_request: true });
  db.addMessage(r.id, "lee", "assistant", "검증부터요");
  assert.equal(db.listMessages(r.id, "odi").length, 2);
  assert.equal(db.listMessages(r.id, "lee").length, 2);
  assert.equal(db.listMessages(r.id).length, 4);
  assert.equal(JSON.parse(db.listMessages(r.id, "lee")[0].meta!).hint_request, true);
});

test("열람 기록과 제출·검토 저장", () => {
  const s = db.createSession("민수");
  const r = db.createRun(s.id, "01");
  db.addDataView(r.id, "data/sales_2026_10.csv", true, false);
  const views = db.listDataViews(r.id);
  assert.equal(views.length, 1);
  assert.equal(views[0].used_sort, 1);
  assert.equal(views[0].used_search, 0);

  const id = db.addSubmission(r.id, 1, "본문", "메모");
  db.setSubmissionReview(id, { decision: "reject", area: "총매출 불일치" });
  const subs = db.listSubmissions(r.id);
  assert.equal(subs.length, 1);
  assert.equal(JSON.parse(subs[0].review_json!).area, "총매출 불일치");

  assert.equal(db.getEvaluation(r.id), undefined);
  db.addEvaluation(r.id, { total: 78 });
  assert.deepEqual(db.getEvaluation(r.id), { total: 78 });
});
