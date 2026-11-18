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
│   ├── odi_tools.json       (선택, 지금 01·02) 오디 계산 도구 설정. 있으면 함정은 도구 기본값이 담당
│   ├── eval.json            (필수, 손으로 관리) 평가 판정 재료: 함정 발견 시점 키워드, 메모-열람 대조 규칙
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

## eval.json (필수)

평가 리포트(`server/src/evaluation/`)가 시나리오마다 다르게 보는 것. 이 스크립트가 만들지 않는다 (손으로 관리). 없거나 함정 id 가 빠졌거나 정규식이 틀리면 서버 시작 때 실패한다.

```json
{
  "traps": { "T1": { "keywords": "중복|두 번|겹치", "tool_flags": ["dedupe_order_ids"] } },
  "memo_files": { "신고필증": "import_declarations" }
}
```

| 필드 | 뜻 |
|---|---|
| traps.{id}.keywords | 사용자가 오디에게 이 함정을 짚었다고 볼 표현 (정규식). 발견 **시점**만 정한다. 발견 **여부**는 제출 숫자(구조화 제출)나 팀장 검토가 정한다 → 키워드만 써서는 점수가 안 오름 |
| traps.{id}.tool_flags | 이 함정을 바로잡는 오디 도구 옵션. 켜서 숫자가 바뀐 턴도 발견 시점 후보 |
| traps.{id}.ai_warns | (선택) 오디가 이 함정을 경고할 때 쓰는 말 (정규식). 사용자가 아직 짚지 않았는데(keywords·tool_flags 기준) 오디 답변에 걸리면 지우지 않고 assistant 메시지 meta.ai_warned 에 기록하고, 평가에서 발견 경로 `ai_warned`(계수 0.7)로 친다. 경고했는데 끝내 못 잡으면 리포트에 "오디가 경고했지만 확인하지 않음". `server/src/aiWarn.ts`, 테스트 `test/unit/aiWarn.test.ts`. 함정 위치를 직접 적지 말고 "설명할 때 쓰는 말"로 쓴다 |
| memo_files | 검증 메모 한 문장에 "이 단어 + 원본/대조/파일" 이 있으면 그 첨부(값은 경로 일부)를 실제로 열었어야 메모 신뢰성 점수를 줌 |

함정 경로 계수(스스로 1.0 / 힌트 1·2·3단계 후 0.8·0.6·0.4 / 반려 후 0.5)는 발견 시점 이전의 힌트·반려 수로 정한다. 기대 점수는 `eval/golden/cases.json`, 확인은 `server/test/unit/evaluation.test.ts`.

## 세계관 일관성
- 02 매출 10건(거래처별 매출 집계, 세금계산서·카드 등 증빙 혼합)의 공급가액 = 01 정답 거래처별 합계 (같은 10월). 01의 단가·금액은 VAT 별도 공급가액
- 04 파손 건 송장 IMP-2026-1012 = 02 수입신고필증 1건
- 05 출장의 Hausmann·Casa Lumi = 04·02의 공급사. 05 Hausmann 방문(10/28)에서 04 파손 건 보험 청구 진행을 공유
- 환율·부가세·서머타임 종료일은 `_shared/constants.json`

## 재생성
`python tools/gen_scenarios.py` 로 생성 (출력은 이 파일 기준 레포 루트의 scenarios/). seed 고정이라 재실행해도 같은 데이터. 데이터를 손으로 고치지 말고 스크립트를 고친 뒤 재생성한다.
