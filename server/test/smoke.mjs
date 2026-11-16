// 스모크 테스트: 서버를 자식 프로세스로 띄우고 LLM 없이 되는 경로만 친다.
// 실행: node test/smoke.mjs   (server/ 에서). API 키 없이 동작. 끝나면 자식만 종료.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(here, "..");
const PORT = 8790;
const DB = path.join(serverDir, "data", "smoke.db");
const BASE = `http://localhost:${PORT}`;

for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });

const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], {
  cwd: serverDir,
  env: { ...process.env, ANTHROPIC_API_KEY: "sk-ant-dummy", PORT: String(PORT), DB_PATH: DB, CORS_ORIGIN: "http://localhost:5173" },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

let failed = 0;
function check(name, cond, detail = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`);
  if (!cond) failed++;
}
async function api(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text };
}

try {
  // 부팅 대기
  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    try {
      up = (await fetch(BASE + "/health")).ok;
    } catch {}
  }
  check("server boots", up, up ? "" : serverLog);
  if (!up) throw new Error("boot failed");

  const health = await api("GET", "/health");
  check("GET /health lists 5 scenarios", health.json?.scenarios?.length === 5, JSON.stringify(health.json?.scenarios));

  check("POST /session rejects empty nickname", (await api("POST", "/session", { nickname: "  " })).status === 400);
  check("POST /session rejects 21 chars", (await api("POST", "/session", { nickname: "가".repeat(21) })).status === 400);
  const s = await api("POST", "/session", { nickname: "테스터" });
  check("POST /session ok", s.status === 200 && typeof s.json?.session_id === "string");
  const sid = s.json.session_id;

  check("POST /scenario/99/start 404", (await api("POST", "/scenario/99/start", { session_id: sid })).status === 404);
  check("POST /scenario/01/start without session 400", (await api("POST", "/scenario/01/start", {})).status === 400);
  const st = await api("POST", "/scenario/01/start", { session_id: sid });
  check("POST /scenario/01/start ok", st.status === 200 && typeof st.json?.run_id === "string");
  check("task_card nickname substituted", st.json?.task_card?.body?.includes("테스터 씨"), st.json?.task_card?.body?.slice(0, 40));
  check("task_card has no answer key", !JSON.stringify(st.json).includes("580300000") && !JSON.stringify(st.json).includes("580,300,000"));
  const rid = st.json.run_id;

  const d = await api("GET", `/run/${rid}/data/data/sales_2026_10.csv?search=1`);
  check("GET data attachment ok", d.status === 200 && d.json?.text?.startsWith("주문번호"), d.json?.text?.slice(0, 30));
  check("GET non-attachment 404", (await api("GET", `/run/${rid}/data/answer_key.json`)).status === 404);
  check("GET path traversal 404", (await api("GET", `/run/${rid}/data/data/../answer_key.json`)).status === 404);

  check("PUT basket ok", (await api("PUT", `/run/${rid}/basket`, { text: "합계표 초안" })).json?.ok === true);
  check("PUT basket too long 400", (await api("PUT", `/run/${rid}/basket`, { text: "x".repeat(20001) })).status === 400);

  check("POST submit short memo 400", (await api("POST", `/run/${rid}/submit`, { verify_memo: "확인함" })).status === 400);

  check("POST npc unknown 404", (await api("POST", `/run/${rid}/npc/kim`, { message: "안녕하세요" })).status === 404);
  check("POST npc hint to non-mentor 400", (await api("POST", `/run/${rid}/npc/park`, { hint_request: true })).status === 400);
  check("POST npc empty message 400", (await api("POST", `/run/${rid}/npc/park`, { message: "" })).status === 400);

  // 더미 키라 LLM 호출은 인증 실패해야 함. 오디는 SSE 로 error 이벤트, NPC 는 500 JSON
  const odi = await api("POST", `/run/${rid}/odi`, { message: "거래처별 합계표 만들어 줘" });
  check("POST odi with dummy key -> SSE error event", odi.status === 200 && odi.text.includes("event: error"), `status=${odi.status} body=${odi.text.slice(0, 120)}`);
  const npc = await api("POST", `/run/${rid}/npc/park`, { message: "마감 언제예요?" });
  check("POST npc with dummy key -> 500 auth error", npc.status === 500, JSON.stringify(npc.json));

  const run = await api("GET", `/run/${rid}`);
  check("GET run ok", run.status === 200 && run.json?.run?.id === rid);
  check("failed LLM calls not counted", run.json?.run?.odi_calls_used === 0 && run.json?.messages?.length === 0);
  check("data_view recorded (indirect via run state)", run.json?.run?.basket_text === "합계표 초안");

  check("POST evaluate before close 409", (await api("POST", `/run/${rid}/evaluate`)).status === 409);

  const sess = await api("GET", `/session/${sid}`);
  check("GET session shows run state", sess.json?.scenarios?.find((x) => x.id === "01")?.run?.state === "assigned");
  check("GET session hides hints/traps", !JSON.stringify(sess.json).includes("hints") && !JSON.stringify(sess.json).includes("traps"));
  check("GET /session/unknown 404", (await api("GET", "/session/nope")).status === 404);
} catch (e) {
  console.error(e);
  failed++;
} finally {
  child.kill();
  await sleep(300);
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(f, { force: true });
}
console.log(failed === 0 ? "\nALL PASS" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
