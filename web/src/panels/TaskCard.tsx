import { NPC_INFO, type NpcId, type TaskCard as TaskCardT } from "../types";

// P1 업무 카드 (티켓). 고정 텍스트
export function TaskCard(props: { card: TaskCardT; owner: NpcId; onOpenData: (file: string) => void }) {
  const npc = NPC_INFO[props.owner];
  return (
    <div className="panel-body prose">
      <h3>{props.card.title}</h3>
      <p className="tiny muted">
        요청: {npc.name} {npc.role} · 마감: {props.card.due}
      </p>
      <blockquote>{props.card.body}</blockquote>
      <p>
        <b>첨부</b>
      </p>
      <ul className="files">
        {props.card.attachments.map((f) => (
          <li key={f}>
            <button className="link" onClick={() => props.onOpenData(f)}>
              {f.replace(/^(data|_shared)\//, "")}
            </button>
          </li>
        ))}
      </ul>
      <p>
        <b>제출물 형식</b>
      </p>
      <p>{props.card.deliverable}</p>
    </div>
  );
}
