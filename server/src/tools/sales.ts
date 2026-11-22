// 01 컴활 매출집계: aggregate_sales 도구.
// 함정을 프롬프트가 아니라 도구 기본값에 둔다.
//   dedupe_order_ids=false        → 같은 주문번호 3건이 두 번씩 더해짐 (T1, 총매출 584,030,000)
//   normalize_customer_names=false → "성실 상사"·"마켓 A"가 따로 묶여 12곳 (T2)
//   둘 다 true                    → answer_key.json 과 같음 (10곳, 580,300,000)
// 계산은 전부 서버 코드가 CSV 에서 결정적으로 한다. 같은 입력이면 매번 같은 결과
import { z } from "zod";
import { parseCsv, num } from "./csv.js";
import type { OdiTool } from "./types.js";

export const SalesInput = z
  .object({
    dedupe_order_ids: z.boolean().default(false),
    normalize_customer_names: z.boolean().default(false),
  })
  .strict();
export type SalesInput = z.infer<typeof SalesInput>;

export interface SalesResult {
  적용_옵션: SalesInput;
  읽은_행수: number;
  집계_행수: number;
  거래처_수: number;
  총매출: number;
  거래처별: { 거래처: string; 금액: number; 건수: number; 비중_pct: number }[];
  제거한_중복?: { 주문번호: string; 제거_행수: number; 제거_금액: number }[];
  통합한_표기?: Record<string, string>;
}

// 거래처명 정규화: 유니코드 호환 정규화 후 공백 전부 제거 ("성실 상사" → "성실상사")
export const normalizeName = (s: string) => s.normalize("NFKC").replace(/\s+/g, "");

export function aggregateSales(csvText: string, input: SalesInput): SalesResult {
  const { rows } = parseCsv(csvText);
  let used = rows;
  let removed: SalesResult["제거한_중복"];
  if (input.dedupe_order_ids) {
    // 주문번호 기준으로 첫 행만 남긴다
    const seen = new Set<string>();
    const dup = new Map<string, { 제거_행수: number; 제거_금액: number }>();
    used = rows.filter((r) => {
      const id = r["주문번호"];
      if (!seen.has(id)) {
        seen.add(id);
        return true;
      }
      const d = dup.get(id) ?? { 제거_행수: 0, 제거_금액: 0 };
      d.제거_행수 += 1;
      d.제거_금액 += num(r["금액"]);
      dup.set(id, d);
      return false;
    });
    removed = [...dup].map(([주문번호, d]) => ({ 주문번호, ...d }));
  }

  const merged: Record<string, string> = {};
  const groups = new Map<string, { 금액: number; 건수: number }>();
  for (const r of used) {
    const raw = r["거래처명"];
    let key = raw;
    if (input.normalize_customer_names) {
      key = normalizeName(raw);
      if (key !== raw) merged[raw] = key;
    }
    const g = groups.get(key) ?? { 금액: 0, 건수: 0 };
    g.금액 += num(r["금액"]);
    g.건수 += 1;
    groups.set(key, g);
  }
  const total = [...groups.values()].reduce((n, g) => n + g.금액, 0);
  const list = [...groups]
    .map(([거래처, g]) => ({ 거래처, 금액: g.금액, 건수: g.건수, 비중_pct: total ? Math.round((g.금액 / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.금액 - a.금액 || a.거래처.localeCompare(b.거래처, "ko"));

  return {
    적용_옵션: input,
    읽은_행수: rows.length,
    집계_행수: used.length,
    거래처_수: list.length,
    총매출: total,
    거래처별: list,
    ...(removed ? { 제거한_중복: removed } : {}),
    ...(input.normalize_customer_names ? { 통합한_표기: merged } : {}),
  };
}

export const aggregateSalesTool: OdiTool<SalesInput, SalesResult> = {
  name: "aggregate_sales",
  // 언제 부르는지를 설명에 분명히 둔다 (모델이 도구를 아껴 부를 때가 있고, tool_choice 강제는 Opus 5.5 에서 400)
  description:
    "10월 매출 원본(sales_2026_10.csv)을 거래처별로 집계해 거래처별 합계·건수·비중(%)·거래처 수·총매출을 돌려준다. " +
    "거래처별 합계표, 총매출, 비중, 차트용 숫자처럼 매출 숫자가 필요한 요청이면 직접 계산하지 말고 항상 이 도구를 호출한다.",
  inputSchema: {
    type: "object",
    properties: {
      dedupe_order_ids: {
        type: "boolean",
        description: "true 면 주문번호가 같은 행은 첫 행만 남기고 집계한다. 기본 false. 사용자가 중복 확인·중복 제거를 요청했을 때만 true.",
      },
      normalize_customer_names: {
        type: "boolean",
        description: "true 면 거래처명의 공백·띄어쓰기 차이를 없앤 이름으로 묶는다. 기본 false. 사용자가 거래처명 정리·통일·정규화를 요청했을 때만 true.",
      },
    },
    additionalProperties: false,
  },
  parse: (raw) => SalesInput.parse(raw ?? {}),
  sources: ["sales"],
  run: (src, input) => aggregateSales(src.sales, input),
  summary: (r) => ({ 거래처_수: r.거래처_수, 총매출: r.총매출, 집계_행수: r.집계_행수 }),
};
