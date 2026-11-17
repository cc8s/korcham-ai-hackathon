import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, odiStream } from "../api";
import type { Message } from "../types";

// P2 오디 패널: 채팅 + 스트리밍 + 결과물로 담기
export function OdiPanel(props: {
  runId: string;
  messages: Message[];
  used: number;
  limit: number;
  basket: string;
  onSent: (ms: Message[], used: number) => void;
  onBasket: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set());
  const bottom = useRef<HTMLDivElement>(null);
  const remaining = props.limit - props.used;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [props.messages.length, streaming]);

  const send = async () => {
    const text = input.trim();
    if (!text || streaming !== null || remaining <= 0) return;
    setInput("");
    setErr(null);
    setStreaming("");
    let acc = "";
    try {
      const done = await odiStream(props.runId, text, (d) => {
        acc += d;
        setStreaming(acc);
      });
      const now = new Date().toISOString();
      props.onSent(
        [
          { id: -Date.now(), agent: "odi", role: "user", content: text, at: now },
          { id: -Date.now() - 1, agent: "odi", role: "assistant", content: acc, at: now },
        ],
        done.odi_calls_used,
      );
      if (done.truncated) setErr("답이 길어서 잘렸어요. '이어서'라고 해 보세요.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "오디가 응답하지 않아요");
      setInput(text);
    } finally {
      setStreaming(null);
    }
  };

  const addToBasket = async (m: Message) => {
    const next = props.basket ? `${props.basket}\n\n${m.content}` : m.content;
    await api.putBasket(props.runId, next);
    props.onBasket(next);
    setAddedIds((s) => new Set(s).add(m.id));
  };

  return (
    <div className="panel-body chat">
      <p className="tiny muted">
        남은 호출 <b>{remaining}</b>/{props.limit} · 첨부 데이터는 오디가 이미 읽고 있어요. 붙여 넣을 필요 없음.
      </p>
      <div className="msgs">
        {props.messages.length === 0 && (
          <p className="muted tiny">예) "거래처별 10월 매출 합계표 만들어 줘. 금액 큰 순서로." · 결과를 받으면 되물어 보세요.</p>
        )}
        {props.messages.map((m) => (
          <div className={`msg ${m.role}`} key={m.id}>
            {m.role === "assistant" ? (
              <>
                <div className="md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                </div>
                <button className="btn tiny" disabled={addedIds.has(m.id)} onClick={() => addToBasket(m)}>
                  {addedIds.has(m.id) ? "담김" : "결과물로 담기"}
                </button>
              </>
            ) : (
              m.content
            )}
          </div>
        ))}
        {streaming !== null && (
          <div className="msg assistant">
            <div className="md">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming || "…"}</ReactMarkdown>
            </div>
          </div>
        )}
        <div ref={bottom} />
      </div>
      {err && <p className="error tiny">{err}</p>}
      {remaining <= 0 ? (
        <p className="warn-text">오디 호출 한도. 지금까지 결과로 제출하세요.</p>
      ) : (
        <div className="row">
          <textarea
            rows={2}
            value={input}
            placeholder="오디에게 지시"
            disabled={streaming !== null}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <button className="btn primary" disabled={streaming !== null || !input.trim()} onClick={send}>
            보내기
          </button>
        </div>
      )}
    </div>
  );
}
