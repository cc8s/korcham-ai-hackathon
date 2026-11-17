import { NPC_INFO, type NpcId, type RunState, type TaskCard as TaskCardT } from "../types";
import { RUN_STATUS } from "../screens/OfficeHome";
import { Avatar, Icon } from "../ui/kit";

// P1 업무 카드. 내용은 시나리오 고정 텍스트
export function TaskCard(props: {
  card: TaskCardT;
  owner: NpcId;
  issueKey: string;
  state: RunState;
  nickname: string;
  label: string;
  onOpenData: (file: string) => void;
}) {
  const npc = NPC_INFO[props.owner];
  const st = RUN_STATUS[props.state];
  return (
    <div className="ws-panel-body">
      <div className="ws-scroll">
        <span className="ws-doc-key">{props.issueKey}</span>
        <h3 className="ws-doc-title">{props.card.title}</h3>
        <span className={`ws-tag ${st.tone}`}>{st.label}</span>

        <dl className="ws-fields">
          <dt>담당자</dt>
          <dd>
            <Avatar who="me" name={props.nickname} size={20} /> {props.nickname}
          </dd>
          <dt>요청자</dt>
          <dd>
            <Avatar who={props.owner} size={20} /> {npc.name} <small>{npc.role}</small>
          </dd>
          <dt>우선순위</dt>
          <dd>
            <span className="ws-tag warn">높음</span>
          </dd>
          <dt>기한</dt>
          <dd>{props.card.due}</dd>
          <dt>분류</dt>
          <dd>
            <span className="ws-tag">{props.label}</span>
          </dd>
        </dl>

        <h4 className="ws-h">설명</h4>
        <div className="ws-prose">{props.card.body}</div>

        <h4 className="ws-h">첨부 파일 {props.card.attachments.length}</h4>
        <div className="ws-files">
          {props.card.attachments.map((f) => {
            const name = f.replace(/^(data|_shared)\//, "");
            const ext = name.split(".").pop() ?? "";
            return (
              <button key={f} className="ws-file" onClick={() => props.onOpenData(f)} title="첨부 데이터에서 열기">
                <Icon name={ext === "csv" ? "table" : "file"} />
                <span>{name}</span>
                <span className="ws-tag">{ext.toUpperCase()}</span>
              </button>
            );
          })}
        </div>

        <h4 className="ws-h">완료 조건</h4>
        <div className="ws-prose">{props.card.deliverable}</div>
      </div>
    </div>
  );
}
