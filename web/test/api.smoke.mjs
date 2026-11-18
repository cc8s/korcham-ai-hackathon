// 프론트 API 클라이언트를 mock 서버에 붙여 S0→S5 흐름을 코드로 재현한다 (브라우저 없이).
// 실행: npm run test:api   (web/ 에서). server 의 하네스를 재사용. API 키 불필요.
import { startServer, makeChecker, testPort } from "../../server/test/_harness.mjs";
import WebSocket from "../../server/node_modules/ws/index.js";

// Node 20 에는 전역 WebSocket 이 없음 (22+ 부터). 브라우저와 같은 이름으로 주입
if (typeof globalThis.WebSocket === "undefined") globalThis.WebSocket = WebSocket;

const PORT = testPort(8792);
process.env.VITE_API_BASE = `http://localhost:${PORT}`;
const { check, finish, fail } = makeChecker();
let srv;
try {
  srv = await startServer({ port: PORT, dbName: "web-api.db", env: { LLM_MOCK: "1" } });
  const { api, odiStream, connectEvents, ApiError } = await import("../src/api.ts");

  // S0
  const s = await api.createSession("프론트");
  check("S0 createSession", typeof s.session_id === "string" && s.nickname === "프론트");
  await api.createSession("   ").then(
    () => check("S0 빈 닉네임은 서버 400", false),
    (e) => check("S0 ApiError 에 status/message", e instanceof ApiError && e.status === 400 && e.message.includes("닉네임")),
  );

  // S6
  const info = await api.getSession(s.session_id);
  check("S6 getSession 5 scenarios, run null", info.scenarios.length === 5 && info.scenarios.every((x) => x.run === null));
  const st = await api.startScenario("01", s.session_id);
  check("S6 startScenario task_card", st.task_card.body.includes("프론트 씨") && st.scenario.owner_npc_id === "park");
  const rid = st.run_id;

  // WS
  const events = [];
  // 연결이 열린 뒤에 호출해야 이벤트를 놓치지 않음 (CI 에서 mock 오디가 연결보다 먼저 끝나 실패한 적 있음)
  let off;
  await new Promise((resolve) => {
    off = connectEvents(rid, (ev) => events.push(ev), resolve);
  });

  // S2 P4 데이터
  const d = await api.getData(rid, "data/sales_2026_10.csv");
  check("P4 getData", d.text.startsWith("주문번호"));
  await api.getData(rid, "data/sales_2026_10.csv", { sort: true });

  // S2 P2 오디 스트리밍 파서
  let acc = "";
  const done = await odiStream(rid, "거래처별 합계표 만들어 줘", (t) => (acc += t));
  check("P2 odiStream deltas accumulate", acc.startsWith("[mock] 거래처별"), acc);
  check("P2 odiStream done payload", done.odi_calls_used === 1 && done.odi_calls_limit === 15 && done.truncated === false, JSON.stringify(done));

  // P3 NPC + 힌트
  const intro = await api.scripted(rid, "lee", "intro");
  check("P3 mentor intro", intro.flow.met_mentor === true && intro.text.includes("박소연"));
  const brief = await api.scripted(rid, "park", "brief");
  check("P3 leader brief", brief.flow.briefed === true && brief.text.includes("프론트 씨"));
  const h = await api.npc(rid, "lee", "오디 팁 있어요?");
  check("P3 mentor chat", h.name === "이하늘");
  const q = await api.npc(rid, "park", "마감 언제예요?");
  check("P3 npc chat", q.text.startsWith("[mock]"));

  // 복구: getRun 에 이력 전부
  const run = await api.getRun(rid);
  check("GET run restores messages", run.messages.filter((m) => m.agent === "odi").length === 2 && run.messages.filter((m) => m.agent === "lee").length === 3);
  check("GET run counters", run.run.odi_calls_used === 1 && run.flow.briefed === true && run.run.closed === false);

  // S3 → S4 (반려 → 승인)
  // 01 은 구조화 제출: 칸 정의가 오고, 숫자는 서버 코드가 채점
  check("S3 submission_fields", run.submission_fields?.length === 3 && run.submission_fields[0].id === "total_sales");
  await api.putBasket(rid, "거래처 12곳 합계표, 비중 %");
  const r1 = await api.submit(rid, "원본 행 수 확인했습니다", { total_sales: 584030000, customer_count: 12, min_customer_sales: 6870000 });
  check("S4 reject", r1.decision === "reject" && r1.reject_count === 1 && r1.closed === false && r1.area === "총매출 불일치", JSON.stringify(r1));
  await api.putBasket(rid, "거래처 10곳 합계표, 중복 3건 제거, 비중 차트");
  const r2 = await api.submit(rid, "주문번호 중복 제거하고 거래처명 정규화했습니다", { total_sales: 580300000, customer_count: 10, min_customer_sales: 9480000 });
  check("S4 approve", r2.decision === "approve" && r2.state === "approved" && r2.closed === true, JSON.stringify(r2));

  // S5 평가 리포트 (LLM_MOCK 서버라 코칭은 규칙 기반)
  const rep = await api.evaluate(rid);
  check("S5 evaluate report", ["S", "A", "B", "C"].includes(rep.grade) && rep.axes.D_deliverable.approved === true && rep.axes.C_traps.traps.length === 2, JSON.stringify(rep).slice(0, 300));
  check("S5 resources", rep.resources.rejects === "1/3" && typeof rep.resources.duration_min === "number");

  await new Promise((r) => setTimeout(r, 300));
  off();
  const types = events.map((e) => e.type);
  check("WS events arrived", types.includes("odi.call.end") && types.includes("review.reject") && types.includes("review.approve"), types.join(","));

  const info2 = await api.getSession(s.session_id);
  check("S6 shows evaluated after report", info2.scenarios.find((x) => x.id === "01").run.state === "evaluated");
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("web api");
