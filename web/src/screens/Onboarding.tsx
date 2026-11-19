import { useState } from "react";
import { Badge, SimternTop } from "../ui/Badge";

// S1 온보딩: 2장. 사용법은 사무실에서 이하늘(사수)이 알려 준다 (2026-11-18 회의: 온보딩 글이 많아 피로)
// 디자인: Figma "UI 적용 테스트 11.19 / 온보딩 출근" 2장
export function Onboarding({ nickname, onDone }: { nickname: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const slides = [
    {
      title: "입사를 환영해요!",
      body: (
        <p>
          (주)오름은 유럽과 동남아에서 주방·생활용품을 수입해
          <br />
          국내에 유통하는 <b>무역회사예요</b>
        </p>
      ),
      foot: `${nickname} 님은 앞으로 오름의 인턴으로 업무를 받아요`,
    },
    {
      title: "사내 AI 오디를 활용해 보세요",
      body: <p>최근 오름은 사내 AI '오디'를 도입했어요. 오디와 함께 업무를 해결해 보세요.</p>,
      foot: "퇴근하면 AI를 어떻게 활용했는지 리포트로 알려드려요.",
    },
  ];
  const s = slides[i];
  return (
    <div className="ws sk-intro">
      <SimternTop />
      <main className="sk-intro-body">
        <section className="sk-intro-copy sk-onb" key={i}>
          <h1 className="sk-display">{s.title}</h1>
          <div className="sk-lead">{s.body}</div>
          <p className="sk-lead sk-onb-foot">{s.foot}</p>
          <div className="sk-actions">
            {i > 0 && (
              <button className="sk-btn ghost" onClick={() => setI(i - 1)}>
                이전
              </button>
            )}
            <button className="sk-btn" onClick={() => (i < slides.length - 1 ? setI(i + 1) : onDone())}>
              다음
            </button>
          </div>
        </section>
        <Badge />
      </main>
    </div>
  );
}
