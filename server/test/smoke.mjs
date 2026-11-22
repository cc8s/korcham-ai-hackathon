// 스모크: LLM 없이 되는 경로 + 더미 키로 LLM 실패 처리. API 키 불필요.
// 실행: npm run test:smoke   (SES/SCN/NPC-01/SUB-01/ODI-02)
import { startServer, makeChecker, testPort } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
let srv;
try {
  srv = await startServer({ port: testPort(8790), dbName: "smoke.db" });
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
  check("NPC-02 hint removed 410", (await api("POST", `/run/${rid}/npc/lee`, { hint_request: true })).status === 410);
  check("MNT-05 brief before mentor 409", (await api("POST", `/run/${rid}/npc/park/scripted`, { kind: "brief" })).status === 409);
  check("MNT-05 brief from non-owner 400", (await api("POST", `/run/${rid}/npc/kang/scripted`, { kind: "brief" })).status === 400);
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

  // SUB-15: 구조화 제출은 팀장 멘트 호출이 실패해도(더미 키) 코드 판정으로 반려 처리, 멘트는 대체문
  const rid2 = (await api("POST", "/scenario/01/start", { session_id: sid, replace: true })).json.run_id;
  await api("PUT", `/run/${rid2}/basket`, { text: "거래처별 합계표, 비중 %" });
  const sub = await api("POST", `/run/${rid2}/submit`, {
    verify_memo: "원본 대조했습니다 (smoke)",
    fields: { total_sales: 584030000, customer_count: 10, min_customer_sales: 9480000 },
  });
  const sub2 = (await api("GET", `/run/${rid2}`)).json.submissions[0];
  check(
    "SUB-15 comment LLM fails -> fallback, code decision kept",
    sub.status === 200 && sub.json?.decision === "reject" && sub.json?.area === "총매출 불일치" && sub.json?.reject_count === 1 && sub2.review.comment_fallback === true,
    JSON.stringify(sub.json),
  );

  // RUN-01~04: 진행 중인 업무는 하나만. rid2 는 반려 1회라 아직 진행 중
  const busy = await api("POST", "/scenario/02/start", { session_id: sid });
  check("RUN-01 진행 중 업무가 있으면 다른 업무 시작 409", busy.status === 409 && busy.json?.code === "active_run" && busy.json?.active?.run_id === rid2, busy.text);
  const swap = await api("POST", "/scenario/02/start", { session_id: sid, replace: true });
  check("RUN-02 replace=true 면 앞 업무를 그만두고 새로 시작", swap.status === 200 && (await api("GET", `/run/${rid2}`)).json?.run?.state === "abandoned", swap.text);
  const sessAfter = (await api("GET", `/session/${sid}`)).json;
  check("RUN-03 그만둔 업무는 배치표에서 미시작(run 없음)", sessAfter.scenarios.find((x) => x.id === "01")?.run === null && sessAfter.scenarios.find((x) => x.id === "02")?.run?.id === swap.json.run_id);
  const dead = await api("PUT", `/run/${rid2}/basket`, { text: "x" });
  check("RUN-04 그만둔 업무는 바꾸는 요청 409, 읽기는 됨", dead.status === 409 && dead.json?.code === "abandoned" && (await api("GET", `/run/${rid2}`)).status === 200, dead.text);
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("smoke");
