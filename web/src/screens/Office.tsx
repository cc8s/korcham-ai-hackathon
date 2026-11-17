import { useCallback, useEffect, useRef, useState } from "react";
import { api, connectEvents } from "../api";
import { NPC_INFO, type Message, type NpcId, type PixelEvent, type RunInfo } from "../types";
import { OfficeStage, type CharStatus } from "../office/OfficeStage";
import { TaskCard } from "../panels/TaskCard";
import { OdiPanel } from "../panels/OdiPanel";
import { DataViewer } from "../panels/DataViewer";
import { NpcChat } from "../panels/NpcChat";

type Panel = "task" | "odi" | "data" | "npc" | null;
const IDLE_MS = 3 * 60 * 1000;

// S2 픽셀 오피스: 모든 패널이 이 위에 뜸
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

  // 무응답 3분 → 이하늘 말풍선 (LLM 호출 없음). 시나리오당 2회
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
      if (r.messages.length === 0) {
        setChar(r.scenario.owner_npc_id, { state: "talking", bubble: "잠깐 봅시다." }, 6000);
        setPanel("task");
      }
    });
    touch();
    return () => {
      alive = false;
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.runId]);

  // 서버 이벤트 → 캐릭터 상태
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

  if (!info) return <div className="screen center muted">출근 중...</div>;

  const run = info.run;
  const owner = info.scenario.owner_npc_id;
  const openNpc = (id: NpcId) => {
    setNpc(id);
    setPanel("npc");
    touch();
  };
  const openData = (file: string) => {
    setDataFile(file);
    setPanel("data");
    touch();
  };
  const appendMessages = (ms: Message[]) => {
    setMessages((prev) => [...prev, ...ms]);
    touch();
  };
  const patchRun = (p: Partial<RunInfo["run"]>) => setInfo((prev) => (prev ? { ...prev, run: { ...prev.run, ...p } } : prev));

  return (
    <div className="screen office-screen">
      <header className="topbar">
        <button className="btn small ghost" onClick={props.onLeave}>
          ← 배치표
        </button>
        <b>{info.scenario.title}</b>
        <span className="grow" />
        <span className="tag">
          오디 {run.odi_calls_limit - run.odi_calls_used}/{run.odi_calls_limit}
        </span>
        <span className="tag">힌트 {run.hint_level}/3</span>
        <span className="tag">반려 {run.reject_count}/3</span>
      </header>

      <div className="office-body">
        <OfficeStage nickname={props.nickname} status={status} owner={owner} onClickNpc={openNpc} />

        {panel && (
          <aside className="panel">
            <div className="panel-head">
              <b>
                {panel === "task" && "업무 카드"}
                {panel === "odi" && "오디 · 사내 AI 비서"}
                {panel === "data" && "첨부 데이터"}
                {panel === "npc" && `${NPC_INFO[npc].name} · ${NPC_INFO[npc].role}`}
              </b>
              <button className="btn small ghost" onClick={() => setPanel(null)}>
                닫기
              </button>
            </div>
            {panel === "task" && <TaskCard card={info.task_card} owner={owner} onOpenData={openData} />}
            {panel === "odi" && (
              <OdiPanel
                runId={props.runId}
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
                npc={npc}
                messages={messages.filter((m) => m.agent === npc)}
                hintLevel={run.hint_level}
                onReply={(ms, hintLevel) => {
                  appendMessages(ms);
                  patchRun({ hint_level: hintLevel, state: run.state === "assigned" ? "working" : run.state });
                }}
              />
            )}
          </aside>
        )}
      </div>

      <footer className="bottombar">
        <button className={`btn ${panel === "task" ? "active" : ""}`} onClick={() => setPanel(panel === "task" ? null : "task")}>
          업무 카드
        </button>
        <button className={`btn ${panel === "odi" ? "active" : ""}`} onClick={() => setPanel(panel === "odi" ? null : "odi")}>
          오디
        </button>
        <button className={`btn ${panel === "data" ? "active" : ""}`} onClick={() => setPanel(panel === "data" ? null : "data")}>
          첨부 데이터
        </button>
        <span className="grow" />
        <span className="muted tiny">바구니 {run.basket_text.length}자</span>
        <button className="btn primary" onClick={props.onSubmit}>
          제출
        </button>
      </footer>
    </div>
  );
}
