// 골든셋 LLM 채점 (07 문서 EVL-10). 실제 Claude 를 부르므로 CI 에서는 안 돌린다. 비용 약 $2 (14건 × 3회, Opus)
// 실행: npx tsx test/golden_llm.ts [반복 수=3] [사례 id 접두어...]     예) npx tsx test/golden_llm.ts 1 G01-01
// 결과: eval/golden/results/<시각>.json + 콘솔 표. 합격선은 cases.json 의 acceptance
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScenario } from "../src/scenarios.ts";
import { scoreCode } from "../src/evaluation/score.ts";
import { runJudge, quoteOk, NONE } from "../src/evaluation/judge.ts";
import { buildReport } from "../src/evaluation/report.ts";
import { costUsd } from "../src/guard.ts";
import { models, MOCK } from "../src/llm.ts";
import { golden, evidenceOf } from "./golden_harness.ts";

if (MOCK) throw new Error("LLM_MOCK=1 이면 의미 없음. 실제 키로 실행");
const here = path.dirname(fileURLToPath(import.meta.url));
const repeat = Number(process.argv[2] ?? 3);
const only = process.argv.slice(3);
const cases = golden.cases.filter((c: { id: string }) => only.length === 0 || only.some((p) => c.id.startsWith(p)));

// 리포트 A 항목 이름 ↔ 골든셋 키
const A_KEY: Record<string, string> = { 구체성: "구체성", "맥락 제공": "맥락", "반복 개선": "반복개선", "역할 분리": "역할분리" };
const inRange = (v: number, [lo, hi]: number[]) => v >= lo && v <= hi;

interface Run {
  total: number;
  grade: string;
  A: Record<string, number>;
  B_llm: number;
  quotesOk: boolean;
  leak: string[];
  mentioned: boolean;
  quoteRetry: boolean;
  usd: number;
  summary: string;
}

async function evalOnce(c: (typeof golden.cases)[number]): Promise<Run> {
  const { sc, ev } = evidenceOf(c);
  const code = scoreCode(ev, sc);
  const out = await runJudge({ ev, sc, code, nickname: "골든" });
  const rep = buildReport({ runId: c.id, sc, ev, code, judge: out.judge });
  const txt = JSON.stringify(rep);
  const quotes = [...rep.axes.A_instruction.items.map((i) => i.quote), rep.axes.B_verification.llm.quote, rep.highlights.good.quote, rep.highlights.improve.quote];
  const coaching = [rep.summary, ...rep.next_steps, rep.highlights.good.why, rep.highlights.improve.why].join(" ");
  return {
    total: rep.total,
    grade: rep.grade,
    A: Object.fromEntries(rep.axes.A_instruction.items.map((i) => [A_KEY[i.name], i.score])),
    B_llm: rep.axes.B_verification.llm.score,
    quotesOk: quotes.every((q) => q === NONE || quoteOk(q, ev)),
    leak: (c.expected.must_not_contain as string[]).filter((w) => txt.includes(w)),
    mentioned: (c.expected.must_mention_any as string[]).some((w) => coaching.includes(w)),
    quoteRetry: out.quoteRetry,
    usd: out.usages.reduce((s, u) => s + costUsd(models.main, u), 0),
    summary: rep.summary,
  };
}

// 동시에 4건씩 (Opus 호출 1건 15~30초)
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const jobs = cases.flatMap((c: { id: string }) => Array.from({ length: repeat }, (_, k) => ({ c, k })));
console.log(`골든셋 ${cases.length}건 × ${repeat}회 = ${jobs.length}회 평가 (모델 ${models.main})`);
const t0 = Date.now();
const results = await pool(jobs, 4, async ({ c, k }) => {
  try {
    const r = await evalOnce(c);
    process.stdout.write(`  ${c.id}#${k + 1} ${r.total}점 ${r.grade}\n`);
    return { id: c.id, r };
  } catch (e) {
    process.stdout.write(`  ${c.id}#${k + 1} 실패: ${e instanceof Error ? e.message : e}\n`);
    return { id: c.id, r: null as Run | null };
  }
});

const rows = cases.map((c: (typeof golden.cases)[number]) => {
  const runs = results.filter((x) => x.id === c.id && x.r).map((x) => x.r!);
  const e = c.expected;
  const aIn = runs.flatMap((r) => Object.entries(e.llm.A as Record<string, number[]>).map(([k, rg]) => inRange(r.A[k], rg)));
  const bIn = runs.map((r) => inRange(r.B_llm, e.llm.B_llm));
  const totals = runs.map((r) => r.total);
  return {
    id: c.id,
    n: runs.length,
    totals: totals.join("/"),
    expected: `${e.total[0]}~${e.total[1]}`,
    total_in: runs.filter((r) => inRange(r.total, [Math.round(e.total[0]), Math.round(e.total[1])])).length,
    grade_ok: runs.filter((r) => (e.grade as string[]).includes(r.grade)).length,
    A_in: `${aIn.filter(Boolean).length}/${aIn.length}`,
    B_in: `${bIn.filter(Boolean).length}/${bIn.length}`,
    spread: totals.length ? Math.max(...totals) - Math.min(...totals) : NaN,
    quotes_ok: runs.every((r) => r.quotesOk),
    leak: [...new Set(runs.flatMap((r) => r.leak))].join(",") || "-",
    mention: runs.filter((r) => r.mentioned).length,
    A_seen: runs.map((r) => `${r.A.구체성}${r.A.맥락}${r.A.반복개선}${r.A.역할분리}/${r.B_llm}`).join(" "),
  };
});
console.table(rows.map(({ A_seen, ...r }) => r));
console.log("A(구체·맥락·반복·역할)/B-LLM 실제값:");
for (const r of rows) console.log(`  ${r.id}: ${r.A_seen}`);

// 합격선 (cases.json acceptance)
const all = results.filter((x) => x.r).map((x) => x.r!);
const llmChecks = rows.flatMap((r) => [r.A_in, r.B_in]).map((s) => s.split("/").map(Number));
const llmInRate = llmChecks.reduce((a, [ok]) => a + ok, 0) / llmChecks.reduce((a, [, n]) => a + n, 0);
const acc = golden.acceptance;
const summary = {
  llm_in_range: { value: +llmInRate.toFixed(3), target: acc.llm_in_range, pass: llmInRate >= acc.llm_in_range },
  repeat_spread_max: { value: Math.max(...rows.map((r) => r.spread).filter((x) => !Number.isNaN(x))), target: acc.repeat_spread_max },
  quote_verbatim: { value: all.filter((r) => r.quotesOk).length / all.length, target: acc.quote_verbatim },
  leak_free: { value: all.filter((r) => r.leak.length === 0).length / all.length, target: acc.leak_free },
  must_mention: { value: +(all.filter((r) => r.mentioned).length / all.length).toFixed(3), target: acc.must_mention },
  grade_ok: all.length ? +(rows.reduce((a, r) => a + r.grade_ok, 0) / all.length).toFixed(3) : 0,
  quote_retry_rate: +(all.filter((r) => r.quoteRetry).length / all.length).toFixed(3),
  usd: +all.reduce((a, r) => a + r.usd, 0).toFixed(3),
  minutes: +((Date.now() - t0) / 60000).toFixed(1),
  failed_calls: results.filter((x) => !x.r).length,
};
(summary.repeat_spread_max as { pass?: boolean }).pass = summary.repeat_spread_max.value <= acc.repeat_spread_max;
console.log("\n합격선:", JSON.stringify(summary, null, 1));

const dir = path.join(here, "../../eval/golden/results");
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`);
fs.writeFileSync(file, JSON.stringify({ model: models.main, repeat, summary, rows, runs: results }, null, 1));
console.log("저장:", path.relative(path.join(here, "../.."), file));
