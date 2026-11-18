import { useCallback, useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { NPC_INFO, type Flow, type Message, type NpcId, type PixelEvent, type RunInfo } from "../types";
import { OfficeHome, RUN_STATUS, type CharStatus } from "./OfficeHome";
import { Avatar, Icon } from "../ui/kit";
import { TaskCard } from "../panels/TaskCard";
import { OdiPanel } from "../panels/OdiPanel";
import { DataViewer } from "../panels/DataViewer";
import { NpcChat } from "../panels/NpcChat";

type Panel = "task" | "odi" | "data" | "npc" | null;
const IDLE_MS = 3 * 60 * 1000;
const NPC_ORDER: NpcId[] = ["kang", "jung", "park", "lee"];
// 업무 카드의 분류 (시나리오 → 연계 자격증)
const CERT_LABEL: Record<string, string> = { "01": "컴퓨터활용능력", "02": "전산회계운용사", "03": "유통관리사", "04": "무역영어", "05": "비서" };

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
      <nav className="ws-side">
        <div className="ws-brand">
          <span className="ws-brand-mark">오름</span>
          <span>
            <b>(주)오름</b>
            <small>{props.nickname} · 수습사원</small>
          </span>
        </div>

        <button className={`ws-nav ${panel === null ? "active" : ""}`} onClick={() => setPanel(null)}>
          <Icon name="home" />홈
        </button>
        <button className={`ws-nav ${panel === "task" ? "active" : ""} ${workLocked ? "locked" : ""}`} onClick={() => toggle("task")}>
          <Icon name="task" />
          업무 카드
          <span className={`ws-tag ${RUN_STATUS[run.state].tone}`}>{RUN_STATUS[run.state].label}</span>
        </button>
        <button className={`ws-nav ${panel === "odi" ? "active" : ""} ${workLocked ? "locked" : ""}`} onClick={() => toggle("odi")}>
          <Icon name="spark" />
          오디
          <span className={`ws-tag ${status.me.state === "working" ? "info" : ""}`}>{status.me.state === "working" ? "응답 중" : `${odiLeft}회 남음`}</span>
        </button>
        <button className={`ws-nav ${panel === "data" ? "active" : ""} ${workLocked ? "locked" : ""}`} onClick={() => toggle("data")}>
          <Icon name="table" />
          첨부 데이터
          <span className="ws-tag">{info.task_card.attachments.length}</span>
        </button>

        <span className="ws-side-label">팀원</span>
        {NPC_ORDER.map((id) => (
          <button
            key={id}
            className={`ws-nav ${panel === "npc" && npc === id ? "active" : ""} ${npcLocked(id) ? "locked" : ""} ${
              (!flow.met_mentor && id === "lee") || (flow.met_mentor && !flow.briefed && id === owner) ? "ws-spot" : ""
            }`}
            onClick={() => openNpc(id)}
          >
            <span className={`ws-presence ${status[id].state === "thinking" ? "busy" : ""}`}>
              <Avatar who={id} size={28} />
            </span>
            <span className="ws-nav-name">
              {NPC_INFO[id].name}
              <small>{status[id].state === "thinking" ? "답변 작성 중…" : NPC_INFO[id].role}</small>
            </span>
            {id === owner && <span className="ws-tag accent">담당</span>}
            {!flow.met_mentor && id === "lee" && <span className="ws-spot-tip">먼저 인사해요 ←</span>}
            {flow.met_mentor && !flow.briefed && id === owner && <span className="ws-spot-tip">지시 받기 ←</span>}
          </button>
        ))}

        <span className="ws-grow" />

        <div className="ws-quota" title="사용량은 평가에 반영됩니다">
          <Quota label="오디" used={run.odi_calls_used} total={run.odi_calls_limit} />
          <Quota label="반려" used={run.reject_count} total={3} warn />
        </div>

        <div className="ws-side-foot">
          <button className="ws-btn primary block" onClick={() => (workLocked ? nudge() : props.onSubmit())}>
            제출하기
          </button>
          <small>결과물 {run.basket_text.length.toLocaleString()}자 담김</small>
          <button className="ws-nav" onClick={props.onLeave}>
            <Icon name="exit" />
            배치표로
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
