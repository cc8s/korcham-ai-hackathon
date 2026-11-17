import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { SAMPLE_REPORT } from "../sample_report";
import { NPC_INFO, type Report, type SessionInfo } from "../types";

const STATE_LABEL: Record<string, string> = {
  assigned: "진행 중",
  working: "진행 중",
  reviewing: "검토 중",
  rejected: "반려됨 · 다시 작업",
  approved: "승인 · 리포트 대기",
  evaluated: "완료",
};

// S6 시나리오 선택 (순환 근무 배치표)
export function Select(props: {
  sessionId: string;
  nickname: string;
  onStart: (rid: string) => void;
  onResume: (rid: string) => void;
  onSampleReport: (r: Report) => void;
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
    } catch {
      setErr("시작 실패. 다시 눌러 주세요");
      setBusy(null);
    }
  };

  return (
    <div className="screen">
      <header className="topbar">
        <b>순환 근무 배치표</b>
        <span className="muted">{props.nickname} 씨 · 수습</span>
        <span className="grow" />
        <button className="btn small" onClick={() => props.onSampleReport(SAMPLE_REPORT)}>
          샘플 리포트 보기
        </button>
        <button className="btn small ghost" onClick={props.onLogout}>
          퇴근
        </button>
      </header>
      {err && <p className="error">{err}</p>}
      <div className="grid">
        {info?.scenarios.map((s, i) => {
          const npc = NPC_INFO[s.owner_npc_id];
          const run = s.run;
          const closed = run && (run.state === "approved" || run.state === "evaluated" || run.reject_count >= 3);
          return (
            <div className="card" key={s.id}>
              <p className="tiny muted">
                {i + 1}주차 · {s.cert}
              </p>
              <h3>{s.title}</h3>
              <p>
                <span className="dot" style={{ background: npc.color }} /> {npc.name} {npc.role}
              </p>
              <p className="muted tiny">첨부 {s.attachments.length}개 · 15~20분</p>
              <p className="status">{run ? STATE_LABEL[run.state] : "미시작"}</p>
              {!run || closed ? (
                <button className="btn primary" disabled={busy !== null} onClick={() => start(s.id)}>
                  {run ? "다시 도전" : "출근"}
                </button>
              ) : (
                <button className="btn primary" onClick={() => props.onResume(run.id)}>
                  이어서
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
