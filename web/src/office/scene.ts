import { COLS, ROWS, TILE, SEATS, CHAR_ORDER, type CharId, type CharState } from "./layout";

// Phaser 는 무거워서(1MB+) 오피스 화면에 들어올 때만 동적 import 한다. 여기서는 타입만 쓴다.
type PhaserLib = typeof import("phaser");
type Scene = import("phaser").Scene;
type Sprite = import("phaser").GameObjects.Sprite;
type Rectangle = import("phaser").GameObjects.Rectangle;
type Graphics = import("phaser").GameObjects.Graphics;
type Tween = import("phaser").Tweens.Tween;
type TimerEvent = import("phaser").Time.TimerEvent;

export interface OfficeHandle {
  setState: (id: CharId, state: CharState) => void;
  /** 게임 시각 (자정부터 분). 창밖 하늘, 바닥 볕, 실내 색조가 바뀐다 */
  setTime: (minutes: number) => void;
  destroy: () => void;
}

// monitor.png 칸: 0 꺼짐, 1 켜짐 A, 2 켜짐 B
const MON_OFF = 0;
const MON_A = 1;
const MON_B = 2;

// 캐릭터 한 칸 24x30. 자리 칸 기준 위치 (tools/make_sprites.py 의 CHAR_DX, CHAR_DY, CHAIR_DY 와 같아야 한다)
const CHAR_W = 24;
const CHAR_H = 30;
const CHAR_DX = -4;
const CHAR_DY = -9;
const CHAIR_DY = 4;

// room.png 의 창 위치 (make_sprites.py 의 WINDOWS_X, 폭 40)
const WINDOWS_X = [58, 140, 222];
const WALL_H = 38;

// 시각별 분위기. [분, 하늘색, 실내 덧칠 색, 덧칠 세기, 바닥 볕 세기, 볕 색]
type Mood = [number, number, number, number, number, number];
const MOODS: Mood[] = [
  [9 * 60, 0x9fd8f5, 0xfff0c0, 0.05, 0.2, 0xfff6d0],
  [12 * 60, 0x7cc4f0, 0xffffff, 0.0, 0.24, 0xffffff],
  [16 * 60, 0x9ccdf0, 0xffdca0, 0.06, 0.2, 0xfff0c0],
  [17 * 60 + 30, 0xf7a45c, 0xff9040, 0.16, 0.2, 0xffb060],
  [18 * 60 + 30, 0x8a5a96, 0x5a3c88, 0.22, 0.05, 0xc080a0],
  [20 * 60, 0x1c2444, 0x141c48, 0.34, 0.0, 0x404880],
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(c1: number, c2: number, t: number): number {
  const r = Math.round(lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t));
  const g = Math.round(lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t));
  const b = Math.round(lerp(c1 & 255, c2 & 255, t));
  return (r << 16) | (g << 8) | b;
}
function moodAt(minutes: number) {
  const m = Math.max(MOODS[0][0], Math.min(MOODS[MOODS.length - 1][0], minutes));
  let i = 0;
  while (i < MOODS.length - 2 && m > MOODS[i + 1][0]) i++;
  const a = MOODS[i];
  const b = MOODS[i + 1];
  const t = (m - a[0]) / (b[0] - a[0]);
  return { sky: mix(a[1], b[1], t), tint: mix(a[2], b[2], t), tintA: lerp(a[3], b[3], t), sunA: lerp(a[4], b[4], t), sun: mix(a[5], b[5], t) };
}

interface CharObj {
  sprite: Sprite;
  monitor: Sprite;
  frame: number; // 기본 칸. +1 이 눈 감은 칸
  baseY: number;
  tween?: Tween;
  timer?: TimerEvent;
}

export function createOfficeGame(Phaser: PhaserLib, parent: HTMLElement, baseUrl: string): OfficeHandle {
  const chars = new Map<CharId, CharObj>();
  const pending = new Map<CharId, CharState>();
  let scene: Scene | null = null;
  let sky: Rectangle | null = null;
  let tint: Rectangle | null = null;
  let sun: Graphics | null = null;
  let minutes = 9 * 60;

  const apply = (id: CharId, state: CharState) => {
    const ch = chars.get(id);
    if (!scene || !ch) return;
    ch.tween?.remove();
    ch.timer?.remove();
    ch.tween = undefined;
    ch.timer = undefined;
    ch.sprite.y = ch.baseY;
    ch.monitor.setFrame(MON_A);
    if (state === "idle") {
      // 숨쉬기: 느리게 1px
      ch.tween = scene.tweens.add({ targets: ch.sprite, y: ch.baseY + 1, duration: 1300, yoyo: true, repeat: -1, ease: "Stepped" });
    } else if (state === "working") {
      // 타이핑: 빠른 1px + 모니터 화면 바뀜
      ch.tween = scene.tweens.add({ targets: ch.sprite, y: ch.baseY + 1, duration: 150, yoyo: true, repeat: -1, ease: "Stepped" });
      let on = false;
      ch.timer = scene.time.addEvent({
        delay: 240,
        loop: true,
        callback: () => {
          on = !on;
          ch.monitor.setFrame(on ? MON_B : MON_A);
        },
      });
    } else if (state === "talking") {
      // 말하기: 2px 통통
      ch.tween = scene.tweens.add({ targets: ch.sprite, y: ch.baseY - 2, duration: 220, yoyo: true, repeat: -1, ease: "Sine.easeOut" });
    } else {
      // thinking: 멈춤 + 모니터 꺼짐. 말풍선 "…" 은 DOM 오버레이가 띄운다
      ch.monitor.setFrame(MON_OFF);
    }
  };

  const applyTime = () => {
    if (!sky || !tint || !sun) return;
    const m = moodAt(minutes);
    sky.setFillStyle(m.sky);
    tint.setFillStyle(m.tint, m.tintA);
    sun.clear();
    if (m.sunA > 0.01) {
      // 창마다 바닥에 비친 볕 (평행사변형). 오후로 갈수록 길어지고 오른쪽으로 눕는다
      const late = Math.max(0, Math.min(1, (minutes - 12 * 60) / (6 * 60)));
      const len = 30 + late * 26;
      const skew = 8 + late * 26;
      sun.fillStyle(m.sun, m.sunA);
      for (const wx of WINDOWS_X) {
        sun.fillPoints(
          [
            { x: wx + 2, y: WALL_H + 2 },
            { x: wx + 38, y: WALL_H + 2 },
            { x: wx + 38 + skew, y: WALL_H + 2 + len },
            { x: wx + 2 + skew, y: WALL_H + 2 + len },
          ],
          true,
        );
      }
    }
  };

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent,
    width: COLS * TILE,
    height: ROWS * TILE,
    pixelArt: true,
    backgroundColor: 0x7d98a3,
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    banner: false,
    audio: { noAudio: true },
    scene: {
      preload(this: Scene) {
        const dir = `${baseUrl}assets/oreum/`;
        this.load.image("room", dir + "room.png");
        this.load.image("desk", dir + "desk.png");
        this.load.image("chair", dir + "chair.png");
        this.load.spritesheet("monitor", dir + "monitor.png", { frameWidth: 14, frameHeight: 14 });
        this.load.spritesheet("chars", dir + "chars.png", { frameWidth: CHAR_W, frameHeight: CHAR_H });
      },
      create(this: Scene) {
        scene = this;
        // 하늘 → 배경(창 유리가 투명) → 바닥 볕 → 자리 → 실내 색조 순서로 쌓는다
        sky = this.add.rectangle(0, 0, COLS * TILE, WALL_H, 0x9fd8f5).setOrigin(0);
        this.add.image(0, 0, "room").setOrigin(0);
        sun = this.add.graphics();

        // 자리: 의자 → 캐릭터 → 책상 → 모니터 (뒤에서 앞 순서). 책상이 하체를 가린다
        CHAR_ORDER.forEach((id, i) => {
          const s = SEATS[id];
          const cy = s.y * TILE + CHAR_DY;
          this.add.image(s.x * TILE, s.y * TILE + CHAIR_DY, "chair").setOrigin(0);
          const sprite = this.add.sprite(s.x * TILE + CHAR_DX, cy, "chars", i * 2).setOrigin(0);
          this.add.image((s.x - 1) * TILE, (s.y + 1) * TILE - 2, "desk").setOrigin(0);
          const monitor = this.add.sprite((s.x - 1) * TILE + 2, (s.y + 1) * TILE - 11, "monitor", MON_A).setOrigin(0);
          const ch: CharObj = { sprite, monitor, frame: i * 2, baseY: cy };
          chars.set(id, ch);

          // 눈 깜빡임: 2~5초마다 120ms
          const blink = () => {
            sprite.setFrame(ch.frame + 1);
            this.time.delayedCall(120, () => sprite.setFrame(ch.frame));
            this.time.delayedCall(Phaser.Math.Between(2000, 5000), blink);
          };
          this.time.delayedCall(Phaser.Math.Between(500, 4000), blink);
        });

        tint = this.add.rectangle(0, 0, COLS * TILE, ROWS * TILE, 0xffffff, 0).setOrigin(0);
        applyTime();
        for (const id of CHAR_ORDER) apply(id, pending.get(id) ?? "idle");
      },
    },
  });

  return {
    setState(id, state) {
      pending.set(id, state);
      apply(id, state);
    },
    setTime(m) {
      minutes = m;
      applyTime();
    },
    destroy() {
      scene = null;
      sky = tint = sun = null;
      chars.clear();
      game.destroy(true);
    },
  };
}
