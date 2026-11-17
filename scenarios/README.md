# scenarios/ — 시나리오 데이터

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
- 02 매출 10건(거래처별 매출 집계, 세금계산서·카드 등 증빙 혼합)의 공급가액 = 01 정답 거래처별 합계 (같은 10월). 01의 단가·금액은 VAT 별도 공급가액
- 04 파손 건 송장 IMP-2026-1012 = 02 수입신고필증 1건
- 05 출장의 Hausmann·Casa Lumi = 04·02의 공급사. 05 Hausmann 방문(10/28)에서 04 파손 건 보험 청구 진행을 공유
- 환율·부가세·서머타임 종료일은 `_shared/constants.json`

## 재생성
`python tools/gen_scenarios.py` 로 생성 (출력은 이 파일 기준 레포 루트의 scenarios/). seed 고정이라 재실행해도 같은 데이터. 데이터를 손으로 고치지 말고 스크립트를 고친 뒤 재생성한다.
