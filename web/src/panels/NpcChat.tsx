import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type Flow, type MentorQuestion, type MentorStage, type Message, type NpcId } from "../types";
import { Avatar, Icon } from "../ui/kit";
import { hhmm } from "./OdiPanel";

// P3 팀원 대화창. NPC 별 세션 분리.
// 이하늘: 처음 열면 고정 인사(LLM 없음), 아래에 추천 질문 버튼. 담당 팀장: 하늘을 만난 뒤 처음 열면 고정 업무 지시
export function NpcChat(props: {
  runId: string;
  nickname: string;
  npc: NpcId;
  owner: NpcId;
  messages: Message[];
  flow: Flow;
  mentorQuestions: MentorQuestion[];
  rejectCount: number;
  onReply: (ms: Message[]) => void;
  onFlow: (flow: Flow) => void;
}) {
  const info = NPC_INFO[props.npc];
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const isMentor = props.npc === "lee";
  const isOwner = props.npc === props.owner;
  const started = useRef(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, busy]);

  // 고정 대사 요청. question 이 있으면(추천 질문) 내 말풍선도 같이 붙인다
  const scripted = async (kind: "intro" | "brief" | "faq", faqId?: string, label?: string) => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    if (label) setPendingText(label);
    try {
      const r = await api.scripted(props.runId, props.npc, kind, faqId);
      const now = new Date().toISOString();
      const ms: Message[] = [];
      if (r.question) ms.push({ id: -Date.now(), agent: props.npc, role: "user", content: r.question, at: now });
      ms.push({ id: -Date.now() - 1, agent: props.npc, role: "assistant", content: r.text, at: now });
      props.onReply(ms);
      props.onFlow(r.flow);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "응답이 없어요");
    } finally {
      setPendingText("");
      setBusy(false);
    }
  };

  // 첫 만남 연출: 하늘은 인사, 담당 팀장은 업무 지시. 이미 받았으면 아무것도 안 함
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (isMentor && !props.flow.met_mentor) void scripted("intro");
    else if (isOwner && props.flow.met_mentor && !props.flow.briefed) void scripted("brief");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setErr(null);
    setPendingText(text);
    setBusy(true);
    try {
      const r = await api.npc(props.runId, props.npc, text);
      const now = new Date().toISOString();
      props.onReply([
        { id: -Date.now(), agent: props.npc, role: "user", content: text, at: now },
        { id: -Date.now() - 1, agent: props.npc, role: "assistant", content: r.text, at: now },
      ]);
      if (r.notice) setErr(r.notice);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "응답이 없어요");
      setInput(text);
    } finally {
      setPendingText("");
      setBusy(false);
    }
  };

  // 추천 질문: 단계에 맞는 것만, 이미 물어본 것은 뺀다
  const stages: MentorStage[] = !props.flow.briefed ? ["start"] : props.rejectCount > 0 ? ["work", "reject"] : ["work"];
  const asked = new Set(props.messages.filter((m) => m.role === "user").map((m) => m.content));
  const chips = isMentor && props.flow.met_mentor ? props.mentorQuestions.filter((q) => q.stages.some((s) => stages.includes(s)) && !asked.has(q.q)) : [];

  const note = isMentor
    ? "궁금한 건 편하게 물어보세요. 선배에게 묻는 건 감점되지 않아요"
    : isOwner
      ? "이번 과제 담당 팀장님 · 첨부 데이터에 답이 있는 질문은 돌려보냅니다"
      : "첨부 데이터에 답이 있는 질문은 돌려보냅니다";

  return (
    <div className="ws-panel-body">
      <p className="ws-chat-note">{note}</p>

      <div className="ws-msgs">
        {props.messages.length === 0 && !busy && (
          <div className="ws-intro">
            <Avatar who={props.npc} size={56} />
            <b>{info.name}</b>
            <p>{info.role}</p>
          </div>
        )}
        {props.messages.map((m) => (
          <div className="ws-msg" key={m.id}>
            <Avatar who={m.role === "assistant" ? props.npc : "me"} name={props.nickname} />
            <div className="ws-msg-main">
              <div className="ws-msg-meta">
                <b>{m.role === "assistant" ? info.name : props.nickname}</b>
                <time>{hhmm(m.at)}</time>
              </div>
              <div className="ws-msg-text">{m.content}</div>
            </div>
          </div>
        ))}
        {busy && (
          <>
            {pendingText && (
              <div className="ws-msg">
                <Avatar who="me" name={props.nickname} />
                <div className="ws-msg-main">
                  <div className="ws-msg-meta">
                    <b>{props.nickname}</b>
                  </div>
                  <div className="ws-msg-text">{pendingText}</div>
                </div>
              </div>
            )}
            <p className="ws-typing">{info.name} 님이 입력 중…</p>
          </>
        )}
        <div ref={bottom} />
      </div>

      {err && <p className="ws-notice">{err}</p>}
      {chips.length > 0 && (
        <div className="ws-faq" aria-label="추천 질문">
          {chips.map((c) => (
            <button key={c.id} className="ws-hint" disabled={busy} onClick={() => scripted("faq", c.id, c.q)}>
              <Icon name="bulb" />
              {c.q}
            </button>
          ))}
        </div>
      )}
      <div className="ws-compose">
        <textarea
          rows={2}
          value={input}
          placeholder={`${info.name} 님에게 메시지 보내기`}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <div className="ws-compose-tools">
          <span>Enter 전송 · Shift+Enter 줄바꿈</span>
          <button className="ws-send" disabled={busy || !input.trim()} onClick={() => send()} aria-label="보내기" title="보내기">
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}
