// 02 전산회계 월말결산: vat_summary 도구.
// 함정을 도구 기본값에 둔다 (기획 피드백 1번).
//   recheck_vat_rate=false        → 거래 내역에 적힌 부가세를 그대로 씀. 광고비 30,000 이 그대로 들어가
//                                   경비 매입세액 1,499,000 (T1, 정답 1,769,000)
//   use_import_declarations=false → 수입 부가세 = 송장 외화 × 기준 환율 × 10% = 3,021,700 (T2, 정답 3,459,242)
//   둘 다 true                    → answer_key.json 과 같음 (납부세액 52,801,758)
// 환율·부가세율은 _shared/constants.json 에서 읽는다
import { z } from "zod";
import { constants } from "../config.js";
import { parseCsv, num } from "./csv.js";
import type { OdiTool } from "./types.js";

export const VatInput = z
  .object({
    recheck_vat_rate: z.boolean().default(false),
    use_import_declarations: z.boolean().default(false),
  })
  .strict();
export type VatInput = z.infer<typeof VatInput>;

type Rates = { vatRate: number; fx: Record<string, number> };

export interface VatResult {
  적용_옵션: VatInput;
  매출: { 건수: number; 공급가액_합계: number; 매출세액: number };
  경비: { 건수: number; 공급가액_합계: number; 매입세액: number };
  수입: {
    근거: string;
    건별: { 송장번호: string; 공급사: string; 매입세액: number; 계산: string }[];
    매입세액: number;
  };
  매입세액_합계: number;
  납부세액: number;
  부가세_정정?: { 번호: string; 거래처: string; 공급가액: number; 기재_부가세: number; 재계산_부가세: number }[];
}

export function vatSummary(transactionsCsv: string, importsCsv: string, input: VatInput, rates: Rates): VatResult {
  const tx = parseCsv(transactionsCsv).rows;
  const imports = parseCsv(importsCsv).rows;
  const fixes: NonNullable<VatResult["부가세_정정"]> = [];

  // 매출·경비 한 줄의 부가세. recheck 면 공급가액×10% 로 다시 계산하고 기재값과 다르면 기록
  const vatOf = (r: Record<string, string>) => {
    const written = num(r["부가세"]);
    if (!input.recheck_vat_rate) return written;
    const supply = num(r["공급가액"]);
    const re = Math.round(supply * rates.vatRate);
    if (re !== written) fixes.push({ 번호: r["번호"], 거래처: r["거래처"], 공급가액: supply, 기재_부가세: written, 재계산_부가세: re });
    return re;
  };
  const sumOf = (type: string) => {
    const rows = tx.filter((r) => r["유형"] === type);
    return {
      건수: rows.length,
      공급가액_합계: rows.reduce((n, r) => n + num(r["공급가액"]), 0),
      세액: rows.reduce((n, r) => n + vatOf(r), 0),
    };
  };
  const sales = sumOf("매출");
  const expense = sumOf("경비");

  let 건별: VatResult["수입"]["건별"];
  if (input.use_import_declarations) {
    건별 = imports.map((d) => ({
      송장번호: d["신고번호"],
      공급사: d["공급사"],
      매입세액: num(d["부가세"]),
      계산: `수입신고필증 부가세 (과세가격 ${num(d["과세가격"]).toLocaleString("ko-KR")} + 관세 ${num(d["관세"]).toLocaleString("ko-KR")}) × 10%`,
    }));
  } else {
    // 거래 내역의 수입 행은 금액 칸이 비어 있고 적요에 "수입 송장 IMP-... (EUR 12,500)" 만 있다
    건별 = tx
      .filter((r) => r["유형"] === "수입")
      .map((r) => {
        const memo = r["적요"];
        const inv = /IMP-\d{4}-\d{4}/.exec(memo)?.[0] ?? r["번호"];
        const m = /\b([A-Z]{3})\s*([\d,]+(?:\.\d+)?)/.exec(memo);
        if (!m) throw new Error(`수입 송장 금액을 읽을 수 없음: ${memo}`);
        const [, cur, amt] = m;
        const rate = rates.fx[cur];
        if (!rate) throw new Error(`환율 없음: ${cur}`);
        const krw = Math.round(num(amt) * rate);
        return {
          송장번호: inv,
          공급사: r["거래처"],
          매입세액: Math.round(krw * rates.vatRate),
          계산: `송장 ${cur} ${num(amt).toLocaleString("ko-KR")} × 환율 ${rate.toLocaleString("ko-KR")} = ${krw.toLocaleString("ko-KR")}원 × 10%`,
        };
      });
  }
  const importVat = 건별.reduce((n, x) => n + x.매입세액, 0);
  const input_vat = expense.세액 + importVat;

  return {
    적용_옵션: input,
    매출: { 건수: sales.건수, 공급가액_합계: sales.공급가액_합계, 매출세액: sales.세액 },
    경비: { 건수: expense.건수, 공급가액_합계: expense.공급가액_합계, 매입세액: expense.세액 },
    수입: {
      근거: input.use_import_declarations ? "수입신고필증 부가세" : "송장 외화 금액 × 기준 환율 × 10%",
      건별,
      매입세액: importVat,
    },
    매입세액_합계: input_vat,
    납부세액: sales.세액 - input_vat,
    ...(input.recheck_vat_rate ? { 부가세_정정: fixes } : {}),
  };
}

export const vatSummaryTool: OdiTool<VatInput, VatResult> = {
  name: "vat_summary",
  description:
    "10월 거래 내역(transactions_2026_10.csv)과 수입신고필증(import_declarations_2026_10.csv)으로 매출세액·매입세액(경비/수입 구분)·납부세액을 집계한다. " +
    "부가세 집계, 납부세액, 분개에 쓸 금액처럼 세액 숫자가 필요한 요청이면 직접 계산하지 말고 항상 이 도구를 호출한다. " +
    "옵션은 사용자가 그 처리를 요청했을 때만 켠다.",
  inputSchema: {
    type: "object",
    properties: {
      recheck_vat_rate: {
        type: "boolean",
        description: "true 면 매출·경비 각 거래의 부가세를 공급가액×10% 로 다시 계산해 기재값 대신 쓰고, 기재값과 다른 거래를 돌려준다. 기본 false(기재값 그대로). 사용자가 부가세 검산·10% 확인을 요청했을 때만 true.",
      },
      use_import_declarations: {
        type: "boolean",
        description: "true 면 수입 매입세액을 수입신고필증의 부가세로 잡는다. 기본 false(송장 외화 금액 × 기준 환율 × 10%). 사용자가 신고필증 기준·수입 부가세 근거 재확인을 요청했을 때만 true.",
      },
    },
    additionalProperties: false,
  },
  parse: (raw) => VatInput.parse(raw ?? {}),
  sources: ["transactions", "imports"],
  run: (src, input) =>
    vatSummary(src.transactions, src.imports, input, {
      vatRate: Number(constants["부가세율"]),
      fx: constants["환율"] as Record<string, number>,
    }),
  summary: (r) => ({
    매출세액: r.매출.매출세액,
    매입세액_경비: r.경비.매입세액,
    매입세액_수입: r.수입.매입세액,
    납부세액: r.납부세액,
  }),
};
