// 통합 (LLM_MOCK=1): 오디 상한, SSE 순서, 힌트 단계, 대화 이력, 제출 상태 머신, WS 이벤트.
// 실행: npm run test:integration   (07 문서 ODI-01/03/04, NPC-02/04, SUB-02/03/04/05, WS-01/02)
import WebSocket from "ws";
import { setTimeout as sleep } from "node:timers/promises";
import { startServer, makeChecker, testPort } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
let srv;
try {
  srv = await startServer({ port: testPort(8791), dbName: "integration.db", env: { LLM_MOCK: "1" } });
  const { api, base } = srv;
  const health = await api("GET", "/health");
  const limits = health.json.limits; // {odiCalls, hints, rejects}
  check("limits from constants.json", limits.odiCalls === 15 && limits.hints === 3 && limits.rejects === 3, JSON.stringify(limits));

  const sid = (await api("POST", "/session", { nickname: "통합" })).json.session_id;
  const rid = (await api("POST", "/scenario/01/start", { session_id: sid })).json.run_id;

  // WS-02: 잘못된 경로는 거절
  const badWs = await new Promise((resolve) => {
    const ws = new WebSocket(base.replace("http", "ws") + "/ws/not-a-run");
    ws.on("open", () => resolve("open"));
    ws.on("error", () => resolve("error"));
    ws.on("close", () => resolve("closed"));
  });
  check("WS-02 bad path rejected", badWs !== "open", badWs);

  // WS-01: 이벤트 수신
  const events = [];
  const ws = new WebSocket(base.replace("http", "ws") + `/ws/${rid}`);
  await new Promise((resolve, reject) => {
    ws.on("open", resolve);
    ws.on("error", reject);
  });
  ws.on("message", (m) => events.push(JSON.parse(m.toString())));

  // ODI-03: SSE 순서 delta... → done
  const first = await api("POST", `/run/${rid}/odi`, { message: "거래처별 합계표 만들어 줘" });
  const evNames = [...first.text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
  check("ODI-03 SSE delta then done", evNames.length >= 2 && evNames.at(-1) === "done" && evNames.slice(0, -1).every((e) => e === "delta"), evNames.join(","));
  const doneLine = first.text.split("\n").find((l, i, arr) => arr[i - 1] === "event: done");
  const done = JSON.parse(doneLine.replace(/^data: /, ""));
  check("ODI-03 done carries odi_calls_used=1", done.odi_calls_used === 1 && done.odi_calls_limit === 15, JSON.stringify(done));
  check("state assigned -> working after first odi call", (await api("GET", `/run/${rid}`)).json.run.state === "working");

  // ODI-01: 14·15회 성공, 16회째 429
  for (let i = 2; i <= 14; i++) await api("POST", `/run/${rid}/odi`, { message: `호출 ${i}` });
  check("ODI-01 14th call ok", (await api("GET", `/run/${rid}`)).json.run.odi_calls_used === 14);
  const r15 = await api("POST", `/run/${rid}/odi`, { message: "호출 15" });
  check("ODI-01 15th call ok", r15.status === 200 && r15.text.includes("event: done"));
  const r16 = await api("POST", `/run/${rid}/odi`, { message: "호출 16" });
  check("ODI-01 16th call 429", r16.status === 429, `status=${r16.status}`);
  check("ODI-01 odi history has 30 messages", (await api("GET", `/run/${rid}`)).json.messages.filter((m) => m.agent === "odi").length === 30);

  // NPC-02: 힌트 1·2·3 단계, 4회째 429. NPC-04: 이력 agent 별 분리
  for (let lvl = 1; lvl <= 3; lvl++) {
    const h = await api("POST", `/run/${rid}/npc/lee`, { hint_request: true });
    check(`NPC-02 hint level ${lvl}`, h.status === 200 && h.json.hint_level === lvl, JSON.stringify(h.json));
  }
  const h4 = await api("POST", `/run/${rid}/npc/lee`, { hint_request: true });
  check("NPC-02 4th hint 429", h4.status === 429, `status=${h4.status}`);
  const chatLee = await api("POST", `/run/${rid}/npc/lee`, { message: "오디 팁 있어요?" });
  check("NPC-02 free chat still ok after hint cap", chatLee.status === 200 && chatLee.json.hint_level === 3);
  await api("POST", `/run/${rid}/npc/park`, { message: "마감 언제예요?" });
  const msgs = (await api("GET", `/run/${rid}`)).json.messages;
  check("NPC-04 history split by agent", msgs.filter((m) => m.agent === "lee").length === 8 && msgs.filter((m) => m.agent === "park").length === 2);

  // SUB-01: 빈 바구니 400
  check("SUB-01 empty basket 400", (await api("POST", `/run/${rid}/submit`, { verify_memo: "원본 행 수 확인했습니다" })).status === 400);

  // SUB-03: 반려 1·2회 → 계속 작업 가능, 3회 → closed. 01 은 구조화 제출: 거래처 12곳 값이면 코드가 반려
  // (구조화 제출 자체의 결정 테이블·마스킹은 test/submit.mjs)
  const wrong = { total_sales: 580300000, customer_count: 12, min_customer_sales: 6870000 };
  await api("PUT", `/run/${rid}/basket`, { text: "거래처 12곳 합계표, 비중 %" });
  for (let n = 1; n <= 2; n++) {
    const r = await api("POST", `/run/${rid}/submit`, { verify_memo: `확인 메모 ${n}차 입니다`, fields: wrong });
    check(`SUB-03 reject #${n}`, r.json?.decision === "reject" && r.json?.reject_count === n && r.json?.closed === false, JSON.stringify(r.json));
  }
  check("SUB-03 after 2 rejects odi still blocked only by cap (429 not 409)", (await api("POST", `/run/${rid}/odi`, { message: "x" })).status === 429);
  check("SUB-03 npc still allowed after reject", (await api("POST", `/run/${rid}/npc/park`, { message: "뭐가 문제예요?" })).status === 200);
  const r3 = await api("POST", `/run/${rid}/submit`, { verify_memo: "확인 메모 3차 입니다", fields: wrong });
  check("SUB-03 reject #3 closes", r3.json?.reject_count === 3 && r3.json?.closed === true, JSON.stringify(r3.json));
  check("SUB-02 submit after close 409", (await api("POST", `/run/${rid}/submit`, { verify_memo: "확인 메모 4차 입니다", fields: wrong })).status === 409);
  check("SUB-02 odi after close 409", (await api("POST", `/run/${rid}/odi`, { message: "x" })).status === 409);
  check("evaluate after close reachable (501 until implemented)", (await api("POST", `/run/${rid}/evaluate`)).status === 501);

  // SUB-04: 검토 JSON 저장 형태
  const subs = (await api("GET", `/run/${rid}`)).json.submissions;
  check("SUB-04 review json stored", subs.length === 3 && subs[0].review.decision === "reject" && Array.isArray(subs[0].review.trap_caught) && subs[0].review.area === "거래처 초과");

  // 승인 경로: 새 run
  const rid2 = (await api("POST", "/scenario/01/start", { session_id: sid })).json.run_id;
  await api("PUT", `/run/${rid2}/basket`, { text: "거래처 10곳 합계표. 중복 3건 제거, 비중 차트" });
  const ok = await api("POST", `/run/${rid2}/submit`, {
    verify_memo: "원본 대조하고 중복 제거했습니다",
    fields: { total_sales: 580300000, customer_count: 10, min_customer_sales: 9480000 },
  });
  check("SUB-03 approve path", ok.json?.decision === "approve" && ok.json?.state === "approved" && ok.json?.closed === true, JSON.stringify(ok.json));
  check("SUB-02 approved run rejects odi 409", (await api("POST", `/run/${rid2}/odi`, { message: "x" })).status === 409);
  check("session shows latest run per scenario", (await api("GET", `/session/${sid}`)).json.scenarios.find((x) => x.id === "01").run.state === "approved");

  // WS-01 이벤트 확인
  await sleep(300);
  ws.close();
  const types = events.map((e) => e.type);
  check("WS-01 odi begin/end received", types.includes("odi.call.begin") && types.includes("odi.call.end"));
  check("WS-01 npc begin/end with npc_id", events.some((e) => e.type === "npc.call.end" && e.npc_id === "lee"));
  check("WS-01 submit + review.reject", types.includes("submit") && types.filter((t) => t === "review.reject").length === 3);
  check("WS-01 events scoped to run", events.every((e) => e.run_id === rid));
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("integration");
