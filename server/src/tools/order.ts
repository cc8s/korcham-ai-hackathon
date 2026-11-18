// 03 유통관리사 발주제안: order_quantity 도구.
// 함정을 프롬프트(planted_belief)가 아니라 도구 기본값에 둔다 (기획 피드백 1번).
// 실제 모델(Sonnet·Opus)은 "시즌 무시" 믿음을 프롬프트로 심어도 따르지 않고 스스로 전년 동월로 계산했다
// (2026-11-18 실측). 숫자를 코드가 내야 함정이 매번 같은 모습으로 재현된다.
//   발주량 = 예측 수요 + 안전재고 − 현재고, 음수면 0 (반품 발주 없음)
//   use_last_year_same_month=false    → 수요 = 최근 3개월(8~10월) 월평균 × 개월 수. 시즌 무시 (T2)
//   include_pre_arrival_demand=false  → 예측 기간 = 커버 2개월(1~2월)만. 12월 말 입고 전 11~12월 소진 누락 (T2)
//   convert_stock_units=false         → 재고 파일 현재고 숫자를 단위와 상관없이 그대로 씀 (T1)
//   기본값(전부 false) = answer_key 의 "오디_오답" 과 같고, 셋 다 true = answer_key 정답과 같다
// T2 를 옵션 둘로 나눈 이유: "전년 동월 기준" 과 "입고 전 소진 포함" 은 서로 다른 지적이고,
// prompts.json 반려 영역도 "시즌 무시" / "입고 전 소진 누락" 으로 따로 있다. 하나만 말하면 하나만 풀린다
import { z } from "zod";
import { parseCsv, num } from "./csv.js";
import type { OdiTool } from "./types.js";

export const OrderInput = z
  .object({
    use_last_year_same_month: z.boolean().default(false),
    include_pre_arrival_demand: z.boolean().default(false),
    convert_stock_units: z.boolean().default(false),
  })
  .strict();
export type OrderInput = z.infer<typeof OrderInput>;

// 업무 카드(prompts.json task_card.body)의 날짜. 발주일 11/16, 입고는 리드타임 뒤(12월 말), 다음 발주분은 3월 초 입고
const ORDER_DATE = "2026-11-16";
const PRE_ARRIVAL_MONTHS = ["2026-11", "2026-12"]; // 재고 기준일(10/31) 다음 날부터 입고 전까지 팔리는 달
const COVER_MONTHS = ["2027-01", "2027-02"]; // 이번 입고분이 버텨야 하는 달
const RECENT_MONTHS = 3; // 기본 예측: 판매 파일 마지막 3개월 평균
const GROWTH = 1.1; // 전년 동월 기준일 때 성장률 (answer_key 기준: 전년 동월 × 1.1, 소수점 버림)

export interface OrderRow {
  SKU: string;
  품명: string;
  현재고: number; // 계산에 쓴 값 (convert 면 ea 로 환산한 값)
  안전재고: number;
  예측수요_입고전?: number; // include_pre_arrival_demand 일 때만
  예측수요_커버: number;
  발주량: number;
  // 아래는 그 옵션을 켰을 때만. 기본 결과에 단위·시즌·입고일이 있으면 오디가 스스로 함정을 짚는다
  // (02 에서 경비 공급가액을 숨긴 것과 같은 이유. 사용자가 원본 파일을 열거나 그 처리를 요청해야 보이게)
  재고_원본?: string;
  시즌?: string;
  입고예정일?: string;
}

export interface OrderResult {
  적용_옵션: OrderInput;
  발주일: string;
  기준: { 수요_예측: string; 예측_기간: string; 현재고: string };
  SKU별: OrderRow[];
  발주량_합계: number;
}

const ym = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
// "2026-01" → 12개월 전 "2025-01"
const lastYear = (month: string) => ym(Number(month.slice(0, 4)) - 1, Number(month.slice(5, 7)));

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// 재고 단위 → 낱개 배수. "ea" = 1, "box(12입)" = 12. 모르는 단위는 계산하지 않고 오류 (조용히 틀리지 않게)
export function unitMultiplier(unit: string): number {
  const u = unit.trim();
  if (u === "" || /^ea$/i.test(u)) return 1;
  const m = /(\d+)\s*입/.exec(u);
  if (!m) throw new Error(`재고 단위를 낱개로 환산할 수 없음: ${unit}`);
  return Number(m[1]);
}

export function orderQuantity(salesCsv: string, inventoryCsv: string, productsCsv: string, input: OrderInput): OrderResult {
  const sales = new Map<string, Map<string, number>>();
  for (const r of parseCsv(salesCsv).rows) {
    const m = sales.get(r["SKU"]) ?? new Map<string, number>();
    m.set(r["월"], num(r["판매량"]));
    sales.set(r["SKU"], m);
  }
  const products = new Map(parseCsv(productsCsv).rows.map((r) => [r["SKU"], r]));
  const inventory = parseCsv(inventoryCsv).rows;

  const rows: OrderRow[] = inventory.map((inv) => {
    const sku = inv["SKU"];
    const hist = sales.get(sku);
    if (!hist) throw new Error(`판매 실적 없음: ${sku}`);
    const at = (month: string) => {
      const v = hist.get(month);
      if (v === undefined) throw new Error(`${sku} ${month} 판매 실적 없음`);
      return v;
    };

    // 수요 예측. 두 기간(입고 전 / 커버)을 같은 방식으로 각각 계산
    let demandOf: (months: string[]) => number;
    if (input.use_last_year_same_month) {
      // 기간 안 달들의 전년 동월 합 × 1.1, 소수점 버림 (answer_key 와 같은 반올림 순서: 합한 뒤 곱하고 버림)
      demandOf = (months) => Math.floor(months.reduce((n, mo) => n + at(lastYear(mo)), 0) * GROWTH);
    } else {
      // 판매 파일 마지막 3개월 월평균(소수점 버림) × 개월 수. 시즌과 무관하게 최근 흐름이 이어진다고 본다
      const recent = [...hist.keys()].sort().slice(-RECENT_MONTHS);
      const avg = Math.floor(recent.reduce((n, mo) => n + at(mo), 0) / recent.length);
      demandOf = (months) => avg * months.length;
    }
    const cover = demandOf(COVER_MONTHS);
    const pre = input.include_pre_arrival_demand ? demandOf(PRE_ARRIVAL_MONTHS) : 0;

    const rawStock = num(inv["현재고"]);
    const stock = input.convert_stock_units ? rawStock * unitMultiplier(inv["단위"]) : rawStock;
    const safety = num(inv["안전재고"]);
    const qty = Math.max(0, pre + cover + safety - stock);

    const p = products.get(sku);
    if (!p) throw new Error(`제품 정보 없음: ${sku}`);
    return {
      SKU: sku,
      품명: inv["품명"] || p["품명"],
      현재고: stock,
      안전재고: safety,
      ...(input.include_pre_arrival_demand ? { 예측수요_입고전: pre } : {}),
      예측수요_커버: cover,
      발주량: qty,
      ...(input.convert_stock_units ? { 재고_원본: `${rawStock} ${inv["단위"]}` } : {}),
      ...(input.use_last_year_same_month ? { 시즌: p["시즌"] } : {}),
      ...(input.include_pre_arrival_demand ? { 입고예정일: addDays(ORDER_DATE, num(inv["리드타임(일)"])) } : {}),
    };
  });

  const span = (ms: string[]) => `${ms[0]}~${ms.at(-1)!.slice(5)}`;
  return {
    적용_옵션: input,
    발주일: ORDER_DATE,
    기준: {
      수요_예측: input.use_last_year_same_month
        ? `기간 안 달들의 전년 동월 판매량 합 × ${GROWTH} (소수점 버림)`
        : `최근 ${RECENT_MONTHS}개월 월평균 판매량 × 개월 수`,
      예측_기간: input.include_pre_arrival_demand
        ? `입고 전 ${span(PRE_ARRIVAL_MONTHS)} + 커버 ${span(COVER_MONTHS)}`
        : `커버 ${span(COVER_MONTHS)}`,
      현재고: input.convert_stock_units ? "재고 파일 현재고를 단위 열에 따라 낱개(ea)로 환산" : "재고 파일 현재고 칸",
    },
    SKU별: rows,
    발주량_합계: rows.reduce((n, r) => n + r.발주량, 0),
  };
}

export const orderQuantityTool: OdiTool<OrderInput, OrderResult> = {
  name: "order_quantity",
  // 설명에는 어느 SKU 가 문제인지 쓰지 않는다 (사용자가 "도구 설명 보여 줘" 해도 단서가 안 되게)
  description:
    "판매 실적(monthly_sales_2025_11_2026_10.csv)·현재고(inventory_2026_10_31.csv)·제품 정보(products.csv)로 SKU별 발주량을 계산한다. " +
    "발주량 = 예측 수요 + 안전재고 − 현재고 (음수면 0). SKU별 예측 수요·현재고·발주량과 발주량 합계를 돌려준다. " +
    "발주량, 예측 수요, 발주 합계처럼 발주 숫자가 필요한 요청이면 직접 계산하지 말고 항상 이 도구를 호출한다. " +
    "옵션은 사용자가 그 처리를 요청했을 때만 켠다.",
  inputSchema: {
    type: "object",
    properties: {
      use_last_year_same_month: {
        type: "boolean",
        description:
          "true 면 수요를 전년 동월 판매량 × 1.1 로 예측한다. 기본 false (최근 3개월 월평균 × 개월 수). 사용자가 전년 동월·작년 실적·시즌(계절) 반영을 요청했을 때만 true.",
      },
      include_pre_arrival_demand: {
        type: "boolean",
        description:
          "true 면 예측 기간에 입고 전(11~12월) 판매분을 더하고 SKU별 입고예정일을 함께 돌려준다. 기본 false (커버 기간 1~2월만). 사용자가 입고 전 소진·리드타임 동안 팔리는 양 반영을 요청했을 때만 true.",
      },
      convert_stock_units: {
        type: "boolean",
        description:
          "true 면 재고 파일의 단위 열을 읽어 현재고를 낱개(ea)로 환산한다. 기본 false (현재고 숫자 그대로). 사용자가 재고 단위 확인·환산을 요청했을 때만 true.",
      },
    },
    additionalProperties: false,
  },
  parse: (raw) => OrderInput.parse(raw ?? {}),
  sources: ["sales", "inventory", "products"],
  run: (src, input) => orderQuantity(src.sales, src.inventory, src.products, input),
  summary: (r) => ({
    발주량_합계: r.발주량_합계,
    SKU별_발주량: Object.fromEntries(r.SKU별.map((x) => [x.SKU, x.발주량])),
  }),
};
