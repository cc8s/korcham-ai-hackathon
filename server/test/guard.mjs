// 비용 방어 통합: 낮은 상한으로 서버를 띄워 실제 HTTP 응답을 확인. API 키 불필요 (LLM_MOCK)
// 실행: npm run test:guard   (07 문서 COST-01~05)
import { startServer, makeChecker, testPort } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
let srv;
try {
  // 1) IP·세션·팀원 대화 상한
  srv = await startServer({
    port: testPort(8794),
    dbName: "guard.db",
    env: { LLM_MOCK: "1", SESSIONS_PER_IP_DAY: "2", RUNS_PER_IP_DAY: "3", RUNS_PER_SESSION_DAY: "2", NPC_CALLS_PER_RUN: "2" },
  });
  let { api } = srv;
  const a = await api("POST", "/session", { nickname: "가" });
  const b = await api("POST", "/session", { nickname: "나" });
  const c = await api("POST", "/session", { nickname: "다" });
  check("COST-01 IP당 세션 2개까지", a.status === 200 && b.status === 200);
  check("COST-01 세 번째 세션 429 + 안내 문구", c.status === 429 && c.json?.code === "ip_sessions" && /내일/.test(c.json?.error), c.text);

  // 진행 중 업무는 하나만이라 바꿔 가며 시작 (replace). 하루 상한은 그보다 먼저 걸린다
  const start = (sid, sc) => api("POST", `/scenario/${sc}/start`, { session_id: sid, replace: true });
  const r1 = await start(a.json.session_id, "01");
  const r2 = await start(a.json.session_id, "02");
  const r3 = await start(a.json.session_id, "03");
  check("COST-02 세션당 하루 2회", r1.status === 200 && r2.status === 200 && r3.status === 429 && r3.json?.code === "daily_runs", r3.text);
  const r4 = await start(b.json.session_id, "01");
  const r5 = await start(b.json.session_id, "02");
  check("COST-02 IP당 하루 3회 (다른 세션이어도)", r4.status === 200 && r5.status === 429, `${r4.status} ${r5.status}`);

  const rid = r2.json.run_id; // r1 은 r2 를 시작하며 그만둔 업무
  const n1 = await api("POST", `/run/${rid}/npc/park`, { message: "질문 1" });
  const n2 = await api("POST", `/run/${rid}/npc/lee`, { message: "질문 2" });
  const n3 = await api("POST", `/run/${rid}/npc/kang`, { message: "질문 3" });
  check("COST-03 run당 팀원 대화 2회", n1.status === 200 && n2.status === 200 && n3.status === 429 && n3.json?.code === "npc_calls", n3.text);
  check("health open=true (상한 안)", (await api("GET", "/health")).json?.open === true);
  await srv.stop();

  // 2) 하루 지출 상한 0 → 새 세션·업무 시작·LLM 호출 전부 503
  srv = await startServer({ port: testPort(8795), dbName: "guard2.db", env: { LLM_MOCK: "1", DAILY_BUDGET_USD: "0" } });
  ({ api } = srv);
  const s = await api("POST", "/session", { nickname: "라" });
  check("COST-04 지출 상한 도달 시 세션 503 + 안내", s.status === 503 && s.json?.code === "budget" && /내일/.test(s.json?.error), s.text);
  check("COST-04 health open=false", (await api("GET", "/health")).json?.open === false);
  await srv.stop();

  // 3) 동시 요청·긴 글 (2026-11-22 보안 점검). mock 응답을 늦춰 실제처럼 호출이 겹치게 한다
  const port3 = testPort(8796);
  srv = await startServer({ port: port3, dbName: "guard3.db", env: { LLM_MOCK: "1", LLM_MOCK_DELAY_MS: "800", NPC_CALLS_PER_RUN: "3" } });
  ({ api } = srv);
  const sess = (await api("POST", "/session", { nickname: "마" })).json.session_id;
  const run = (await api("POST", "/scenario/01/start", { session_id: sess })).json.run_id;
  const odiLimit = (await api("GET", `/run/${run}`)).json.run.odi_calls_limit;
  const odi = (message) =>
    fetch(`http://localhost:${port3}/run/${run}/odi`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message }) }).then(
      async (r) => ({ status: r.status, body: await r.text() }),
    );
  const burst = await Promise.all(Array.from({ length: odiLimit + 5 }, () => odi("매출 합계 알려줘")));
  const ok = burst.filter((r) => r.status === 200 && r.body.includes("event: done")).length;
  const used = (await api("GET", `/run/${run}`)).json.run.odi_calls_used;
  check(`COST-06 오디 동시 ${odiLimit + 5}건 → ${odiLimit}건만 성공, 사용 횟수 ${odiLimit}`, ok === odiLimit && used === odiLimit, `ok=${ok} used=${used}`);
  const npcBurst = await Promise.all(Array.from({ length: 6 }, (_, i) => api("POST", `/run/${run}/npc/park`, { message: `동시 질문 ${i}` })));
  check(
    "COST-06 팀원 대화 동시 6건 → 상한 3건만",
    npcBurst.filter((r) => r.status === 200).length === 3 && npcBurst.filter((r) => r.status === 429).length === 3,
    npcBurst.map((r) => r.status).join(","),
  );
  const run2 = (await api("POST", "/scenario/02/start", { session_id: sess, replace: true })).json.run_id;
  const longOdi = await fetch(`http://localhost:${port3}/run/${run2}/odi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "가".repeat(4001) }),
  });
  const longNpc = await api("POST", `/run/${run2}/npc/kang`, { message: "가".repeat(1001) });
  check("COST-07 긴 글 거절 (오디 4,000자 · 팀원 1,000자 초과 → 400)", longOdi.status === 400 && longNpc.status === 400 && longNpc.json?.code === "too_long", `${longOdi.status} ${longNpc.status}`);
  const huge = await api("POST", `/run/${run2}/npc/kang`, { message: "a".repeat(300_000) });
  check("COST-07 본문 256KB 초과 → 413 (500 아님)", huge.status === 413, String(huge.status));
  check("COST-07 거절된 요청은 오디 횟수 안 씀", (await api("GET", `/run/${run2}`)).json.run.odi_calls_used === 0);
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("guard");
