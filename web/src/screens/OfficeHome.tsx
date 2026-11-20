import { NPC_INFO, type Message, type NpcId, type RunInfo, type RunState } from "../types";
import { Avatar } from "../ui/kit";
import { hhmm } from "../panels/OdiPanel";

// 업무 카드의 분류 (시나리오 → 연계 자격증)
export const CERT_LABEL: Record<string, string> = { "01": "컴퓨터활용능력", "02": "전산회계운용사", "03": "유통관리사", "04": "무역영어", "05": "비서" };

export type CharState = "idle" | "thinking" | "talking" | "working";
export type CharStatus = { state: CharState; bubble?: string };

export const RUN_STATUS: Record<RunState, { label: string; tone: "" | "info" | "accent" | "warn" }> = {
  assigned: { label: "할 일", tone: "" },
  working: { label: "진행 중", tone: "info" },
  reviewing: { label: "검토 중", tone: "info" },
  rejected: { label: "반려됨", tone: "warn" },
  approved: { label: "완료", tone: "accent" },
  evaluated: { label: "완료", tone: "accent" },
};


// 사무실 홈. 오늘 업무 요약, 팀원 상태, 최근 활동. 서버 이벤트로 바뀌는 팀원 상태는 행의 한 줄로 보여 준다
export function OfficeHome(props: {
  nickname: string;
  info: RunInfo;
  messages: Message[];
  status: Record<NpcId | "me", CharStatus>;
  npcOrder: NpcId[];
  onOpenTask: () => void;
  onOpenOdi: () => void;
  onOpenData: (file: string) => void;
  onOpenNpc: (id: NpcId) => void;
}) {
  const { run, scenario, task_card: card } = props.info;
  const owner = scenario.owner_npc_id;
  const st = RUN_STATUS[run.state];
  const recent = props.messages.slice(-6).reverse();
  const speaking = props.npcOrder.find((id) => props.status[id].state === "talking" && props.status[id].bubble);

  return (
    <>
      <div className="ws-home sk-home">
        <header className="sk-hello">
          <h1 className="sk-display">{props.nickname} 님, 오늘 업무가 도착했어요</h1>
          <p>오디와 맡은 업무를 처리하고, 결과는 직접 검증해서 제출하세요!</p>
        </header>

        <section className="sk-task">
          <div className="sk-task-row">
            <div className="sk-task-main">
              <div className="sk-task-tags">
                <span className="sk-cert">{CERT_LABEL[scenario.id] ?? "수습 과제"}</span>
                {run.state !== "assigned" && <span className={`sk-state ${st.tone}`}>{st.label}</span>}
              </div>
              <h2 className="sk-display">{card.title}</h2>
              <div className="sk-task-meta">
                <span>
                  <img src="/assets/ui/ic-user.svg" width={18} height={18} alt="" />
                  {NPC_INFO[owner].name} {NPC_INFO[owner].role}
                </span>
                <span>
                  <img src="/assets/ui/ic-clock.svg" width={18} height={18} alt="" />
                  {card.due}
                </span>
              </div>
            </div>
            <button className="sk-btn lg sk-odi-btn" onClick={props.onOpenOdi}>
              <img src="/assets/ui/ic-odi-btn.svg?v=3" width={23} height={24} alt="" />
              오디와 함께하기
            </button>
          </div>
          <div className="sk-task-links">
            <button className="sk-link" onClick={props.onOpenTask}>
              <img src="/assets/ui/ic-clipboard.svg" width={18} height={18} alt="" />
              업무 내용 보기
            </button>
            {card.attachments.map((f) => (
              <button key={f} className="sk-link file" onClick={() => props.onOpenData(f)}>
                <img src="/assets/ui/ic-paperclip.svg" width={18} height={18} alt="" />
                {f.replace(/^data\//, "")}
              </button>
            ))}
          </div>
        </section>

        <section className="sk-recent">
          <h2>최근 활동</h2>
          {recent.length === 0 ? (
            <p className="sk-empty">아직 활동이 없어요. 하늘 선배에게 인사하고, 팀장님 지시를 받아 보세요.</p>
          ) : (
            <div className="sk-recent-list">
              {recent.map((m) => {
                const agent = m.agent as NpcId | "odi";
                const agentName = agent === "odi" ? "AI오디" : NPC_INFO[agent]?.name ?? m.agent;
                const mine = m.role === "user";
                return (
                  <button key={m.id} className="sk-recent-row" onClick={() => (agent === "odi" ? props.onOpenOdi() : props.onOpenNpc(agent))}>
                    <Avatar who={mine ? "me" : agent} name={props.nickname} size={34} />
                    <span className="sk-recent-main">
                      <b>{mine ? `${agentName}에게` : agentName}</b>
                      <span>{m.content.replace(/\s+/g, " ").slice(0, 120)}</span>
                    </span>
                    <time>{hhmm(m.at)}</time>
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {speaking && (
        <button className="ws-toast" onClick={() => props.onOpenNpc(speaking)}>
          <Avatar who={speaking} size={28} />
          <span>
            <b>{NPC_INFO[speaking].name}</b>
            {props.status[speaking].bubble}
          </span>
        </button>
      )}
    </>
  );
}
