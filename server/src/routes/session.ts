import { Router } from "express";
import { createSession, getSession, listRunsForSession, createRun } from "../db.js";
import { loadScenarios, getScenario, publicScenarioSummary } from "../scenarios.js";
import { emit } from "../events.js";
import { config } from "../config.js";
import { checkBudget, clientIp, sessionsFromIpToday, runsFromIpToday, runsForSessionToday } from "../guard.js";

const DAILY_LIMIT_MESSAGE = "오늘 이용할 수 있는 횟수를 모두 썼어요. 내일 다시 와 주세요. (매일 0시 초기화)";

export const sessionRouter = Router();

// POST /session { nickname } → { session_id, nickname }
// 닉네임만 받음. 실명·연락처는 받지 않음 (대회 규정: 외부 AI API에 실제 개인정보 금지)
sessionRouter.post("/session", (req, res) => {
  const raw = typeof req.body?.nickname === "string" ? req.body.nickname.trim() : "";
  if (raw.length < 1 || raw.length > 20) {
    res.status(400).json({ error: "닉네임은 1~20자" });
    return;
  }
  if (!checkBudget(res)) return;
  const ip = clientIp(req);
  if (sessionsFromIpToday(ip) >= config.guard.sessionsPerIpDay) {
    res.status(429).json({ error: DAILY_LIMIT_MESSAGE, code: "ip_sessions" });
    return;
  }
  const s = createSession(raw, ip);
  res.json({ session_id: s.id, nickname: s.nickname });
});

// GET /session/:id → 진행 현황 (S6 시나리오 선택 화면용)
sessionRouter.get("/session/:id", (req, res) => {
  const s = getSession(req.params.id);
  if (!s) {
    res.status(404).json({ error: "세션 없음" });
    return;
  }
  const runs = listRunsForSession(s.id);
  const scenarios = [...loadScenarios().values()].map((sc) => {
    const run = runs.filter((r) => r.scenario_id === sc.id).at(-1);
    return {
      ...publicScenarioSummary(sc),
      run: run
        ? { id: run.id, state: run.state, reject_count: run.reject_count, odi_calls_used: run.odi_calls_used }
        : null,
    };
  });
  res.json({ session_id: s.id, nickname: s.nickname, scenarios });
});

// POST /scenario/:sid/start { session_id } → run 생성 + 업무 카드
sessionRouter.post("/scenario/:sid/start", (req, res) => {
  const sc = getScenario(req.params.sid);
  if (!sc) {
    res.status(404).json({ error: "시나리오 없음" });
    return;
  }
  const s = typeof req.body?.session_id === "string" ? getSession(req.body.session_id) : undefined;
  if (!s) {
    res.status(400).json({ error: "session_id 필요" });
    return;
  }
  // 새 업무 시작이 비용이 드는 단위라 여기서 하루 상한을 건다
  if (!checkBudget(res)) return;
  const ip = clientIp(req);
  if (runsFromIpToday(ip) >= config.guard.runsPerIpDay || runsForSessionToday(s.id) >= config.guard.runsPerSessionDay) {
    res.status(429).json({ error: DAILY_LIMIT_MESSAGE, code: "daily_runs" });
    return;
  }
  const run = createRun(s.id, sc.id, ip);
  const card = sc.prompts.task_card;
  const body = card.body.replaceAll("{nickname}", s.nickname);
  emit({ type: "scenario.start", run_id: run.id, npc_id: sc.ownerNpcId, text: body.split(/(?<=[.!?。])\s/)[0] });
  res.json({
    run_id: run.id,
    state: run.state,
    scenario: publicScenarioSummary(sc),
    task_card: { ...card, body },
  });
});
