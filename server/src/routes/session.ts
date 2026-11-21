import { isActive } from "../runState.js";
import { Router } from "express";
import { createSession, getSession, listRunsForSession, createRun, updateRun } from "../db.js";
import { loadScenarios, getScenario, publicScenarioSummary } from "../scenarios.js";
import { emit } from "../events.js";
import { maskPii } from "../pii.js";
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
  // 닉네임은 팀원 대사("○○ 씨")로 매번 Claude 에 들어간다. 연락처 같은 형식이 보이면 받지 않는다
  if (maskPii(raw).found.length > 0) {
    res.status(400).json({ error: "닉네임에 연락처 같은 개인정보는 넣지 말아 주세요. 별명을 써 주세요." });
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
    // 그만둔 도전은 배치표에서 미시작으로 보인다 (다시 담당하면 처음부터)
    const last = runs.filter((r) => r.scenario_id === sc.id).at(-1);
    const run = last && last.state !== "abandoned" ? last : undefined;
    return {
      ...publicScenarioSummary(sc),
      run: run
        ? { id: run.id, state: run.state, reject_count: run.reject_count, odi_calls_used: run.odi_calls_used }
        : null,
    };
  });
  res.json({ session_id: s.id, nickname: s.nickname, scenarios });
});

// GET /session/:id/runs → 이 세션의 모든 도전 (새로 도전하기 전의 run 포함). 상세는 GET /run/:rid.
// 세션 id 를 아는 사람만 볼 수 있음 (/session/:id 와 같은 수준). DB 조회만이라 비용 없음
sessionRouter.get("/session/:id/runs", (req, res) => {
  const s = getSession(String(req.params.id));
  if (!s) {
    res.status(404).json({ error: "세션 없음" });
    return;
  }
  res.json(
    listRunsForSession(s.id).map((r) => ({
      id: r.id,
      scenario_id: r.scenario_id,
      state: r.state,
      reject_count: r.reject_count,
      odi_calls_used: r.odi_calls_used,
      hint_level: r.hint_level,
      created_at: r.created_at,
    })),
  );
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
  // 진행 중인 도전은 하나만. 있으면 409 로 알려 주고, replace=true 면 그 도전을 그만두고 새로 시작
  const active = listRunsForSession(s.id).find(isActive);
  if (active) {
    if (req.body?.replace !== true) {
      const activeSc = getScenario(active.scenario_id);
      res.status(409).json({
        error: "진행 중인 업무가 있어요. 그만두고 바꿀지 먼저 정해 주세요.",
        code: "active_run",
        active: { run_id: active.id, scenario_id: active.scenario_id, title: activeSc?.prompts.task_card.title ?? "" },
      });
      return;
    }
    updateRun(active.id, { state: "abandoned" });
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
