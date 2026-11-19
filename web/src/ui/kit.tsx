import type { NpcId } from "../types";

// 새 테마(ws.css)에서 쓰는 작은 부품: 선 아이콘, 이니셜 아바타

const PATHS = {
  home: "M4 11.5 12 4l8 7.5M6 10v9h12v-9M10 19v-5h4v5",
  task: "M9 4h6v3H9zM9 5.5H6V20h12V5.5h-3M9 12h6M9 16h4",
  spark: "M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9zM18.5 16l.7 2 .2.1 2 .7-2 .7-.2.2-.7 2-.7-2-.2-.2-2-.7 2-.7.2-.1z",
  table: "M4 5h16v14H4zM4 10h16M4 14.5h16M10 5v14",
  send: "M12 19V5M6 11l6-6 6 6",
  close: "M6 6l12 12M18 6 6 18",
  exit: "M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9",
  clip: "M19 11.5 12.5 18a4 4 0 0 1-5.7-5.7l7-7a2.7 2.7 0 0 1 3.8 3.8l-6.9 6.9a1.3 1.3 0 0 1-1.9-1.9l6.2-6.2",
  search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zM16 16l4.5 4.5",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  plus: "M12 5v14M5 12h14",
  clock: "M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18zM12 7.5V12l3 2",
  user: "M12 12a4 4 0 1 1 0-8 4 4 0 0 1 0 8zM4.5 20a7.5 7.5 0 0 1 15 0",
  file: "M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 16h5",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon(props: { name: IconName }) {
  return (
    <svg className="ws-ico" viewBox="0 0 24 24" aria-hidden="true">
      <path d={PATHS[props.name]} />
    </svg>
  );
}

const ME_COLOR = "#3f4650";

export function Avatar(props: { who: NpcId | "me" | "odi"; name?: string; size?: number }) {
  const size = props.size ?? 32;
  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };
  if (props.who === "odi") {
    return <img className="ws-avatar odi-img" style={box} src="/assets/ui/odi-avatar.svg" alt="" />;
  }
  // 팀원은 사진 (2026-11-19 Figma UI 적용 테스트, 생성형 이미지)
  if (props.who !== "me") {
    return <img className="ws-avatar photo" style={box} src={`/assets/ui/npc-${props.who}.jpg`} alt="" />;
  }
  const name = props.name ?? "나";
  const color = ME_COLOR;
  return (
    <span className="ws-avatar" style={{ ...box, background: color }}>
      {name.slice(0, 1)}
    </span>
  );
}
