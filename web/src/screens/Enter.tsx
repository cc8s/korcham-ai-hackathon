import { useState } from "react";
import { api, ApiError } from "../api";

// S0 입장: 닉네임만. 회원가입·실명 없음 (대회 규정)
export function Enter({ onEnter }: { onEnter: (s: { id: string; nickname: string }) => void }) {
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const n = nick.trim();
    if (n.length < 2 || n.length > 8) {
      setErr("닉네임은 2~8자");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const s = await api.createSession(n);
      onEnter({ id: s.session_id, nickname: s.nickname });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "서버에 연결할 수 없어요");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen center">
      <div className="card narrow">
        <h1>(주)오름</h1>
        <p className="muted">
          주방·생활용품 수입 유통 회사. 오늘부터 수습 신입입니다.
          <br />
          사내 AI 비서 "오디"와 함께 팀장님 과제를 해결하고, AI를 어떻게 썼는지 리포트를 받습니다.
        </p>
        <label className="field">
          <span>사원증에 쓸 이름 (닉네임)</span>
          <input
            value={nick}
            maxLength={8}
            placeholder="2~8자"
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            autoFocus
          />
        </label>
        {err && <p className="error">{err}</p>}
        <button className="btn primary" disabled={busy} onClick={go}>
          {busy ? "출입증 발급 중..." : "입사하기"}
        </button>
        <p className="tiny muted">실명·연락처는 받지 않습니다. 입력한 닉네임은 세계관 안에서만 쓰입니다.</p>
      </div>
    </div>
  );
}
