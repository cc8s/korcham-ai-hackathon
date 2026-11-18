// 통합 (LLM_MOCK=1): 오디 계산 도구. 도구 호출이 옵션과 함께 기록되고, SSE 는 그대로 delta…→done.
// 실행: npm run test:odi-tools   (07 문서 TOOL-08~11)
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { startServer, makeChecker, testPort, serverDir } from "./_harness.mjs";

const { check, finish, fail } = makeChecker();
const dbName = "odi_tools.db";
let srv;
let ro;

const events = (text) => [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
const deltaText = (text) =>
  text
    .split("\n\n")
    .filter((c) => c.startsWith("event: delta"))
    .map((c) => JSON.parse(c.split("\n").find((l) => l.startsWith("data: ")).slice(6)).text)
    .join("");

try {
  srv = await startServer({ port: testPort(8796), dbName, env: { LLM_MOCK: "1" } });
  const { api } = srv;
  ro = new Database(path.join(serverDir, "data", dbName), { readonly: true });
  const lastOdiMeta = (rid) =>
    JSON.parse(ro.prepare("SELECT meta FROM message WHERE run_id = ? AND agent = 'odi' AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(rid).meta);
  const spendRows = (rid) => ro.prepare("SELECT COUNT(*) AS n FROM spend WHERE run_id = ? AND kind = 'odi'").get(rid).n;

  const sid = (await api("POST", "/session", { nickname: "도구" })).json.session_id;
  const rid = (await api("POST", "/scenario/01/start", { session_id: sid })).json.run_id;

  // TOOL-08 기본 요청: 기본값으로 도구 호출, SSE 는 tool(선택) → delta… → done
  const r1 = await api("POST", `/run/${rid}/odi`, { message: "거래처별 합계표 만들어 줘" });
  const ev1 = events(r1.text);
  check("TOOL-08 SSE ends with done, only tool/delta before", ev1.at(-1) === "done" && ev1.slice(0, -1).every((e) => e === "delta" || e === "tool"), ev1.join(","));
  check("TOOL-08 tool event before first delta", ev1.indexOf("tool") >= 0 && ev1.indexOf("tool") < ev1.indexOf("delta"));
  const t1 = deltaText(r1.text);
  check("TOOL-08 text from tool result (12곳, 중복 포함 총매출)", t1.startsWith("[mock] 거래처별") && t1.includes("거래처_수: 12") && t1.includes("총매출: 584,030,000"), t1);
  const m1 = lastOdiMeta(rid);
  const c1 = m1.tool_calls?.[0];
  check(
    "TOOL-08 tool call logged with default flags",
    m1.tool_calls?.length === 1 && c1.name === "aggregate_sales" && c1.defaults_changed === false && c1.changed_flags.length === 0 && c1.differs_from_default === false && c1.input.dedupe_order_ids === false,
    JSON.stringify(m1),
  );
  check("TOOL-08 one user turn = one odi call, spend per API request", (await api("GET", `/run/${rid}`)).json.run.odi_calls_used === 1 && m1.api_requests === 2 && spendRows(rid) === 2, `spend=${spendRows(rid)}`);

  // TOOL-09 교정 요청: 옵션이 켜지고 숫자가 바뀐 것이 기록됨
  const r2 = await api("POST", `/run/${rid}/odi`, { message: "중복 제거하고 거래처명 정규화해서 다시 해 줘" });
  const t2 = deltaText(r2.text);
  const c2 = lastOdiMeta(rid).tool_calls?.[0];
  check("TOOL-09 correcting flags logged", c2?.defaults_changed === true && c2.changed_flags.sort().join(",") === "dedupe_order_ids,normalize_customer_names", JSON.stringify(c2));
  check("TOOL-09 result changed vs default = discovery evidence", c2?.differs_from_default === true && c2.summary.총매출 === 580300000 && c2.summary.거래처_수 === 10, JSON.stringify(c2?.summary));
  check("TOOL-09 text shows corrected numbers", t2.includes("거래처_수: 10") && t2.includes("총매출: 580,300,000"), t2);
  check("TOOL-10 flag names/values never sent to the browser", ![r1.text, r2.text].some((t) => /dedupe|normalize|적용_옵션/.test(t)));

  // 이력은 글만: GET run 의 odi 메시지 4개, 도구 블록 없음
  const msgs = (await api("GET", `/run/${rid}`)).json.messages.filter((m) => m.agent === "odi");
  check("TOOL-08 history text-only, 2 turns", msgs.length === 4 && msgs.every((m) => typeof m.content === "string" && !m.content.includes("tool_use")));

  // WRN-07 오디 답변에 함정 경고 표현이 있으면 지우지 않고 그대로 보내고, meta.ai_warned 에 기록
  // (mock 답변은 사용자 말을 따라 하므로, T2 키워드에는 안 걸리고 ai_warns 에만 걸리는 말을 보냄)
  check("WRN-07 no warning → no ai_warned", m1.ai_warned === undefined && lastOdiMeta(rid).ai_warned === undefined, JSON.stringify(m1));
  const ridW = (await api("POST", "/scenario/01/start", { session_id: sid })).json.run_id;
  const rw = await api("POST", `/run/${ridW}/odi`, { message: "같은 곳이 따로 나뉘어 있는지 표로 줘" });
  const tw = deltaText(rw.text);
  const storedW = ro.prepare("SELECT content FROM message WHERE run_id = ? AND agent = 'odi' AND role = 'assistant' ORDER BY id DESC LIMIT 1").get(ridW).content;
  check("WRN-07 warning streamed unchanged = stored text", tw.includes("같은 곳이 따로 나뉘어") && tw === storedW, tw);
  check("WRN-07 meta.ai_warned = [T2], no suppressed", JSON.stringify(lastOdiMeta(ridW).ai_warned) === '["T2"]' && lastOdiMeta(ridW).suppressed === undefined, JSON.stringify(lastOdiMeta(ridW)));

  // 02: vat_summary
  const rid2 = (await api("POST", "/scenario/02/start", { session_id: sid })).json.run_id;
  await api("POST", `/run/${rid2}/odi`, { message: "10월 부가세 집계해 줘" });
  const v1 = lastOdiMeta(rid2).tool_calls?.[0];
  check("TOOL-11 02 default: vat_summary, trap numbers", v1?.name === "vat_summary" && v1.defaults_changed === false && v1.summary.매입세액_수입 === 3021700 && v1.summary.매입세액_경비 === 1499000, JSON.stringify(v1));
  await api("POST", `/run/${rid2}/odi`, { message: "수입 부가세는 신고필증 기준으로 다시 해 줘" });
  const v2 = lastOdiMeta(rid2).tool_calls?.[0];
  check("TOOL-11 02 declarations flag only", v2?.changed_flags.join(",") === "use_import_declarations" && v2.summary.매입세액_수입 === 3459242 && v2.differs_from_default === true, JSON.stringify(v2));

  // TOOL-13 03: order_quantity 기본값은 함정 숫자, 단위 환산만 요청하면 그 옵션만 켜짐
  const rid3 = (await api("POST", "/scenario/03/start", { session_id: sid })).json.run_id;
  await api("POST", `/run/${rid3}/odi`, { message: "SKU별 발주량 제안해 줘" });
  const o1 = lastOdiMeta(rid3).tool_calls?.[0];
  check("TOOL-13 03 default: order_quantity, trap numbers", o1?.name === "order_quantity" && o1.defaults_changed === false && o1.summary.발주량_합계 === 1373 && o1.summary.SKU별_발주량["TH-003"] === 278, JSON.stringify(o1));
  await api("POST", `/run/${rid3}/odi`, { message: "재고 단위 환산해서 다시 해 줘" });
  const o2 = lastOdiMeta(rid3).tool_calls?.[0];
  check("TOOL-13 03 unit flag only", o2?.changed_flags.join(",") === "convert_stock_units" && o2.differs_from_default === true && o2.summary.SKU별_발주량["TH-003"] === 0, JSON.stringify(o2));

  // 도구 없는 시나리오는 예전 그대로: tool 이벤트 없음, tool_calls 없음, 지출 1행
  // 폴더에서 odi_tools.json 없는 첫 시나리오를 고른다 (모든 시나리오가 도구로 바뀌면 건너뜀)
  const scDir = path.join(serverDir, "..", "scenarios");
  const legacy = fs
    .readdirSync(scDir)
    .filter((d) => /^\d{2}_/.test(d) && !fs.existsSync(path.join(scDir, d, "odi_tools.json")))
    .map((d) => d.slice(0, 2))[0];
  if (legacy) {
    const ridL = (await api("POST", `/scenario/${legacy}/start`, { session_id: sid })).json.run_id;
    const rL = await api("POST", `/run/${ridL}/odi`, { message: "초안 만들어 줘" });
    const evL = events(rL.text);
    check(`TOOL-12 non-tool scenario ${legacy} unchanged (delta… → done)`, evL.at(-1) === "done" && evL.slice(0, -1).every((e) => e === "delta"), evL.join(","));
    check(`TOOL-12 non-tool scenario ${legacy} meta has no tool_calls, 1 spend row`, lastOdiMeta(ridL).tool_calls === undefined && spendRows(ridL) === 1);
  } else console.log("  (TOOL-12 건너뜀: odi_tools.json 없는 시나리오가 없음)");
} catch (e) {
  console.error(e);
  fail();
} finally {
  ro?.close();
  if (srv) await srv.stop();
}
finish("odi-tools");
