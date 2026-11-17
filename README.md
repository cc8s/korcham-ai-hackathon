# AI 가상 회사 업무 시뮬레이션

2026 대한민국 청년 CAREER FAIR AI 해커톤 (주관: 대한상공회의소) 출품작.

> 기업은 이미 AI 회사를 굴리기 시작했다. 그 안에서 일해 본 청년은 없다.

## 무엇인가

AI 직원(NPC 에이전트)으로 이루어진 가상 회사에 신입으로 입사해,
대한상공회의소 자격증별 실무 업무를 사내 AI 비서를 활용해 처리하고,
끝나면 **"AI를 어떻게 활용했는가"**까지 평가받는 훈련 서비스.

- 사내 업무 도구처럼 생긴 화면에서 팀장·동료·거래처 NPC가 업무를 던지고 피드백
- 자격증별 업무 시나리오 5개 (컴활, 전산회계운용사, 유통관리사, 무역영어, 비서)
- 시나리오 데이터에 일부러 심은 오류를 사용자가 잡아내는지 평가
- 종료 후 AI 활용 역량 리포트

## 구조

```
[브라우저: React 업무 화면 (홈 + 패널), Vercel]
        │
[백엔드 서버: Node, Railway]  ← API 키는 서버 환경변수에만
        │
[Claude API]  ← NPC / AI 비서 / 평가 에이전트, system prompt만 다름
```

## 문서

기획·설계 문서는 레포 밖(로컬·노션)에서 관리한다.

- [시나리오](scenarios/README.md) — 자격증별 시나리오 5개 폴더 (데이터·프롬프트·정답)
- [server/](server/README.md) — Node 백엔드 실행·API
- [web/](web/README.md) — React 프론트 실행·화면 구조

## 일정

- 제출 마감: 2026-11-23 (월) 17:00
- 본선 진출 발표: 2026-11-30 (월)
- 본선: 2026-12-07 (월)

## 라이선스 / 출처

- 그림 에셋: 없음 (아이콘은 직접 그린 SVG, 프로필은 이름 첫 글자)
- 글꼴: Pretendard (SIL OFL 1.1)
- 개념 참고: [Paperclip](https://github.com/paperclipai/paperclip), [Pixel Agents](https://github.com/pablodelucca/pixel-agents) — 코드 미사용
