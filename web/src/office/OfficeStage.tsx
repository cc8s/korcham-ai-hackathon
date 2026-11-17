import { NPC_INFO, type NpcId } from "../types";

export type CharStatus = { state: "idle" | "thinking" | "talking" | "working"; bubble?: string };

// 픽셀 오피스 자리. Phaser 씬이 들어오기 전까지 DOM 으로 같은 레이아웃을 그린다.
// 좌표는 % 라 Phaser 로 바꿀 때 타일 좌표로 치환.
const DESKS: Record<NpcId | "me", { x: number; y: number; label: string }> = {
  kang: { x: 18, y: 22, label: "경영지원" },
  jung: { x: 50, y: 22, label: "무역" },
  park: { x: 82, y: 22, label: "영업" },
  lee: { x: 36, y: 66, label: "영업 (멘토)" },
  me: { x: 64, y: 66, label: "수습" },
};

export function OfficeStage(props: {
  nickname: string;
  status: Record<NpcId | "me", CharStatus>;
  owner: NpcId;
  onClickNpc: (id: NpcId) => void;
}) {
  const ids: (NpcId | "me")[] = ["kang", "jung", "park", "lee", "me"];
  return (
    <div className="stage">
      {ids.map((id) => {
        const d = DESKS[id];
        const s = props.status[id];
        const isMe = id === "me";
        const info = isMe ? { name: props.nickname, color: "#8a8f98", role: "" } : NPC_INFO[id];
        return (
          <div
            key={id}
            className={`char ${isMe ? "me" : "npc"} ${s.state} ${!isMe && id === props.owner ? "owner" : ""}`}
            style={{ left: `${d.x}%`, top: `${d.y}%` }}
            onClick={() => !isMe && props.onClickNpc(id)}
            title={isMe ? "나" : `${info.name} ${info.role}`}
          >
            {(s.bubble || s.state === "thinking") && <div className="bubble">{s.state === "thinking" ? "…" : s.bubble}</div>}
            <div className="desk">
              <div className="monitor" />
            </div>
            <div className="sprite" style={{ background: info.color }}>
              {info.name[0]}
            </div>
            <div className="nameplate">
              {info.name}
              <span className="tiny muted"> {d.label}</span>
            </div>
          </div>
        );
      })}
      <div className="stage-hint tiny muted">캐릭터를 클릭하면 대화 · 팀장에게 질문 · 이하늘에게 힌트</div>
    </div>
  );
}
