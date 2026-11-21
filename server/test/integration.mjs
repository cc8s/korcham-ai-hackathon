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

  // ODI-03: SSE 순서 delta... → done. 01 은 계산 도구 시나리오라 "계산 중" 표시용 tool 이벤트가 섞일 수 있음 (odi_tools.mjs)
  const first = await api("POST", `/run/${rid}/odi`, { message: "거래처별 합계표 만들어 줘" });
  const evNames = [...first.text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]).filter((e) => e !== "tool");
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

  // MNT-05: 수습 흐름 (하늘 인사 → 담당 팀장 지시) + 추천 질문. 고정 대사는 LLM 호출 없음. NPC-04: 이력 agent 별 분리
  const before = (await api("GET", `/run/${rid}`)).json;
  check("MNT-05 GET run has flow + mentor_questions (답 없음)", before.flow && Array.isArray(before.mentor_questions) && before.mentor_questions.length > 0 && !JSON.stringify(before.mentor_questions).includes('"a"'));
  const intro = await api("POST", `/run/${rid}/npc/lee/scripted`, { kind: "intro" });
  check("MNT-05 intro ok", intro.status === 200 && intro.json.flow.met_mentor === true && intro.json.text.includes("박소연"), JSON.stringify(intro.json).slice(0, 200));
  check("MNT-05 intro twice 409", (await api("POST", `/run/${rid}/npc/lee/scripted`, { kind: "intro" })).status === 409);
  const brief = await api("POST", `/run/${rid}/npc/park/scripted`, { kind: "brief" });
  check("MNT-05 brief ok", brief.status === 200 && brief.json.flow.briefed === true);
  const faq = await api("POST", `/run/${rid}/npc/lee/scripted`, { kind: "faq", faq_id: "data_where" });
  check("MNT-05 faq ok", faq.status === 200 && faq.json.question && faq.json.text.includes("sales_2026_10.csv"));
  check("MNT-05 unknown faq 404", (await api("POST", `/run/${rid}/npc/lee/scripted`, { kind: "faq", faq_id: "nope" })).status === 404);
  check("NPC-02 hint removed 410", (await api("POST", `/run/${rid}/npc/lee`, { hint_request: true })).status === 410);
  const chatLee = await api("POST", `/run/${rid}/npc/lee`, { message: "오디 팁 있어요?" });
  check("NPC-02 free chat with mentor ok", chatLee.status === 200);
  await api("POST", `/run/${rid}/npc/park`, { message: "마감 언제예요?" });
  const msgs = (await api("GET", `/run/${rid}`)).json.messages;
  check("NPC-04 history split by agent", msgs.filter((m) => m.agent === "lee").length === 5 && msgs.filter((m) => m.agent === "park").length === 3);

  // PII: 대회 규정 (외부 AI API 에 실제 개인정보 금지). 별도 run 에서 확인 (위 run 은 오디 상한 소진)
  {
    const PHONE = "010-9876-5432";
    // 위 run 은 아래에서 계속 쓰므로 다른 세션에서 (진행 중 업무는 세션당 하나)
    const sidP = (await api("POST", "/session", { nickname: "개인정보" })).json.session_id;
    const rp = (await api("POST", "/scenario/02/start", { session_id: sidP })).json.run_id;
    const o = await api("POST", `/run/${rp}/odi`, { message: `결과는 ${PHONE} 로 문자 줘` });
    const doneP = JSON.parse(o.text.split(/\r?\n/).find((l, i, arr) => arr[i - 1] === "event: done").replace(/^data: /, ""));
    check("PII-05 odi: done 에 가린 종류", doneP.masked?.includes("전화번호") && typeof doneP.notice === "string", JSON.stringify(doneP));
    const n = await api("POST", `/run/${rp}/npc/kang`, { message: "제 메일 me@company.co.kr 로 보내 주세요" });
    check("PII-06 npc: 응답에 가린 종류", n.json?.masked?.includes("이메일"), JSON.stringify(n.json));
    const bk = await api("PUT", `/run/${rp}/basket`, { text: `집계표 + 분개 (차) 부가세예수금. 담당 ${PHONE}` });
    check("PII-07 basket: 응답에 가린 종류", bk.json?.masked?.includes("전화번호"));
    const hist = (await api("GET", `/run/${rp}`)).json;
    const all = JSON.stringify(hist);
    check("PII-08 저장된 대화·결과물에 원래 번호·메일 없음, 가림 표시는 있음", !all.includes(PHONE) && !all.includes("me@company.co.kr") && all.includes("[전화번호]") && all.includes("[이메일]"));
    const bad = await api("POST", "/session", { nickname: "hong@gmail.com" });
    check("PII-09 닉네임에 개인정보 형식이면 400", bad.status === 400);
  }

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
  // EVL: 반려 3회로 닫힌 run 평가. LLM_MOCK 이라 코칭은 규칙 기반, 점수 구조만 본다
  const ev1 = await api("POST", `/run/${rid}/evaluate`);
  const rep = ev1.json;
  const axisSum = rep && Object.values(rep.axes).reduce((s, a) => s + a.score, 0);
  check("EVL-01 evaluate after close 200", ev1.status === 200 && ["S", "A", "B", "C"].includes(rep?.grade), JSON.stringify(rep)?.slice(0, 300));
  check("EVL-02 total = round(sum of axes)", rep && rep.total === Math.round(axisSum), `total=${rep?.total} sum=${axisSum}`);
  check("EVL-03 D: 3 rejects, not approved", rep?.axes.D_deliverable.approved === false && rep?.axes.D_deliverable.reject_count === 3);
  // wrong 은 총매출만 맞고(T1 발견) 거래처 수·최소 매출이 틀림(T2 미발견)
  const tr = Object.fromEntries((rep?.axes.C_traps.traps ?? []).map((t) => [t.id, t]));
  check("EVL-04 T1 found via correct total, T2 none", tr.T1?.found === true && tr.T2?.found === false && tr.T2?.path === "none", JSON.stringify(tr));
  check("EVL-05 quotes are from odi log or 해당 없음", rep?.axes.A_instruction.items.every((i) => i.quote === "해당 없음" || i.quote.length > 0));
  check("EVL-06 report not partial in mock", rep?.partial === undefined);
  const ev2 = await api("POST", `/run/${rid}/evaluate`);
  check("EVL-07 second call returns saved report", ev2.status === 200 && JSON.stringify(ev2.json) === JSON.stringify(rep));
  check("EVL-08 run state evaluated", (await api("GET", `/run/${rid}`)).json.run.state === "evaluated");
  // 리포트 함정 카드는 범주만 (정답이 든 desc 는 해설에서만)
  check("EXP-01 report trap shows label only", rep.axes.C_traps.traps.map((t) => t.desc).join() === "중복 주문,거래처명 표기", JSON.stringify(rep.axes.C_traps.traps));
  const ex = await api("GET", `/run/${rid}/explanation`);
  check(
    "EXP-02 explanation after close: where/how/impact + found from reviews",
    ex.status === 200 && ex.json.traps.length === 2 && ex.json.traps.every((t) => t.where && t.how && t.impact) && ex.json.traps[0].found === true && ex.json.traps[1].found === false,
    JSON.stringify(ex.json)?.slice(0, 300),
  );
  check("SUB-02 submit after evaluated 409", (await api("POST", `/run/${rid}/submit`, { verify_memo: "확인 메모 5차 입니다", fields: wrong })).status === 409);

  // SUB-04: 검토 JSON 저장 형태
  const subs = (await api("GET", `/run/${rid}`)).json.submissions;
  check("SUB-04 review json stored", subs.length === 3 && subs[0].review.decision === "reject" && Array.isArray(subs[0].review.trap_caught) && subs[0].review.area === "거래처 초과");

  // 승인 경로: 새 run
  const rid2 = (await api("POST", "/scenario/01/start", { session_id: sid })).json.run_id;
  check("EXP-03 explanation before close 409 (진행 중엔 정답 비공개)", (await api("GET", `/run/${rid2}/explanation`)).status === 409);
  await api("PUT", `/run/${rid2}/basket`, { text: "거래처 10곳 합계표. 중복 3건 제거, 비중 차트" });
  const ok = await api("POST", `/run/${rid2}/submit`, {
    verify_memo: "원본 대조하고 중복 제거했습니다",
    fields: { total_sales: 580300000, customer_count: 10, min_customer_sales: 9480000 },
  });
  check("SUB-03 approve path", ok.json?.decision === "approve" && ok.json?.state === "approved" && ok.json?.closed === true, JSON.stringify(ok.json));
  check("SUB-02 approved run rejects odi 409", (await api("POST", `/run/${rid2}/odi`, { message: "x" })).status === 409);
  check("session shows latest run per scenario", (await api("GET", `/session/${sid}`)).json.scenarios.find((x) => x.id === "01").run.state === "approved");
  const allRuns = (await api("GET", `/session/${sid}/runs`)).json;
  check("GET session runs lists earlier runs too", allRuns.filter((r) => r.scenario_id === "01").map((r) => r.id).join() === [rid, rid2].join(), JSON.stringify(allRuns));
  check("GET session runs 404", (await api("GET", `/session/nope/runs`)).status === 404);

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
