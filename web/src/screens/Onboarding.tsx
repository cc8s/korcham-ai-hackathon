import { useState } from "react";

// S1 온보딩: 2장. 사용법은 사무실에서 이하늘(사수)이 알려 준다 (2026-11-18 회의: 온보딩 글이 많아 피로)
export function Onboarding({ nickname, onDone }: { nickname: string; onDone: () => void }) {
  const [i, setI] = useState(0);
  const slides = [
    {
      title: "첫 출근",
      body: (
        <>
          <p>
            <b>(주)오름</b>은 유럽·동남아에서 주방·생활용품을 수입해 국내에 유통하는 직원 28명 회사입니다.
          </p>
          <p>{nickname} 씨는 3개월 순환 근무 중인 수습 신입. 경영지원팀·영업팀·무역팀을 돌며 과제를 받습니다.</p>
        </>
      ),
    },
    {
      title: "사규 한 줄",
      body: (
        <>
          <p>
            3개월 전 사내 AI 비서 <b>오디(ODI)</b>를 도입했습니다. 표, 계산, 초안, 뭐든 시킬 수 있어요.
          </p>
          <blockquote className="ws-callout">"AI가 만든 결과물의 검증 책임은 담당자에게 있다."</blockquote>
          <p>오디는 유능하지만 가끔 자신 있게 틀립니다. 팀장님은 오디가 아니라 {nickname} 씨를 봅니다.</p>
        </>
      ),
    },
  ];
  const s = slides[i];
  return (
    <div className="ws ws-center">
      <div className="ws-card ws-narrow">
        <div className="ws-progress" aria-label={`${i + 1} / ${slides.length}`}>
          {slides.map((_, k) => (
            <i key={k} className={k <= i ? "on" : ""} />
          ))}
        </div>
        <h2 className="ws-title">{s.title}</h2>
        <div className="ws-body">{s.body}</div>
        <div className="ws-actions">
          {i > 0 && (
            <button className="ws-btn" onClick={() => setI(i - 1)}>
              이전
            </button>
          )}
          {i < slides.length - 1 ? (
            <button className="ws-btn primary" onClick={() => setI(i + 1)}>
              다음
            </button>
          ) : (
            <button className="ws-btn primary" onClick={onDone}>
              배치표 보기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
