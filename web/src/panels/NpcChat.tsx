import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type Message, type NpcId } from "../types";
import { Face } from "./Face";
import { hhmm } from "./OdiPanel";

// P3 팀원 대화창. 사내 메신저의 1:1 대화처럼 보여 준다. NPC 별 세션 분리. 이하늘에게만 힌트 버튼
export function NpcChat(props: {
  runId: string;
  nickname: string;
  npc: NpcId;
  messages: Message[];
  hintLevel: number;
  onReply: (ms: Message[], hintLevel: number) => void;
}) {
  const info = NPC_INFO[props.npc];
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const isMentor = props.npc === "lee";

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, busy]);

  const send = async (hint = false) => {
    const text = hint ? "힌트 좀 주세요." : input.trim();
    if (!text || busy) return;
    setInput("");
    setErr(null);
    setPendingText(text);
    setBusy(true);
    try {
      const r = await api.npc(props.runId, props.npc, text, hint);
      const now = new Date().toISOString();
      props.onReply(
        [
          { id: -Date.now(), agent: props.npc, role: "user", content: text, at: now },
          { id: -Date.now() - 1, agent: props.npc, role: "assistant", content: r.text, at: now },
        ],
        r.hint_level,
      );
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "응답이 없어요");
      if (!hint) setInput(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel-body app slk">
      <div className="slk-head">
        <Face who={props.npc} size={24} />
        <b>{info.name}</b>
        <span className="slk-presence" title="자리에 있음" />
        <span className="slk-topic">{isMentor ? `${info.role} · 힌트 ${props.hintLevel}/3 사용 (평가에 반영)` : `${info.role} · 첨부에 답이 있는 걸 물으면 돌려보냅니다`}</span>
      </div>

      <div className="slk-msgs">
        {props.messages.length === 0 && !busy && (
          <div className="slk-intro">
            <Face who={props.npc} size={48} />
            <p>
              <b>{info.name}</b> 님과 나누는 대화의 시작입니다.
            </p>
            <p className="sub">{info.role}</p>
          </div>
        )}
        {props.messages.map((m) => (
          <div className="slk-msg" key={m.id}>
            <Face who={m.role === "assistant" ? props.npc : "me"} />
            <div className="slk-main">
              <div className="slk-meta">
                <b>{m.role === "assistant" ? info.name : props.nickname}</b>
                <time>{hhmm(m.at)}</time>
              </div>
              <div className="slk-text">{m.content}</div>
            </div>
          </div>
        ))}
        {busy && (
          <>
            <div className="slk-msg">
              <Face who="me" />
              <div className="slk-main">
                <div className="slk-meta">
                  <b>{props.nickname}</b>
                </div>
                <div className="slk-text">{pendingText}</div>
              </div>
            </div>
            <p className="slk-typing">{info.name} 님이 입력 중…</p>
          </>
        )}
        <div ref={bottom} />
      </div>

      {err && <p className="slk-err">{err}</p>}
      <div className="slk-compose">
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
        <div className="slk-tools">
          {isMentor ? (
            <button className="slk-hint" disabled={busy || props.hintLevel >= 3} onClick={() => send(true)}>
              💡 힌트 요청 ({3 - props.hintLevel}번 남음)
            </button>
          ) : (
            <span>Enter 전송 · Shift+Enter 줄바꿈</span>
          )}
          <button className="slk-send" disabled={busy || !input.trim()} onClick={() => send()}>
            보내기
          </button>
        </div>
      </div>
    </div>
  );
}
