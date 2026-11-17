# server — (주)오름 백엔드 (Node + Express + SQLite)

API 키는 서버 환경변수에만 둔다. 사용자는 닉네임만 입력한다.

## 실행

```bash
cd server
npm install
cp .env.example .env     # ANTHROPIC_API_KEY 채우기
npm run dev              # tsx watch, :8787
```

- `npm run typecheck` — tsc
- `npm test` — 아래 순서대로. 전부 API 키 불필요
  - `test:unit` — node:test. 시나리오 로더, 프롬프트 조립, DB, 비용 방어, 구조화 제출 채점, 정답 마스킹
  - `test:smoke` — 서버를 자식 프로세스로 띄워 LLM 없는 경로 + 더미 키 실패 처리
  - `test:integration` — `LLM_MOCK=1`로 오디 상한, 힌트 단계, 제출 상태 머신, WS 이벤트
  - `test:submit` — `LLM_MOCK=1`로 구조화 제출(01·02 채점, 03 기존 경로)과 팀장·NPC 출력 마스킹
  - `test:guard` — 비용 방어 상한
- `LLM_MOCK=1 npm run dev` — Claude 없이 프론트 붙여 볼 때. 응답은 `[mock] ...`
- `npm run build && npm start` — Railway용

## 구조

| 파일 | 역할 |
|---|---|
| `src/config.ts` | env, 모델 ID, `scenarios/_shared/constants.json`의 상한(오디 15, 힌트 3, 반려 3) |
| `src/db.ts` | SQLite 스키마(04 문서 6절) + 쿼리 함수 |
| `src/scenarios.ts` | `scenarios/` 폴더 로더. 첨부는 `task_card.attachments`에 있는 파일만 읽음 (경로 탈출 방지). `submission.json` 이 있으면 읽고 검사 |
| `src/grading.ts` | 구조화 제출 칸 정의 검사·입력 해석·코드 채점 (승인/반려, 틀린 영역, trap_caught) |
| `src/mask.ts` | LLM 출력에서 answer_key 숫자 마스킹 (팀장 검토 코멘트, NPC 대화) |
| `src/prompts/index.ts` | 03 문서의 system prompt 블록. 고정 블록(캐시)과 가변 블록 분리 |
| `src/llm.ts` | Anthropic SDK 래퍼: `chat`(NPC), `chatStream`(오디, SSE), `structured`(검토·평가, zod) |
| `src/events.ts` | `/ws/{run_id}` 픽셀 이벤트 브로드캐스트 |
| `src/routes/session.ts` | 세션, 시나리오 선택, 시작 |
| `src/routes/run.ts` | 데이터 뷰어, 바구니, 오디, NPC, 제출/검토, 평가(미구현) |

## API

| 메서드 | 경로 | 비고 |
|---|---|---|
| GET | `/health` | 시나리오 목록, 상한 |
| POST | `/session` | `{nickname}` 1~20자 |
| GET | `/session/{id}` | 시나리오별 진행 상태 (S6) |
| POST | `/scenario/{sid}/start` | `{session_id}` → run, 업무 카드 |
| GET | `/run/{rid}` | 복구용 전체 상태. `submission_fields`: 칸 `{id, label, type, unit, required}[]` 또는 null (정답·허용오차 없음). 제출 이력에 `fields` |
| GET | `/run/{rid}/data/{file}?sort=1&search=1` | 첨부 원문. 열람 기록 |
| PUT | `/run/{rid}/basket` | `{text}` 결과물 바구니 |
| POST | `/run/{rid}/odi` | `{message}` → SSE `delta`/`done`/`error`. 상한 초과 429 |
| POST | `/run/{rid}/npc/{kang\|park\|jung\|lee}` | `{message, hint_request?}`. 힌트는 lee만, 상한 초과 429. 응답의 정답 숫자는 ○○○ |
| POST | `/run/{rid}/submit` | `{verify_memo, fields?}` 메모 10자 이상. 칸 있는 시나리오는 `fields: {칸 id: 숫자 또는 "580,300,000원"}` 필수 칸 전부, 아니면 400 `code: fields` → approve/reject. 응답 `{attempt, decision, area, wrong_areas?, message, state, reject_count, closed}` |
| POST | `/run/{rid}/evaluate` | 승인 또는 반려 3회 후. **미구현(501)** — 06 문서 파이프라인 다음 단계 |
| WS | `/ws/{rid}` | `{type, run_id, npc_id?, text?}` |

## LLM 호출 설계

- 오디: system = [기본 규칙] + [첨부 데이터 + 심어진 믿음 (cache_control)]. 대화 이력은 DB의 agent=odi 메시지. 성공한 호출만 횟수 차감.
- 대화 이력 캐시: 모든 호출에서 마지막 턴에 cache_control 을 붙여, 다음 호출은 이전 대화를 캐시에서 읽는다.
- NPC: system = [공통 + 페르소나] + [시나리오 컨텍스트 (cache)] + [대화 상대·힌트 단계]. 이하늘은 공개된 단계까지의 힌트만 프롬프트에 들어감.
- 검토 (구조화 제출, `submission.json` 있는 01·02): **판정은 코드.** 칸마다 answer_key 의 `answer.path` 값과 비교(허용오차 `tolerance`, 지금 전부 0). 승인 = 필수 칸 전부 정답 + `text_checks`(01 비중·차트, 02 분개 존재 여부) 통과. 틀린 칸의 `reject_area` 를 모아 `wrong_areas`, 첫 번째가 `area`. `derived` 칸(02 납부세액)은 다른 칸이 다 맞을 때만 자기 영역을 보고. trap_caught = 그 함정을 `proves` 하는 칸이 전부 정답. 그다음 담당 팀장 LLM 을 한 번 불러 멘트만 받는다 (zod `{message}`). 이 호출에는 answer_key·`scenario_context_for_npc`(정답이 적혀 있음)를 넣지 않고 판정·틀린 영역 이름·영역 말투만 준다. 호출이 실패하면 영역 말투 문장으로 대체하고 판정은 그대로 반영 (`comment_fallback`). submission 행에 `fields_json`(입력값), `grading_json`(칸별 정답 여부, 정답 값은 저장 안 함), `review_json`(`graded_by: "code"`).
- 검토 (나머지 시나리오): 담당 팀장 페르소나 + answer_key + 함정 정의 → zod 스키마 `{decision, area, message, trap_caught[]}` (`graded_by: "llm"`).
- 정답 마스킹 (`mask.ts`): 팀장 검토 코멘트와 NPC 대화 응답에서 그 시나리오 answer_key 의 숫자 잎 중 1만 이상을 찾아 ○○○ 로 바꾼다. 쉼표 유무, `원`, `만원`, `억 … 만` 표기를 같은 값으로 본다. 1만 미만은 10곳·124행·2026년·% 같은 일상 숫자와 겹쳐서 제외 (그래서 03 의 두세 자리 발주량은 가리지 못함). 저장도 가린 문장으로. 오디 출력에는 적용하지 않음.
- `LLM_MOCK=1`: 구조화 제출 멘트는 영역 말투 + 검증 메모 앞부분 인용(마스킹 테스트용), 기존 검토는 "반려/12곳/12개" 규칙.
- 모델: 오디·검토는 `MODEL_MAIN`(기본 `claude-opus-5-5`), 팀장 대화는 `MODEL_NPC`, 이하늘은 `MODEL_MENTOR`(둘 다 기본 `claude-haiku-5-5`).

## 비용 방어 (`src/guard.ts`)

공개 링크가 마감(11/23)부터 본선(12/7)까지 열려 있어야 해서 넣었다. 날짜는 한국 시간, 매일 0시 초기화. 숫자는 전부 환경변수(`.env.example`).

| 장치 | 기본값 | 걸리면 |
|---|---|---|
| 서버 전체 하루 지출 상한 `DAILY_BUDGET_USD` | $20 | 새 세션·업무 시작·오디·팀원·제출 전부 503 `code: budget`, "오늘 준비한 체험 분량이 모두 소진됐어요" |
| IP당 하루 세션 `SESSIONS_PER_IP_DAY` | 10 | 429 `ip_sessions` |
| IP당·세션당 하루 업무 시작 `RUNS_PER_IP_DAY`·`RUNS_PER_SESSION_DAY` | 10·6 | 429 `daily_runs` |
| run당 팀원 대화 `NPC_CALLS_PER_RUN` | 30 | 429 `npc_calls` (오디 15회·힌트 3회·반려 3회는 기존 상한) |
| 대화 이력 길이 `ODI_HISTORY_CHARS`·`NPC_HISTORY_CHARS` | 6만·1.6만 자 | 오래된 주고받기부터 버림. 상한의 40% 단위로 잘라 이력 캐시가 매번 깨지지 않게 |

- 지출은 호출마다 `spend` 테이블에 기록(모델, 토큰 4종, 추정 달러). 단가는 `guard.ts` 의 표(2026-11 claude-api 스킬 문서 기준)이고 실제 청구는 Console 에서 확인.
- 1회 실측 비용: `SELECT run_id, SUM(usd) FROM spend GROUP BY run_id` 로 run 별 합계를 본다 (소개서용).
- `/health` 의 `open` 은 오늘 상한 안인지 여부만 알려 준다 (액수는 비공개).
- **배포 후 확인**: 휴대폰(LTE)과 PC 에서 각각 `/health` 를 열어 `your_ip` 가 서로 다르고 실제 공인 IP 인지 본다. 둘이 같으면 프록시 IP 를 읽는 중이므로 `TRUST_PROXY` 를 2 로 올린다. 그대로 두면 IP 한도가 전체 사용자에게 한꺼번에 걸린다.
- 상한은 호출 직전에 확인하므로 동시에 들어온 호출 몇 개만큼은 넘을 수 있다.

## 배포 (Railway)

- Node 20+. `npm run build` → `npm start`.
- 환경변수: `ANTHROPIC_API_KEY`, `PORT`(Railway가 줌), 비용 방어 값(위 표, 기본값으로 충분하면 생략), `CORS_ORIGIN`(Vercel 도메인), `DB_PATH`(volume 경로, 예 `/data/oreum.db`), `SCENARIOS_DIR`(레포 루트 기준 `../scenarios`이므로 모노레포 루트에서 빌드하거나 scenarios를 함께 배포)
- better-sqlite3는 12.x 고정 (13.x는 Node 22 이상만 지원, Node 20에서 세그폴트)
