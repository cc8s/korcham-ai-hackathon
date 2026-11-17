# scenarios/ — 시나리오 데이터

서버가 이 폴더를 그대로 읽는다. 시나리오 하나 = 폴더 하나.

```
scenarios/
├── _shared/                 공통 데이터 (거래처, 제품, 상수). 모든 시나리오가 참조
├── 01_컴활_매출집계/
│   ├── README.md            사람용 설명: 업무 카드, 정답, 함정, 반려 기준, 힌트
│   ├── prompts.json         서버용: task_card, NPC 컨텍스트, 오디 planted_belief, hints, review_rules, traps
│   ├── answer_key.json      정답. 팀장 검토·평가 에이전트에만 주입. 사용자에게 절대 노출 금지
│   ├── submission.json      (선택, 지금 01·02) 구조화 제출 칸. 서버가 칸 값을 answer_key 와 대조해 채점
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
| traps | 평가 에이전트의 함정 발견 판정 기준. submission.json 이 있으면 발견 여부는 칸 값으로 판정하고 detect 는 발견 시점에만 씀 |

## submission.json 필드 (선택)

있으면 S3 제출 화면에 숫자 칸이 뜨고, 승인/반려와 함정 발견(trap_caught)을 **서버 코드가** 정한다. 팀장 LLM 은 판정을 받아 멘트만 쓴다. 없으면 팀장 LLM 이 제출물 텍스트를 읽고 판정 (03~05).

| 필드 | 뜻 |
|---|---|
| fields[].id | API 키 (`fields: {id: 값}`). 영문 소문자·숫자·_ |
| fields[].label, unit | 화면 칸 이름·단위. 사용자에게 보이는 건 이것과 type, required 뿐 |
| fields[].type | `integer` 또는 `number` |
| fields[].required | 비면 400 |
| fields[].answer | 정답 위치. `path` = answer_key 키를 `.` 으로 이음. `derive` (선택) = `count`(키 개수) / `min` / `max` |
| fields[].tolerance | 허용 차이(절댓값). 0 = 정확히 일치 |
| fields[].reject_area | 틀리면 이 반려 영역. prompts.json `review_rules.reject_area` 또는 아래 `extra_reject_area` 의 키 |
| fields[].proves | 맞으면 증명되는 함정 id. 한 함정을 여러 칸이 증명하면 전부 맞아야 발견 |
| fields[].derived | (선택) 다른 칸에서 계산되는 합계 칸. 다른 칸이 다 맞을 때만 자기 반려 영역을 보고 |
| fields[].why | 사람용 설명: 왜 이 칸이 함정을 가르는지 |
| text_checks[] | 숫자가 아닌 승인 조건 중 결정적으로 볼 수 있는 것. `pattern`(정규식)이 결과물(`target: basket`)에 있는지만 본다. 틀리면 `reject_area` |
| extra_reject_area | prompts.json 에 없는 반려 영역의 팀장 말투 (prompts.json 을 건드리지 않으려고 여기 둠) |

칸 고르는 기준: 사용자가 결과물에서 바로 옮겨 적을 수 있고, 함정을 잡았을 때와 놓쳤을 때 값이 다를 것. 함정 하나를 하나의 칸이 가르도록(다른 함정의 영향을 안 받게) 고른다. 서버 시작 때 path·반려 영역·함정 id 를 검사해서 틀리면 바로 실패한다.

## 세계관 일관성
- 02 매출 세금계산서 10건의 공급가액 = 01 정답 거래처별 합계 (같은 10월)
- 04 파손 건 송장 IMP-2026-1012 = 02 수입신고필증 1건
- 05 출장의 Hausmann·Casa Lumi = 04·02의 공급사
- 환율·부가세·서머타임 종료일은 `_shared/constants.json`

## 재생성
`gen_scenarios.py` (scratchpad, 추후 tools/로 이동)로 생성. seed 고정이라 재실행해도 같은 데이터.
