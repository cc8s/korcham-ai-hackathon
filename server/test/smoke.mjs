// 스모크: LLM 없이 되는 경로 + 더미 키로 LLM 실패 처리. API 키 불필요.
// 실행: npm run test:smoke   (07 문서 SES/SCN/NPC-01/SUB-01/ODI-02)
import { startServer, makeChecker } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
let srv;
try {
  srv = await startServer({ port: 8790, dbName: "smoke.db" });
  const { api } = srv;
  check("server boots", true);

  const health = await api("GET", "/health");
  check("GET /health lists 5 scenarios", health.json?.scenarios?.length === 5, JSON.stringify(health.json?.scenarios));

  check("SES-01 empty nickname 400", (await api("POST", "/session", { nickname: "  " })).status === 400);
  check("SES-01 21 chars 400", (await api("POST", "/session", { nickname: "가".repeat(21) })).status === 400);
  check("SES-01 1 char ok", (await api("POST", "/session", { nickname: "a" })).status === 200);
  check("SES-01 20 chars ok", (await api("POST", "/session", { nickname: "가".repeat(20) })).status === 200);
  const s = await api("POST", "/session", { nickname: "테스터" });
  check("POST /session ok", s.status === 200 && typeof s.json?.session_id === "string");
  const sid = s.json.session_id;

  check("SES-03 scenario 99 404", (await api("POST", "/scenario/99/start", { session_id: sid })).status === 404);
  check("start without session 400", (await api("POST", "/scenario/01/start", {})).status === 400);
  const st = await api("POST", "/scenario/01/start", { session_id: sid });
  check("POST /scenario/01/start ok", st.status === 200 && typeof st.json?.run_id === "string");
  check("SCN-02 nickname substituted", st.json?.task_card?.body?.includes("테스터 씨"), st.json?.task_card?.body?.slice(0, 40));
  check("SCN-02 no answer key in card", !JSON.stringify(st.json).includes("580300000") && !JSON.stringify(st.json).includes("580,300,000"));
  const rid = st.json.run_id;

  const d = await api("GET", `/run/${rid}/data/data/sales_2026_10.csv?search=1`);
  check("GET data attachment ok", d.status === 200 && d.json?.text?.startsWith("주문번호"), d.json?.text?.slice(0, 30));
  check("SCN-03 non-attachment 404", (await api("GET", `/run/${rid}/data/answer_key.json`)).status === 404);
  check("SCN-03 path traversal 404", (await api("GET", `/run/${rid}/data/data/../answer_key.json`)).status === 404);

  check("PUT basket ok", (await api("PUT", `/run/${rid}/basket`, { text: "합계표 초안" })).json?.ok === true);
  check("PUT basket 20001 chars 400", (await api("PUT", `/run/${rid}/basket`, { text: "x".repeat(20001) })).status === 400);

  check("SUB-01 memo 9 chars 400", (await api("POST", `/run/${rid}/submit`, { verify_memo: "123456789" })).status === 400);

  check("NPC-01 unknown npc 404", (await api("POST", `/run/${rid}/npc/kim`, { message: "안녕하세요" })).status === 404);
  check("NPC-02 hint to non-mentor 400", (await api("POST", `/run/${rid}/npc/park`, { hint_request: true })).status === 400);
  check("NPC-01 empty message 400", (await api("POST", `/run/${rid}/npc/park`, { message: "" })).status === 400);

  // 더미 키 → 인증 실패. 오디는 SSE error 이벤트, NPC 는 500 JSON
  const odi = await api("POST", `/run/${rid}/odi`, { message: "거래처별 합계표 만들어 줘" });
  check("ODI-02 dummy key -> SSE error event", odi.status === 200 && odi.text.includes("event: error"), `status=${odi.status} body=${odi.text.slice(0, 120)}`);
  const npc = await api("POST", `/run/${rid}/npc/park`, { message: "마감 언제예요?" });
  check("NPC dummy key -> 500", npc.status === 500, JSON.stringify(npc.json));

  const run = await api("GET", `/run/${rid}`);
  check("GET run ok", run.status === 200 && run.json?.run?.id === rid);
  check("ODI-02 failed calls not counted", run.json?.run?.odi_calls_used === 0 && run.json?.messages?.length === 0);
  check("basket persisted", run.json?.run?.basket_text === "합계표 초안");

  check("evaluate before close 409", (await api("POST", `/run/${rid}/evaluate`)).status === 409);

  const sess = await api("GET", `/session/${sid}`);
  check("GET session shows run state", sess.json?.scenarios?.find((x) => x.id === "01")?.run?.state === "assigned");
  check("SES-02 hides hints/traps", !JSON.stringify(sess.json).includes("hints") && !JSON.stringify(sess.json).includes("traps"));
  check("SES-03 unknown session 404", (await api("GET", "/session/nope")).status === 404);
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("smoke");
