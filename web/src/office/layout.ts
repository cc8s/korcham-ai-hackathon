import type { NpcId } from "../types";

// 사무실 타일 좌표 (타일 1칸 = 16px). Phaser 씬과 DOM 오버레이가 같이 쓴다.
// 그림은 tools/make_sprites.py 가 만든다. 자리를 옮기면 그 스크립트의 SEATS 도 같이 고칠 것 (preview 용)
export const TILE = 16;
export const COLS = 20;
export const ROWS = 13;

export type CharId = NpcId | "me";
export type CharState = "idle" | "thinking" | "talking" | "working";

// x,y = 캐릭터가 앉는 칸. 책상은 바로 아래 줄에 x-1..x+1 세 칸
export const SEATS: Record<CharId, { x: number; y: number; label: string }> = {
  kang: { x: 3, y: 3, label: "경영지원" },
  jung: { x: 10, y: 3, label: "무역" },
  park: { x: 16, y: 3, label: "영업" },
  lee: { x: 6, y: 9, label: "영업 (멘토)" },
  me: { x: 13, y: 9, label: "수습" },
};

// chars.png 에서 캐릭터 순서 (한 명당 2칸: 기본, 눈 감음). make_sprites.py 의 CHARS 순서와 같아야 한다
export const CHAR_ORDER: CharId[] = ["kang", "jung", "park", "lee", "me"];
