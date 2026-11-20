import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type SessionInfo } from "../types";
import { Avatar } from "../ui/kit";

const STATE_LABEL: Record<string, { label: string; tone: string }> = {
  assigned: { label: "진행 중", tone: "info" },
  working: { label: "진행 중", tone: "info" },
  reviewing: { label: "검토 중", tone: "info" },
  rejected: { label: "반려됨 · 다시 작업", tone: "warn" },
  approved: { label: "승인 · 리포트 대기", tone: "accent" },
  evaluated: { label: "완료", tone: "accent" },
};

// S6 시나리오 선택 (순환 근무 배치표)
export function Select(props: {
  sessionId: string;
  nickname: string;
  onStart: (rid: string) => void;
  onResume: (rid: string) => void;
  onLogout: () => void;
}) {
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSession(props.sessionId)
      .then(setInfo)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) props.onLogout();
        else setErr("서버에 연결할 수 없어요");
      });
  }, [props.sessionId]);

  const start = async (sid: string) => {
    setBusy(sid);
    try {
      const r = await api.startScenario(sid, props.sessionId);
      props.onStart(r.run_id);
    } catch (e) {
      // 하루 이용 한도·체험 분량 소진은 서버 문구를 그대로 보여 준다
      setErr(e instanceof ApiError && e.status !== 500 ? e.message : "시작 실패. 다시 눌러 주세요");
      setBusy(null);
    }
  };

  return (
    <div className="ws ws-col sk-select">
      <header className="sk-top between">
        <span className="sk-logo">
          <img src="/assets/ui/oreum-logo-sm.svg" width={26} height={26} alt="" />
          <b>(주)오름</b>
        </span>
        <span className="sk-top-actions">
          <button className="sk-btn ghost" onClick={props.onLogout}>
            퇴근하기
          </button>
        </span>
      </header>
      <div className="ws-page sk-select-page">
        <div className="sk-page-head">
          <h1 className="sk-display">자격증별 실무 업무</h1>
          <p>가지고 있는 자격증의 업무를 골라 시작해 보세요.</p>
        </div>
        {err && <p className="ws-notice flat">{err}</p>}
        {!info && !err && <p className="ws-empty">불러오는 중…</p>}
        <div className="sk-cards">
          {info?.scenarios.map((s) => {
            const npc = NPC_INFO[s.owner_npc_id];
            const run = s.run;
            const closed = run && (run.state === "approved" || run.state === "evaluated" || run.reject_count >= 3);
            const st = run ? STATE_LABEL[run.state] : { label: "미시작", tone: "" };
            return (
              <div className="sk-card" key={s.id}>
                <div className="sk-card-top">
                  <span className="sk-cert">{s.cert}</span>
                  <span className={`sk-state ${st.tone}`}>{st.label}</span>
                </div>
                <h3>{s.title}</h3>
                <div className="sk-owner">
                  <Avatar who={s.owner_npc_id} size={34} />
                  <b>{npc.name}</b>
                  <span>{npc.role}</span>
                </div>
                <p className="sk-caption">업무소요 15~20분 · 첨부 {s.attachments.length}개</p>
                {!run || closed ? (
                  <button className="sk-btn block" disabled={busy !== null} onClick={() => start(s.id)}>
                    {run ? "다시 도전" : busy === s.id ? "배정 중…" : "담당하기"}
                  </button>
                ) : (
                  <button className="sk-btn block" onClick={() => props.onResume(run.id)}>
                    이어서 하기
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
