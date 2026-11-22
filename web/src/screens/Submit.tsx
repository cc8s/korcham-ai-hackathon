import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, NPC_DUTY, type NpcId, type SubmissionField, type SubmitResult } from "../types";
import { Avatar, Icon } from "../ui/kit";
import { Bnv, mobileNav, useIsMobile, type MobileTab } from "../ui/mobile";

// 입력 중인 숫자를 천 단위 쉼표로. 숫자·소수점·앞쪽 - 만 남김 (붙여 넣은 "580,300,000원" 도 허용)
function formatNumberInput(raw: string, type: "integer" | "number"): string {
  const neg = raw.trim().startsWith("-") ? "-" : "";
  const cleaned = raw.replace(type === "integer" ? /[^\d]/g : /[^\d.]/g, "");
  const [int, ...rest] = cleaned.split(".");
  const intFmt = int ? Number(int).toLocaleString("ko-KR") : "";
  return neg + intFmt + (type === "number" && rest.length > 0 ? "." + rest.join("") : "");
}
function parseNumberInput(text: string): number | null {
  const s = text.replace(/,/g, "").trim();
  if (!s || s === "-") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// S3 제출 = 담당 팀장에게 보고 메일 보내기.
// 받는 사람·참조(주소록), 제목, 본문, 결과물 첨부는 F축(보고 커뮤니케이션)으로 코드 채점 (server/src/email.ts).
// 보고서 양식 칸은 메일에 붙는 첨부, 검증 메모는 평가 담당자에게만 가는 기록
const BOOK: NpcId[] = ["park", "kang", "jung", "lee"];
const MEMO_GUIDE = ["이렇게 적어 보세요", "· 어떤 자료를 열어 봤는지", "· 오디 결과와 무엇을 비교했는지", "· 다른 점이 있었다면 무엇이고, 어떻게 고쳤는지"].join("\n");

export function SubmitScreen(props: {
  runId: string;
  onBack: () => void;
  onResult: (r: SubmitResult, owner: NpcId) => void;
  onReport: () => void; // 승인 팝업 '확인하기' → AI 리포트
}) {
  const [basket, setBasket] = useState("");
  const [memo, setMemo] = useState("");
  const [owner, setOwner] = useState<NpcId>("park");
  const [deliverable, setDeliverable] = useState("");
  const [fields, setFields] = useState<SubmissionField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [to, setTo] = useState<NpcId[]>([]);
  const [cc, setCc] = useState<NpcId[]>([]);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [attached, setAttached] = useState(false);
  const [openResult, setOpenResult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [approved, setApproved] = useState(false);
  // 모바일(640px 이하): 주소록 대신 받는 사람·참조 줄을 누르면 팀원 목록이 펼쳐짐 (Figma Frame 214, 고르면 닫힘)
  const isMobile = useIsMobile();
  const [pick, setPick] = useState<"to" | "cc" | null>(null);

  useEffect(() => {
    api.getRun(props.runId).then((r) => {
      setBasket(r.run.basket_text);
      setOwner(r.scenario.owner_npc_id);
      setDeliverable(r.task_card.deliverable);
      setFields(r.submission_fields);
      // 재제출이면 지난 입력값·메일을 채워 둠
      const prev = r.submissions.at(-1);
      const last = prev?.fields;
      if (r.submission_fields && last) {
        const init: Record<string, string> = {};
        for (const f of r.submission_fields) {
          if (last[f.id] === undefined) continue;
          // 선택 칸은 보기 id 그대로, 숫자 칸은 쉼표 형식으로
          init[f.id] = f.type === "choice" ? String(last[f.id]) : formatNumberInput(String(last[f.id]), f.type);
        }
        setValues(init);
      }
      if (prev?.email) {
        setTo(prev.email.to);
        setCc(prev.email.cc);
        setSubject(prev.email.subject);
        setBody(prev.email.body);
        setAttached(prev.email.attach_result);
      }
    });
  }, [props.runId]);

  // 주소록: 한 사람은 받는 사람·참조 중 한 곳에만
  const place = (id: NpcId, where: "to" | "cc") => {
    const inTo = to.includes(id);
    const inCc = cc.includes(id);
    if (where === "to") {
      setTo(inTo ? to.filter((x) => x !== id) : [...to, id]);
      if (inCc) setCc(cc.filter((x) => x !== id));
    } else {
      setCc(inCc ? cc.filter((x) => x !== id) : [...cc, id]);
      if (inTo) setTo(to.filter((x) => x !== id));
    }
  };

  const submit = async () => {
    if (to.length === 0) return setErr("받는 사람을 주소록에서 골라 주세요.");
    if (!subject.trim()) return setErr("제목을 써 주세요.");
    if (body.trim().length < 20) return setErr("본문을 20자 이상 써 주세요.");
    if (memo.trim().length < 10) return setErr("검증 메모를 10자 이상 써 주세요. 무엇을 어떻게 확인했는지.");
    if (!basket.trim()) return setErr("결과물이 비어 있어요. 오디 답을 담거나 직접 써 주세요.");
    let parsed: Record<string, number | string> | undefined;
    if (fields) {
      parsed = {};
      for (const f of fields) {
        if (f.type === "choice") {
          const id = values[f.id];
          if (!id) {
            if (f.required) return setErr(`보고서 양식 · ${f.label}: 하나를 골라 주세요.`);
            continue;
          }
          parsed[f.id] = id;
          continue;
        }
        const n = parseNumberInput(values[f.id] ?? "");
        if (n === null) {
          if (f.required) return setErr(`보고서 양식 · ${f.label} 칸을 채워 주세요.`);
          continue;
        }
        parsed[f.id] = n;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      await api.putBasket(props.runId, basket);
      const r = await api.submit(props.runId, memo.trim(), parsed, { to, cc, subject: subject.trim(), body: body.trim(), attach_result: attached });
      // 승인이면 이 화면 위에 '수고하셨어요' 팝업 → 리포트. 반려·3회 반려 종료는 검토 화면 (Figma 132:4090)
      if (r.decision === "approve") {
        setApproved(true);
        setBusy(false);
      }
      else props.onResult(r, owner);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "보내기 실패");
      setBusy(false);
    }
  };

  const onTab = (t: MobileTab) => {
    if (t === "submit" || busy) return;
    mobileNav.pending = t;
    props.onBack();
  };
  const picker = (where: "to" | "cc") =>
    isMobile &&
    pick === where && (
      <div className="sk-m-pick" role="listbox" aria-label={where === "to" ? "받는 사람 고르기" : "참조 고르기"}>
        {BOOK.map((id) => {
          const on = (where === "to" ? to : cc).includes(id);
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={on}
              className={on ? "on" : ""}
              onClick={() => {
                place(id, where);
                setPick(null);
              }}
            >
              <Avatar who={id} size={34} />
              <b>{NPC_INFO[id].name}</b>
              <small>{NPC_INFO[id].role}</small>
            </button>
          );
        })}
      </div>
    );

  const chip = (id: NpcId, where: "to" | "cc") => (
    <span className="ws-mail-chip" key={id}>
      <Avatar who={id} size={24} />
      {NPC_INFO[id].name}
      <button type="button" aria-label={`${NPC_INFO[id].name} 빼기`} onClick={() => place(id, where)} disabled={busy}>
        <Icon name="close" />
      </button>
    </span>
  );

  return (
    <div className="ws ws-col sk-submit">
      {isMobile ? (
        // Figma 제출 179:6908: 제목만, 이동은 아래 BNV
        <header className="sk-m-head">
          <h1>보고 메일 쓰기</h1>
        </header>
      ) : (
      <header className="sk-top between">
        <h1 className="sk-top-title">제출 작성하기</h1>
        <button className="sk-leave" onClick={props.onBack} disabled={busy}>
          <img src="/assets/ui/ic-logout.svg" width={16} height={16} alt="" />
          돌아가기
        </button>
      </header>
      )}
      {approved && (
        <div className="sk-modal-dim" role="dialog" aria-modal="true" aria-labelledby="sk-done-title">
          <div className="sk-modal">
            <h2 id="sk-done-title">수고하셨어요!</h2>
            <p>바로 ai 리포트 결과를 확인하세요.</p>
            <button className="sk-btn block" onClick={props.onReport} autoFocus>
              확인하기
            </button>
          </div>
        </div>
      )}
      <div className="ws-page">
        <div className="ws-cols lean">
          <section className="ws-card ws-mail">
            <div className="ws-mail-row">
              <span>받는 사람</span>
              <div className="ws-mail-chips">{to.length ? to.map((id) => chip(id, "to")) : isMobile ? null : <em>오른쪽 주소록에서 추가</em>}</div>
              {isMobile && (
                <button type="button" className={`sk-m-chev ${pick === "to" ? "open" : ""}`} aria-label="받는 사람 고르기" aria-expanded={pick === "to"} onClick={() => setPick(pick === "to" ? null : "to")} disabled={busy}>
                  <img src="/assets/ui/ic-chevron-down.svg" width={24} height={24} alt="" />
                </button>
              )}
            </div>
            {picker("to")}
            <div className="ws-mail-row">
              <span>참조</span>
              <div className="ws-mail-chips">{cc.length ? cc.map((id) => chip(id, "cc")) : <em>없음</em>}</div>
              {isMobile && (
                <button type="button" className={`sk-m-chev ${pick === "cc" ? "open" : ""}`} aria-label="참조 고르기" aria-expanded={pick === "cc"} onClick={() => setPick(pick === "cc" ? null : "cc")} disabled={busy}>
                  <img src="/assets/ui/ic-chevron-down.svg" width={24} height={24} alt="" />
                </button>
              )}
            </div>
            {picker("cc")}
            <label className="ws-mail-row">
              <span>제목</span>
              <input className="ws-mail-subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={120} disabled={busy} />
            </label>
            <textarea className="ws-mail-body" rows={14} placeholder={isMobile ? "보고 할 메시지를 작성하세요" : undefined} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} disabled={busy} aria-label="본문" />
            <div className="ws-mail-attach">
              <span>첨부</span>
              {attached ? (
                <span className="ws-mail-file">
                  <Icon name="task" />
                  결과물 ({basket.length.toLocaleString()}자)
                  <button type="button" onClick={() => setOpenResult(!openResult)} disabled={busy}>
                    {openResult ? "접기" : "열어 보기"}
                  </button>
                  <button type="button" aria-label="첨부 빼기" onClick={() => setAttached(false)} disabled={busy}>
                    <Icon name="close" />
                  </button>
                </span>
              ) : (
                <button type="button" className="ws-btn" onClick={() => setAttached(true)} disabled={busy}>
                  결과물 첨부하기
                </button>
              )}
            </div>
            {attached && openResult && (
              <>
                <p className="ws-fine">요구 형식: {deliverable}</p>
                <textarea className="ws-textarea" rows={12} value={basket} onChange={(e) => setBasket(e.target.value)} placeholder="오디 답변을 담거나 직접 작성" disabled={busy} />
              </>
            )}
            {err && !isMobile && <p className="ws-notice flat">{err}</p>}
            {!isMobile && (
              <button className="ws-btn primary block lg" disabled={busy} onClick={submit}>
                {busy ? "팀장님이 보는 중…" : "보내기"}
              </button>
            )}
          </section>
          <div className="ws-stack">
            <section className="ws-card sk-pc-only">
              <h3>주소록</h3>
              <div className="ws-book">
                {BOOK.map((id) => (
                  <div className="ws-book-row" key={id}>
                    <Avatar who={id} size={28} />
                    <span className="ws-book-name">
                      <b>{NPC_INFO[id].name}</b>
                      <small>{NPC_DUTY[id]}</small>
                    </span>
                    <button type="button" className={`ws-choice${to.includes(id) ? " on" : ""}`} aria-pressed={to.includes(id)} onClick={() => place(id, "to")} disabled={busy}>
                      받는 사람
                    </button>
                    <button type="button" className={`ws-choice${cc.includes(id) ? " on" : ""}`} aria-pressed={cc.includes(id)} onClick={() => place(id, "cc")} disabled={busy}>
                      참조
                    </button>
                  </div>
                ))}
              </div>
            </section>
            {fields && (
              <section className="ws-card">
                <h3>{isMobile ? "보고서 양식 [필수]" : "보고서 양식 (필수)"}</h3>
                <p className="ws-fine">결과물의 핵심 숫자와 판단을 칸에 옮겨 주세요. 메일에 함께 붙고, 팀장님이 이것부터 대조합니다.</p>
                <div className="ws-stack">
                  {fields.map((f) =>
                    f.type === "choice" ? (
                      <div key={f.id} className="ws-field" role="radiogroup" aria-label={f.label}>
                        <span>{f.label}</span>
                        <div className="ws-choices">
                          {(f.options ?? []).map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              role="radio"
                              aria-checked={values[f.id] === o.id}
                              className={`ws-choice${values[f.id] === o.id ? " on" : ""}`}
                              onClick={() => setValues((v) => ({ ...v, [f.id]: o.id }))}
                              disabled={busy}
                            >
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <label key={f.id} className="ws-field">
                        <span>
                          {f.label} ({f.unit})
                        </span>
                        <input
                          className="ws-input"
                          inputMode={f.type === "integer" ? "numeric" : "decimal"}
                          value={values[f.id] ?? ""}
                          placeholder={isMobile ? "숫자만 입력하세요." : "숫자만"}
                          onChange={(e) => setValues((v) => ({ ...v, [f.id]: formatNumberInput(e.target.value, f.type === "number" ? "number" : "integer") }))}
                          disabled={busy}
                        />
                      </label>
                    ),
                  )}
                </div>
              </section>
            )}
            <section className="ws-card">
              <h3>{isMobile ? "검증 메모 [필수]" : "검증 메모 (필수)"}</h3>
              <p className="ws-fine">무엇을, 어떻게 확인했는지. 메일에는 안 들어가고 평가 담당자만 봅니다. 실제 열람·대화 기록과 대조됩니다.</p>
              <textarea className="ws-textarea" rows={6} maxLength={4000} value={memo} onChange={(e) => setMemo(e.target.value)} placeholder={MEMO_GUIDE} disabled={busy} />
            </section>
            {/* 모바일: 메일·양식·메모를 다 쓴 맨 아래에서 제출 (Figma 제출 179:6908) */}
            {isMobile && (
              <>
                {err && <p className="ws-notice flat">{err}</p>}
                <button className="ws-btn primary block lg" disabled={busy} onClick={submit}>
                  {busy ? "팀장님이 보는 중…" : "제출하기"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
      {isMobile && <Bnv active="submit" onTab={onTab} />}
    </div>
  );
}
