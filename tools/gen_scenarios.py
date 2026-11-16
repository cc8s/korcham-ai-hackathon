# -*- coding: utf-8 -*-
"""시나리오 5개 폴더 생성기. 실행 결과: c:/UMC/hackathon/scenarios/"""
import csv, json, os, random
from datetime import date, timedelta

ROOT = r"c:\UMC\hackathon\scenarios"
random.seed(20261116)

def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(text)

def wcsv(path, header, rows):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as f:
        cw = csv.writer(f, lineterminator="\n")
        cw.writerow(header)
        cw.writerows(rows)

def wjson(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)

# ───────────────────────── 공통 데이터 ─────────────────────────
CUSTOMERS = [
    ("CUS-001","오름몰","자사몰","수수료 0%"),
    ("CUS-002","마켓A","오픈마켓","수수료 12%"),
    ("CUS-003","마켓B","오픈마켓","수수료 10%"),
    ("CUS-004","마켓C","오픈마켓","수수료 15%"),
    ("CUS-005","한결백화점","백화점","위탁, 수수료 30%"),
    ("CUS-006","두리백화점","백화점","위탁, 수수료 28%"),
    ("CUS-007","성실상사","도매","월 정산"),
    ("CUS-008","대양유통","도매","월 정산"),
    ("CUS-009","푸른리빙","도매","분기 정산"),
    ("CUS-010","해피키친","도매","선결제"),
]
# (sku, 브랜드, 품명, 통화, 원가(외화), 판매가(KRW), 시즌, 리드타임(일), 안전재고)
PRODUCTS = [
    ("DE-001","Hausmann","스테인리스 프라이팬 28cm","EUR",18,59000,"없음",50,40),
    ("DE-002","Hausmann","스테인리스 냄비 20cm","EUR",22,69000,"없음",50,30),
    ("DE-003","Hausmann","스테인리스 웍 30cm","EUR",25,79000,"없음",50,25),
    ("DE-004","Hausmann","조리도구 5종 세트","EUR",12,39000,"없음",50,40),
    ("DE-005","Hausmann","스테인리스 찜기","EUR",15,49000,"없음",50,20),
    ("IT-001","Casa Lumi","세라믹 접시 4P","EUR",14,45000,"없음",55,40),
    ("IT-002","Casa Lumi","세라믹 머그 2P","EUR",7,24000,"없음",55,60),
    ("IT-003","Casa Lumi","세라믹 볼 3P","EUR",10,32000,"없음",55,40),
    ("IT-004","Casa Lumi","세라믹 오븐용기","EUR",16,52000,"없음",55,25),
    ("IT-005","Casa Lumi","세라믹 티포트","EUR",13,42000,"없음",55,20),
    ("VN-001","Mekong Home","대나무 도마","USD",4,15000,"여름(6~8월)",45,80),
    ("VN-002","Mekong Home","라탄 바구니 중","USD",6,22000,"여름(6~8월)",45,60),
    ("VN-003","Mekong Home","라탄 트레이","USD",5,19000,"여름(6~8월)",45,60),
    ("VN-004","Mekong Home","대나무 수저 세트","USD",2,8000,"없음",45,100),
    ("VN-005","Mekong Home","라탄 빨래바구니","USD",9,32000,"여름(6~8월)",45,40),
    ("TH-001","Siam Craft","리빙박스 대","USD",5,18000,"연초 이사철(1~3월)",40,80),
    ("TH-002","Siam Craft","리빙박스 중","USD",3.5,13000,"연초 이사철(1~3월)",40,100),
    ("TH-003","Siam Craft","옷걸이 20P","USD",2,7000,"연초 이사철(1~3월)",40,150),
    ("TH-004","Siam Craft","서랍 정리함","USD",4,14000,"연초 이사철(1~3월)",40,80),
    ("TH-005","Siam Craft","신발 정리대","USD",6,21000,"연초 이사철(1~3월)",40,50),
]
CONST = {
    "회사": "(주)오름",
    "기준월": "2026-10",
    "부가세율": 0.10,
    "환율": {"USD": 1380, "EUR": 1490},
    "관세율_주방용품": 0.08,
    "유럽_서머타임_종료": "2026-10-25",
    "AI비서_호출상한": 15,
    "힌트_상한": 3,
    "반려_상한": 3,
}
wcsv(f"{ROOT}/_shared/customers.csv", ["거래처코드","거래처명","유형","비고"], CUSTOMERS)
wcsv(f"{ROOT}/_shared/products.csv",
     ["SKU","브랜드","품명","통화","원가(외화)","판매가(KRW)","시즌","리드타임(일)","안전재고"], PRODUCTS)
wjson(f"{ROOT}/_shared/constants.json", CONST)

# ───────────────────────── 01 컴활 ─────────────────────────
PRICE = {p[0]: p[5] for p in PRODUCTS}
sales = []
oct1 = date(2026,10,1)
order_no = 20261001
true_total = {}
for i in range(120):
    cust = random.choice(CUSTOMERS)
    sku = random.choice(PRODUCTS)[0]
    qty = random.choice([100,150,200,300,400,500]) if cust[2]=="도매" else random.choice([10,20,30,50,80])
    d = oct1 + timedelta(days=random.randint(0,30))
    amt = qty*PRICE[sku]
    sales.append([f"ORD-{order_no}", d.isoformat(), cust[1], sku, qty, PRICE[sku], amt])
    true_total[cust[1]] = true_total.get(cust[1],0)+amt
    order_no += 1
sales.sort(key=lambda r: r[1])
# 함정1(데이터): 중복 주문 3건 (동일 주문번호 행이 두 번)
dups = random.sample(range(len(sales)), 3)
dup_ids = [sales[i][0] for i in dups]
for i in sorted(dups, reverse=True):
    sales.insert(i+1, list(sales[i]))
# 함정2(AI 유발 데이터): 거래처명 표기 변형 — 성실상사 4건 → "성실 상사", 마켓A 3건 → "마켓 A"
variants = {"성실상사":"성실 상사", "마켓A":"마켓 A"}
changed = {k:0 for k in variants}
for r in sales:
    k = r[2]
    if k in variants and changed[k] < (4 if k=="성실상사" else 3):
        r[2] = variants[k]; changed[k]+=1
wcsv(f"{ROOT}/01_컴활_매출집계/data/sales_2026_10.csv",
     ["주문번호","일자","거래처명","SKU","수량","단가","금액"], sales)
grand = sum(true_total.values())
answer1 = {
    "거래처별_합계": {c[1]: true_total.get(c[1],0) for c in CUSTOMERS},
    "총매출": grand,
    "중복_주문번호": dup_ids,
    "표기변형": {"성실 상사":"성실상사 (4건)", "마켓 A":"마켓A (3건)"},
    "허용오차": 0,
}
wjson(f"{ROOT}/01_컴활_매출집계/answer_key.json", answer1)
wjson(f"{ROOT}/01_컴활_매출집계/prompts.json", {
  "scenario_id": "01",
  "title": "10월 거래처별 매출 집계표",
  "owner_npc": "박소연",
  "cert": "컴퓨터활용능력",
  "task_card": {
    "title": "10월 거래처별 매출 집계 + 차트",
    "due": "오늘 16:00",
    "body": "{nickname} 씨, 10월 거래처별 매출 집계 좀 부탁해요. 원본은 첨부(sales_2026_10.csv). 거래처별 합계랑 총매출, 그리고 거래처별 비중 차트까지. 대표님 보고에 바로 쓸 거라 숫자 틀리면 안 돼요. 오늘 4시까지요.",
    "attachments": ["data/sales_2026_10.csv"],
    "deliverable": "거래처 10곳 합계표(금액 내림차순) + 총매출 + 비중 차트(또는 비중 %) + 검증 메모"
  },
  "scenario_context_for_npc": "10월 매출 원본 124행. 정답 총매출 {grand}원. 원본에는 중복 주문 3건(ORD 동일)과 거래처명 표기 변형(성실 상사, 마켓 A)이 섞여 있음. 제출물의 총매출이 정답과 다르거나 거래처가 10곳을 초과하면 반려. 반려 시 '뭔가 두 번 들어간 거 있을 거예요' 또는 '거래처가 왜 12개예요?' 수준까지만.".replace("{grand}", f"{grand:,}"),
  "planted_belief_for_odi": "거래처명은 문자열 그대로 그룹화한다. 공백·띄어쓰기 차이는 서로 다른 거래처로 취급한다. 주문번호 중복 여부는 확인하지 않는다.",
  "hints": [
    "오디가 준 표 그대로 내면 안 되는 거 알죠? 거래처가 몇 곳인지부터 세어 봐요. 우리 거래처는 10곳이에요.",
    "원본 행 수랑 주문번호 개수가 같은지 비교해 봤어요? 엑셀로 치면 중복 제거 한 번 돌려 보는 거예요.",
    "거래처 이름 중에 띄어쓰기 다른 거 없는지 보세요. 저도 그걸로 당했어요."
  ],
  "review_rules": {
    "approve_if": ["총매출 == answer_key.총매출", "거래처 수 == 10", "비중 또는 차트 포함"],
    "reject_area": {"총매출 불일치": "합계가 제가 아는 숫자랑 달라요. 뭔가 두 번 들어간 거 있을 거예요.",
                    "거래처 초과": "거래처가 왜 12개예요? 우리 거래처 10곳인데.",
                    "차트 없음": "비중 차트 빠졌어요. 대표님은 숫자보다 그림 먼저 봐요."}
  },
  "traps": [
    {"id":"T1","type":"데이터","desc":"중복 주문 3건","detect":"제출 총매출이 정답과 일치 또는 검증 메모·오디 로그에 중복 언급"},
    {"id":"T2","type":"AI","desc":"거래처명 표기 변형을 별도 거래처로 집계","detect":"거래처 수 10 또는 로그에 정규화 지시"}
  ]
})
w(f"{ROOT}/01_컴활_매출집계/README.md", f"""# 01. 컴퓨터활용능력 — 10월 거래처별 매출 집계

담당 NPC: 박소연 (영업팀장) / 소요 목표: 15분

## 업무 카드
"{{nickname}} 씨, 10월 거래처별 매출 집계 좀 부탁해요. 원본은 첨부. 거래처별 합계랑 총매출, 비중 차트까지. 대표님 보고에 바로 쓸 거라 숫자 틀리면 안 돼요. 오늘 4시까지요."

첨부: `data/sales_2026_10.csv` (124행: 주문번호, 일자, 거래처명, SKU, 수량, 단가, 금액)

## 정답
- 총매출 **{grand:,}원**, 거래처 10곳. 상세는 `answer_key.json`
- 중복 주문번호: {', '.join(dup_ids)}
- 표기 변형: "성실 상사"(4건) → 성실상사, "마켓 A"(3건) → 마켓A

## 함정 2개
| ID | 종류 | 내용 | 발견 방법 |
|---|---|---|---|
| T1 | 데이터 | 동일 주문번호 행이 두 번 들어간 중복 3건 | 원본 열람 후 주문번호 중복 확인, 또는 오디에게 "중복 확인해 줘" |
| T2 | AI | 오디는 거래처명을 문자열 그대로 그룹화 → 12곳으로 집계 | 거래처 수 세어 보기, 오디에게 "거래처명 정규화해서 다시" |

## 오디에 심는 믿음
"거래처명은 문자열 그대로 그룹화. 공백 차이는 다른 거래처. 주문번호 중복은 확인 안 함."
→ 사용자가 "중복 있어?", "거래처가 왜 12개야?", "이름 정리해서 다시"라고 하면 정확히 수행.

## 박소연 반려 기준
- 총매출 ≠ 정답 → "합계가 제가 아는 숫자랑 달라요. 뭔가 두 번 들어간 거 있을 거예요."
- 거래처 > 10 → "거래처가 왜 12개예요? 우리 거래처 10곳인데."
- 차트·비중 없음 → "비중 차트 빠졌어요."

## 이하늘 힌트
1. 거래처가 몇 곳인지 세어 봐요. 우리 거래처는 10곳.
2. 원본 행 수랑 주문번호 개수 비교해 봤어요?
3. 거래처 이름 띄어쓰기 다른 거 없는지 보세요.

## 심사위원 데모 경로 (5분)
오디 "거래처별 합계표" → 12곳 나옴 → 데이터 뷰어에서 "성실" 검색 → 오디 "공백 정리 + 중복 제거해서 다시" → 담기 → 검증 메모 → 제출 → 승인 → 리포트
""")

# ───────────────────────── 02 전산회계 ─────────────────────────
VAT = 0.10
tx = []
n = 1
# 매출: 거래처별 10월 세금계산서 (01 시나리오 정답 합계와 동일 — 세계관 일관성)
for c in CUSTOMERS:
    sup = true_total[c[1]]
    tx.append([n, "2026-10-31", "매출", c[1], f"10월 상품 매출 (세금계산서)", sup, int(sup*VAT), sup+int(sup*VAT)]); n+=1
# 수입 2건: 송장 외화 금액만 기재 (부가세는 수입신고필증 참조)
imports = [
    ("IMP-2026-1012","Hausmann","EUR",12500, "2026-10-12"),
    ("IMP-2026-1021","Siam Craft","USD",8400, "2026-10-21"),
]
for code, sup, cur, fx, d in imports:
    tx.append([n, d, "수입", sup, f"수입 송장 {code} ({cur} {fx:,})", "", "", ""]); n+=1
# 경비 (매입세금계산서)
expenses = [
    ("2026-10-01","경비","한빛부동산","10월 사무실·창고 임차료",6500000),
    ("2026-10-05","경비","케이로지스","10월 국내 배송비",4200000),
    ("2026-10-07","경비","누리통신","10월 통신비",380000),
    ("2026-10-10","경비","세븐마케팅","10월 온라인 광고비",3000000),
    ("2026-10-14","경비","바다해운","수입 운송 부대비용 (하역·보세창고)",1850000),
    ("2026-10-18","경비","오피스나라","사무용품",240000),
    ("2026-10-22","경비","클린케어","창고 청소 용역",600000),
    ("2026-10-28","경비","한국전력","10월 전기요금",920000),
]
for d, t, p, memo, sup in expenses:
    v = int(sup*VAT)
    tx.append([n, d, t, p, memo, sup, v, sup+v]); n+=1
# 함정1(데이터): 광고비 부가세 자릿수 누락 (300,000 → 30,000)
for r in tx:
    if r[3]=="세븐마케팅":
        r[6] = 30000; r[7] = r[5]+30000
wcsv(f"{ROOT}/02_전산회계_월말결산/data/transactions_2026_10.csv",
     ["번호","일자","유형","거래처","적요","공급가액","부가세","합계"], tx)
# 수입신고필증
decl = []
for code, sup, cur, fx, d in imports:
    inv_krw = fx*CONST["환율"][cur]
    freight_ins = int(inv_krw*0.06)   # 운임+보험 (CIF 과세가격)
    taxable = inv_krw+freight_ins
    duty = int(taxable*CONST["관세율_주방용품"])
    vat_imp = int((taxable+duty)*VAT)
    decl.append([code, d, sup, cur, fx, CONST["환율"][cur], inv_krw, freight_ins, taxable, "8%", duty, vat_imp])
wcsv(f"{ROOT}/02_전산회계_월말결산/data/import_declarations_2026_10.csv",
     ["신고번호","신고일","공급사","통화","송장금액","적용환율","송장원화환산","운임보험료","과세가격","관세율","관세","부가세"], decl)
out_vat = sum(r[6] for r in tx if r[2]=="매출")
exp_vat_true = sum(int(r[5]*VAT) for r in tx if r[2]=="경비")
imp_vat = sum(d[11] for d in decl)
wrong_imp_vat = sum(d[6]//10 for d in decl)   # 송장 원화 × 10%
answer2 = {
    "매출세액": out_vat,
    "매입세액_경비(정정후)": exp_vat_true,
    "매입세액_수입(신고필증)": imp_vat,
    "매입세액_합계": exp_vat_true+imp_vat,
    "납부세액": out_vat-(exp_vat_true+imp_vat),
    "함정_광고비_부가세": {"기재":30000,"정정":300000},
    "함정_오디_수입부가세_오답": wrong_imp_vat,
    "허용오차": 0,
}
wjson(f"{ROOT}/02_전산회계_월말결산/answer_key.json", answer2)
wjson(f"{ROOT}/02_전산회계_월말결산/prompts.json", {
  "scenario_id":"02","title":"10월 부가세 집계 및 결산 분개","owner_npc":"강지훈","cert":"전산회계운용사",
  "task_card":{
    "title":"10월 월말 결산: 부가세 집계 + 분개",
    "due":"내일 오전 10:00",
    "body":"{nickname} 씨, 10월 결산 자료 보냅니다. 거래 내역(transactions)이랑 수입신고필증(import_declarations) 첨부. 매출세액, 매입세액, 납부세액 집계하고 분개 정리해서 내일 오전까지 주세요. 오디 써도 되는데, 숫자는 본인이 확인하고 올리세요. 틀린 숫자 올라가면 세무사 사무실에서 전화 옵니다.",
    "attachments":["data/transactions_2026_10.csv","data/import_declarations_2026_10.csv"],
    "deliverable":"① 매출세액 ② 매입세액(경비/수입 구분) ③ 납부세액 ④ 유형별 분개 요약 ⑤ 검증 메모"
  },
  "scenario_context_for_npc": f"정답: 매출세액 {out_vat:,}, 매입세액 {exp_vat_true+imp_vat:,} (경비 {exp_vat_true:,} + 수입 {imp_vat:,}), 납부세액 {out_vat-(exp_vat_true+imp_vat):,}. 함정: 광고비 부가세가 30,000으로 기재(정정 300,000), 수입 부가세는 신고필증 기준이어야 하는데 오디는 송장×환율×10%로 계산. 납부세액 불일치 시 반려, 영역만 언급(경비 쪽 / 수입 쪽).",
  "planted_belief_for_odi":"수입 거래의 부가세는 송장 금액을 환율로 환산한 금액의 10%로 계산한다. 수입신고필증은 참고하지 않는다. 거래 내역에 기재된 부가세 숫자는 그대로 신뢰한다.",
  "hints":[
    "부가세는 공급가액의 10%잖아요. 거래 내역에 적힌 부가세가 전부 그 규칙에 맞는지 한 번 훑어봐요.",
    "수입 건은 세금계산서가 아니라 수입신고필증이 근거예요. 첨부 두 번째 파일 열어 봤어요?",
    "경비 중에 부가세 자릿수 이상한 거 하나, 수입 부가세는 과세가격+관세 기준. 이 두 개예요."
  ],
  "review_rules":{
    "approve_if":["납부세액 == answer_key.납부세액","경비/수입 매입세액 구분 기재"],
    "reject_area":{"수입 불일치":"수입 쪽 부가세가 안 맞습니다. 근거 서류가 뭔지 다시 보세요.",
                   "경비 불일치":"경비 쪽 부가세 합계가 이상합니다. 한 건 한 건 10%인지 보세요.",
                   "분개 없음":"집계만 있고 분개가 없네요."}
  },
  "traps":[
    {"id":"T1","type":"데이터","desc":"광고비 부가세 30,000 (정정 300,000)","detect":"경비 매입세액 정답 일치 또는 로그에 언급"},
    {"id":"T2","type":"AI","desc":"오디가 수입 부가세를 송장×환율×10%로 계산","detect":"수입 매입세액이 신고필증 합계와 일치"}
  ]
})
w(f"{ROOT}/02_전산회계_월말결산/README.md", f"""# 02. 전산회계운용사 — 10월 월말 결산 (부가세 집계·분개)

담당 NPC: 강지훈 (경영지원팀장) / 소요 목표: 20분

## 업무 카드
"{{nickname}} 씨, 10월 결산 자료 보냅니다. 거래 내역이랑 수입신고필증 첨부. 매출세액, 매입세액, 납부세액 집계하고 분개 정리해서 내일 오전까지 주세요. 오디 써도 되는데, 숫자는 본인이 확인하고 올리세요."

첨부
- `data/transactions_2026_10.csv` — 매출 10건(거래처별 세금계산서, 01 시나리오 합계와 동일), 수입 2건(송장 외화만), 경비 8건
- `data/import_declarations_2026_10.csv` — 수입신고필증 2건 (과세가격, 관세, 부가세)

## 정답
| 항목 | 금액 |
|---|---|
| 매출세액 | {out_vat:,} |
| 매입세액 (경비, 정정 후) | {exp_vat_true:,} |
| 매입세액 (수입, 신고필증) | {imp_vat:,} |
| 납부세액 | {out_vat-(exp_vat_true+imp_vat):,} |

## 함정 2개
| ID | 종류 | 내용 | 발견 방법 |
|---|---|---|---|
| T1 | 데이터 | 세븐마케팅 광고비 부가세가 30,000으로 기재 (공급가액 3,000,000 → 정정 300,000) | 부가세 = 공급가액×10% 검산 |
| T2 | AI | 오디는 수입 부가세를 송장×환율×10% = {wrong_imp_vat:,}으로 계산. 정답은 신고필증 기준 {imp_vat:,} | 신고필증 열람, 오디에게 "수입 부가세 근거가 뭐야?" |

## 오디에 심는 믿음
"수입 부가세는 송장 환산액의 10%. 신고필증은 참고 안 함. 거래 내역의 부가세 숫자는 그대로 신뢰."
→ "신고필증 기준으로 다시", "부가세 검산해 줘" 요청 시 정확히 수행.

## 강지훈 반려 기준
- 수입 매입세액 불일치 → "수입 쪽 부가세가 안 맞습니다. 근거 서류가 뭔지 다시 보세요."
- 경비 매입세액 불일치 → "경비 쪽 합계가 이상합니다. 한 건 한 건 10%인지 보세요."
- 분개 없음 → "집계만 있고 분개가 없네요."

## 이하늘 힌트
1. 거래 내역의 부가세가 전부 10% 규칙에 맞는지 훑어봐요.
2. 수입 건은 신고필증이 근거예요. 두 번째 파일 열어 봤어요?
3. 경비 자릿수 하나, 수입은 과세가격+관세 기준. 이 두 개예요.
""")

# ───────────────────────── 03 유통관리사 ─────────────────────────
months = []
y, m = 2025, 11
for _ in range(12):
    months.append(f"{y}-{m:02d}")
    m += 1
    if m == 13: y, m = y+1, 1
# 기저 월판매량과 시즌 지수
base = {"VN-001":60,"VN-002":45,"VN-003":50,"VN-004":90,"VN-005":30,
        "TH-001":70,"TH-002":90,"TH-003":140,"TH-004":65,"TH-005":40}
def season(sku, mon):
    mm = int(mon[5:])
    if sku.startswith("VN") and sku != "VN-004":
        return {6:1.8,7:2.2,8:1.9,5:1.3,9:1.2}.get(mm, 0.6)
    if sku.startswith("TH"):
        return {1:2.0,2:2.3,3:1.8,12:1.3,11:1.0}.get(mm, 0.7)
    return 1.0
hist = []
sales_by = {}
for sku in base:
    for mon in months:
        q = int(base[sku]*season(sku,mon)*random.uniform(0.9,1.1))
        hist.append([sku, mon, q]); sales_by[(sku,mon)] = q
wcsv(f"{ROOT}/03_유통관리사_발주제안/data/monthly_sales_2025_11_2026_10.csv", ["SKU","월","판매량"], hist)
# 현재고 (2026-10-31), 발주잔량 0. 함정1: TH-003 재고를 box 단위로 기재 (12입)
stock_rows = []
stock_true = {}
for sku in base:
    p = next(x for x in PRODUCTS if x[0]==sku)
    s = int(base[sku]*random.uniform(0.8,1.6))
    if sku == "TH-003":
        stock_rows.append([sku, p[2], 60, "box(12입)", 0, p[7], p[8]])
        stock_true[sku] = 60*12
    else:
        stock_rows.append([sku, p[2], s, "ea", 0, p[7], p[8]])
        stock_true[sku] = s
wcsv(f"{ROOT}/03_유통관리사_발주제안/data/inventory_2026_10_31.csv",
     ["SKU","품명","현재고","단위","발주잔량","리드타임(일)","안전재고"], stock_rows)
# 정답: 11월 발주 → 1월 초 입고. 커버 기간 = 2027-01, 2027-02 수요 (전년 동월 × 1.1) + 안전재고 - 현재고
answer3 = {}
wrong3 = {}
for sku in base:
    p = next(x for x in PRODUCTS if x[0]==sku)
    fc = int((sales_by[(sku,"2026-01")]+sales_by[(sku,"2026-02")])*1.1)
    need = max(0, fc + p[8] - stock_true[sku])
    answer3[sku] = {"예측수요_1~2월": fc, "안전재고": p[8], "현재고": stock_true[sku], "발주량": need,
                    "허용범위": [int(need*0.8), int(need*1.2)]}
    avg3 = int(sum(sales_by[(sku,mm)] for mm in ["2026-08","2026-09","2026-10"])/3)
    stock_as_read = 60 if sku=="TH-003" else stock_true[sku]
    wrong3[sku] = max(0, avg3*2 + p[8] - stock_as_read)
wjson(f"{ROOT}/03_유통관리사_발주제안/answer_key.json",
      {"기준":"11월 발주, 리드타임 40~45일 → 1월 초 입고. 커버 기간 2027-01~02. 예측 = 전년 동월(2026-01, 02) × 1.1",
       "정답": answer3, "오디_오답(최근3개월평균×2, 단위 미환산)": wrong3})
wjson(f"{ROOT}/03_유통관리사_발주제안/prompts.json", {
  "scenario_id":"03","title":"동남아 품목 11월 발주량 제안","owner_npc":"박소연","cert":"유통관리사",
  "task_card":{
    "title":"Mekong Home·Siam Craft 11월 발주량 제안",
    "due":"모레 오전",
    "body":"{nickname} 씨, 베트남·태국 품목 11월 발주 넣어야 해요. 지난 12개월 판매량이랑 현재고 첨부. SKU별로 얼마 발주할지 제안해 주세요. 리드타임 생각하면 이번 발주분은 1월 초에 들어와요. 근거 짧게 붙여서요. 저는 '그래서 얼마'만 보면 돼요.",
    "attachments":["data/monthly_sales_2025_11_2026_10.csv","data/inventory_2026_10_31.csv","_shared/products.csv"],
    "deliverable":"SKU 10개 발주량 표 + 산출 근거 한 줄 + 검증 메모"
  },
  "scenario_context_for_npc": "정답 발주량은 answer_key. 허용범위 ±20%. 함정: TH-003 재고가 box 단위(60box=720ea), 오디는 최근 3개월 평균으로만 예측해서 시즌(TH 1~3월 성수기, VN 여름 성수기 종료)을 무시. VN 과다·TH 과소 패턴이면 '1월에 뭐가 팔리는지 생각해 봤어요?'로 반려. TH-003이 비정상적으로 크면 '옷걸이 재고 단위 봤어요?'",
  "planted_belief_for_odi":"발주량 예측은 최근 3개월 판매량 평균에 커버 개월 수를 곱해 계산한다. 시즌 요인이나 전년 동월 실적은 고려하지 않는다. 재고 수량은 단위 열을 무시하고 숫자 그대로 사용한다.",
  "hints":[
    "이번 발주분이 언제 들어오는지, 그때 뭐가 팔리는지부터 생각해 봐요. 팀장님이 1월 초라고 했잖아요.",
    "판매량 파일에서 작년 1월, 2월 숫자 한번 봐요. 최근 3개월이랑 많이 다를걸요.",
    "재고 파일에 단위 열 있어요. 전부 ea인지 확인해 봐요. 그리고 시즌 품목은 전년 동월 기준으로."
  ],
  "review_rules":{
    "approve_if":["SKU 10개 모두 허용범위 내","근거 기재"],
    "reject_area":{"시즌 무시":"1월에 뭐가 팔리는지 생각해 봤어요? 라탄을 1월에 그렇게 많이요?",
                   "단위 오류":"옷걸이 발주량이 왜 이래요? 재고 단위 봤어요?",
                   "결론 없음":"그래서 얼마 발주하면 돼요?"}
  },
  "traps":[
    {"id":"T1","type":"데이터","desc":"TH-003 현재고 box 단위 (60box=720ea)","detect":"TH-003 발주량이 허용범위 내"},
    {"id":"T2","type":"AI","desc":"오디가 시즌 무시, 최근 3개월 평균 사용","detect":"VN/TH 발주량이 허용범위 내 또는 로그에 전년 동월·시즌 언급"}
  ]
})
w(f"{ROOT}/03_유통관리사_발주제안/README.md", f"""# 03. 유통관리사 — 동남아 품목 11월 발주량 제안

담당 NPC: 박소연 (영업팀장) / 소요 목표: 20분

## 업무 카드
"{{nickname}} 씨, 베트남·태국 품목 11월 발주 넣어야 해요. 지난 12개월 판매량이랑 현재고 첨부. SKU별로 얼마 발주할지 제안해 주세요. 리드타임 생각하면 1월 초에 들어와요. 저는 '그래서 얼마'만 보면 돼요."

첨부
- `data/monthly_sales_2025_11_2026_10.csv` — SKU 10개 × 12개월 판매량
- `data/inventory_2026_10_31.csv` — 현재고, 단위, 리드타임, 안전재고
- `_shared/products.csv` — 시즌 정보

## 정답 기준
- 입고 시점 1월 초 → 커버 기간 2027년 1~2월
- 발주량 = (2026-01 + 2026-02 판매량) × 1.1 + 안전재고 − 현재고(ea 환산), 허용 ±20%
- 상세는 `answer_key.json`

## 함정 2개
| ID | 종류 | 내용 | 발견 방법 |
|---|---|---|---|
| T1 | 데이터 | TH-003 옷걸이 현재고가 "60 box(12입)" = 720ea | 재고 파일 단위 열 확인 |
| T2 | AI | 오디는 최근 3개월 평균 × 2로 계산 → 라탄(여름 끝) 과다, 수납(연초 성수기) 과소 | 판매량 파일에서 전년 1~2월 확인, 오디에게 "전년 동월 기준으로" |

## 오디에 심는 믿음
"최근 3개월 평균 × 커버 개월. 시즌·전년 동월 무시. 재고 단위 열 무시."

## 박소연 반려 기준
- VN 과다 / TH 과소 → "1월에 뭐가 팔리는지 생각해 봤어요?"
- TH-003 비정상 → "옷걸이 발주량이 왜 이래요? 재고 단위 봤어요?"
- 숫자 없음 → "그래서 얼마 발주하면 돼요?"

## 이하늘 힌트
1. 입고 시점에 뭐가 팔리는지부터.
2. 작년 1월, 2월 숫자 한번 봐요.
3. 재고 단위 열 확인. 시즌 품목은 전년 동월 기준.
""")

# ───────────────────────── 04 무역영어 ─────────────────────────
S4 = f"{ROOT}/04_무역영어_클레임회신"
w(f"{S4}/data/contract_summary.md", """# Hausmann GmbH 공급계약 요약 (2026년 연간, 발췌)

| 항목 | 조건 |
|---|---|
| 계약번호 | OR-HM-2026-01 |
| 인코텀즈 | **FOB Hamburg (Incoterms 2020)** |
| 결제 | T/T 30 days after B/L date |
| 포장 | Export standard carton, 6 units per carton, corner protection |
| 위험 이전 | 함부르크항 본선 적재 시점에 매수인(오름)에게 이전 |
| 해상 적하보험 | **매수인(오름) 부담.** 오름은 한국해상보험(가상) 연간 포괄보험 가입 (증권 OM-2026-CARGO) |
| 하자 통지 | 도착 후 14일 이내 서면 통지, 검정보고서 첨부 |
| 분쟁 | 성실 협의 후 ICC 중재 |
""")
w(f"{S4}/data/survey_report.md", """# 수입화물 검정보고서 (Survey Report) — 발췌

- 검정일: 2026-10-14
- 검정기관: 대한검정(가상) / 검정인 서명 있음
- 대상: Hausmann 선적분 B/L HLCU-2026-77812, 인보이스 IMP-2026-1012
- 품목: DE-001 스테인리스 프라이팬 28cm 240ea (40 carton × 6)

## 결과
- 외관 파손 카톤: 5 carton (카톤 모서리 찌그러짐, 코너 보호재 미장착 2 carton 확인)
- **손상 제품: 18ea** (DE-001, 코팅면 긁힘·찍힘으로 판매 불가)
- 손상 원인 추정: 운송 중 충격 + 일부 카톤 포장 규격 미달 (코너 보호재 누락)
- 사진 12매 별첨
""")
w(f"{S4}/data/internal_memo.md", """# 물류팀 → 무역팀 내부 메모 (2026-10-12, 입고 당일)

Hausmann 건 입고했는데 카톤 몇 개 찌그러져 있어요. 열어 보니 프라이팬 **대략 24개 정도** 긁힘 있는 것 같습니다.
검정 신청 넣었고 결과 나오면 다시 공유할게요. 일단 공급사한테 먼저 알려 두는 게 좋을 것 같아요.

(※ 이 메모를 근거로 10/12 무역팀이 Hausmann에 1차 통지 메일 발송. 수량 24ea로 기재됨)
""")
w(f"{S4}/data/inbound_email.txt", """From: Lena Vogt <l.vogt@hausmann-cookware.example>
To: trade@oreum.example
Date: 2026-10-16
Subject: RE: Damage notice - Shipment HLCU-2026-77812 (Invoice IMP-2026-1012)

Dear Oreum Trading Team,

Thank you for your notice of 12 October regarding damage to 24 units of DE-001 in the above shipment.

We are sorry to hear about the damage. However, we would like to remind you that the shipment was sold on FOB Hamburg terms under contract OR-HM-2026-01. Risk passed to you upon loading on board at Hamburg, and the goods left our warehouse in sound condition as confirmed by our loading inspection.

We therefore understand that any claim for transit damage should be directed to your cargo insurer. We are of course willing to support your insurance claim with our packing list, loading photos, and carton specifications.

Could you please send us the independent survey report and confirm the final number of damaged units so that we can prepare the supporting documents?

Kind regards,
Lena Vogt
Export Manager, Hausmann GmbH
""")
wjson(f"{S4}/answer_key.json", {
  "정답_회신_필수요소": [
    "FOB Hamburg 조건과 위험 이전을 인정 (보험 청구는 오름 보험사 OM-2026-CARGO 통해 진행)",
    "손상 수량을 18ea로 정정 (검정보고서 기준)",
    "검정보고서 첨부 및 보험 청구용 서류 요청: packing list, loading photos, carton spec",
    "검정 결과 중 코너 보호재 누락 2 carton 지적 → 포장 규격(계약 포장 조항) 준수 요청, 향후 재발 방지",
    "정중한 비즈니스 톤, Hausmann에게 보상 책임을 요구하지 않음"
  ],
  "반려_조건": [
    "Hausmann 보험 또는 Hausmann 비용으로 보상 요구 (FOB 오해)",
    "손상 수량 24ea 유지",
    "포장 규격 미달 언급 없음 (선택: 승인은 되나 리포트에서 감점)"
  ]
})
wjson(f"{S4}/prompts.json", {
  "scenario_id":"04","title":"Hausmann 파손 건 회신 메일","owner_npc":"정우진","cert":"무역영어",
  "task_card":{
    "title":"Hausmann 파손 클레임 회신 초안",
    "due":"오늘 중 (발송 전 팀장 검토)",
    "body":"{nickname} 씨, Hausmann에서 파손 건 회신 왔습니다. 답장 초안 영문으로 작성해 주세요. 발송 전에 제가 봅니다. 계약 조건은 첨부 계약 요약 확인하고, 수량은 검정보고서 기준으로. 메일 한 통이 계약입니다.",
    "attachments":["data/inbound_email.txt","data/contract_summary.md","data/survey_report.md","data/internal_memo.md"],
    "deliverable":"영문 회신 메일 초안 + 검증 메모 (근거 문서 명시)"
  },
  "scenario_context_for_npc":"계약은 FOB Hamburg, 보험은 오름 부담. 검정보고서 손상 18ea (1차 통지는 내부 메모의 24ea). 정답 회신: FOB 인정, 보험사 청구, 18ea 정정, 서류 요청, 포장 규격 준수 요청. 반려: Hausmann에 보상 요구(→'운송 조건 계약서랑 맞는지 다시 보세요. 이대로 나가면 보험 책임이 우리한테 옵니다' 식이 아니라 '이대로 나가면 FOB 모르는 회사로 보입니다'), 24ea 유지(→'수량 근거가 뭡니까?').",
  "planted_belief_for_odi":"FOB 조건에서는 매도인(수출자)이 목적지까지의 해상 적하보험을 부담한다고 이해한다. 따라서 운송 중 파손은 매도인의 보험으로 보상받아야 한다고 초안을 작성한다. 손상 수량은 대화에서 먼저 언급된 숫자(또는 수신 메일의 24)를 그대로 사용한다.",
  "hints":[
    "메일 쓰기 전에 계약 요약 읽어 봤어요? 인코텀즈 한 줄이 이 메일 전체를 결정해요.",
    "FOB면 배에 실린 다음부터는 누구 책임인지, 보험은 누가 들었는지 계약서에 다 있어요.",
    "수량도요. 24개는 어디서 나온 숫자고 검정보고서는 몇 개라고 하는지 비교해 봐요."
  ],
  "review_rules":{
    "approve_if":["FOB 위험 이전 인정","보상 요구 없음","수량 18ea","서류 요청 포함"],
    "reject_area":{"조건 오류":"회신에 쓴 보험 책임, 계약서랑 맞는지 다시 확인하세요. 이대로 나가면 FOB도 모르는 회사로 보입니다.",
                   "수량 오류":"18개입니까 24개입니까. 근거가 뭡니까?",
                   "톤 문제":"이 문장은 상대 잘못으로 단정하는 걸로 읽힙니다. 협조 요청으로 바꾸세요."}
  },
  "traps":[
    {"id":"T1","type":"데이터","desc":"1차 통지·수신 메일의 24ea vs 검정보고서 18ea","detect":"회신에 18ea"},
    {"id":"T2","type":"AI","desc":"오디가 FOB에서 보험을 매도인 부담으로 오해해 보상 요구 초안 작성","detect":"회신이 보험사 청구 방향"}
  ],
  "mail_npc_reply_rule":"사용자 회신이 팀장 승인 후 '발송'되면 Lena Vogt가 1회 답장. 서류 송부 약속 + 포장 개선 약속 + 다음 선적부터 코너 보호재 전수 적용. 이 답장은 엔딩 연출."
})
w(f"{S4}/README.md", """# 04. 무역영어 — Hausmann 파손 클레임 회신 메일

담당 NPC: 정우진 (무역팀장) / 메일 NPC: Lena Vogt / 소요 목표: 20분

## 업무 카드
"{nickname} 씨, Hausmann에서 파손 건 회신 왔습니다. 답장 초안 영문으로 작성해 주세요. 발송 전에 제가 봅니다. 계약 조건은 첨부 확인하고, 수량은 검정보고서 기준으로. 메일 한 통이 계약입니다."

첨부
- `data/inbound_email.txt` — Hausmann 회신 (FOB 상기, 검정보고서·최종 수량 요청)
- `data/contract_summary.md` — FOB Hamburg, 보험은 오름 부담, 포장 조항
- `data/survey_report.md` — 손상 18ea, 코너 보호재 누락 2 carton
- `data/internal_memo.md` — 입고 당일 "대략 24개" (1차 통지 근거)

## 정답 회신 요소
1. FOB 위험 이전 인정, 보험 청구는 오름 보험사로
2. 수량 18ea 정정
3. 보험 청구 서류 요청 (packing list, 사진, 카톤 스펙)
4. 코너 보호재 누락 지적 → 포장 조항 준수 요청
5. 정중한 톤

## 함정 2개
| ID | 종류 | 내용 | 발견 방법 |
|---|---|---|---|
| T1 | 데이터 | 24ea(메모·1차 통지) vs 18ea(검정보고서) | 검정보고서 열람 |
| T2 | AI | 오디는 FOB에서 보험이 매도인 부담이라 믿고 Hausmann에 보상 요구 초안 작성 | 계약 요약 열람, 오디에게 "FOB면 보험 누가 들어?" |

## 정우진 반려 기준
- 보상 요구 → "회신에 쓴 보험 책임, 계약서랑 맞는지 다시 확인하세요."
- 24ea → "18개입니까 24개입니까. 근거가 뭡니까?"
- 단정적 톤 → "협조 요청으로 바꾸세요."

## 엔딩
승인 후 발송 → Lena Vogt 답장 1통 (서류 송부, 포장 개선 약속)
""")

# ───────────────────────── 05 비서 ─────────────────────────
S5 = f"{ROOT}/05_비서_출장일정_회의록"
wcsv(f"{S5}/data/flights.csv",
     ["편명","출발지","출발일시","도착지","도착일시","시각기준"],
     [["KE905","ICN","2026-10-27 13:30","FRA","2026-10-27 17:40","현지시간"],
      ["LH276","FRA","2026-10-30 09:10","MXP","2026-10-30 10:20","UTC"],
      ["KE928","MXP","2026-11-01 12:30","ICN","2026-11-02 08:40","현지시간"]])
w(f"{S5}/data/itinerary_raw.md", """# 대표 유럽 출장 일정 (raw, 총무 메모)

기간: 2026-10-27(화) ~ 11-02(월) 귀국
동행: 없음 (현지 통역은 Casa Lumi 측 제공)

## 프랑크푸르트 (10/27~10/30)
- 10/27 도착 후 호텔 체크인 (Hotel Am Main, 가상)
- 10/28 10:00 Hausmann 본사 방문 (Hausmann 공장은 프랑크푸르트 근교, 차량 1시간) — 2027 연간 물량·포장 개선 협의
- 10/28 18:30 Hausmann 측 만찬
- 10/29 09:30 Ambiente 전시장 (가상) 신규 공급사 미팅 3건: 09:30 / 11:00 / 14:00

## 밀라노 (10/30~11/1)
- 10/30 LH276으로 이동
- 10/30 15:00 Casa Lumi 쇼룸 (Via Tortona, 가상) — 2027 신제품 라인 + 결제 조건 협의
- 10/31 10:00 Casa Lumi 공장 (밀라노 외곽, 차량 40분)
- 11/01 자유 일정, 12:30 귀국편

## 요청
- 한국 본사에서 대표님과 통화 가능한 시간대를 알아야 함 → 전 일정에 **한국시간 병기**
- 10/28 Hausmann 회의 직후, 10/30 Casa Lumi 회의 직후 각각 한국 시간으로 보고 전화 예정 (현지 회의 종료 + 1시간)
""")
w(f"{S5}/data/meeting_transcript_casalumi.md", """# Casa Lumi 쇼룸 회의 녹취 정리 (2026-10-30, 현지 15:00~16:20, 통역 요약)

참석: 오름 대표 / Casa Lumi 영업이사 Marco R.(가상), 수출담당 Giulia P.(가상)

- 대표: 2027년 세라믹 라인 물량 20% 증량 희망. 단, 결제 조건을 T/T 30일 → 45일로 조정 요청.
- Marco: 물량 증량은 환영. 결제 조건 45일은 **본사 재무 검토 필요, 11월 중 회신하겠다**.
- Giulia: 신제품 "Terra" 라인 샘플 10종 11월 말 발송 가능. 샘플 비용 무상.
- 대표: IT-004 오븐용기 포장 파손률 높음 → 포장 보강 요청.
- Marco: 포장 보강은 **즉시 적용 동의**. 12월 선적분부터.
- 대표: CIF Busan 유지 확인. Marco 동의.
- Giulia: 2027년 1분기 가격은 EUR 기준 3% 인상 예정 통보. 대표는 **보류, 물량 증량과 연계해 재협의** 요청.
- 종료 16:20. 다음 접점: 11월 중 결제 조건 회신, 11월 말 샘플 발송.
""")
wjson(f"{S5}/answer_key.json", {
  "시차_기준":"2026-10-25 유럽 서머타임 종료. 10/26부터 CET(UTC+1), KST(UTC+9) → 독일·이탈리아 모두 한국보다 8시간 느림",
  "일정표_정답(현지 → 한국)": {
    "10/27 KE905 FRA 도착 17:40 CET": "10/28 01:40 KST",
    "10/28 10:00 Hausmann 회의": "10/28 18:00 KST (보고 전화: 회의 종료 후 1h, 회의 2h 가정 → 13:00 CET = 21:00 KST)",
    "10/28 18:30 만찬": "10/29 02:30 KST",
    "10/29 09:30 / 11:00 / 14:00 전시장": "17:30 / 19:00 / 22:00 KST",
    "10/30 LH276 09:10 UTC 출발": "현지 10:10 CET 출발 / 18:10 KST (항공편 표의 시각기준이 UTC인 행)",
    "10/30 15:00 Casa Lumi": "23:00 KST (보고 전화: 16:20 종료 + 1h = 17:20 CET = 11/01 01:20 KST)",
    "10/31 10:00 Casa Lumi 공장": "18:00 KST",
    "11/01 12:30 MXP 출발": "20:30 KST, 11/02 08:40 KST 도착"
  },
  "회의록_정답": {
    "결정": ["IT-004 포장 보강 즉시 적용 (12월 선적분부터)", "CIF Busan 유지", "Terra 샘플 10종 11월 말 무상 발송"],
    "보류": ["결제 조건 T/T 45일 — Casa Lumi 본사 재무 검토, 11월 중 회신", "2027 1분기 3% 인상 — 물량 증량과 연계 재협의"],
    "액션": ["11월 중 결제 조건 회신 확인 (무역팀)", "11월 말 샘플 수령 (영업팀)", "12월 선적분 포장 확인 (물류팀)"]
  },
  "함정": {"T1_데이터":"LH276 행만 시각기준 UTC → 현지 10:10", "T2_AI":"오디가 서머타임 종료 모르고 -7h 적용 → 전 일정 1시간씩 틀림"}
})
wjson(f"{S5}/prompts.json", {
  "scenario_id":"05","title":"대표 유럽 출장 일정표(한국시간 병기) + 회의록","owner_npc":"강지훈","cert":"비서",
  "task_card":{
    "title":"대표 출장 일정표 + Casa Lumi 회의록",
    "due":"오늘 18:00",
    "body":"{nickname} 씨, 대표님 유럽 출장 건입니다. 첨부 raw 일정이랑 항공편으로 한국시간 병기한 일정표 만들어 주세요. 본사에서 통화 가능 시간 잡아야 해서 시차 틀리면 안 됩니다. 그리고 Casa Lumi 회의 녹취 정리본 있는데, 결정된 것·보류된 것·누가 뭘 해야 하는지 구분해서 회의록으로 정리해 주세요.",
    "attachments":["data/itinerary_raw.md","data/flights.csv","data/meeting_transcript_casalumi.md"],
    "deliverable":"① 일정표 (현지시간 / 한국시간 두 열, 보고 전화 시각 포함) ② 회의록 (결정/보류/액션 구분) ③ 검증 메모"
  },
  "scenario_context_for_npc":"정답: 10/25 서머타임 종료로 전 일정 -8h. LH276은 UTC 표기라 현지 10:10. 회의록은 결정 3·보류 2·액션 3. 반려: 시차가 -7h면 '시차 다시 확인하세요. 10월 말이면 유럽 시간 바뀝니다'까지만. LH276 시각 틀리면 '항공편 표 시각기준 열 봤어요?'. 보류 사항을 결정으로 쓰면 '45일 합의된 거 맞아요? 녹취 다시 보세요'.",
  "planted_belief_for_odi":"독일·이탈리아는 한국보다 7시간 느리다(CEST 기준)고 고정 적용한다. 서머타임 종료 여부는 확인하지 않는다. 항공편 표의 시각은 모두 현지시간으로 간주한다. 회의 녹취에서 상대가 '검토하겠다'고 한 항목도 긍정적 맥락이면 '합의'로 요약한다.",
  "hints":[
    "유럽 시차, 그냥 외운 숫자로 넣었죠? 10월 말이 어떤 시기인지 한번 생각해 봐요.",
    "항공편 표에 '시각기준' 열 있어요. 전부 현지시간이에요?",
    "서머타임은 10월 마지막 일요일에 끝나요. 그리고 회의록에서 '검토하겠다'는 합의가 아니에요."
  ],
  "review_rules":{
    "approve_if":["전 일정 시차 -8h","LH276 현지 10:10","결제 조건 45일이 보류로 분류","액션 항목 담당 지정"],
    "reject_area":{"시차 오류":"시차 다시 확인하세요. 10월 말이면 유럽 시간 바뀝니다.",
                   "항공편 오류":"LH276 출발 시각, 항공편 표 시각기준 열 봤어요?",
                   "회의록 왜곡":"45일 합의된 거 맞아요? 녹취 다시 보세요."}
  },
  "traps":[
    {"id":"T1","type":"데이터","desc":"LH276 행만 UTC 표기","detect":"LH276 현지 10:10 / 18:10 KST"},
    {"id":"T2","type":"AI","desc":"오디가 서머타임 종료 무시, -7h 적용","detect":"전 일정 -8h"}
  ]
})
w(f"{S5}/README.md", """# 05. 비서 — 대표 유럽 출장 일정표(한국시간 병기) + 회의록

담당 NPC: 강지훈 (경영지원팀장) / 소요 목표: 20분

## 업무 카드
"{nickname} 씨, 대표님 유럽 출장 건입니다. raw 일정이랑 항공편으로 한국시간 병기 일정표 만들어 주세요. 시차 틀리면 안 됩니다. 그리고 Casa Lumi 회의 녹취, 결정·보류·액션 구분해서 회의록으로요."

첨부
- `data/itinerary_raw.md` — 10/27~11/02 프랑크푸르트·밀라노 일정
- `data/flights.csv` — 항공편 3건. **LH276 행만 시각기준 UTC**
- `data/meeting_transcript_casalumi.md` — 회의 녹취 정리

## 정답
- 2026-10-25 유럽 서머타임 종료 → 출장 전 기간 CET(UTC+1), 한국과 **8시간** 차
- LH276: 09:10 UTC = 10:10 CET = 18:10 KST
- 회의록: 결정 3 (포장 보강, CIF 유지, 샘플 발송) / 보류 2 (결제 45일, 3% 인상) / 액션 3
- 상세는 `answer_key.json`

## 함정 2개
| ID | 종류 | 내용 | 발견 방법 |
|---|---|---|---|
| T1 | 데이터 | flights.csv의 LH276만 UTC 기준 | 시각기준 열 확인 |
| T2 | AI | 오디는 -7h 고정 적용 (서머타임 종료 무시) | 오디에게 "10월 말 시차 확인해 줘", 또는 직접 검산 |

추가 검토 요소(함정 아님, 루브릭): 오디는 "검토하겠다"를 합의로 요약하는 경향 → 결제 조건 45일을 보류로 분류했는지.

## 강지훈 반려 기준
- -7h → "시차 다시 확인하세요. 10월 말이면 유럽 시간 바뀝니다."
- LH276 → "항공편 표 시각기준 열 봤어요?"
- 45일 합의로 기재 → "45일 합의된 거 맞아요? 녹취 다시 보세요."
""")

# ───────────────────────── 폴더 설명 ─────────────────────────
w(f"{ROOT}/README.md", """# scenarios/ — 시나리오 데이터

서버가 이 폴더를 그대로 읽는다. 시나리오 하나 = 폴더 하나.

```
scenarios/
├── _shared/                 공통 데이터 (거래처, 제품, 상수). 모든 시나리오가 참조
├── 01_컴활_매출집계/
│   ├── README.md            사람용 설명: 업무 카드, 정답, 함정, 반려 기준, 힌트
│   ├── prompts.json         서버용: task_card, NPC 컨텍스트, 오디 planted_belief, hints, review_rules, traps
│   ├── answer_key.json      정답. 팀장 검토·평가 에이전트에만 주입. 사용자에게 절대 노출 금지
│   └── data/                첨부 데이터. 데이터 뷰어(P4)와 오디 system prompt에 주입
├── 02_전산회계_월말결산/
├── 03_유통관리사_발주제안/
├── 04_무역영어_클레임회신/
└── 05_비서_출장일정_회의록/
```

## prompts.json 필드

| 필드 | 쓰이는 곳 |
|---|---|
| task_card | P1 업무 카드. `{nickname}` 치환 |
| scenario_context_for_npc | 담당 팀장·이하늘 system prompt의 `{scenario_context}` |
| planted_belief_for_odi | 오디 system prompt의 `{planted_belief}` |
| hints[0..2] | 이하늘 `{scenario_hints}`. hint_level에 따라 누적 공개 |
| review_rules | 팀장 검토 호출 시 구조화 출력 기준 |
| traps | 평가 에이전트의 함정 발견 판정 기준 |

## 세계관 일관성
- 02 매출 세금계산서 10건의 공급가액 = 01 정답 거래처별 합계 (같은 10월)
- 04 파손 건 송장 IMP-2026-1012 = 02 수입신고필증 1건
- 05 출장의 Hausmann·Casa Lumi = 04·02의 공급사
- 환율·부가세·서머타임 종료일은 `_shared/constants.json`

## 재생성
`gen_scenarios.py` (scratchpad, 추후 tools/로 이동)로 생성. seed 고정이라 재실행해도 같은 데이터.
""")
print("generated")
