import { useState } from "react";
import { api, ApiError } from "../api";
import { Badge, SimternTop } from "../ui/Badge";

// S0 입장: 닉네임만. 회원가입·실명 없음 (대회 규정). 디자인: Figma "UI 적용 테스트 11.19 / 심턴 에이전트 소개"
export function Enter({ onEnter }: { onEnter: (s: { id: string; nickname: string }) => void }) {
  const [nick, setNick] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const go = async () => {
    const n = nick.trim();
    if (n.length < 2 || n.length > 8) {
      setErr("이름은 2~8자로 정해 주세요");
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
    <div className="ws sk-intro">
      <SimternTop />
      <main className="sk-intro-body">
        <section className="sk-intro-copy">
          <div className="sk-company">
            <img src="/assets/ui/oreum-logo.svg" width={76} height={76} alt="" />
            <div>
              <h1>(주)오름</h1>
              <p>주방·생활용품 수입 유통 회사</p>
            </div>
          </div>
          <p className="sk-lead">
            오름의 신입 인턴 합격을 축하드려요!
            <br />
            사내 AI "오디"와 함께 업무를 해결하고, AI를 어떻게 활용했는지 리포트로 받아보세요.
          </p>
          <label className="sk-field">
            <span>회사에서 불릴 이름을 정해 주세요</span>
            <input
              value={nick}
              maxLength={8}
              placeholder="이름 (2~8자)"
              onChange={(e) => setNick(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && go()}
              autoFocus
            />
          </label>
          {/^[가-힣]{2,3}$/.test(nick.trim()) && <p className="sk-fine warn">실명이라면 별명으로 바꿔 주세요. 이름은 팀원 대사로 AI 대화에 들어갑니다.</p>}
          {err && <p className="sk-fine err">{err}</p>}
          <button className="sk-btn lg block" disabled={busy} onClick={go}>
            {busy ? "출입증 발급 중…" : "입사하기"}
          </button>
          <p className="sk-fine">실명과 연락처는 저장되지 않아요</p>
        </section>
        <Badge />
      </main>
    </div>
  );
}
