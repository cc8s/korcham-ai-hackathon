import { useEffect, useRef, useState } from "react";
import { useIsMobile } from "../ui/mobile";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError, odiStream } from "../api";
import type { Message } from "../types";
import { Avatar, Icon } from "../ui/kit";

export const hhmm = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const h = d.getHours();
  return `${h < 12 ? "오전" : "오후"} ${h % 12 === 0 ? 12 : h % 12}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// P2 오디 패널: 스트리밍 + 결과물로 담기
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
  const isMobile = useIsMobile();
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [pendingText, setPendingText] = useState("");
  // 오디가 계산 도구를 부른 뒤 다음 글이 오기 전까지 "계산 중" 표시. 옵션 값은 보여 주지 않음 (함정 노출)
  const [calculating, setCalculating] = useState(false);
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
      const done = await odiStream(
        props.runId,
        text,
        (d) => {
          acc += d;
          setStreaming(acc);
          setCalculating(false);
        },
        undefined,
        () => setCalculating(true),
      );
      const now = new Date().toISOString();
      props.onSent(
        [
          { id: -Date.now(), agent: "odi", role: "user", content: text, at: now },
          { id: -Date.now() - 1, agent: "odi", role: "assistant", content: acc, at: now },
        ],
        done.odi_calls_used,
      );
      // 서버가 개인정보를 가려서 보냈으면 알려 준다 (대회 규정, server/src/pii.ts)
      if (done.notice) setErr(done.notice);
      else if (done.truncated) setErr("답이 길어서 잘렸어요. '이어서'라고 해 보세요.");
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "오디가 응답하지 않아요");
      setInput(text);
    } finally {
      setStreaming(null);
      setCalculating(false);
    }
  };

  const addToBasket = async (m: Message) => {
    const next = props.basket ? `${props.basket}\n\n${m.content}` : m.content;
    await api.putBasket(props.runId, next);
    props.onBasket(next);
    setAddedIds((s) => new Set(s).add(m.id));
  };

  return (
    <div className="ws-panel-body">
      <p className="ws-chat-note">
        남은 호출 {remaining}/{props.limit} · 첨부 데이터는 오디가 이미 읽고 있어요
      </p>

      <div className="ws-msgs">
        {props.messages.length === 0 && streaming === null && (
          <div className="ws-intro">
            <Avatar who="odi" size={56} />
            <b>무엇을 도와드릴까요?</b>
            <p>예) "거래처별 10월 매출 합계표 만들어 줘. 금액 큰 순서로."</p>
            <p>결과를 받으면 그대로 쓰지 말고 되물어 확인해 보세요.</p>
          </div>
        )}
        {props.messages.map((m) => (
          <div className="ws-msg" key={m.id}>
            <Avatar who={m.role === "assistant" ? "odi" : "me"} name={props.nickname} />
            <div className="ws-msg-main">
              <div className="ws-msg-meta">
                <b>{m.role === "assistant" ? "오디" : props.nickname}</b>
                <time>{hhmm(m.at)}</time>
              </div>
              {m.role === "assistant" ? (
                <>
                  <div className="ws-md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
                  </div>
                  <button className="ws-msg-action" disabled={addedIds.has(m.id)} onClick={() => addToBasket(m)}>
                    <Icon name={addedIds.has(m.id) ? "check" : "plus"} />
                    {addedIds.has(m.id) ? "결과물에 담김" : "결과물로 담기"}
                  </button>
                </>
              ) : (
                <div className="ws-msg-text">{m.content}</div>
              )}
            </div>
          </div>
        ))}
        {streaming !== null && (
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
            <div className="ws-msg">
              <Avatar who="odi" />
              <div className="ws-msg-main">
                <div className="ws-msg-meta">
                  <b>오디</b>
                </div>
                <div className="ws-md">
                  {streaming && <ReactMarkdown remarkPlugins={[remarkGfm]}>{streaming}</ReactMarkdown>}
                  {calculating ? (
                    <span className="ws-typing">첨부 데이터 계산 중…</span>
                  ) : (
                    !streaming && <span className="ws-typing">답변 작성 중…</span>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
        <div ref={bottom} />
      </div>

      {err && <p className="ws-notice">{err}</p>}
      {remaining <= 0 ? (
        <p className="ws-notice">오디 호출 한도를 다 썼어요. 지금까지 결과로 제출하세요.</p>
      ) : (
        <div className="ws-compose">
          <textarea
            rows={2}
            maxLength={4000} // 서버 상한과 같게 (server config.guard)
            value={input}
            placeholder="오디에게 시킬 일을 적어 주세요"
            disabled={streaming !== null}
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
            <button className="ws-send" disabled={streaming !== null || !input.trim()} onClick={send} aria-label="보내기" title="보내기">
              {isMobile ? (
                // Figma 오디대화: arrow-up-circle
                <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
                  <circle cx="13" cy="13" r="13" fill="currentColor" />
                  <path d="M13 18V8M8.5 12.5L13 8l4.5 4.5" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <Icon name="send" />
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
