import { useEffect, useRef, useState, type CSSProperties } from "react";
import { NPC_INFO, type NpcId } from "../types";
import { COLS, ROWS, SEATS, type CharId, type CharState } from "./layout";
import type { OfficeHandle } from "./scene";

export type CharStatus = { state: CharState; bubble?: string };

const IDS: CharId[] = ["kang", "jung", "park", "lee", "me"];
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

// 픽셀 오피스. 그림(배경·캐릭터·움직임·시간대)은 Phaser 캔버스, 한글(이름표·말풍선)과 클릭은 그 위 DOM.
// 캔버스가 320x208 을 확대하는 방식이라 글자를 캔버스에 그리면 뭉개져서 나눴다.
export function OfficeStage(props: {
  nickname: string;
  status: Record<CharId, CharStatus>;
  owner: NpcId;
  /** 게임 시각 (자정부터 분) */
  minutes: number;
  onClickNpc: (id: NpcId) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const handle = useRef<OfficeHandle | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const [{ default: Phaser }, { createOfficeGame }] = await Promise.all([import("phaser"), import("./scene")]);
        if (dead || !host.current) return;
        const h = createOfficeGame(Phaser, host.current, import.meta.env.BASE_URL);
        handle.current = h;
        for (const id of IDS) h.setState(id, latest.current.status[id].state);
        h.setTime(latest.current.minutes);
      } catch (e) {
        console.error("픽셀 오피스 로드 실패", e);
        setFailed(true);
      }
    })();
    return () => {
      dead = true;
      handle.current?.destroy();
      handle.current = null;
    };
  }, []);

  const states = IDS.map((id) => props.status[id].state).join(",");
  useEffect(() => {
    for (const id of IDS) handle.current?.setState(id, latest.current.status[id].state);
  }, [states]);

  useEffect(() => {
    handle.current?.setTime(props.minutes);
  }, [props.minutes]);

  const innerStyle = { aspectRatio: `${COLS} / ${ROWS}`, "--ratio": COLS / ROWS } as CSSProperties;

  return (
    <div className="stage">
      <div className="stage-inner" style={innerStyle}>
        <div className="stage-canvas" ref={host} />
        {IDS.map((id) => {
          const seat = SEATS[id];
          const s = props.status[id];
          const isMe = id === "me";
          const info = isMe ? { name: props.nickname, role: "" } : NPC_INFO[id];
          const isOwner = !isMe && id === props.owner;
          const bubble = s.state === "thinking" ? "…" : s.bubble;
          return (
            <div
              key={id}
              className={`char ${isMe ? "me" : "npc"} ${isOwner ? "owner" : ""} ${failed ? "fallback" : ""}`}
              style={{ left: pct(seat.x - 1, COLS), top: pct(seat.y, ROWS), width: pct(3, COLS), height: pct(2, ROWS) }}
              onClick={() => !isMe && props.onClickNpc(id as NpcId)}
              title={isMe ? "나" : `${info.name} ${info.role} · 클릭해서 대화`}
            >
              {bubble && <div className="bubble">{bubble}</div>}
              <div className="nameplate">
                {info.name}
                <span className="sub"> {seat.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
