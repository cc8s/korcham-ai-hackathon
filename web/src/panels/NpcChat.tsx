import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type Message, type NpcId } from "../types";

// P3 NPC 대화창. NPC 별 세션 분리. 이하늘에게만 힌트 버튼
export function NpcChat(props: {
  runId: string;
  npc: NpcId;
  messages: Message[];
  hintLevel: number;
  onReply: (ms: Message[], hintLevel: number) => void;
}) {
  const info = NPC_INFO[props.npc];
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
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
    <div className="panel-body chat">
      <div className="row">
        <span className="avatar" style={{ background: info.color }}>
          {info.name[0]}
        </span>
        <span className="tiny muted">
          {isMentor ? `힌트 ${props.hintLevel}/3 사용. 힌트는 평가에 반영돼요.` : "첨부에 답이 있는 걸 물으면 돌려보냅니다."}
        </span>
      </div>
      <div className="msgs">
        {props.messages.map((m) => (
          <div className={`msg ${m.role}`} key={m.id}>
            {m.content}
          </div>
        ))}
        {busy && <div className="msg assistant muted">…</div>}
        <div ref={bottom} />
      </div>
      {err && <p className="error tiny">{err}</p>}
      <div className="row">
        <textarea
          rows={2}
          value={input}
          placeholder={`${info.name}에게`}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn primary" disabled={busy || !input.trim()} onClick={() => send()}>
          보내기
        </button>
        {isMentor && (
          <button className="btn" disabled={busy || props.hintLevel >= 3} onClick={() => send(true)}>
            힌트 요청
          </button>
        )}
      </div>
    </div>
  );
}
