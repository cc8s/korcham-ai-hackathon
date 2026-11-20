import { useCallback, useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { NPC_INFO, type Flow, type Message, type NpcId, type PixelEvent, type RunInfo } from "../types";
import { OfficeHome, CERT_LABEL, type CharStatus } from "./OfficeHome";
import { Avatar, Icon } from "../ui/kit";
import { TaskCard } from "../panels/TaskCard";
import { OdiPanel } from "../panels/OdiPanel";
import { DataViewer } from "../panels/DataViewer";
import { NpcChat } from "../panels/NpcChat";

type Panel = "task" | "odi" | "data" | "npc" | null;
const IDLE_MS = 3 * 60 * 1000;
const NPC_ORDER: NpcId[] = ["kang", "jung", "park", "lee"];

function Quota(props: { label: string; used: number; total: number; warn?: boolean }) {
  return (
    <div className="ws-quota-row">
      <span>{props.label}</span>
      <div className={`ws-bar ${props.warn ? "warn" : ""}`}>
        <i style={{ width: `${Math.min(100, (props.used / props.total) * 100)}%` }} />
      </div>
      <em>
        {props.used}/{props.total}
      </em>
    </div>
  );
}

// S2 사무실: 왼쪽 사이드바(메뉴·팀원·사용량) + 홈 + 오른쪽 패널
export function Office(props: {
  runId: string;
  nickname: string;
  onSubmit: () => void;
  onClosed: (owner: NpcId) => void;
  onLeave: () => void;
}) {
  const [info, setInfo] = useState<RunInfo | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [npc, setNpc] = useState<NpcId>("lee");
  const [dataFile, setDataFile] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<NpcId | "me", CharStatus>>({
    kang: { state: "idle" },
    park: { state: "idle" },
    jung: { state: "idle" },
    lee: { state: "idle" },
    me: { state: "idle" },
  });
  const idlePokes = useRef(0);
  const idleTimer = useRef<number | null>(null);
  const bubbleTimers = useRef<Partial<Record<NpcId | "me", number>>>({});

  const setChar = useCallback((id: NpcId | "me", s: CharStatus, autoClearMs?: number) => {
    setStatus((prev) => ({ ...prev, [id]: s }));
    const t = bubbleTimers.current[id];
    if (t) window.clearTimeout(t);
    if (autoClearMs) {
      bubbleTimers.current[id] = window.setTimeout(() => setStatus((prev) => ({ ...prev, [id]: { state: "idle" } })), autoClearMs);
    }
  }, []);

  // 무응답 3분 → 이하늘이 먼저 말을 건다 (LLM 호출 없음). 시나리오당 2회
  const touch = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (idlePokes.current < 2) {
        idlePokes.current += 1;
        setChar("lee", { state: "talking", bubble: `${props.nickname} 씨, 막혔어요?` }, 8000);
      }
    }, IDLE_MS);
  }, [props.nickname, setChar]);

  // 초기 로드 + 진입 연출
  useEffect(() => {
    let alive = true;
    api.getRun(props.runId).then((r) => {
      if (!alive) return;
      setInfo(r);
      setMessages(r.messages);
      if (r.run.closed) {
        props.onClosed(r.scenario.owner_npc_id);
        return;
      }
      // 첫 진입: 하늘이 먼저 부른다 (화면은 어두워지고 하늘만 강조). 업무 카드는 팀장 지시 뒤에
      if (!r.flow.met_mentor) setChar("lee", { state: "talking", bubble: "여기예요! 저부터 만나요." }, 10000);
    });
    touch();
    return () => {
      alive = false;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runId]);

  // 서버 이벤트 → 팀원 상태
  useEffect(() => {
    const off = connectEvents(props.runId, (ev: PixelEvent) => {
      const first = ev.text?.split(/(?<=[.!?。])\s/)[0];
      switch (ev.type) {
        case "odi.call.begin":
          setChar("me", { state: "working" });
          break;
        case "odi.call.end":
          setChar("me", { state: "idle" });
          break;
        case "npc.call.begin":
          if (ev.npc_id) setChar(ev.npc_id, { state: "thinking" });
          break;
        case "npc.call.end":
          if (ev.npc_id) setChar(ev.npc_id, { state: "talking", bubble: first }, 4000);
          break;
        case "review.reject":
        case "review.approve":
          if (ev.npc_id) setChar(ev.npc_id, { state: "talking", bubble: first }, 6000);
          break;
      }
    });
    return off;
  }, [props.runId, setChar]);

  if (!info)
    return (
      <div className="ws">
        <p className="ws-loading">불러오는 중…</p>
      </div>
    );

  const run = info.run;
  const owner = info.scenario.owner_npc_id;
  const flow = info.flow;
  // 수습 흐름: 하늘을 만나기 전엔 하늘만, 팀장 지시 전엔 하늘·팀원만 열린다
  const npcLocked = (id: NpcId) => !flow.met_mentor && id !== "lee";
  const workLocked = !flow.briefed;
  const nudge = () =>
    flow.met_mentor
      ? setChar("lee", { state: "talking", bubble: `${NPC_INFO[owner].name} 팀장님께 지시부터 받아 와요.` }, 6000)
      : setChar("lee", { state: "talking", bubble: "여기예요! 저부터 만나요." }, 6000);
  const toggle = (p: Exclude<Panel, null | "npc">) => {
    if (workLocked) return nudge();
    setPanel(panel === p ? null : p);
    touch();
  };
  const openNpc = (id: NpcId) => {
    if (npcLocked(id)) return nudge();
    setNpc(id);
    setPanel("npc");
    touch();
  };
  const openData = (file: string) => {
    if (workLocked) return nudge();
    setDataFile(file);
    setPanel("data");
    touch();
  };
  const setFlow = (f: Flow) => {
    setInfo((prev) => (prev ? { ...prev, flow: f } : prev));
    // 팀장 지시를 받으면 팀장 말풍선
    if (f.briefed && !flow.briefed) setChar(owner, { state: "talking", bubble: "그럼 부탁해요." }, 5000);
  };
  const appendMessages = (ms: Message[]) => {
    setMessages((prev) => [...prev, ...ms]);
    touch();
  };
  const patchRun = (p: Partial<RunInfo["run"]>) => setInfo((prev) => (prev ? { ...prev, run: { ...prev.run, ...p } } : prev));
  const odiLeft = run.odi_calls_limit - run.odi_calls_used;

  return (
    <div className="ws">
      {!flow.met_mentor && panel !== "npc" && <div className="ws-spot-dim" aria-hidden="true" />}
      <nav className="ws-side sk-side">
        <div className="sk-side-brand">
          <img src="/assets/ui/oreum-logo-sm.svg" width={30} height={30} alt="" />
          <span>
            <b>(주)오름</b>
            <small>
              <strong>{props.nickname}</strong> 인턴
            </small>
          </span>
        </div>

        <button className={`sk-nav ${panel === null ? "active" : ""}`} onClick={() => setPanel(null)}>
          <img src="/assets/ui/ic-home.svg" width={14} height={14} alt="" />홈
        </button>
        <button className={`sk-nav ${panel === "odi" ? "active" : ""} ${workLocked ? "locked" : ""}`} onClick={() => toggle("odi")}>
          <img src="/assets/ui/ic-odi.svg?v=3" width={17} height={17} alt="" />
          AI 오디
          <span className="sk-count">{status.me.state === "working" ? "응답 중" : `${odiLeft}회 남음`}</span>
        </button>
        <button className={`sk-nav ${panel === "data" ? "active" : ""} ${workLocked ? "locked" : ""}`} onClick={() => toggle("data")}>
          <img src="/assets/ui/ic-paperclip.svg" width={16} height={16} alt="" />
          첨부 데이터
          <span className="sk-count">{info.task_card.attachments.length}</span>
        </button>

        <span className="sk-side-label">팀원</span>
        {NPC_ORDER.map((id) => {
          const spot = (!flow.met_mentor && id === "lee") || (flow.met_mentor && !flow.briefed && id === owner);
          return (
            <button
              key={id}
              className={`sk-mate ${panel === "npc" && npc === id ? "active" : ""} ${npcLocked(id) ? "locked" : ""} ${spot ? "sk-spot" : ""}`}
              onClick={() => openNpc(id)}
            >
              <span className={`sk-presence ${status[id].state === "thinking" ? "busy" : ""}`}>
                <Avatar who={id} size={34} />
              </span>
              <span className="sk-mate-name">
                <b>
                  {NPC_INFO[id].name}
                  {id === owner && <em className="sk-owner-tag">담당</em>}
                </b>
                <small>{status[id].state === "thinking" ? "답변 작성 중…" : NPC_INFO[id].role}</small>
              </span>
              {spot && <span className="sk-alert">1</span>}
              {spot && <span className="sk-spot-tip">{flow.met_mentor ? "지시 받기!" : "먼저 인사해요!"}</span>}
            </button>
          );
        })}

        <span className="ws-grow" />

        <div className="sk-todo">
          <img src="/assets/ui/ic-todo.svg" width={25} height={24} alt="" />
          <span>
            <small>지금 할 일</small>
            <b>
              {!flow.met_mentor
                ? "하늘 선배에게 인사하세요"
                : !flow.briefed
                  ? "담당 팀장님께 지시 받기"
                  : run.state === "rejected"
                    ? "반려 내용을 보완하세요"
                    : run.state === "reviewing"
                      ? "팀장님이 검토 중이에요"
                      : "AI오디와 함께 작업하세요"}
            </b>
          </span>
        </div>

        <div className="sk-quota" title="사용량은 평가에 반영됩니다">
          <Quota label="오디" used={run.odi_calls_used} total={run.odi_calls_limit} />
          <Quota label="반려" used={run.reject_count} total={3} warn />
        </div>

        <div className="sk-side-foot">
          <button className="sk-btn block" onClick={() => (workLocked ? nudge() : props.onSubmit())}>
            제출하기
          </button>
          {/* 퇴근하기: 지금은 배치표로 나가기 (퇴근 → 리포트 흐름은 다음 단계) */}
          <button className="sk-leave" onClick={props.onLeave}>
            <img src="/assets/ui/ic-logout.svg" width={16} height={16} alt="" />
            퇴근하기
          </button>
        </div>
      </nav>

      <main className="ws-main">
        <OfficeHome
          nickname={props.nickname}
          info={info}
          messages={messages}
          status={status}
          npcOrder={NPC_ORDER}
          onOpenTask={() => (workLocked ? nudge() : setPanel("task"))}
          onOpenOdi={() => (workLocked ? nudge() : setPanel("odi"))}
          onOpenData={openData}
          onOpenNpc={openNpc}
        />
      </main>

      {panel && (
        <aside className={`ws-panel ${panel === "data" ? "wide" : ""}`}>
          <div className="ws-panel-head">
            {panel === "task" && <b>업무 카드</b>}
            {panel === "odi" && (
              <>
                <Avatar who="odi" size={24} />
                <b>오디</b>
                <small>사내 AI 비서</small>
              </>
            )}
            {panel === "data" && <b>첨부 데이터</b>}
            {panel === "npc" && (
              <>
                <Avatar who={npc} size={24} />
                <b>{NPC_INFO[npc].name}</b>
                <small>{NPC_INFO[npc].role}</small>
              </>
            )}
            <button className="ws-iconbtn" onClick={() => setPanel(null)} aria-label="닫기" title="닫기">
              <Icon name="close" />
            </button>
          </div>
          {panel === "task" && (
            <TaskCard
              card={info.task_card}
              owner={owner}
              issueKey={`ORM-${100 + Number(info.scenario.id)}`}
              state={run.state}
              nickname={props.nickname}
              label={CERT_LABEL[info.scenario.id] ?? "수습 과제"}
              onOpenData={openData}
            />
          )}
          {panel === "odi" && (
            <OdiPanel
              runId={props.runId}
              nickname={props.nickname}
              messages={messages.filter((m) => m.agent === "odi")}
              used={run.odi_calls_used}
              limit={run.odi_calls_limit}
              basket={run.basket_text}
              onSent={(ms, used) => {
                appendMessages(ms);
                patchRun({ odi_calls_used: used, state: run.state === "assigned" ? "working" : run.state });
              }}
              onBasket={(text) => patchRun({ basket_text: text })}
            />
          )}
          {panel === "data" && <DataViewer runId={props.runId} files={info.task_card.attachments} initial={dataFile} />}
          {panel === "npc" && (
            <NpcChat
              key={npc}
              runId={props.runId}
              nickname={props.nickname}
              npc={npc}
              owner={owner}
              messages={messages.filter((m) => m.agent === npc)}
              flow={flow}
              mentorQuestions={info.mentor_questions}
              rejectCount={run.reject_count}
              onReply={appendMessages}
              onFlow={setFlow}
            />
          )}
        </aside>
      )}
    </div>
  );
}
