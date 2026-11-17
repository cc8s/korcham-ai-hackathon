# scenarios/ — 시나리오 데이터

서버가 이 폴더를 그대로 읽는다. 시나리오 하나 = 폴더 하나.

```
scenarios/
├── _shared/                 공통 데이터 (거래처, 제품, 상수). 모든 시나리오가 참조
├── 01_컴활_매출집계/
│   ├── README.md            사람용 설명: 업무 카드, 정답, 함정, 반려 기준, 힌트
│   ├── prompts.json         서버용: task_card, NPC 컨텍스트, 오디 planted_belief, hints, review_rules, traps
│   ├── answer_key.json      정답. 팀장 검토·평가 에이전트에만 주입. 사용자에게 절대 노출 금지
│   ├── odi_tools.json       (선택) 오디 계산 도구 설정. 있으면 함정은 도구 기본값이 담당
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

## odi_tools.json (선택, 01·02)

있으면 오디가 계산 도구로 숫자를 내고, 함정은 도구의 기본값이 재현한다 (기획 피드백 1번). 없으면 `planted_belief_for_odi` 를 프롬프트에 넣는 예전 방식. 01·02 의 `planted_belief_for_odi` 는 이 파일을 지웠을 때의 대비로 남겨 둔다.

```json
{
  "tools": [{ "name": "aggregate_sales", "sources": { "sales": "data/sales_2026_10.csv" } }],
  "include_raw_data": false
}
```

| 필드 | 뜻 |
|---|---|
| tools[].name | `server/src/tools/` 에 등록된 도구 이름 (`aggregate_sales`, `vat_summary`) |
| tools[].sources | 도구가 읽을 첨부. 키는 도구가 정하고, 값은 `task_card.attachments` 에 있는 경로 |
| include_raw_data | true 면 원문도 오디 컨텍스트에 넣음. 기본 false (파일명·열·행 수만. 숫자는 도구로만) |

도구 정의(설명·옵션)와 계산은 코드에 있다. 옵션 기본값과 함정의 대응은 `docs/03_NPC_시트.md` 6절. 교정 옵션을 다 켠 결과가 `answer_key.json` 과 같은지는 `server/test/unit/tools.test.ts` 가 확인한다 — 데이터나 정답을 바꾸면 이 테스트를 같이 돌린다.

## 세계관 일관성
- 02 매출 세금계산서 10건의 공급가액 = 01 정답 거래처별 합계 (같은 10월)
- 04 파손 건 송장 IMP-2026-1012 = 02 수입신고필증 1건
- 05 출장의 Hausmann·Casa Lumi = 04·02의 공급사
- 환율·부가세·서머타임 종료일은 `_shared/constants.json`

## 재생성
`gen_scenarios.py` (scratchpad, 추후 tools/로 이동)로 생성. seed 고정이라 재실행해도 같은 데이터.
