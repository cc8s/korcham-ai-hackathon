// 팀원 대화 누설 측정 (실제 Claude 호출, 수동 실행. CI 에서 돌리지 않음).
// 실행: node test/npc_leak.mjs [라벨]   (server/ 에서, server/.env 의 키 사용. 키는 출력하지 않음)
//
// 시나리오 5개 × 팀원 4명에게 같은 순서로 보낸다: "넵" ×3 → "알겠어요, 근데 뭘 확인하면 돼요?" → "넵"
// 2026-11-22 발견: "넵"만 반복해도 팀장이 말을 덧붙이다 "원본 행 수와 집계 행 수를 비교" 같은
// 함정 해법(01 중복 주문)을 말함. 함정 키워드에는 안 걸려서 두 가지를 센다.
//   키워드   시나리오 eval.json 의 함정 키워드 (업무 카드에 이미 공개된 단어는 제외)
//   확인항목 "어떻게 확인하라"를 구체적으로 짚은 표현 (행 수·건수·합계 대조·단위·시차 등). 사람이 원문을 읽어 판정
// 답 전문은 test/out/npc_leak-<라벨>.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, testPort } from "./_harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const label = process.argv[2] ?? "run";
const key = fs
  .readFileSync(path.join(here, "..", ".env"), "utf8")
  .split(/\r?\n/)
  .find((l) => l.startsWith("ANTHROPIC_API_KEY="))
  ?.slice("ANTHROPIC_API_KEY=".length)
  .trim();
if (!key) throw new Error("server/.env 에 ANTHROPIC_API_KEY 없음");

const SEQ = ["넵", "넵", "넵", "알겠어요, 근데 뭘 확인하면 돼요?", "넵"];
const NPCS = ["kang", "park", "jung", "lee"];
const CHECK =
  /행 ?수|건수|몇 건|합친 값|합산|합계.{0,8}(맞|일치|같)|총매출과|단위|환산|시차|서머|기준 ?열|중복|누락|빠진|두 번|표기|공백|띄어쓰기|수량.{0,6}(맞|다르|차이)|세율|10 ?%|신고필증|전년|동월|보험|FOB/g;

const srv = await startServer({
  port: testPort(8798),
  dbName: "npc_leak.db",
  env: { ANTHROPIC_API_KEY: key, NPC_CALLS_PER_RUN: "200", RUNS_PER_IP_DAY: "100", SESSIONS_PER_IP_DAY: "100", RUNS_PER_SESSION_DAY: "100" },
});
const { api } = srv;
const out = [];
try {
  const { getScenario } = await import("../src/scenarios.ts");
  for (const sid of ["01", "02", "03", "04", "05"]) {
    const sc = getScenario(sid);
    const card = [sc.prompts.task_card.title, sc.prompts.task_card.body, sc.prompts.task_card.deliverable].join("\n");
    const traps = Object.entries(sc.evalCfg.traps).map(([id, t]) => ({ id, re: new RegExp(t.keywords, "g") }));
    const pub = (re) => new Set([...card.matchAll(re)].map((m) => m[0]));
    const session = (await api("POST", "/session", { nickname: "측정" })).json.session_id;
    const rid = (await api("POST", `/scenario/${sid}/start`, { session_id: session })).json.run_id;
    await api("POST", `/run/${rid}/npc/lee/scripted`, { kind: "intro" });
    await api("POST", `/run/${rid}/npc/${sc.ownerNpcId}/scripted`, { kind: "brief" });
    for (const npc of NPCS) {
      for (const [i, msg] of SEQ.entries()) {
        const r = await api("POST", `/run/${rid}/npc/${npc}`, { message: msg });
        const text = r.json?.text ?? `(오류 ${r.status}) ${r.text}`;
        const kw = traps.flatMap((t) => [...text.matchAll(t.re)].map((m) => m[0]).filter((w) => !pub(t.re).has(w)).map((w) => `${t.id}:${w}`));
        const checks = [...text.matchAll(CHECK)].map((m) => m[0]).filter((w) => !card.includes(w));
        out.push({ sid, npc, owner: npc === sc.ownerNpcId, turn: i + 1, msg, text, kw, checks, scripted: r.json?.scripted ?? false });
        process.stdout.write(kw.length ? "K" : checks.length ? "c" : ".");
      }
    }
    process.stdout.write(` ${sid}\n`);
  }
} finally {
  await srv.stop();
}
fs.mkdirSync(path.join(here, "out"), { recursive: true });
fs.writeFileSync(path.join(here, "out", `npc_leak-${label}.json`), JSON.stringify(out, null, 2));
const n = (f) => out.filter(f).length;
console.log(`\n[${label}] 답 ${out.length}개 · 키워드 ${n((o) => o.kw.length)} · 확인항목 ${n((o) => o.checks.length)}`);
console.log(`  "넵"에 대한 답: 키워드 ${n((o) => o.msg === "넵" && o.kw.length)} · 확인항목 ${n((o) => o.msg === "넵" && o.checks.length)} (총 ${n((o) => o.msg === "넵")})`);
for (const o of out.filter((o) => o.kw.length || o.checks.length)) {
  console.log(`- ${o.sid} ${o.npc}${o.owner ? "(담당)" : ""} ${o.turn}번째 "${o.msg}" → [${[...o.kw, ...o.checks].join(", ")}] ${o.text.replace(/\s+/g, " ").slice(0, 140)}`);
}
