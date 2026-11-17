# web — (주)오름 프론트 (Vite + React + TypeScript, Phaser 3)

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
| `src/panels/` | 패널 안은 사내 앱처럼 보인다. P1 TaskCard = 업무보드(이슈 트래커풍: 이슈 번호, 상태, 담당자·보고자, 첨부 카드), P2 OdiPanel·P3 NpcChat = 사내 메신저풍(프로필, 이름, 시각, 결과물로 담기, 힌트 버튼), P4 DataViewer = 스프레드시트풍 초록 테마(셀 선택, 수식줄, 정렬 버튼, 시트 탭, 열람 기록). Face = 캐릭터 시트에서 얼굴만 잘라 쓰는 프로필 사진. 실제 제품 로고·이름은 쓰지 않는다 |
| `src/screens/Office.tsx` | 오피스 화면. 왼쪽 사이드바(게임 시계, 메뉴, 팀원, 남은 횟수, 제출) + 사무실 + 오른쪽 패널 |
| `src/office/OfficeStage.tsx` | 사무실. Phaser 캔버스(그림·움직임·시간대) 위에 DOM 오버레이(한글 이름표·말풍선·클릭). Phaser 는 이 화면에서만 동적 import, 실패하면 DOM 자리 표시로 대체 |
| `src/office/scene.ts` | Phaser 씬. 20x13 타일(320x208)을 FIT 확대. 하늘 → room.png(창 유리 투명) → 바닥 볕 → 의자·캐릭터·책상·모니터 → 실내 색조 순서로 쌓는다. 상태별 움직임과 눈 깜빡임, `setTime(분)` 으로 시간대 변화 |
| `src/office/layout.ts` | 자리 좌표(SEATS)와 chars.png 칸 순서(CHAR_ORDER). 씬과 오버레이가 같이 씀 |
| `src/index.css` | 픽셀 게임 메뉴풍 테마 (종이색 패널, 굵은 테두리, 각진 그림자). 틀은 Galmuri, 긴 글은 본문 글꼴 |
| `public/assets/oreum/` | 자체 제작 픽셀 아트 (스타듀밸리풍). `tools/make_sprites.py` 가 생성. 설명은 `public/assets/CREDITS.md` |
| `tools/make_sprites.py` | 스프라이트 생성기 (Python + Pillow). 색·머리 모양·가구를 여기서 고치고 다시 실행 |
| `src/sample_report.ts` | S6 "샘플 리포트 보기"용 고정 리포트 (06 문서 예시) |

## 동작 메모

- 게임 시계: 09:00 출근, 현실 1초 = 게임 30초 (현실 18분이면 18:00). 창밖 하늘·바닥 볕·실내 색조가 낮 → 노을 → 밤으로 바뀐다. 연출용이라 서버는 모르고 마감을 넘겨도 불이익 없음. 주소에 `?clock=1050` 을 붙이면 그 시각(자정부터 분)으로 고정 (데모·확인용)
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
- React 19, TypeScript 7, Phaser 3.90 (별도 청크 1.5MB, gzip 340kB. 오피스 진입 시 로드)
