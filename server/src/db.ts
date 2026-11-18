import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// 04 문서 6절 데이터 모델. run.basket_text 는 바구니 저장용으로 추가
db.exec(`
CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS run (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  scenario_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'assigned',
  reject_count INTEGER NOT NULL DEFAULT 0,
  hint_level INTEGER NOT NULL DEFAULT 0,
  odi_calls_used INTEGER NOT NULL DEFAULT 0,
  basket_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES run(id),
  agent TEXT NOT NULL,          -- 'odi' | npc_id ('kang','park','jung','lee') | 'mail'
  role TEXT NOT NULL,           -- 'user' | 'assistant'
  content TEXT NOT NULL,
  meta TEXT,                    -- JSON: hint_request, usage 등
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_message_run ON message(run_id, agent, id);
CREATE TABLE IF NOT EXISTS data_view (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES run(id),
  file TEXT NOT NULL,
  opened_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_sort INTEGER NOT NULL DEFAULT 0,
  used_search INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS submission (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES run(id),
  attempt INTEGER NOT NULL,
  basket_text TEXT NOT NULL,
  verify_memo TEXT NOT NULL,
  review_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS evaluation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES run(id),
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);
// 비용 방어(guard.ts)용 ip 열. 예전 DB 에도 붙도록 없으면 추가
for (const table of ["session", "run"]) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === "ip")) db.exec(`ALTER TABLE ${table} ADD COLUMN ip TEXT`);
}
// 구조화 제출(grading.ts)용 열. fields_json = 입력한 칸 값, grading_json = 코드 채점 결과
{
  const cols = db.prepare(`PRAGMA table_info(submission)`).all() as { name: string }[];
  for (const col of ["fields_json", "grading_json", "email_json"]) {
    if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE submission ADD COLUMN ${col} TEXT`);
  }
}

export type RunState =
  | "assigned"
  | "working"
  | "reviewing"
  | "rejected"
  | "approved"
  | "evaluated";

export interface SessionRow {
  id: string;
  nickname: string;
  created_at: string;
}
export interface RunRow {
  id: string;
  session_id: string;
  scenario_id: string;
  state: RunState;
  reject_count: number;
  hint_level: number;
  odi_calls_used: number;
  basket_text: string;
  created_at: string;
  updated_at: string;
}
export interface MessageRow {
  id: number;
  run_id: string;
  agent: string;
  role: "user" | "assistant";
  content: string;
  meta: string | null;
  created_at: string;
}
export interface DataViewRow {
  id: number;
  run_id: string;
  file: string;
  opened_at: string;
  used_sort: number;
  used_search: number;
}
export interface SubmissionRow {
  id: number;
  run_id: string;
  attempt: number;
  basket_text: string;
  verify_memo: string;
  review_json: string | null;
  fields_json: string | null;
  grading_json: string | null;
  email_json: string | null; // 결과물 제출 메일 (email.ts)
  created_at: string;
}

// ---- session ----
// ip 는 비용 방어용 하루 횟수 집계에만 쓴다 (guard.ts)
export function createSession(nickname: string, ip: string | null = null): SessionRow {
  const id = randomUUID();
  db.prepare("INSERT INTO session (id, nickname, ip) VALUES (?, ?, ?)").run(id, nickname, ip);
  return getSession(id)!;
}
export function getSession(id: string): SessionRow | undefined {
  return db.prepare("SELECT * FROM session WHERE id = ?").get(id) as SessionRow | undefined;
}
export function listRunsForSession(sessionId: string): RunRow[] {
  return db
    .prepare("SELECT * FROM run WHERE session_id = ? ORDER BY created_at")
    .all(sessionId) as RunRow[];
}

// ---- run ----
export function createRun(sessionId: string, scenarioId: string, ip: string | null = null): RunRow {
  const id = randomUUID();
  db.prepare("INSERT INTO run (id, session_id, scenario_id, ip) VALUES (?, ?, ?, ?)").run(
    id,
    sessionId,
    scenarioId,
    ip,
  );
  return getRun(id)!;
}
export function getRun(id: string): RunRow | undefined {
  return db.prepare("SELECT * FROM run WHERE id = ?").get(id) as RunRow | undefined;
}
export function updateRun(
  id: string,
  patch: Partial<Pick<RunRow, "state" | "reject_count" | "hint_level" | "odi_calls_used" | "basket_text">>,
): RunRow {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (keys.length > 0) {
    const sets = keys.map((k) => `${k} = @${k}`).join(", ");
    db.prepare(`UPDATE run SET ${sets}, updated_at = datetime('now') WHERE id = @id`).run({
      ...patch,
      id,
    });
  }
  return getRun(id)!;
}

// ---- message ----
export function addMessage(
  runId: string,
  agent: string,
  role: "user" | "assistant",
  content: string,
  meta?: Record<string, unknown>,
): number {
  const r = db
    .prepare("INSERT INTO message (run_id, agent, role, content, meta) VALUES (?, ?, ?, ?, ?)")
    .run(runId, agent, role, content, meta ? JSON.stringify(meta) : null);
  return Number(r.lastInsertRowid);
}
export function listMessages(runId: string, agent?: string): MessageRow[] {
  if (agent) {
    return db
      .prepare("SELECT * FROM message WHERE run_id = ? AND agent = ? ORDER BY id")
      .all(runId, agent) as MessageRow[];
  }
  return db.prepare("SELECT * FROM message WHERE run_id = ? ORDER BY id").all(runId) as MessageRow[];
}

// ---- data_view ----
export function addDataView(runId: string, file: string, usedSort: boolean, usedSearch: boolean): void {
  db.prepare(
    "INSERT INTO data_view (run_id, file, used_sort, used_search) VALUES (?, ?, ?, ?)",
  ).run(runId, file, usedSort ? 1 : 0, usedSearch ? 1 : 0);
}
export function listDataViews(runId: string): DataViewRow[] {
  return db.prepare("SELECT * FROM data_view WHERE run_id = ? ORDER BY id").all(runId) as DataViewRow[];
}

// ---- submission ----
export function addSubmission(
  runId: string,
  attempt: number,
  basketText: string,
  verifyMemo: string,
  fields?: Record<string, number | string>, // 숫자 칸은 number, 선택 칸은 보기 id
  grading?: unknown,
  email?: unknown,
): number {
  const r = db
    .prepare(
      "INSERT INTO submission (run_id, attempt, basket_text, verify_memo, fields_json, grading_json, email_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      runId,
      attempt,
      basketText,
      verifyMemo,
      fields ? JSON.stringify(fields) : null,
      grading ? JSON.stringify(grading) : null,
      email ? JSON.stringify(email) : null,
    );
  return Number(r.lastInsertRowid);
}
export function setSubmissionReview(id: number, review: unknown): void {
  db.prepare("UPDATE submission SET review_json = ? WHERE id = ?").run(JSON.stringify(review), id);
}
export function listSubmissions(runId: string): SubmissionRow[] {
  return db.prepare("SELECT * FROM submission WHERE run_id = ? ORDER BY attempt").all(runId) as SubmissionRow[];
}

// ---- evaluation ----
export function addEvaluation(runId: string, report: unknown): void {
  db.prepare("INSERT INTO evaluation (run_id, report_json) VALUES (?, ?)").run(runId, JSON.stringify(report));
}
export function getEvaluation(runId: string): unknown | undefined {
  const row = db.prepare("SELECT report_json FROM evaluation WHERE run_id = ? ORDER BY id DESC LIMIT 1").get(runId) as
    | { report_json: string }
    | undefined;
  return row ? JSON.parse(row.report_json) : undefined;
}
