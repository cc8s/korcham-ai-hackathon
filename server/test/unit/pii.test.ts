// PII-01~04: 개인정보 가리기 (대회 규정: 외부 AI API 에 실제 개인정보 금지). 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPii, maskNotice } from "../../src/pii.ts";

test("PII-01 형식이 정해진 개인정보는 가린다", () => {
  const cases: [string, string, string][] = [
    ["제 번호 010-1234-5678로 보내 줘", "제 번호 [전화번호]로 보내 줘", "전화번호"],
    ["01012345678 로 연락", "[전화번호] 로 연락", "전화번호"],
    ["+82 10-1234-5678", "[전화번호]", "전화번호"],
    ["사무실 02-123-4567", "사무실 [전화번호]", "전화번호"],
    ["메일은 hong.gildong@gmail.com 입니다", "메일은 [이메일] 입니다", "이메일"],
    ["주민번호 900101-1234567", "주민번호 [주민등록번호]", "주민등록번호"],
    ["카드 1234-5678-9012-3456 결제", "카드 [카드번호] 결제", "카드번호"],
    ["국민은행 123456-01-123456 입금", "국민은행 [계좌번호] 입금", "계좌번호"],
  ];
  for (const [input, want, kind] of cases) {
    const m = maskPii(input);
    assert.equal(m.text, want, input);
    assert.deepEqual(m.found, [kind], input);
  }
});

test("PII-02 업무 숫자·가상 데이터는 그대로 둔다 (금액·날짜·주문·송장·증권번호·시각·예시 메일)", () => {
  const keep = [
    "총매출 580,300,000원, 거래처 10곳, 최소 9,480,000원",
    "납부세액 52801758, 경비 1769000, 1100000000원",
    "재고 기준일 2026-10-31, 발주일 2026-11-16",
    "ORD-20261008 중복, 송장 IMP-2026-1012, 증권 OM-2026-CARGO",
    "LH276 10/30 18:10 출발, 전시장 10/29 22:00",
    "회신 주소 trade@oreum.example 로 보내세요",
    "SKU TH-003 발주량 418개, VN-004 409개",
    "환율 1,452.30원, 부가세율 10%",
  ];
  for (const t of keep) {
    const m = maskPii(t);
    assert.equal(m.text, t, t);
    assert.deepEqual(m.found, [], t);
  }
});

test("PII-03 한 글에 여러 종류: 모두 가리고 종류는 처음 나온 순서로 한 번씩", () => {
  const m = maskPii("010-1111-2222, a@b.co, 010-3333-4444, 900101-2234567");
  assert.equal(m.text, "[전화번호], [이메일], [전화번호], [주민등록번호]");
  assert.deepEqual(m.found.sort(), ["이메일", "전화번호", "주민등록번호"].sort());
});

test("PII-04 안내 문구: 가린 게 없으면 null", () => {
  assert.equal(maskNotice([]), null);
  assert.ok(maskNotice(["전화번호"])!.includes("전화번호"));
});
