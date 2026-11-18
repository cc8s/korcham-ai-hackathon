# web — (주)오름 프론트 (Vite + React + TypeScript)

04 문서의 화면을 그대로 구현한다. S0 입장 → S1 온보딩 → S6 배치표 → S2 오피스(+패널 4개) → S3 제출 → S4 검토 → S5 리포트.

## 실행

```bash
cd web
npm install
cp .env.example .env         # VITE_API_BASE (기본 http://localhost:8787)
npm run dev                  # :5173
```

서버는 `server/` 에서 `npm run dev` (키 있으면) 또는 `LLM_MOCK=1 npm run dev` (키 없이, 가짜 응답).

- `npm run typecheck` — tsc
- `npm run build` — Vercel 이 이 명령으로 빌드
- `npm run test:api` — mock 서버를 띄워 API 클라이언트로 S0→S5 흐름 재현 (server 의존성 필요: `npm ci --prefix ../server`)

## 구조

| 경로 | 역할 |
|---|---|
| `src/App.tsx` | 화면 상태 머신. localStorage 에 session·run 저장 → 새로고침 복구 |
| `src/api.ts` | 서버 클라이언트. `odiStream` 이 SSE 파서, `connectEvents` 가 WS (끊기면 2초 후 재연결) |
| `src/types.ts` | 서버 응답 타입, NPC 이름·색 |
| `src/screens/` | S0 Enter, S1 Onboarding, S6 Select, S2 Office, S3 Submit, S4 Review, S5 Report |
| `src/panels/` | 오른쪽 패널 4종. P1 TaskCard(문서 번호, 상태, 담당자·요청자, 첨부), P2 OdiPanel·P3 NpcChat(대화, 결과물로 담기, 힌트 버튼), P4 DataViewer(파일 탭, 찾기, 열 제목 정렬, 열람 기록) |
| `src/screens/Office.tsx` | 사무실 화면. 왼쪽 사이드바(메뉴, 팀원, 사용량, 제출) + 홈 + 오른쪽 패널. 서버 이벤트를 받아 팀원 상태를 갱신 |
| `src/screens/OfficeHome.tsx` | 홈. 오늘 업무 카드(상태, 진행 단계), 팀원 목록(자리에 있음·답변 작성 중·방금 한 말), 최근 활동, 팀원이 말을 걸 때 뜨는 알림 |
| `src/ui/kit.tsx` | 선 아이콘(SVG 경로)과 이니셜 아바타 |
| `src/ws.css` | 테마 전체. 흰 카드, 1px 선, 초록 강조색 하나, Pretendard. 클래스는 모두 `ws-` 로 시작 |
| `public/assets/CREDITS.md` | 글꼴 출처. 그림 에셋은 없다 |
| `src/sample_report.ts` | S6 "샘플 리포트 보기"용 고정 리포트 (06 문서 예시) |

## 동작 메모

- 무응답 3분이면 이하늘이 먼저 말을 건다 "막혔어요?" (홈의 팀원 행과 알림, 프론트 타이머, LLM 호출 없음, 시나리오당 2회)
- 시나리오 첫 진입 시 담당 팀장 알림 "잠깐 봅시다." + 업무 카드 자동 오픈
- 데이터 뷰어는 열람·첫 정렬·첫 검색을 서버에 기록 (평가 B축)
- 오디 호출 0회가 되면 입력창 대신 "지금까지 결과로 제출하세요"
- 리포트 화면은 평가가 실패해 코드 점수만 있으면 "부분 리포트" 표시 (다시 열면 재시도), 등급 상한이 걸리면 그 이유 표시

## 배포 (Vercel)

- Root Directory `web`, Framework Vite, Build `npm run build`, Output `dist`
- 환경변수 `VITE_API_BASE=https://<railway 도메인>` (끝에 / 없이). 빌드 때 박히는 값이라 바꾸면 재배포
- 서버 쪽 `CORS_ORIGIN` 에 Vercel 도메인 추가 (예 `https://xxx.vercel.app`, 쉼표로 여러 개)

## 도구 버전

- 로컬 Node 20.17 → Vite 6 고정 (Vite 7·8은 Node 20.19 이상). Node 를 22 로 올리면 Vite 8 로 올려도 됨
- React 19, TypeScript 7. 글꼴은 npm `pretendard` 의 dynamic subset (글자 범위별 woff2 를 필요한 것만 받음)
