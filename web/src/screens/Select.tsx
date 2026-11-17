import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { SAMPLE_REPORT } from "../sample_report";
import { NPC_INFO, type Report, type SessionInfo } from "../types";
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
    } catch (e) {
      // 하루 이용 한도·체험 분량 소진은 서버 문구를 그대로 보여 준다
      setErr(e instanceof ApiError && e.status !== 500 ? e.message : "시작 실패. 다시 눌러 주세요");
      setBusy(null);
    }
  };

  return (
    <div className="ws ws-col">
      <header className="ws-top">
        <span className="ws-brand-mark">오름</span>
        <b>(주)오름</b>
        <small>{props.nickname} · 수습사원</small>
        <span className="ws-grow" />
        <button className="ws-btn" onClick={() => props.onSampleReport(SAMPLE_REPORT)}>
          샘플 리포트 보기
        </button>
        <button className="ws-btn" onClick={props.onLogout}>
          퇴근
        </button>
      </header>
      <div className="ws-page">
        <div className="ws-page-head">
          <h1>순환 근무 배치표</h1>
          <p>주차마다 다른 팀에서 과제를 받습니다. 순서는 상관없고, 한 과제에 15~20분 걸립니다.</p>
        </div>
        {err && <p className="ws-notice flat">{err}</p>}
        {!info && !err && <p className="ws-empty">불러오는 중…</p>}
        <div className="ws-scn-grid">
          {info?.scenarios.map((s, i) => {
            const npc = NPC_INFO[s.owner_npc_id];
            const run = s.run;
            const closed = run && (run.state === "approved" || run.state === "evaluated" || run.reject_count >= 3);
            const st = run ? STATE_LABEL[run.state] : { label: "미시작", tone: "" };
            return (
              <div className="ws-card ws-scn" key={s.id}>
                <div className="ws-scn-top">
                  <span>{i + 1}주차</span>
                  <span className="ws-tag">{s.cert}</span>
                  <span className={`ws-tag ${st.tone}`}>{st.label}</span>
                </div>
                <h3>{s.title}</h3>
                <div className="ws-scn-owner">
                  <Avatar who={s.owner_npc_id} size={24} />
                  <b>{npc.name}</b> {npc.role}
                </div>
                <p className="ws-fine">첨부 {s.attachments.length}개 · 15~20분</p>
                {!run || closed ? (
                  <button className="ws-btn primary" disabled={busy !== null} onClick={() => start(s.id)}>
                    {run ? "다시 도전" : "출근"}
                  </button>
                ) : (
                  <button className="ws-btn primary" onClick={() => props.onResume(run.id)}>
                    이어서
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
