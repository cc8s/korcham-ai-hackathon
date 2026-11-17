import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { NpcId, SubmitResult } from "../types";

// S3 제출: 결과물(바구니) 편집 + 검증 메모 필수
export function SubmitScreen(props: {
  runId: string;
  onBack: () => void;
  onResult: (r: SubmitResult, owner: NpcId) => void;
}) {
  const [basket, setBasket] = useState("");
  const [memo, setMemo] = useState("");
  const [owner, setOwner] = useState<NpcId>("park");
  const [deliverable, setDeliverable] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.getRun(props.runId).then((r) => {
      setBasket(r.run.basket_text);
      setOwner(r.scenario.owner_npc_id);
      setDeliverable(r.task_card.deliverable);
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
    setBusy(true);
    setErr(null);
    try {
      await api.putBasket(props.runId, basket);
      const r = await api.submit(props.runId, memo.trim());
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
  );
}
