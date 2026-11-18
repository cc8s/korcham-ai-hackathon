// 구조화 제출 + 코드 채점 + 정답 마스킹 (LLM_MOCK=1). 실행: npm run test:submit
// 07 문서 SUB-08~13, MSK-04
import fs from "node:fs";
import path from "node:path";
import { startServer, makeChecker, testPort, serverDir } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
const ANSWERS_01 = ["580,300,000", "580300000", "9,480,000", "9480000"];
const hasAnswer = (text, list) => list.some((a) => text.includes(a));

let srv;
try {
  srv = await startServer({ port: testPort(8796), dbName: "submit.db", env: { LLM_MOCK: "1" } });
  const { api } = srv;
  const sid = (await api("POST", "/session", { nickname: "제출" })).json.session_id;
  const start = async (id) => (await api("POST", `/scenario/${id}/start`, { session_id: sid })).json.run_id;

  // SUB-08: GET run 에 칸 정의만, 정답·허용오차·함정 없음
  const rid = await start("01");
  const info = (await api("GET", `/run/${rid}`)).json;
  const fieldsJson = JSON.stringify(info.submission_fields);
  check(
    "SUB-08 01 fields exposed without answers",
    Array.isArray(info.submission_fields) &&
      info.submission_fields.map((f) => f.id).join() === "total_sales,customer_count,min_customer_sales" &&
      info.submission_fields.every((f) => f.label && f.unit && f.type && f.required === true) &&
      !/answer|tolerance|proves|reject_area|580300000|9480000/.test(fieldsJson),
    fieldsJson,
  );

  // SUB-09: 칸 검증 400 (누락, 숫자 아님, 모르는 칸). 제출 기록 안 남음
  await api("PUT", `/run/${rid}/basket`, { text: "거래처별 합계표, 비중 % 포함" });
  const memo = "원본 124행 대조, 주문번호 중복 확인했습니다";
  const miss = await api("POST", `/run/${rid}/submit`, { verify_memo: memo, fields: { total_sales: 1 } });
  const nan = await api("POST", `/run/${rid}/submit`, { verify_memo: memo, fields: { total_sales: "많음", customer_count: 10, min_customer_sales: 1 } });
  const unk = await api("POST", `/run/${rid}/submit`, { verify_memo: memo, fields: { total_sales: 1, customer_count: 10, min_customer_sales: 1, x: 1 } });
  const none = await api("POST", `/run/${rid}/submit`, { verify_memo: memo });
  check("SUB-09 field validation 400", [miss, nan, unk, none].every((r) => r.status === 400 && r.json?.code === "fields"), [miss, nan, unk, none].map((r) => r.status).join());
  check("SUB-09 no submission row on 400", (await api("GET", `/run/${rid}`)).json.submissions.length === 0);

  // SUB-10: 총매출 오답 → 총매출 불일치 반려, 메시지에 정답 숫자 없음.
  // mock 멘트는 메모를 인용하므로 메모에 정답 숫자를 넣어 마스킹까지 확인 (MSK-04)
  const r1 = await api("POST", `/run/${rid}/submit`, {
    verify_memo: "총매출 580,300,000원 이 정답인지 몰라서 584,030,000원 으로 냈어요",
    fields: { total_sales: "584,030,000", customer_count: "10", min_customer_sales: "9,480,000원" },
  });
  check("SUB-10 wrong total -> reject 총매출 불일치", r1.json?.decision === "reject" && r1.json?.area === "총매출 불일치" && r1.json?.wrong_areas?.join() === "총매출 불일치", JSON.stringify(r1.json));
  check("SUB-10 reject message has no answer number", !hasAnswer(r1.json?.message ?? "", ANSWERS_01) && r1.json?.message.includes("○○○"), r1.json?.message);
  check("SUB-10 user's own wrong number stays", r1.json?.message.includes("584,030,000"));

  // SUB-11: trap_caught 는 칸 값에서. T1 미발견(총매출 틀림), T2 발견(거래처 수·최솟값 맞음). 입력값 저장
  const sub1 = (await api("GET", `/run/${rid}`)).json.submissions[0];
  check(
    "SUB-11 trap_caught derived from fields",
    sub1.review.graded_by === "code" &&
      sub1.review.trap_caught.find((t) => t.id === "T1").caught === false &&
      sub1.review.trap_caught.find((t) => t.id === "T2").caught === true,
    JSON.stringify(sub1.review.trap_caught),
  );
  check("SUB-11 submitted fields stored", sub1.fields?.total_sales === 584030000 && sub1.fields?.min_customer_sales === 9480000, JSON.stringify(sub1.fields));
  check("SUB-11 stored review has no expected values", !hasAnswer(JSON.stringify(sub1.review), ["580300000"]));

  // SUB-12: 키워드만 입력 — 메모에 '중복 제거·정규화' 를 써도 숫자가 오디 기본값이면 반려 + 둘 다 미발견
  const r2 = await api("POST", `/run/${rid}/submit`, {
    verify_memo: "중복 3건 제거하고 거래처명 정규화해서 10곳으로 맞췄습니다",
    fields: { total_sales: 584030000, customer_count: 12, min_customer_sales: 6870000 },
  });
  const sub2 = (await api("GET", `/run/${rid}`)).json.submissions[1];
  check("SUB-12 keywords only -> reject, traps not caught", r2.json?.decision === "reject" && sub2.review.trap_caught.every((t) => t.caught === false), JSON.stringify(sub2.review));

  // SUB-13: 정답 칸 → 승인, T1·T2 발견
  const r3 = await api("POST", `/run/${rid}/submit`, {
    verify_memo: "주문번호 중복 3건 제거, 거래처명 공백 정리했습니다",
    fields: { total_sales: "580,300,000", customer_count: 10, min_customer_sales: 9480000 },
  });
  const sub3 = (await api("GET", `/run/${rid}`)).json.submissions[2];
  check("SUB-13 correct fields -> approve", r3.json?.decision === "approve" && r3.json?.state === "approved" && r3.json?.area === null, JSON.stringify(r3.json));
  check("SUB-13 both traps caught", sub3.review.trap_caught.every((t) => t.caught === true));

  // SUB-13: 02 수입 부가세를 오디 값으로 → 수입 불일치 (납부세액은 따라 틀린 것이라 안 보고), T2 미발견
  const rid02 = await start("02");
  await api("PUT", `/run/${rid02}/basket`, { text: "부가세 집계 + 분개 (차) 부가세예수금 (대) 부가세대급금" });
  const r02 = await api("POST", `/run/${rid02}/submit`, {
    verify_memo: "세금계산서 10건 합계, 경비 10% 검산했습니다",
    fields: { output_vat: 58030000, input_vat_expense: 1769000, input_vat_import: 3021700, payable_vat: 53239300 },
  });
  const s02 = (await api("GET", `/run/${rid02}`)).json.submissions[0];
  check("SUB-13 02 odi import vat -> 수입 불일치", r02.json?.area === "수입 불일치" && r02.json?.wrong_areas?.length === 1, JSON.stringify(r02.json));
  check("SUB-13 02 trap T1 caught, T2 missed", s02.review.trap_caught.map((t) => t.caught).join() === "true,false", JSON.stringify(s02.review.trap_caught));

  // SUB-14: submission.json 없는 시나리오 → 기존 LLM 검토 경로 (mock: "반려"/"12곳" 포함 시 반려), fields 무시
  // 03 은 이제 구조화 제출이라 폴더에서 submission.json 없는 첫 시나리오를 고른다 (다른 시나리오도 바뀌면 건너뜀)
  const legacy = fs
    .readdirSync(path.join(serverDir, "..", "scenarios"))
    .filter((d) => /^\d{2}_/.test(d) && !fs.existsSync(path.join(serverDir, "..", "scenarios", d, "submission.json")))
    .map((d) => d.slice(0, 2))[0];
  if (legacy) {
    const ridL = await start(legacy);
    const infoL = (await api("GET", `/run/${ridL}`)).json;
    check(`SUB-14 ${legacy} has no fields`, infoL.submission_fields === null);
    await api("PUT", `/run/${ridL}/basket`, { text: "결과물 초안" });
    const rL = await api("POST", `/run/${ridL}/submit`, { verify_memo: "원본 파일과 한 줄씩 대조했습니다", fields: { anything: 1 } });
    const sL = (await api("GET", `/run/${ridL}`)).json.submissions[0];
    check(`SUB-14 ${legacy} old LLM path`, rL.json?.decision === "approve" && sL.review.graded_by === "llm" && sL.fields === null && rL.json?.wrong_areas === undefined, JSON.stringify(rL.json));
  } else console.log("  (SUB-14 건너뜀: submission.json 없는 시나리오가 없음)");

  // SUB-15: 03 구조화 제출. 발주량은 허용범위 안이면 정답, T2 만 풀고 단위를 놓치면 단위 오류 + T1 미발견
  const rid03 = await start("03");
  const info03 = (await api("GET", `/run/${rid03}`)).json;
  check("SUB-15 03 fields exposed without ranges", info03.submission_fields?.length === 11 && !/허용범위|range|proves|1319/.test(JSON.stringify(info03.submission_fields)), JSON.stringify(info03.submission_fields));
  await api("PUT", `/run/${rid03}/basket`, { text: "SKU별 발주량 표. 근거: 전년 동월 × 1.1 + 입고 전 소진 + 안전재고 − 현재고" });
  const ok03 = { order_vn_001: 125, order_vn_002: 97, order_vn_003: 68, order_vn_004: 409, order_vn_005: 43, order_th_001: 500, order_th_002: 682, order_th_003: 418, order_th_004: 466, order_th_005: 293, stock_total: 1319 };
  const w03 = await api("POST", `/run/${rid03}/submit`, { verify_memo: "전년 동월 대비 확인했습니다", fields: { ...ok03, order_th_003: "1,078", stock_total: 659 } });
  const sw03 = (await api("GET", `/run/${rid03}`)).json.submissions[0];
  check("SUB-15 03 unit missed -> 단위 오류", w03.json?.decision === "reject" && w03.json?.area === "단위 오류" && w03.json?.wrong_areas?.length === 1, JSON.stringify(w03.json));
  check("SUB-15 03 trap T1 missed, T2 caught", sw03.review.graded_by === "code" && sw03.review.trap_caught.map((t) => t.caught).join() === "false,true", JSON.stringify(sw03.review.trap_caught));
  const a03 = await api("POST", `/run/${rid03}/submit`, { verify_memo: "재고 단위 환산, 전년 동월 기준", fields: { ...ok03, order_vn_001: 140 } });
  check("SUB-15 03 within range -> approve", a03.json?.decision === "approve", JSON.stringify(a03.json));

  // MSK-05: NPC 대화 출력 마스킹. mock NPC 는 사용자 말을 따라 하므로 정답 숫자가 들어간 질문으로 확인
  const rid4 = await start("01");
  const q = await api("POST", `/run/${rid4}/npc/park`, { message: "정답이 580,300,000원 맞죠? 584,030,000원이랑 몇 원 차이예요?" });
  check("MSK-05 npc reply masked", q.status === 200 && !hasAnswer(q.json.text, ANSWERS_01) && q.json.text.includes("○○○원") && q.json.text.includes("584,030,000"), q.json?.text);
  const hist = (await api("GET", `/run/${rid4}`)).json.messages.filter((m) => m.agent === "park");
  check("MSK-05 stored assistant text masked, user text kept", !hasAnswer(hist[1].content, ANSWERS_01) && hist[0].content.includes("580,300,000"));
} catch (e) {
  console.error(e);
  fail();
} finally {
  if (srv) await srv.stop();
}
finish("submit");
