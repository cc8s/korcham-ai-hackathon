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
- `npm test` — 아래 셋 순서대로. 전부 API 키 불필요
  - `test:unit` — node:test. 시나리오 로더, 프롬프트 조립, DB
  - `test:smoke` — 서버를 자식 프로세스로 띄워 LLM 없는 경로 + 더미 키 실패 처리
  - `test:integration` — `LLM_MOCK=1`로 오디 상한, 힌트 단계, 제출 상태 머신, WS 이벤트
- `LLM_MOCK=1 npm run dev` — Claude 없이 프론트 붙여 볼 때. 응답은 `[mock] ...`
- `npm run build && npm start` — Railway용

## 구조

| 파일 | 역할 |
|---|---|
| `src/config.ts` | env, 모델 ID, `scenarios/_shared/constants.json`의 상한(오디 15, 힌트 3, 반려 3) |
| `src/db.ts` | SQLite 스키마(04 문서 6절) + 쿼리 함수 |
| `src/scenarios.ts` | `scenarios/` 폴더 로더. 첨부는 `task_card.attachments`에 있는 파일만 읽음 (경로 탈출 방지) |
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
| GET | `/run/{rid}` | 복구용 전체 상태 |
| GET | `/run/{rid}/data/{file}?sort=1&search=1` | 첨부 원문. 열람 기록 |
| PUT | `/run/{rid}/basket` | `{text}` 결과물 바구니 |
| POST | `/run/{rid}/odi` | `{message}` → SSE `delta`/`done`/`error`. 상한 초과 429 |
| POST | `/run/{rid}/npc/{kang\|park\|jung\|lee}` | `{message, hint_request?}`. 힌트는 lee만, 상한 초과 429 |
| POST | `/run/{rid}/submit` | `{verify_memo}` 10자 이상 → 팀장 검토(구조화 출력) → approve/reject |
| POST | `/run/{rid}/evaluate` | 승인 또는 반려 3회 후. **미구현(501)** — 06 문서 파이프라인 다음 단계 |
| WS | `/ws/{rid}` | `{type, run_id, npc_id?, text?}` |

## LLM 호출 설계

- 오디: system = [기본 규칙] + [첨부 데이터 + 심어진 믿음 (cache_control)]. 대화 이력은 DB의 agent=odi 메시지. 성공한 호출만 횟수 차감.
- NPC: system = [공통 + 페르소나] + [시나리오 컨텍스트 (cache)] + [대화 상대·힌트 단계]. 이하늘은 공개된 단계까지의 힌트만 프롬프트에 들어감.
- 검토: 담당 팀장 페르소나 + answer_key + 함정 정의 → zod 스키마 `{decision, area, message, trap_caught[]}`.
- 모델: 전부 `claude-opus-5-5`. 이하늘만 `MODEL_MENTOR`로 교체 가능.

## 배포 (Railway)

- Node 20+. `npm run build` → `npm start`.
- 환경변수: `ANTHROPIC_API_KEY`, `PORT`(Railway가 줌), `CORS_ORIGIN`(Vercel 도메인), `DB_PATH`(volume 경로, 예 `/data/oreum.db`), `SCENARIOS_DIR`(레포 루트 기준 `../scenarios`이므로 모노레포 루트에서 빌드하거나 scenarios를 함께 배포)
- better-sqlite3는 12.x 고정 (13.x는 Node 22 이상만 지원, Node 20에서 세그폴트)
