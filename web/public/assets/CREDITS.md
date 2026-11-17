# 에셋 출처

그림은 외부 에셋 없음. `oreum/` 의 PNG 는 전부 `web/tools/make_sprites.py` 가 직접 찍어서 만든 자체 제작물이다.

| 파일 | 내용 |
|---|---|
| `oreum/room.png` | 배경 320x208 (카펫 타일, 벽, 블라인드 창과 먼 빌딩, 간판, 복합기, 캐비닛, 정수기, 칸막이, 회의 테이블, 화분). 창 유리는 투명 |
| `oreum/chars.png` | 캐릭터 5명 x 2칸 (기본, 눈 감음). 한 칸 24x30, 2등신, 오피스룩 |
| `oreum/desk.png`, `chair.png` | 책상 48x24, 의자 16x18 |
| `oreum/monitor.png` | 모니터 14x14 x 3칸 (꺼짐, 켜짐 A, 켜짐 B) |
| `oreum/icons.png` | 사이드바 아이콘 12x12 x 6칸 (업무, 오디, 자료, 팀원, 제출, 나가기) |
| `oreum/preview.png`, `preview_chars.png` | 확인용 합성본·캐릭터 확대본 (앱에서는 안 씀) |

- 다시 만들기: `cd web && python tools/make_sprites.py` (Pillow 필요). 색·자리·머리 모양·옷은 스크립트 안에서 고친다.
- 화풍은 스타듀밸리류의 색감과 SD(2등신) 도트 캐릭터의 문법(굵은 외곽선, 큰 머리, 세로로 긴 눈)을 참고했다. 기존 게임·작가의 스프라이트를 베끼거나 가져온 것은 없다.

## 글꼴

| 이름 | 용도 | 제작 | 라이선스 | 받은 곳 |
|---|---|---|---|---|
| Galmuri11, Galmuri14 | UI 틀 (제목·버튼·라벨·이름표) | quiple | SIL Open Font License 1.1 | npm `galmuri` (https://github.com/quiple/galmuri) |

OFL 은 CC0 가 아니다. 사용·번들·재배포는 자유지만 글꼴 파일만 따로 팔 수 없고, 라이선스 고지를 함께 둬야 한다. 제출용 외부 자원 표(01 문서)에 기재했다.
