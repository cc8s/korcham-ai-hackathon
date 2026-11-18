// EML: 결과물 제출 메일 F축 (보고 커뮤니케이션 10점) 코드 채점. 실행: npm run test:unit
import { test } from "node:test";
import assert from "node:assert/strict";
import { getScenario } from "../../src/scenarios.ts";
import { parseEmail, scoreEmail, valueAppears, type Email } from "../../src/email.ts";
import { expectedValue } from "../../src/grading.ts";

const s01 = getScenario("01")!;
const s03 = getScenario("03")!;
const s05 = getScenario("05")!;
const correct = (sc: typeof s01) => Object.fromEntries(sc.submission!.fields.map((f) => [f.id, expectedValue(f, sc.answerKey)]));
const v01 = correct(s01);
const good01: Email = {
  to: ["park"],
  cc: ["lee", "kang"],
  subject: "[보고] 10월 거래처별 매출 집계",
  body: `박소연 팀장님, 김수습입니다.\n10월 총매출은 ${Number(v01.total_sales).toLocaleString("ko-KR")}원입니다.\n거래처별 표는 첨부를 봐 주세요.`,
  attach_result: true,
};
const f01 = (e: Partial<Email> | null, basket = "합계표") =>
  scoreEmail({ email: e === null ? null : { ...good01, ...e }, cfg: s01.email, owner: s01.ownerNpcId, spec: s01.submission, values: v01, basket });

test("EML-01 모범 메일 10점, 메일 없으면 0점", () => {
  assert.deepEqual({ ...f01({}), cc_missing: undefined, cc_extra: undefined }, { to: 2, cc: 2, attach: 2, subject: 1, lead: 3, total: 10, cc_missing: undefined, cc_extra: undefined });
  assert.equal(f01(null).total, 0);
});

test("EML-02 받는 사람: 팀장만 2, 팀장+다른 사람 1, 팀장을 참조에만 넣으면 0", () => {
  assert.equal(f01({ to: ["park", "jung"] }).to, 1);
  assert.equal(f01({ to: ["lee"], cc: ["park", "kang"] }).to, 0);
});

test("EML-03 참조: 필요한 사람 전원·그 밖 없음 2, 일부만 또는 필요 없는 사람까지 1, 아무도 없으면 0", () => {
  assert.equal(f01({ cc: ["lee"] }).cc, 1);
  assert.equal(f01({ cc: ["lee", "kang", "jung"] }).cc, 1);
  assert.deepEqual(f01({ cc: ["lee", "kang", "jung"] }).cc_extra, ["jung"]);
  assert.equal(f01({ cc: [] }).cc, 0);
  assert.equal(f01({ cc: ["jung"] }).cc, 0);
  assert.deepEqual(f01({ cc: [] }).cc_missing, ["lee", "kang"]);
});

test("EML-04 첨부: 결과물을 붙여야 2. 안 붙였거나 결과물이 비었으면 0", () => {
  assert.equal(f01({ attach_result: false }).attach, 0);
  assert.equal(f01({}, "  ").attach, 0);
});

test("EML-05 제목: 업무 대상이 있고 6자 이상", () => {
  assert.equal(f01({ subject: "보고드립니다" }).subject, 0);
  assert.equal(f01({ subject: "매출" }).subject, 0);
  assert.equal(f01({ subject: "10월 매출 집계 보고" }).subject, 1);
});

test("EML-06 두괄식: 첫 3줄 안에 내가 낸 핵심 값 (쉼표 무관, 맞는지는 안 봄)", () => {
  assert.equal(f01({ body: `팀장님, 김수습입니다.\n총매출 ${v01.total_sales}원입니다.\n감사합니다.` }).lead, 3);
  assert.equal(f01({ body: "팀장님, 김수습입니다.\n요청하신 집계 보내 드립니다.\n확인 부탁드립니다.\n총매출은 첨부에 있습니다." }).lead, 0);
  // 틀린 값이어도 자기가 낸 값을 앞에 쓰면 두괄식
  const wrong = { ...v01, total_sales: 584030000 };
  const e = { ...good01, body: "팀장님,\n총매출 584,030,000원입니다.\n감사합니다." };
  assert.equal(scoreEmail({ email: e, cfg: s01.email, owner: "park", spec: s01.submission, values: wrong, basket: "x" }).lead, 3);
  // 다른 숫자 속에 들어 있는 건 안 침
  const f = s01.submission!.fields[0];
  assert.equal(valueAppears("15803000001", f, 580300000), false);
});

test("EML-07 선택 칸 값도 두괄식 판정 (05 출발 시각), 03 은 발주량 중 하나", () => {
  const v05 = correct(s05);
  const f = s05.submission!.fields.find((x) => x.id === "lh276_departure_kst")!;
  const label = f.options!.find((o) => o.id === v05.lh276_departure_kst)!.label;
  const time = label.split(" ").pop()!;
  assert.ok(valueAppears(`출발은 한국시간 ${time}입니다`, f, v05.lh276_departure_kst));
  const v03 = correct(s03);
  const e03: Email = { to: ["park"], cc: ["lee", "jung"], subject: "11월 발주 제안", body: `팀장님,\nVN-001 ${v03.order_vn_001}개 발주 제안드립니다.\n첨부 참고 부탁드립니다.`, attach_result: true };
  assert.equal(scoreEmail({ email: e03, cfg: s03.email, owner: "park", spec: s03.submission, values: v03, basket: "x" }).total, 10);
});

test("EML-08 입력 검증: 받는 사람·제목·본문 20자, 같은 사람이 받는 사람·참조 둘 다면 받는 사람만", () => {
  assert.ok("error" in parseEmail({ to: [], cc: [], subject: "a", body: "x".repeat(20), attach_result: true }));
  assert.ok("error" in parseEmail({ to: ["park"], cc: [], subject: "", body: "x".repeat(20), attach_result: true }));
  assert.ok("error" in parseEmail({ to: ["park"], cc: [], subject: "a", body: "짧음", attach_result: true }));
  assert.ok("error" in parseEmail({ to: ["kim"], cc: [], subject: "a", body: "x".repeat(20), attach_result: true }));
  const r = parseEmail({ to: ["park"], cc: ["park", "lee", "lee"], subject: "제목", body: "x".repeat(20), attach_result: true });
  assert.ok("email" in r && r.email.cc.join() === "lee");
});

test("EML-09 시나리오 설정: 담당 팀장은 참조 정답에 없고, 사수 이하늘은 모든 시나리오 참조", () => {
  for (const id of ["01", "02", "03", "04", "05"]) {
    const sc = getScenario(id)!;
    assert.ok(!sc.email.cc_required.includes(sc.ownerNpcId), id);
    assert.ok(sc.email.cc_required.includes("lee"), id);
    assert.ok(sc.email.cc_why.length > 10, id);
  }
});
