// 개인정보 가리기. 대회 규정: 외부 AI API 에 실제 개인정보를 보내지 않는다.
// 사용자가 직접 쓰는 글(오디·팀원 대화, 결과물, 검증 메모)을 Claude 호출과 DB 저장 전에 거른다.
// 형식이 정해진 것만 결정적으로 가린다. 사람 이름은 정규식으로 확실히 못 잡으므로 입장 화면 안내로 대신한다.
//
// 업무 숫자를 개인정보로 오인하지 않는 것이 중요하다: 금액(580,300,000), 날짜(2026-10-31),
// 주문번호(ORD-20261008), 증권번호(OM-2026-CARGO), 송장번호(IMP-2026-1012), 시각(10/30 18:10) 은 그대로 둔다

export type PiiKind = "주민등록번호" | "전화번호" | "이메일" | "카드번호" | "계좌번호";

// 순서가 중요하다: 주민번호·카드번호처럼 긴 것을 먼저 가려야 짧은 패턴이 그 일부를 먹지 않는다.
// 앞뒤 경계는 숫자·영문·하이픈이 아닌 곳 (주문번호 ORD-2026… 의 일부를 잘라 먹지 않게)
const B = "(?<![\\w-])";
const E = "(?![\\w-])";
const RULES: { kind: PiiKind; re: RegExp; ok?: (m: string) => boolean }[] = [
  // 생년월일 6자리 + 성별 1~4 로 시작하는 7자리
  { kind: "주민등록번호", re: new RegExp(`${B}\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])[- ]?[1-4]\\d{6}${E}`, "g") },
  // 16자리 카드번호 (4-4-4-4, 구분자 공백·하이픈)
  { kind: "카드번호", re: new RegExp(`${B}\\d{4}[- ]\\d{4}[- ]\\d{4}[- ]\\d{4}${E}`, "g") },
  // 휴대폰 010·011·016~019, 구분자 없이도. 유선 02·0xx 는 구분자가 있을 때만 (숫자열 오인 방지)
  // 맨 앞 0 을 꼭 요구한다 (+82 국제 표기만 예외). 안 그러면 쉼표 없는 금액 1100000000 이 전화번호가 됨
  { kind: "전화번호", re: new RegExp(`(?<![\\w-]|\\+)(?:\\+82[- ]?1[016-9]|01[016-9])[-. ]?\\d{3,4}[-. ]?\\d{4}${E}`, "g") },
  { kind: "전화번호", re: new RegExp(`${B}0(?:2|[3-6][1-5]|70)[-. )]\\d{3,4}[-. ]\\d{4}${E}`, "g") },
  // 이메일. 시나리오 속 가상 주소(*.example, RFC 2606 예약 도메인)는 사용자 개인정보가 아니므로 그대로
  { kind: "이메일", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ok: (m) => /\.example$/i.test(m) },
  // 계좌번호: 숫자 세 덩어리 이상을 하이픈으로 이은 것 중 숫자가 10~16자리. 날짜(2026-10-31) 모양은 제외
  {
    kind: "계좌번호",
    re: new RegExp(`${B}\\d{2,6}-\\d{2,6}-\\d{2,8}(?:-\\d{1,3})?${E}`, "g"),
    ok: (m) => {
      const digits = m.replace(/-/g, "").length;
      return digits < 10 || digits > 16 || /^\d{4}-\d{1,2}-\d{1,2}$/.test(m);
    },
  },
];

export interface Masked {
  text: string;
  found: PiiKind[]; // 가린 종류 (중복 없이, 처음 나온 순서)
}

export function maskPii(input: string): Masked {
  let text = input;
  const found: PiiKind[] = [];
  for (const { kind, re, ok } of RULES) {
    text = text.replace(re, (m) => {
      if (ok?.(m)) return m;
      if (!found.includes(kind)) found.push(kind);
      return `[${kind}]`;
    });
  }
  return { text, found };
}

// 사용자에게 보여 줄 한 줄 (응답에 붙임)
export const maskNotice = (found: PiiKind[]) =>
  found.length === 0 ? null : `개인정보로 보이는 부분(${found.join(", ")})은 가려서 보냈어요. 이 서비스에는 실제 개인정보를 쓰지 마세요.`;
