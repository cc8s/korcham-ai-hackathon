// 정답 숫자 마스킹. 팀원 대화·팀장 검토 멘트에는 정답을 주지 않지만,
// 출력에 정답 숫자가 나오면 한 번 더 가린다 (사용자가 쓴 숫자를 따라 말하는 경우 등).

// 이 값 미만의 정답은 가리지 않는다. 1만 미만은 거래처 수(10곳), 행 수(124행), 연도(2026),
// 비율(%), 날짜·시각, 03 의 발주 수량(두세 자리)처럼 대화에 흔한 숫자와 겹쳐서
// 엉뚱한 숫자까지 가려진다. 01·02 의 금액 정답은 전부 1만 이상
export const MASK_MIN = 10_000;

export const MASK_TEXT = "○○○";

// answer_key 의 숫자 잎 전부 (배열 포함). MASK_MIN 미만은 제외
export function answerNumbers(answerKey: unknown): number[] {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === "number") {
      if (Number.isFinite(v) && Math.abs(v) >= MASK_MIN) out.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(answerKey);
  return [...out];
}

// 숫자 한 덩어리: 천 단위 쉼표(580,300,000) 또는 쉼표 없는 숫자, 소수점 선택
const NUM = String.raw`(?:\d{1,3}(?:,\d{3})+(?!\d)|\d+)(?:\.\d+)?`;
// 앞이 숫자·소수점이면 숫자 중간이라 제외. 뒤에 억/만/천과 원이 붙는 표기까지 한 덩어리로 본다
// 예) 580300000, 580,300,000원, 58,030만원, 5억 8,030만 원, 5.803억
const TOKEN = new RegExp(
  String.raw`(?<![\d.])(${NUM})(?:( ?억)(?: ?(${NUM}) ?만)?|( ?만| ?천))?( ?원)?`,
  "g",
);

const num = (s: string) => Number(s.replace(/,/g, ""));

function tokenValue(m: RegExpExecArray): number {
  const [, a, eok, b, unit] = m;
  if (eok) return num(a) * 1e8 + (b ? num(b) * 1e4 : 0);
  if (unit?.trim() === "만") return num(a) * 1e4;
  if (unit?.trim() === "천") return num(a) * 1e3;
  return num(a);
}

// text 안의 정답 숫자를 MASK_TEXT 로 바꾼다. "원" 이 붙어 있었으면 "○○○원" 으로 남김
export function maskNumbers(text: string, answers: number[]): string {
  if (answers.length === 0) return text;
  return text.replace(TOKEN, (...args) => {
    const m = args.slice(0, 6) as unknown as RegExpExecArray;
    const v = tokenValue(m);
    if (!answers.some((x) => Math.abs(x - v) < 0.5)) return m[0];
    return MASK_TEXT + (m[5] ? "원" : "");
  });
}

export function maskAnswers(text: string, answerKey: unknown): string {
  return maskNumbers(text, answerNumbers(answerKey));
}
