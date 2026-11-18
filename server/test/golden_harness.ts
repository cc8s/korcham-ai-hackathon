// 골든셋(eval/golden/cases.json) 로그 → 평가 입력(Evidence). 단위 테스트(EVL-09)와 실제 LLM 채점 스크립트가 같이 쓴다
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getScenario, type Scenario, type NpcId } from "../src/scenarios.ts";
import { grade, expectedValue } from "../src/grading.ts";
import { odiToolsFor, type OdiToolLog } from "../src/tools/index.ts";
import type { Evidence } from "../src/evaluation/evidence.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
export const golden = JSON.parse(fs.readFileSync(path.join(here, "../../eval/golden/cases.json"), "utf8"));

type Flags = Record<string, boolean>;
interface GOdi { user: string; tool: Flags | null; changed: boolean; after?: string }
interface GNpc { to: NpcId; user: string; hint?: boolean; after?: string }
interface GView { file: string; sort: boolean; search: boolean; after?: string }
interface GSub { fields: string | Record<string, string>; memo: string; result: "approve" | "reject"; basket?: string }

// 시점: (앞선 반려 수, 앞선 힌트 수, 종류) 를 숫자 하나로. after="reject1,hint2" 면 반려 1·힌트 2 다음
const parseAfter = (after?: string) => ({
  r: Math.max(0, ...[...(after ?? "").matchAll(/reject(\d)/g)].map((m) => Number(m[1]))),
  h: Math.max(0, ...[...(after ?? "").matchAll(/hint(\d)/g)].map((m) => Number(m[1]))),
});
const at = (r: number, h: number, kind: number) => r * 1000 + h * 10 + kind;

const BASKETS: Record<string, string> = {
  tool_result_with_share: "거래처별 합계표 (금액 내림차순), 비중 % 포함",
  user_written_with_share: "직접 만든 피벗 합계표, 비중 % 포함",
  tool_result_with_journal: "부가세 집계표 + 분개 요약 (차) 부가세대급금 (대) 미지급금",
  tool_result_without_journal: "부가세 집계표",
};
const defaultBasket = (sc: Scenario) => (sc.id === "01" ? BASKETS.tool_result_with_share : BASKETS.tool_result_with_journal);

// 도구 결과 → 제출 칸 값
function fieldsFromTool(sc: Scenario, flags: Flags): Record<string, number> {
  const tools = odiToolsFor(sc)!;
  const name = sc.id === "01" ? "aggregate_sales" : "vat_summary";
  const out = tools.run(name, flags);
  assert.ok(!out.isError, out.content);
  const r = JSON.parse(out.content);
  if (sc.id === "01") {
    return {
      total_sales: r.총매출,
      customer_count: r.거래처_수,
      min_customer_sales: Math.min(...r.거래처별.map((x: { 금액: number }) => x.금액)),
    };
  }
  return { output_vat: r.매출.매출세액, input_vat_expense: r.경비.매입세액, input_vat_import: r.수입.매입세액, payable_vat: r.납부세액 };
}

const VARIANT_FLAGS: Record<string, Flags> = { default: {}, normalized_only: { normalize_customer_names: true } };

function fieldValues(sc: Scenario, spec: GSub["fields"]): Record<string, number> {
  const fields = sc.submission!.fields;
  const pick = (id: string, variant: string) => {
    if (variant === "correct") return expectedValue(fields.find((f) => f.id === id)!, sc.answerKey);
    const flags = VARIANT_FLAGS[variant];
    assert.ok(flags, `모르는 값 종류 ${variant}`);
    return fieldsFromTool(sc, flags)[id];
  };
  return Object.fromEntries(fields.map((f) => [f.id, pick(f.id, typeof spec === "string" ? spec : spec[f.id])]));
}

export function evidenceOf(c: { scenario: string; log: { odi: GOdi[]; npc: GNpc[]; data_views: GView[]; submissions: GSub[] } }) {
  const sc = getScenario(c.scenario)!;
  const tools = odiToolsFor(sc)!;
  const toolName = sc.id === "01" ? "aggregate_sales" : "vat_summary";

  // 골든셋 'changed' = 직전 도구 결과 대비 숫자가 바뀌었는가 (첫 호출은 기본값 대비)
  let prev = JSON.stringify(tools.run(toolName, {}).log.summary);
  // after 가 없는 턴은 직전 턴과 같은 구간 (대화는 순서대로 쌓이므로 시각이 앞 턴보다 앞설 수 없음)
  let lastAt = 0;
  const odi = c.log.odi.map((t) => {
    const p = parseAfter(t.after);
    const prevR = Math.floor(lastAt / 1000);
    const prevH = Math.floor((lastAt % 1000) / 10);
    const { r, h } = t.after ? p : { r: prevR, h: prevH };
    lastAt = Math.max(lastAt, at(r, h, 1));
    let toolCalls: OdiToolLog[] = [];
    if (t.tool) {
      const log = tools.run(toolName, t.tool).log;
      const now = JSON.stringify(log.summary);
      assert.equal(now !== prev, t.changed, `도구 결과 변화가 골든셋 'changed' 와 다름: ${t.user}`);
      prev = now;
      toolCalls = [log];
    }
    return { at: lastAt, text: t.user, reply: "", toolCalls, aiWarned: [] as string[] };
  });

  let hintNo = 0;
  const npc = c.log.npc.map((n) => {
    const { r, h } = parseAfter(n.after);
    if (n.hint) {
      hintNo++;
      return { at: at(r, hintNo - 1, 2), to: n.to, text: n.user, hint: true };
    }
    return { at: at(r, h, 1), to: n.to, text: n.user, hint: false };
  });

  const views = c.log.data_views.map((v) => {
    const { r, h } = parseAfter(v.after);
    return { at: at(r, h, 1), file: v.file, sort: v.sort, search: v.search };
  });

  const subs = c.log.submissions.map((s, i) => {
    const values = fieldValues(sc, s.fields);
    const basket = s.basket ? BASKETS[s.basket] : defaultBasket(sc);
    assert.ok(basket, `모르는 basket ${s.basket}`);
    const g = grade({ spec: sc.submission!, answerKey: sc.answerKey, traps: sc.prompts.traps, values, basket, memo: s.memo });
    return {
      at: at(i, 99, 3),
      attempt: i + 1,
      memo: s.memo,
      basket,
      decision: g.decision,
      trapCaught: Object.fromEntries(g.trap_caught.map((t) => [t.id, t.caught])),
      checks: g.checks,
      expectedResult: s.result,
    };
  });

  const ev: Evidence = {
    startedAt: 0,
    odi,
    npc,
    views,
    subs,
    odiCallsUsed: odi.length,
    hintLevel: hintNo,
    rejectCount: subs.filter((s) => s.decision === "reject").length,
  };
  return { sc, ev, subs };
}
