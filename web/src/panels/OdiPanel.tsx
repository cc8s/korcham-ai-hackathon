import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, odiStream } from "../api";
import type { Message } from "../types";
import { Face } from "./Face";

export const hhmm = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// P2 오디 패널. 사내 메신저의 앱 대화방처럼 보여 준다: 스트리밍 + 결과물로 담기
export function OdiPanel(props: {
  runId: string;
  nickname: string;
  messages: Message[];
  used: number;
  limit: number;
  basket: string;
  onSent: (ms: Message[], used: number) => void;
  onBasket: (text: string) => void;
}) {
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
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
    setPendingText(text);
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
    <div className="panel-body app slk">
      <div className="slk-head">
        <Face who="odi" size={24} />
        <b>오디</b>
        <span className="slk-app">앱</span>
        <span className="slk-topic">
          남은 호출 {remaining}/{props.limit} · 첨부 데이터는 이미 읽고 있어요
        </span>
      </div>

      <div className="slk-msgs">
        {props.messages.length === 0 && streaming === null && (
          <div className="slk-intro">
            <Face who="odi" size={48} />
            <p>
              <b>오디</b>와 나누는 대화의 시작입니다.
            </p>
            <p className="sub">예) "거래처별 10월 매출 합계표 만들어 줘. 금액 큰 순서로." 결과를 받으면 되물어 보세요.</p>
          </div>
        )}
        {props.messages.map((m) => (
          <div className="slk-msg" key={m.id}>
            <Face who={m.role === "assistant" ? "odi" : "me"} />
            <div className="slk-main">
              <div className="slk-meta">
                <b>{m.role === "assistant" ? "오디" : props.nickname}</b>
                {m.role === "assistant" && <span className="slk-app">앱</span>}
                <time>{hhmm(m.at)}</time>
              </div>
              {m.role === "assistant" ? (
                <>
                  <div className="md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  <button className="slk-action" disabled={addedIds.has(m.id)} onClick={() => addToBasket(m)}>
                    {addedIds.has(m.id) ? "✓ 결과물에 담김" : "＋ 결과물로 담기"}
                  </button>
                </>
              ) : (
                <div className="slk-text">{m.content}</div>
              )}
            </div>
          </div>
        ))}
        {streaming !== null && (
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
            <div className="slk-msg">
              <Face who="odi" />
              <div className="slk-main">
                <div className="slk-meta">
                  <b>오디</b>
                  <span className="slk-app">앱</span>
                </div>
                <div className="md">{streaming ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown> : <span className="slk-typing">입력 중…</span>}</div>
              </div>
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>

      {err && <p className="slk-err">{err}</p>}
      {remaining <= 0 ? (
        <p className="slk-err">오디 호출 한도. 지금까지 결과로 제출하세요.</p>
      ) : (
        <div className="slk-compose">
          <textarea
            rows={2}
            value={input}
            placeholder="오디에게 메시지 보내기"
            disabled={streaming !== null}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          <div className="slk-tools">
            <span>Enter 전송 · Shift+Enter 줄바꿈</span>
            <button className="slk-send" disabled={streaming !== null || !input.trim()} onClick={send}>
              보내기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
