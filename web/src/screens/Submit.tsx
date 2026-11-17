import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { NpcId, SubmissionField, SubmitResult } from "../types";

// 입력 중인 숫자를 천 단위 쉼표로. 숫자·소수점·앞쪽 - 만 남김 (붙여 넣은 "580,300,000원" 도 허용)
function formatNumberInput(raw: string, type: SubmissionField["type"]): string {
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

// S3 제출: 결과물(바구니) 편집 + 구조화 제출 칸(시나리오별) + 검증 메모 필수
export function SubmitScreen(props: {
  runId: string;
  onBack: () => void;
  onResult: (r: SubmitResult, owner: NpcId) => void;
}) {
  const [basket, setBasket] = useState("");
  const [memo, setMemo] = useState("");
  const [owner, setOwner] = useState<NpcId>("park");
  const [deliverable, setDeliverable] = useState("");
  const [fields, setFields] = useState<SubmissionField[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getRun(props.runId).then((r) => {
      setBasket(r.run.basket_text);
      setOwner(r.scenario.owner_npc_id);
      setDeliverable(r.task_card.deliverable);
      setFields(r.submission_fields);
      // 재제출이면 지난 입력값을 채워 둠
      const last = r.submissions.at(-1)?.fields;
      if (r.submission_fields && last) {
        const init: Record<string, string> = {};
        for (const f of r.submission_fields) if (last[f.id] !== undefined) init[f.id] = formatNumberInput(String(last[f.id]), f.type);
        setValues(init);
      }
    });
  }, [props.runId]);

  const submit = async () => {
    if (memo.trim().length < 10) {
      setErr("검증 메모를 10자 이상 써 주세요. 무엇을 어떻게 확인했는지.");
      return;
    }
    if (!basket.trim()) {
      setErr("결과물이 비어 있어요.");
      return;
    }
    let parsed: Record<string, number> | undefined;
    if (fields) {
      parsed = {};
      for (const f of fields) {
        const n = parseNumberInput(values[f.id] ?? "");
        if (n === null) {
          if (f.required) {
            setErr(`${f.label} 칸을 채워 주세요.`);
            return;
          }
          continue;
        }
        parsed[f.id] = n;
      }
    }
    setBusy(true);
    setErr(null);
    try {
      await api.putBasket(props.runId, basket);
      const r = await api.submit(props.runId, memo.trim(), parsed);
      props.onResult(r, owner);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "제출 실패");
      setBusy(false);
    }
  };

  return (
    <div className="ws ws-col">
      <header className="ws-top">
        <button className="ws-btn" onClick={props.onBack} disabled={busy}>
          ← 사무실
        </button>
        <b>팀장 검토 요청</b>
      </header>
      <div className="ws-page">
        <div className="ws-cols lean">
          <section className="ws-card">
            <h3>결과물</h3>
            <p className="ws-fine">요구 형식: {deliverable}</p>
            <textarea className="ws-textarea" rows={20} value={basket} onChange={(e) => setBasket(e.target.value)} placeholder="오디 답변을 담거나 직접 작성" />
          </section>
          <div className="ws-stack">
            {fields && (
              <section className="ws-card">
                <h3>보고 숫자 (필수)</h3>
                <p className="ws-fine">결과물의 핵심 숫자를 칸에 옮겨 적어 주세요. 팀장님이 이 숫자부터 대조합니다.</p>
                <div className="ws-stack">
                  {fields.map((f) => (
                    <label key={f.id} className="ws-field">
                      <span>
                        {f.label} ({f.unit})
                      </span>
                      <input
                        className="ws-input"
                        inputMode={f.type === "integer" ? "numeric" : "decimal"}
                        value={values[f.id] ?? ""}
                        placeholder="숫자만"
                        onChange={(e) => setValues((v) => ({ ...v, [f.id]: formatNumberInput(e.target.value, f.type) }))}
                        disabled={busy}
                      />
                    </label>
                  ))}
                </div>
              </section>
            )}
            <section className="ws-card">
              <h3>검증 메모 (필수)</h3>
              <p className="ws-fine">무엇을, 어떻게 확인했는지. 팀장과 평가 담당자가 봅니다. 실제 열람·대화 기록과 대조됩니다.</p>
              <div className="ws-stack">
                <textarea
                  className="ws-textarea"
                  rows={8}
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  placeholder="예) 원본 124행과 주문번호 개수를 비교해 중복 3건을 찾았고, 오디에게 거래처명 정규화를 다시 시켰습니다."
                />
                {err && <p className="ws-notice flat">{err}</p>}
                <button className="ws-btn primary block lg" disabled={busy} onClick={submit}>
                  {busy ? "팀장님이 보는 중…" : "제출"}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
