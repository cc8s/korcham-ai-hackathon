# web — (주)오름 프론트 (Vite + React + TypeScript, Phaser 예정)

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
| `src/panels/` | P1 TaskCard, P2 OdiPanel(마크다운 표, 결과물로 담기), P4 DataViewer(CSV 정렬·검색, 열람 기록), P3 NpcChat(이하늘 힌트 버튼) |
| `src/office/OfficeStage.tsx` | 사무실. 지금은 DOM 으로 책상·캐릭터·말풍선. Phaser 씬으로 교체 예정 (좌표는 % → 타일로) |
| `src/sample_report.ts` | S6 "샘플 리포트 보기"용 고정 리포트 (06 문서 예시) |

## 동작 메모

- 무응답 3분이면 이하늘 말풍선 "막혔어요?" (프론트 타이머, LLM 호출 없음, 시나리오당 2회)
- 시나리오 첫 진입 시 담당 팀장 말풍선 "잠깐 봅시다." + 업무 카드 자동 오픈
- 데이터 뷰어는 열람·첫 정렬·첫 검색을 서버에 기록 (평가 B축)
- 오디 호출 0회가 되면 입력창 대신 "지금까지 결과로 제출하세요"
- 리포트 화면은 서버가 501 이면 "다음 단계에서 열립니다" 표시

## 배포 (Vercel)

- Root Directory `web`, Build `npm run build`, Output `dist`
- 환경변수 `VITE_API_BASE=https://<railway 도메인>`
- 서버 쪽 `CORS_ORIGIN` 에 Vercel 도메인 추가

## 도구 버전

- 로컬 Node 20.17 → Vite 6 고정 (Vite 7·8은 Node 20.19 이상). Node 를 22 로 올리면 Vite 8 로 올려도 됨
- React 19, TypeScript 7, Phaser 3.90 (아직 미사용)
