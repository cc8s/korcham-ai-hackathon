import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type Message, type NpcId } from "../types";
import { Avatar, Icon } from "../ui/kit";
import { hhmm } from "./OdiPanel";

// P3 팀원 대화창. NPC 별 세션 분리. 이하늘에게만 힌트 버튼
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
      if (r.notice) setErr(r.notice);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "응답이 없어요");
      if (!hint) setInput(text);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="ws-panel-body">
      <p className="ws-chat-note">{isMentor ? `힌트 ${props.hintLevel}/3 사용 · 힌트 사용은 평가에 반영됩니다` : "첨부 데이터에 답이 있는 질문은 돌려보냅니다"}</p>

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
            <div className="ws-msg">
              <Avatar who="me" name={props.nickname} />
              <div className="ws-msg-main">
                <div className="ws-msg-meta">
                  <b>{props.nickname}</b>
                </div>
                <div className="ws-msg-text">{pendingText}</div>
              </div>
            </div>
            <p className="ws-typing">{info.name} 님이 입력 중…</p>
          </>
        )}
        <div ref={bottom} />
      </div>

      {err && <p className="ws-notice">{err}</p>}
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
          {isMentor ? (
            <button className="ws-hint" disabled={busy || props.hintLevel >= 3} onClick={() => send(true)}>
              <Icon name="bulb" />
              힌트 요청 · {3 - props.hintLevel}번 남음
            </button>
          ) : (
            <span>Enter 전송 · Shift+Enter 줄바꿈</span>
          )}
          <button className="ws-send" disabled={busy || !input.trim()} onClick={() => send()} aria-label="보내기" title="보내기">
            <Icon name="send" />
          </button>
        </div>
      </div>
    </div>
  );
}
