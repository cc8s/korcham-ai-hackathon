import { NPC_INFO, type NpcId, type RunState, type TaskCard as TaskCardT } from "../types";
import { Face } from "./Face";

const STATUS: Record<RunState, { label: string; tone: "todo" | "doing" | "done" | "blocked" }> = {
  assigned: { label: "할 일", tone: "todo" },
  working: { label: "진행 중", tone: "doing" },
  reviewing: { label: "검토 중", tone: "doing" },
  rejected: { label: "반려됨", tone: "blocked" },
  approved: { label: "완료", tone: "done" },
  evaluated: { label: "완료", tone: "done" },
};

// P1 업무 카드. 사내 업무보드(이슈 트래커) 화면처럼 보여 준다. 내용은 시나리오 고정 텍스트
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
  const st = STATUS[props.state];
  return (
    <div className="panel-body app jira">
      <div className="jira-crumb">
        <span>오름 업무보드</span>
        <span>/</span>
        <span className="jira-type" title="작업" />
        <span className="jira-key">{props.issueKey}</span>
      </div>
      <h3 className="jira-title">{props.card.title}</h3>
      <div className="jira-actions">
        <span className={`jira-status ${st.tone}`}>{st.label}</span>
      </div>

      <dl className="jira-fields">
        <dt>담당자</dt>
        <dd>
          <Face who="me" size={20} /> {props.nickname}
        </dd>
        <dt>보고자</dt>
        <dd>
          <Face who={props.owner} size={20} /> {npc.name} <span className="sub">{npc.role}</span>
        </dd>
        <dt>우선순위</dt>
        <dd>
          <span className="jira-prio" /> 높음
        </dd>
        <dt>기한</dt>
        <dd>{props.card.due}</dd>
        <dt>레이블</dt>
        <dd>
          <span className="jira-label">{props.label}</span>
        </dd>
      </dl>

      <h4>설명</h4>
      <div className="jira-desc">{props.card.body}</div>

      <h4>
        첨부 파일 <span className="jira-count">{props.card.attachments.length}</span>
      </h4>
      <div className="jira-files">
        {props.card.attachments.map((f) => {
          const name = f.replace(/^(data|_shared)\//, "");
          const ext = name.split(".").pop() ?? "";
          return (
            <button key={f} className="jira-file" onClick={() => props.onOpenData(f)} title="첨부 데이터에서 열기">
              <span className={`jira-ext ${ext}`}>{ext.toUpperCase()}</span>
              <span className="jira-fname">{name}</span>
            </button>
          );
        })}
      </div>

      <h4>완료 조건</h4>
      <div className="jira-desc plain">{props.card.deliverable}</div>
    </div>
  );
}
