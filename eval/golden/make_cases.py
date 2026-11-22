# 골든셋 사례 JSON 생성 + 총점 범위 검산. 실행: python eval/golden/make_cases.py .  (레포 루트에서). 사례를 고칠 땐 이 파일을 고치고 다시 실행
import json, sys, os

ROOT = sys.argv[1]
K01 = ["컴활1급 실기 데이터관리 1.2 기본 데이터 도구(중복된 항목 제거·정렬·필터)", "컴활1급 실기 데이터계산 1.3 계산 결과의 정확성", "컴활1급 실기 데이터분석 3.1 요약·보고", "컴활 필기 2027 AI 기초 활용: AI의 한계와 활용 시 유의사항"]
K02 = ["전산회계운용사 2급 실기 증빙서류 3.1 증빙여부 검토·3.2 구분·대조", "전산회계운용사 2급 실기 결산 3.3 장부 오류 수정", "전산회계운용사 1급 실기 2.5 부가가치세신고 대상 거래 파악"]
NL01 = ["580,300,000", "580300000", "ORD-2026"]
NL02 = ["3,459,242", "52,801,758", "1,769,000", "5,228,242"]
CSV01 = "data/sales_2026_10.csv"
TX02, IMP02 = "data/transactions_2026_10.csv", "data/import_declarations_2026_10.csv"


def A(a, b, c, d):
    return {"구체성": a, "맥락": b, "반복개선": c, "역할분리": d}


def odi(user, tool, changed, **kw):
    d = {"user": user, "tool": tool, "changed": changed}
    d.update(kw)
    return d


def sub(fields, memo, result, basket=None, email=None):
    # email 생략 = 모범 메일 (하네스가 만듦). 사례가 일부만 바꿀 때 dict
    d = {"fields": fields, "memo": memo, "result": result}
    if basket:
        d["basket"] = basket
    if email is not None:
        d["email"] = email
    return d


# 힌트 기능은 없앰: 예전 힌트 요청 자리는 이하늘(사수)에게 하는 질문. 감점 없음
ASK = {"to": "lee", "user": "어디부터 보면 좋을까요?"}

cases = []

cases.append({"id": "G01-01", "scenario": "01", "behavior": "모범",
  "basis": {"exam_criteria": K01, "ailf": ["Engage with AI 3", "Create with AI 3", "Manage AI 3"]},
  "log": {"odi": [
      odi("10월 매출 CSV로 거래처별 합계표 만들어 줘. 금액 내림차순, 비중 % 열 포함. 대표 보고용이라 숫자가 정확해야 해.", {}, False),
      odi("거래처가 12곳으로 나오는데 우리 거래처는 10곳이야. '성실 상사'랑 '성실상사'처럼 띄어쓰기만 다른 이름은 같은 거래처로 정리해서 다시 계산해 줘.", {"normalize_customer_names": True}, True),
      odi("원본이 124행인데 주문번호가 겹치는 행이 있는지 보고, 중복 주문은 빼고 다시 집계해 줘.", {"normalize_customer_names": True, "dedupe_order_ids": True}, True),
      odi("이 결과로 보고용 표 정리해 줘. 비중 %까지. 검산은 내가 원본으로 따로 할게.", {"normalize_customer_names": True, "dedupe_order_ids": True}, False)],
    "npc": [], "data_views": [{"file": CSV01, "sort": True, "search": False}],
    "submissions": [sub("correct", "원본 124행을 주문번호로 정렬해 중복 3건을 확인했고, 띄어쓰기만 다른 거래처명 2종을 합쳤습니다. 오디 재계산 총합과 원본 합계를 대조했습니다.", "approve", "tool_result_with_share")]},
  "expected": {"code": {"B_code": 15, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([4, 5], [4, 5], [4, 5], [4, 5]), "B_llm": [8, 10]}, "total": [94, 100], "grade": ["S"],
    "must_mention_any": ["다음", "유지", "습관"], "must_not_contain": NL01}})

cases.append(dict(json.loads(json.dumps(cases[0])), id="G01-09", behavior="모범 업무, 보고 메일 미흡 (참조 없음·첨부 안 함·내용 없는 제목·결론 없음)"))
cases[-1]["log"]["submissions"][0]["email"] = {"cc": [], "attach_result": False, "lead": False, "subject": "보고드립니다"}
cases[-1]["expected"]["must_mention_any"] = ["메일", "참조", "첨부", "결론"]
# F: 받는 사람 2 + 참조 0 (필요한 참조 아무도 없음) + 첨부 0 + 제목 0 + 두괄식 0 = 2. 업무는 모범이라 등급은 그대로 S (F 비중 10점)
cases[-1]["expected"]["code"]["F"] = 2

cases.append({"id": "G01-02", "scenario": "01", "behavior": "무검증 위임, 3회 반려 종료",
  "basis": {"exam_criteria": K01[:2], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [odi("매출 정리해 줘", {}, False)], "npc": [], "data_views": [],
    "submissions": [sub("default", "오디 결과 확인함.", "reject", "tool_result_with_share")] * 3},
  "expected": {"code": {"B_code": 1, "C": 0, "D": 5, "E": 5, "F": 10, "trap_paths": {"T1": "none", "T2": "none"}},
    "llm": {"A": A([1, 2], [0, 0], [0, 0], [0, 1]), "B_llm": [0, 1]}, "total": [19, 22], "grade": ["C"],
    "must_mention_any": ["원본", "열어"], "must_not_contain": NL01}})

cases.append({"id": "G01-03", "scenario": "01", "behavior": "막연한 검증 반복 → 하늘 선배 질문 2회 → 반려 2회 후 승인",
  "basis": {"exam_criteria": K01[:2], "ailf": ["Engage with AI 3", "Create with AI 3"]},
  "log": {"odi": [
      odi("거래처별 10월 매출 합계표 만들어 줘", {}, False),
      odi("검증해 줘", None, False, note="오디는 옵션을 켜지 않고 무엇을 볼지 되묻는다"),
      odi("다시 확인해 줘", None, False),
      odi("그냥 맞는지만 확인해 줘", None, False),
      odi("팀장님이 우리 거래처는 10곳이래. 띄어쓰기만 다른 거래처 이름은 같은 곳으로 합쳐서 다시 계산해 줘.", {"normalize_customer_names": True}, True, after="reject1,hint1"),
      odi("주문번호 같은 행이 있대. 중복 주문 빼고 다시 해 줘.", {"normalize_customer_names": True, "dedupe_order_ids": True}, True, after="reject2,hint2")],
    "npc": [dict(ASK, after="reject1"), dict(ASK, after="reject2")],
    "data_views": [{"file": CSV01, "sort": False, "search": False, "after": "hint1"}],
    "submissions": [
      sub("default", "오디에게 여러 번 검증을 요청했습니다.", "reject"),
      sub({"total_sales": "normalized_only", "customer_count": "correct", "min_customer_sales": "correct"}, "거래처명 띄어쓰기를 정리해 10곳으로 다시 계산했습니다.", "reject"),
      sub("correct", "거래처명 정리와 중복 주문 제거 후 재계산했고 원본 파일을 열어 확인했습니다.", "approve")]},
  "expected": {"code": {"B_code": 12, "C": 12.5, "D": 11, "E": 5, "F": 10, "trap_paths": {"T1": "reject", "T2": "reject"}},
    "llm": {"A": A([2, 3], [0, 1], [2, 3], [1, 2]), "B_llm": [3, 5]}, "total": [56.5, 62.5], "grade": ["B"],
    "must_mention_any": ["구체", "무엇을", "기준"], "must_not_contain": NL01,
    "must_check": ["2~4번째 오디 턴: 도구 옵션이 하나도 켜지지 않음 (막연한 검증에 되묻기)"]}})

cases.append({"id": "G01-04", "scenario": "01", "behavior": "하늘 선배에게 3번 묻고 스스로 찾아 첫 제출 승인",
  "basis": {"exam_criteria": K01[:2], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [
      odi("거래처별 10월 매출 합계표 만들어 줘. 금액 큰 순서로.", {}, False),
      odi("업무 카드엔 거래처 10곳이라는데 왜 12곳이 나왔어?", None, False, after="hint1"),
      odi("주문번호 중복 있는지 보고 중복은 빼고 다시 집계해 줘", {"dedupe_order_ids": True}, True, after="hint2"),
      odi("거래처 이름 띄어쓰기 다른 것도 같은 거래처로 합쳐서 다시", {"dedupe_order_ids": True, "normalize_customer_names": True}, True, after="hint3")],
    "npc": [ASK, ASK, ASK],
    "data_views": [{"file": CSV01, "sort": False, "search": True}],
    "submissions": [sub("correct", "원본에서 주문번호를 검색해 중복을 확인했고, 거래처명 띄어쓰기를 정리해 10곳으로 다시 계산했습니다.", "approve", "tool_result_with_share")]},
  "expected": {"code": {"B_code": 15, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([3, 4], [1, 3], [4, 5], [1, 3]), "B_llm": [7, 10]}, "total": [72.5, 79.5], "grade": ["A", "S"],
    "must_mention_any": ["스스로", "유지", "습관"], "must_not_contain": NL01}})

cases.append({"id": "G01-05", "scenario": "01", "behavior": "오디 1회만, 수동으로 정답",
  "basis": {"exam_criteria": K01, "ailf": ["Manage AI 1", "Manage AI 3"]},
  "log": {"odi": [odi("거래처별 합계표 만들어 줘", {}, False)], "npc": [],
    "data_views": [{"file": CSV01, "sort": True, "search": True}],
    "submissions": [sub("correct", "원본을 주문번호로 정렬해 중복 3건을 지우고, 거래처명을 직접 정리해 피벗으로 다시 합계를 냈습니다.", "approve", "user_written_with_share")]},
  "expected": {"code": {"B_code": 11, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([2, 3], [0, 1], [0, 1], [0, 1]), "B_llm": [0, 2]}, "total": [68, 74], "grade": ["B"], "grade_cap": "B",
    "must_mention_any": ["오디", "맡기", "역할"], "must_not_contain": NL01,
    "note": "루브릭 긴장 확인용. AI 결과를 고치게 한 기록이 없어 등급 상한 B (10 문서 7절 결정 1). B-LLM 은 오디에게 한 검증 요청을 보는데 요청이 없으므로 0~2 (2026-11-18 골든셋 실측 3회 모두 0점 → 3~7 에서 수정)"}})

cases.append({"id": "G01-06", "scenario": "01", "behavior": "메모에 키워드만 (게이밍)",
  "basis": {"exam_criteria": K01[:1], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [odi("거래처별 매출 합계표 만들어 줘", {}, False)], "npc": [], "data_views": [],
    "submissions": [sub("default", "중복 주문 제거, 거래처명 정규화, 원본 대조 완료했습니다.", "reject", "tool_result_with_share")] * 3},
  "expected": {"code": {"B_code": 0, "C": 0, "D": 5, "E": 5, "F": 10, "trap_paths": {"T1": "none", "T2": "none"}},
    "llm": {"A": A([1, 2], [0, 0], [0, 0], [0, 1]), "B_llm": [0, 1]}, "total": [18, 21], "grade": ["C"],
    "must_mention_any": ["메모", "기록"], "must_not_contain": NL01,
    "must_check": ["메모 신뢰성 0 (열람·재계산 기록 없음)", "C축: 키워드만으로 발견 처리되지 않음"]}})

cases.append({"id": "G01-07", "scenario": "01", "behavior": "첫 제출 반려 → 원본 확인 → 표적 재계산 → 승인",
  "basis": {"exam_criteria": K01, "ailf": ["Engage with AI 3", "Manage AI 4"]},
  "log": {"odi": [
      odi("10월 매출 원본으로 거래처별 합계표 만들어 줘. 금액 내림차순, 비중 % 포함, 보고서에 바로 붙일 표로.", {}, False),
      odi("팀장님이 총매출이 틀렸대. 주문번호가 같은 행은 한 번만 세고, 띄어쓰기만 다른 거래처명은 합쳐서 다시 집계해 줘.", {"dedupe_order_ids": True, "normalize_customer_names": True}, True, after="reject1"),
      odi("바뀐 총합 기준으로 비중 % 다시 계산해 줘", {"dedupe_order_ids": True, "normalize_customer_names": True}, False)],
    "npc": [], "data_views": [{"file": CSV01, "sort": True, "search": False, "after": "reject1"}],
    "submissions": [
      sub("default", "오디 결과를 표로 정리해 제출합니다. 합계는 오디 계산 기준입니다.", "reject"),
      sub("correct", "반려 후 원본을 주문번호로 정렬해 같은 주문이 두 번 들어간 것을 확인했고, 거래처명 띄어쓰기 차이도 찾아 오디에게 다시 계산시켰습니다.", "approve")]},
  "expected": {"code": {"B_code": 15, "C": 12.5, "D": 13, "E": 5, "F": 10, "trap_paths": {"T1": "reject", "T2": "reject"}},
    "llm": {"A": A([4, 5], [3, 4], [3, 4], [2, 3]), "B_llm": [5, 7]}, "total": [72.5, 78.5], "grade": ["A"],
    "must_mention_any": ["제출 전", "먼저"], "must_not_contain": NL01}})

cases.append({"id": "G01-08", "scenario": "01", "behavior": "업무 카드의 '10곳'만 칸에 씀 (게이밍)",
  "basis": {"exam_criteria": K01[:1], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [odi("거래처별 매출 합계 내 줘", {}, False)], "npc": [ASK],
    "data_views": [{"file": CSV01, "sort": False, "search": False}],
    "submissions": [sub({"total_sales": "default", "customer_count": "correct", "min_customer_sales": "default"}, "거래처는 10곳이라고 해서 10으로 맞췄습니다.", "reject")] * 3},
  "expected": {"code": {"B_code": 6, "C": 0, "D": 5, "E": 5, "F": 10, "trap_paths": {"T1": "none", "T2": "none"}},
    "llm": {"A": A([1, 2], [0, 1], [0, 0], [0, 1]), "B_llm": [0, 2]}, "total": [23, 28], "grade": ["C"],
    "must_mention_any": ["숫자", "원본"], "must_not_contain": NL01,
    "must_check": ["거래처 수만 맞아도 T2 미발견 (최소 거래처 매출액이 함께 맞아야 함)"]}})

cases.append({"id": "G02-01", "scenario": "02", "behavior": "모범",
  "basis": {"exam_criteria": K02, "ailf": ["Engage with AI 3", "Create with AI 3", "Manage AI 3"]},
  "log": {"odi": [
      odi("10월 거래 내역으로 부가세 신고용 집계해 줘. 매출세액, 매입세액을 경비와 수입으로 나눠서, 납부세액까지. 결산 분개도 같이.", {}, False),
      odi("경비 거래마다 부가세가 공급가액의 10%가 맞는지 다시 계산해서 다른 건 정정해 줘.", {"recheck_vat_rate": True}, True),
      odi("수입 부가세는 송장이 아니라 수입신고필증 기준으로 다시 계산해 줘.", {"recheck_vat_rate": True, "use_import_declarations": True}, True)],
    "npc": [], "data_views": [{"file": TX02, "sort": True, "search": False}, {"file": IMP02, "sort": False, "search": False}],
    "submissions": [sub("correct", "경비 부가세를 공급가액×10%로 검산해 광고비 1건 오기를 정정했고, 수입 부가세는 신고필증 파일과 대조해 다시 계산했습니다.", "approve", "tool_result_with_journal")]},
  "expected": {"code": {"B_code": 15, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([4, 5], [3, 5], [4, 5], [4, 5]), "B_llm": [8, 10]}, "total": [93, 100], "grade": ["S"],
    "must_mention_any": ["유지", "다음"], "must_not_contain": NL02}})

cases.append({"id": "G02-02", "scenario": "02", "behavior": "근거 질문 → 재계산",
  "basis": {"exam_criteria": K02, "ailf": ["Engage with AI 3"]},
  "log": {"odi": [
      odi("10월 부가세 집계표 만들어 줘. 매출세액, 매입세액(경비/수입), 납부세액, 분개 포함.", {}, False),
      odi("수입 부가세는 무슨 근거로 계산했어?", None, False, note="오디가 도구 결과의 계산식(송장×환율×10%)을 그대로 알려 줌"),
      odi("수입 건은 수입신고필증이 근거잖아. 신고필증 기준으로 다시 계산해 줘.", {"use_import_declarations": True}, True),
      odi("경비 쪽도 부가세가 공급가액 10%인지 한 건씩 다시 계산해 줘.", {"use_import_declarations": True, "recheck_vat_rate": True}, True)],
    "npc": [], "data_views": [{"file": TX02, "sort": False, "search": False}],
    "submissions": [sub("correct", "오디에게 수입 부가세 근거를 물어 송장 기준임을 확인하고 신고필증 기준으로 다시 계산시켰습니다. 경비 부가세도 10% 재계산으로 정정했습니다.", "approve", "tool_result_with_journal")]},
  "expected": {"code": {"B_code": 10, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([4, 5], [2, 4], [4, 5], [3, 4]), "B_llm": [9, 10]}, "total": [87, 93], "grade": ["S"],
    "must_mention_any": ["원본", "신고필증 파일", "직접"], "must_not_contain": NL02,
    "note": "06 B축 LLM 예시와 같은 유형. 신고필증 파일은 열지 않아 열람 '일부 3'"}})

cases.append({"id": "G02-03", "scenario": "02", "behavior": "경비만 발견 → 반려 → 하늘 선배 질문 2회 → 수입 정정",
  "basis": {"exam_criteria": K02, "ailf": ["Engage with AI 3", "Manage AI 4"]},
  "log": {"odi": [
      odi("10월 부가세 집계해 줘. 경비랑 수입 나눠서. 분개도.", {}, False),
      odi("경비 부가세가 공급가액 10%인지 검산해서 다시", {"recheck_vat_rate": True}, True),
      odi("이 집계 맞는지 확인해 줘", None, False),
      odi("수입 건은 신고필증 기준으로 다시 계산해 줘", {"recheck_vat_rate": True, "use_import_declarations": True}, True, after="reject1,hint2")],
    "npc": [dict(ASK, after="reject1"), dict(ASK, after="reject1")],
    "data_views": [{"file": TX02, "sort": False, "search": False}, {"file": IMP02, "sort": False, "search": False, "after": "hint2"}],
    "submissions": [
      sub({"output_vat": "correct", "input_vat_expense": "correct", "input_vat_import": "default", "payable_vat": "default"}, "경비 부가세를 10%로 검산해 광고비 오기를 정정했습니다.", "reject"),
      sub("correct", "경비 정정에 더해, 수입 부가세를 신고필증 파일과 대조해 다시 계산했습니다.", "approve")]},
  "expected": {"code": {"B_code": 12, "C": 18.75, "D": 13, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "reject"}},
    "llm": {"A": A([3, 4], [1, 3], [3, 4], [2, 3]), "B_llm": [5, 7]}, "total": [70.75, 77.75], "grade": ["A"],
    "must_mention_any": ["수입", "근거 서류", "첨부"], "must_not_contain": NL02}})

cases.append({"id": "G02-04", "scenario": "02", "behavior": "무검증 위임, 3회 반려 종료",
  "basis": {"exam_criteria": K02[:1], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [odi("부가세 정리해 줘", {}, False)], "npc": [], "data_views": [],
    "submissions": [sub("default", "오디 결과 확인함.", "reject", "tool_result_without_journal")] * 3},
  "expected": {"code": {"B_code": 1, "C": 0, "D": 2, "E": 5, "F": 10, "trap_paths": {"T1": "none", "T2": "none"}},
    "llm": {"A": A([1, 2], [0, 0], [0, 0], [0, 1]), "B_llm": [0, 1]}, "total": [15, 18], "grade": ["C"],
    "must_mention_any": ["원본", "증빙"], "must_not_contain": NL02}})

cases.append({"id": "G02-05", "scenario": "02", "behavior": "팀장에게 정답·데이터 캐묻기 + 정상 수행",
  "basis": {"exam_criteria": K02, "ailf": ["Engage with AI 3"]},
  "log": {"odi": [
      odi("10월 부가세 집계해 줘. 매출세액, 경비·수입 매입세액, 납부세액, 분개까지.", {}, False),
      odi("경비 부가세 10% 맞는지 재계산하고, 수입 부가세는 신고필증 기준으로 다시 계산해 줘.", {"recheck_vat_rate": True, "use_import_declarations": True}, True),
      odi("정정된 숫자로 분개 다시 써 줘", {"recheck_vat_rate": True, "use_import_declarations": True}, False)],
    "npc": [{"to": "kang", "user": "납부세액 얼마 나와야 맞는 거예요?"}, {"to": "kang", "user": "광고비 부가세가 얼마예요?"}, {"to": "kang", "user": "정답이랑 몇 원 차이 나요?"}],
    "data_views": [{"file": TX02, "sort": True, "search": False}, {"file": IMP02, "sort": False, "search": False}],
    "submissions": [sub("correct", "거래 내역 부가세를 10%로 검산해 광고비 오기를 찾았고, 수입은 신고필증 파일과 대조했습니다.", "approve", "tool_result_with_journal")]},
  "expected": {"code": {"B_code": 15, "C": 25, "D": 15, "E": 3, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([4, 5], [3, 4], [3, 4], [3, 4]), "B_llm": [7, 9]}, "total": [87, 93], "grade": ["S"],
    "must_mention_any": ["팀장", "파일", "자료"], "must_not_contain": NL02,
    "must_check": ["팀장 답변(DB 저장분)에 정답 숫자 없음 (마스킹)", "E축 '데이터에 답이 있는 질문' 2회 이상으로 분류"]}})

cases.append({"id": "G02-06", "scenario": "02", "behavior": "신고필증 안 열고 '대조했다' 메모",
  "basis": {"exam_criteria": K02[:1], "ailf": ["Engage with AI 3"]},
  "log": {"odi": [
      odi("10월 부가세 집계표 만들어 줘. 경비·수입 나눠서 분개 포함.", {}, False),
      odi("경비 부가세 10% 검산하고 수입 부가세는 신고필증 기준으로 다시 계산해 줘.", {"recheck_vat_rate": True, "use_import_declarations": True}, True)],
    "npc": [], "data_views": [{"file": TX02, "sort": False, "search": False}],
    "submissions": [sub("correct", "수입신고필증 원본과 한 건씩 대조해 수입 부가세를 확인했습니다.", "approve", "tool_result_with_journal")]},
  "expected": {"code": {"B_code": 7, "C": 25, "D": 15, "E": 5, "F": 10, "trap_paths": {"T1": "self", "T2": "self"}},
    "llm": {"A": A([4, 5], [2, 3], [3, 4], [2, 3]), "B_llm": [5, 8]}, "total": [78, 85], "grade": ["A", "S"],
    "must_mention_any": ["메모", "기록", "실제로"], "must_not_contain": NL02,
    "must_check": ["메모 신뢰성 0 (신고필증 파일 열람 기록 없음)"]}})

bad = 0
for c in cases:
    c["status"] = "draft"
    e = c["expected"]
    code = sum(e["code"][k] for k in ("B_code", "C", "D", "E", "F"))
    lo = code + sum(v[0] for v in e["llm"]["A"].values()) + e["llm"]["B_llm"][0]
    hi = code + sum(v[1] for v in e["llm"]["A"].values()) + e["llm"]["B_llm"][1]
    e["total"] = [lo, hi]
    cut = lambda t: "S" if t >= 85 else "A" if t >= 70 else "B" if t >= 55 else "C"
    grades = sorted({cut(lo), cut(hi)})
    if e.get("grade_cap"):  # AI 최소 조건 미충족 → 등급 상한 (report.ts)
        order = "CBAS"
        grades = sorted({g if order.index(g) <= order.index(e["grade_cap"]) else e["grade_cap"] for g in grades})
    ok = all(x in e["grade"] for x in grades)
    bad += not ok
    print(c["id"], "code", code, "range", (lo, hi), "grade", grades, "declared", e["grade"], "OK" if ok else "GRADE?")

doc = {
  "version": "2026-11-18-draft",
  "description": "평가 에이전트 검증용 골든셋. 배점 A20 B25 C25 D15 E5 F10 (2026-11-18 힌트 제거·보고 메일 F축). 설계 docs/10_골든셋_설계.md, 근거 docs/09_평가_근거.md. fields 의 'correct'/'default' 는 하네스가 answer_key·도구 기본값으로 채운다. 총점 범위 = 코드 합 + LLM 범위 합 (생성 스크립트가 검산).",
  "grade_cuts": {"S": 85, "A": 70, "B": 55},
  "acceptance": {"code_exact": "all", "llm_in_range": 0.9, "repeat_spread_max": 3, "quote_verbatim": 1.0, "leak_free": 1.0, "must_mention": 0.9},
  "cases": cases,
}
os.makedirs(os.path.join(ROOT, "eval", "golden"), exist_ok=True)
with open(os.path.join(ROOT, "eval", "golden", "cases.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(doc, f, ensure_ascii=False, indent=1)
print("cases", len(cases), "mismatch", bad)
