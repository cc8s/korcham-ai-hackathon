import type { Request, Response } from "express";
import { db } from "./db.js";
import { config } from "./config.js";
import type { ChatTurn, Usage } from "./llm.js";

// 공개 링크 비용 방어 (기획 피드백 5번). 마감(11/23)부터 본선(12/7)까지 링크가 열려 있어야 해서
// 1) 서버 전체 하루 지출 상한  2) IP·세션별 하루 시작 수  3) run 당 NPC 대화 수  4) 대화 이력 길이 상한
// 날짜는 한국 시간 기준. 상한 숫자는 전부 환경변수로 바꿀 수 있음 (config.guard)

// 1M 토큰당 달러. 2026-11 기준 claude-api 스킬 문서(models.md, prompt-caching.md) 값.
// 지출 상한 계산용 추정치이므로 실제 청구는 Console 에서 확인. 캐시 쓰기는 5분 TTL 1.25배
type Price = { input: number; output: number; cacheRead: number };
const PRICES: [prefix: string, price: Price][] = [
  ["claude-opus-5-5", { input: 4, output: 20, cacheRead: 0.2 }],
  ["claude-sonnet-5-5", { input: 2, output: 10, cacheRead: 0.1 }],
  ["claude-haiku-5-5", { input: 0.1, output: 0.5, cacheRead: 0.01 }],
];
// 표에 없는 모델은 비싸게 잡는다 (상한이 늦게 걸리는 것보다 일찍 걸리는 편이 안전)
const UNKNOWN: Price = { input: 10, output: 50, cacheRead: 1 };

export function priceOf(model: string): Price {
  return PRICES.find(([p]) => model.startsWith(p))?.[1] ?? UNKNOWN;
}

export function costUsd(model: string, u: Usage): number {
  const p = priceOf(model);
  return (u.input * p.input + u.output * p.output + u.cacheRead * p.cacheRead + u.cacheWrite * p.input * 1.25) / 1e6;
}

db.exec(`
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day TEXT NOT NULL,            -- 한국 날짜 YYYY-MM-DD
  run_id TEXT,
  kind TEXT NOT NULL,           -- 'odi' | 'npc' | 'review' | 'evaluate'
  model TEXT NOT NULL,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cache_read INTEGER NOT NULL, cache_write INTEGER NOT NULL,
  usd REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_spend_day ON spend(day);
`);

const TODAY = "date('now', '+9 hours')";
const kstDay = (col: string) => `date(${col}, '+9 hours')`;

export function recordSpend(args: { runId?: string; kind: string; model: string; usage: Usage }): number {
  const usd = costUsd(args.model, args.usage);
  db.prepare(
    `INSERT INTO spend (day, run_id, kind, model, input, output, cache_read, cache_write, usd)
     VALUES (${TODAY}, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(args.runId ?? null, args.kind, args.model, args.usage.input, args.usage.output, args.usage.cacheRead, args.usage.cacheWrite, usd);
  return usd;
}

export function spentToday(): number {
  const row = db.prepare(`SELECT COALESCE(SUM(usd), 0) AS usd FROM spend WHERE day = ${TODAY}`).get() as { usd: number };
  return row.usd;
}

// 실측용: 오늘 run 별 지출 (평균 1회 비용을 소개서에 쓰기 위해)
export function spendSummaryToday(): { usd: number; calls: number; runs: number } {
  return db
    .prepare(`SELECT COALESCE(SUM(usd),0) AS usd, COUNT(*) AS calls, COUNT(DISTINCT run_id) AS runs FROM spend WHERE day = ${TODAY}`)
    .get() as { usd: number; calls: number; runs: number };
}

export function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

export const BUDGET_MESSAGE = "오늘 준비한 체험 분량이 모두 소진됐어요. 내일 다시 와 주세요. (매일 0시 초기화)";

// 하루 지출 상한. 넘었으면 503 으로 응답하고 false. 동시에 들어온 호출은 상한을 조금 넘길 수 있음
export function checkBudget(res: Response): boolean {
  if (spentToday() < config.guard.dailyBudgetUsd) return true;
  res.status(503).json({ error: BUDGET_MESSAGE, code: "budget" });
  return false;
}

export function sessionsFromIpToday(ip: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM session WHERE ip = ? AND ${kstDay("created_at")} = ${TODAY}`).get(ip) as { n: number }).n;
}
export function runsFromIpToday(ip: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM run WHERE ip = ? AND ${kstDay("created_at")} = ${TODAY}`).get(ip) as { n: number }).n;
}
export function runsForSessionToday(sessionId: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM run WHERE session_id = ? AND ${kstDay("created_at")} = ${TODAY}`).get(sessionId) as { n: number }).n;
}
// run 의 팀원 대화 수. 제출 기록(meta.submission)은 대화가 아니라 뺀다
export function npcCallsForRun(runId: string): number {
  return (
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM message WHERE run_id = ? AND role = 'user' AND agent IN ('kang','park','jung','lee')
         AND (meta IS NULL OR meta NOT LIKE '%"submission"%')`,
      )
      .get(runId) as { n: number }
  ).n;
}

// 대화 이력 길이 상한. 오래된 주고받기(user+assistant 한 쌍)부터 버린다.
// 자르는 위치가 매 호출 바뀌면 이력 캐시가 매번 깨지므로, 상한의 40% 단위로 끊어서 자른다
export function trimTurns(turns: ChatTurn[], maxChars: number): ChatTurn[] {
  const len = (ts: ChatTurn[]) => ts.reduce((n, t) => n + t.content.length, 0);
  const total = len(turns);
  if (total <= maxChars) return turns;
  const step = Math.max(1, Math.floor(maxChars * 0.4));
  const mustDrop = Math.ceil((total - maxChars) / step) * step;
  let dropped = 0;
  let i = 0;
  // 마지막 턴(이번 질문)은 항상 남긴다. 첫 턴이 user 가 되도록 쌍 단위로
  while (i + 2 < turns.length && dropped < mustDrop) {
    dropped += turns[i].content.length + turns[i + 1].content.length;
    i += 2;
  }
  return turns.slice(i);
}
