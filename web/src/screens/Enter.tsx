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
    <div className="ws ws-center">
      <div className="ws-card ws-narrow">
        <span className="ws-brand-mark lg">오름</span>
        <h1 className="ws-title">(주)오름</h1>
        <p className="ws-lead">
          주방·생활용품 수입 유통 회사. 오늘부터 수습 신입입니다. 사내 AI 비서 "오디"와 함께 팀장님 과제를 해결하고, AI를 어떻게 썼는지 리포트를 받습니다.
        </p>
        <label className="ws-field">
          <span>사원증에 쓸 이름 (닉네임)</span>
          <input
            className="ws-input"
            value={nick}
            maxLength={8}
            placeholder="2~8자"
            onChange={(e) => setNick(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && go()}
            autoFocus
          />
        </label>
        {/^[가-힣]{2,3}$/.test(nick.trim()) && (
          <p className="ws-fine">실명이라면 별명으로 바꿔 주세요. 닉네임은 팀원 대사로 AI 대화에 들어갑니다.</p>
        )}
        {err && <p className="ws-notice flat">{err}</p>}
        <button className="ws-btn primary block lg" disabled={busy} onClick={go}>
          {busy ? "출입증 발급 중…" : "입사하기"}
        </button>
        <p className="ws-fine">실명·연락처는 받지 않습니다. 대화·메모에 전화번호·이메일 같은 개인정보를 쓰면 서버가 가려서 AI 에 보냅니다.</p>
      </div>
    </div>
  );
}
