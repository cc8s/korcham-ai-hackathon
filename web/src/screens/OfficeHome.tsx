import { NPC_INFO, type Message, type NpcId, type RunInfo, type RunState } from "../types";
import { Avatar, Icon } from "../ui/kit";
import { hhmm } from "../panels/OdiPanel";

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

const STEPS = ["업무 확인", "오디와 작업", "제출", "팀장 검토", "완료"];
const STEP_OF: Record<RunState, number> = { assigned: 0, working: 1, rejected: 1, reviewing: 3, approved: 5, evaluated: 5 };

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
  const step = STEP_OF[run.state];
  const recent = props.messages.slice(-6).reverse();
  const speaking = props.npcOrder.find((id) => props.status[id].state === "talking" && props.status[id].bubble);

  return (
    <>
      <div className="ws-home">
        <header className="ws-hello">
          <h1>{props.nickname} 님, 오늘 업무가 도착했어요</h1>
          <p>
            {NPC_INFO[owner].name} {NPC_INFO[owner].role.replace(/ \(.*\)$/, "")}이 맡긴 일입니다. 오디와 함께 처리하고, 결과는 직접 검증해서 제출하세요.
          </p>
        </header>

        <section className="ws-card">
          <div className="ws-card-head">
            <h2>오늘 업무</h2>
            <span className={`ws-tag ${st.tone}`}>{st.label}</span>
          </div>
          <h3 className="ws-task-title">{card.title}</h3>
          <div className="ws-task-meta">
            <span>
              <Icon name="clock" />
              {card.due}
            </span>
            <span>
              <Icon name="user" />
              {NPC_INFO[owner].name} 요청
            </span>
            <span>
              <Icon name="clip" />
              첨부 {card.attachments.length}개
            </span>
          </div>
          <div className="ws-task-actions">
            <button className="ws-btn primary" onClick={props.onOpenOdi}>
              <Icon name="spark" />
              오디에게 맡기기
            </button>
            <button className="ws-btn" onClick={props.onOpenTask}>
              업무 카드 보기
            </button>
            <button className="ws-btn" onClick={() => props.onOpenData(card.attachments[0])}>
              첨부 데이터 열기
            </button>
          </div>
          <div className="ws-steps">
            {STEPS.map((s, i) => (
              <div key={s} className={`ws-step ${i < step ? "done" : i === step ? `now ${run.state === "rejected" ? "warn" : ""}` : ""}`}>
                {i === step && run.state === "rejected" ? "보완 중" : s}
              </div>
            ))}
          </div>
        </section>

        <div className="ws-cols">
          <section className="ws-card">
            <div className="ws-card-head">
              <h2>팀원</h2>
            </div>
            <div className="ws-rows">
              {props.npcOrder.map((id) => {
                const s = props.status[id];
                const live = s.state === "thinking" || (s.state === "talking" && !!s.bubble);
                const sub = s.state === "thinking" ? "답변 작성 중…" : s.state === "talking" && s.bubble ? s.bubble : NPC_INFO[id].role;
                return (
                  <button key={id} className={`ws-row ${live ? "live" : ""}`} onClick={() => props.onOpenNpc(id)}>
                    <span className={`ws-presence ${s.state === "thinking" ? "busy" : ""}`}>
                      <Avatar who={id} size={36} />
                    </span>
                    <span className="ws-row-main">
                      <b>{NPC_INFO[id].name}</b>
                      <span className="ws-row-sub">{sub}</span>
                    </span>
                    {id === owner && <span className="ws-tag accent">담당</span>}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="ws-card">
            <div className="ws-card-head">
              <h2>최근 활동</h2>
            </div>
            {recent.length === 0 ? (
              <p className="ws-empty">아직 활동이 없어요. 업무 카드를 읽고 오디에게 첫 지시를 내려 보세요.</p>
            ) : (
              <div className="ws-rows">
                {recent.map((m) => {
                  const agent = m.agent as NpcId | "odi";
                  const agentName = agent === "odi" ? "오디" : NPC_INFO[agent]?.name ?? m.agent;
                  const mine = m.role === "user";
                  return (
                    <button key={m.id} className="ws-row" onClick={() => (agent === "odi" ? props.onOpenOdi() : props.onOpenNpc(agent))}>
                      <Avatar who={mine ? "me" : agent} name={props.nickname} size={28} />
                      <span className="ws-row-main">
                        <b>{mine ? `${agentName}에게` : agentName}</b>
                        <span className="ws-row-sub">{m.content.replace(/\s+/g, " ").slice(0, 80)}</span>
                      </span>
                      <time>{hhmm(m.at)}</time>
                    </button>
                  );
                })}
              </div>
            )}
          </section>
        </div>
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
