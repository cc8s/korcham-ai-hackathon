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
const NPC_ORDER: NpcId[] = ["kang", "jung", "park", "lee"];
// 업무 카드의 레이블 (시나리오 → 연계 자격증)
const CERT_LABEL: Record<string, string> = { "01": "컴퓨터활용능력", "02": "전산회계운용사", "03": "유통관리사", "04": "무역영어", "05": "비서" };

// 게임 시계. 09:00 에 출근해서 현실 1초 = 게임 30초 (현실 18분 = 게임 9시간 → 18:00).
// 연출용이라 서버는 모른다. 마감 시각을 넘겨도 불이익은 없다. 새로고침해도 이어지게 출근 시각만 localStorage 에 둔다.
const CLOCK_START = 9 * 60;
const CLOCK_END = 22 * 60;
const GAME_MIN_PER_SEC = 0.5;

function useGameClock(runId: string): number {
  const read = useCallback(() => {
    // 데모·확인용: 주소에 ?clock=1050 을 붙이면 그 시각으로 고정
    const forced = Number(new URLSearchParams(window.location.search).get("clock"));
    if (forced > 0) return forced;
    const key = `oreum.clock.${runId}`;
    let started = Number(localStorage.getItem(key));
    if (!started) {
      started = Date.now();
      localStorage.setItem(key, String(started));
    }
    const m = CLOCK_START + ((Date.now() - started) / 1000) * GAME_MIN_PER_SEC;
    return Math.min(CLOCK_END, Math.floor(m));
  }, [runId]);
  const [minutes, setMinutes] = useState(read);
  useEffect(() => {
    setMinutes(read());
    const t = window.setInterval(() => setMinutes(read()), 2000);
    return () => window.clearInterval(t);
  }, [read]);
  return minutes;
}

function clockText(minutes: number) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { ampm: h < 12 ? "오전" : "오후", time: `${h12}:${String(m).padStart(2, "0")}`, phase: h < 12 ? "오전 근무" : h < 13 ? "점심 무렵" : h < 18 ? "오후 근무" : "야근 중" };
}

// 남은 횟수를 칸으로. filled = 채워진 칸 수
function Pips(props: { total: number; filled: number; tone?: "ok" | "warn" }) {
  return (
    <span className={`pips ${props.tone ?? "ok"}`}>
      {Array.from({ length: props.total }, (_, i) => (
        <i key={i} className={i < props.filled ? "on" : ""} />
      ))}
    </span>
  );
}

// S2 픽셀 오피스: 왼쪽 사이드바(시계·메뉴·팀원·자원) + 사무실 + 오른쪽 패널
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
  const minutes = useGameClock(props.runId);

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

  if (!info) return <div className="screen center loading">출근 중...</div>;

  const run = info.run;
  const owner = info.scenario.owner_npc_id;
  const clock = clockText(minutes);
  const toggle = (p: Exclude<Panel, null | "npc">) => {
    setPanel(panel === p ? null : p);
    touch();
  };
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
  const odiLeft = run.odi_calls_limit - run.odi_calls_used;

  return (
    <div className="office-screen">
      <nav className="sidebar">
        <div className="clock" title="게임 시계. 현실 1초에 30초씩 흐릅니다">
          <span className="clock-ampm">{clock.ampm}</span>
          <span className="clock-time">{clock.time}</span>
          <span className="clock-phase">{clock.phase}</span>
        </div>

        <div className="side-task">
          <span className="side-label">오늘 업무</span>
          <b>{info.scenario.title}</b>
        </div>

        <div className="side-menu">
          <button className={`side-item ${panel === "task" ? "active" : ""}`} onClick={() => toggle("task")}>
            <i className="ico ico-task" />
            업무 카드
          </button>
          <button className={`side-item ${panel === "odi" ? "active" : ""}`} onClick={() => toggle("odi")}>
            <i className="ico ico-odi" />
            오디
            <span className="count">{odiLeft}</span>
          </button>
          <button className={`side-item ${panel === "data" ? "active" : ""}`} onClick={() => toggle("data")}>
            <i className="ico ico-data" />
            첨부 데이터
            <span className="count">{info.task_card.attachments.length}</span>
          </button>
        </div>

        <span className="side-label">
          <i className="ico ico-people small" /> 팀원
        </span>
        <div className="side-menu">
          {NPC_ORDER.map((id) => (
            <button key={id} className={`side-item person ${panel === "npc" && npc === id ? "active" : ""}`} onClick={() => openNpc(id)}>
              <span className="dot" style={{ background: NPC_INFO[id].color }} />
              <span className="person-name">
                {NPC_INFO[id].name}
                <small>{NPC_INFO[id].role}</small>
              </span>
              {id === owner && <span className="chip">담당</span>}
            </button>
          ))}
        </div>

        <span className="grow" />

        <div className="meters">
          <div className="meter">
            <span>오디</span>
            <Pips total={run.odi_calls_limit} filled={odiLeft} />
          </div>
          <div className="meter">
            <span>힌트</span>
            <Pips total={3} filled={3 - run.hint_level} />
          </div>
          <div className="meter">
            <span>반려</span>
            <Pips total={3} filled={run.reject_count} tone="warn" />
          </div>
        </div>

        <button className="btn primary submit" onClick={props.onSubmit}>
          <i className="ico ico-submit" />
          제출하기
          <small>바구니 {run.basket_text.length}자</small>
        </button>
        <button className="side-item leave" onClick={props.onLeave}>
          <i className="ico ico-exit" />
          배치표로
        </button>
      </nav>

      <div className="office-body">
        <OfficeStage nickname={props.nickname} status={status} owner={owner} minutes={minutes} onClickNpc={openNpc} />

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
    </div>
  );
}
