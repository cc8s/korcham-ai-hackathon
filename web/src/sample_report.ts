import type { Report } from "./types";

// S6 "샘플 리포트 보기"용. 06 문서 6절 예시 그대로. 심사위원이 플레이 없이 결과물 형태를 보게
export const SAMPLE_REPORT: Report = {
  run_id: "sample",
  scenario: { id: "01", title: "10월 거래처별 매출 집계표", cert: "컴퓨터활용능력" },
  total: 82,
  grade: "A",
  summary: "검증 습관이 있어요. 지시를 처음부터 더 구체적으로 주면 호출을 반으로 줄일 수 있습니다.",
  axes: {
    A_instruction: {
      score: 14,
      max: 20,
      items: [
        { name: "구체성", score: 4, quote: "거래처별 10월 매출 합계표 만들어 줘. 금액 큰 순서로." },
        { name: "맥락 제공", score: 2, quote: "해당 없음" },
        { name: "반복 개선", score: 5, quote: "거래처가 12개로 나오는데 우리 거래처는 10곳이야. 이름 공백 정리해서 다시 집계해 줘." },
        { name: "역할 분리", score: 3, quote: "합계는 네가 내고 중복은 내가 볼게." },
      ],
    },
    B_verification: {
      score: 21,
      max: 25,
      code: { data_viewed: 5, active_explore: 3, ask_back: 4, memo_consistent: 3 },
      llm: { score: 6, quote: "중복 주문번호 있는지 확인해 줘." },
    },
    C_traps: {
      score: 21.25,
      max: 25,
      traps: [
        { id: "T1", desc: "중복 주문 3건", found: true, path: "self", coef: 1.0, score: 12.5 },
        { id: "T2", desc: "거래처명 표기 변형", found: true, path: "ai_warned", coef: 0.7, score: 8.75 },
      ],
    },
    D_deliverable: { score: 13, max: 15, approved: true, reject_count: 1, format_ok: true },
    E_efficiency: { score: 4, max: 5, odi_calls: 8, redundant_questions: 0 },
    F_report: {
      score: 9,
      max: 10,
      to: 2,
      cc: 1,
      attach: 2,
      subject: 1,
      lead: 3,
      cc_missing: ["kang"],
      cc_extra: [],
      cc_why: "사수 이하늘은 모든 보고에 참조. 이 집계는 대표 보고용이고 대표 보고·매출 회계는 경영지원팀(강지훈) 업무라 참조",
      sent: true,
    },
  },
  highlights: {
    good: {
      quote: "거래처가 12개로 나오는데 우리 거래처는 10곳이야. 이름 공백 정리해서 다시 집계해 줘.",
      why: "결과를 도메인 지식(거래처 10곳)과 대조해서 오류를 특정했습니다.",
    },
    improve: { quote: "매출 정리해 줘.", why: "첫 지시에 범위·형식이 없어 두 번 더 호출해야 했습니다." },
  },
  next_steps: [
    "첫 지시에 '무엇을, 어떤 형식으로, 왜'를 한 문장에 넣어 보세요.",
    "집계 결과를 받으면 행 수·그룹 수를 원본과 먼저 비교하는 습관을 들이세요.",
  ],
  resources: { odi_calls: "8/15", mentor_questions: 3, rejects: "1/3", duration_min: 14 },
};
