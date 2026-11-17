import { useState } from "react";

// S1 온보딩: 3장, 30초
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
          <p>3개월 전 사내 AI 비서 <b>오디(ODI)</b>를 도입했습니다. 표, 계산, 초안, 뭐든 시킬 수 있어요.</p>
          <blockquote>"AI가 만든 결과물의 검증 책임은 담당자에게 있다."</blockquote>
          <p>오디는 유능하지만 가끔 자신 있게 틀립니다. 팀장님은 오디가 아니라 {nickname} 씨를 봅니다.</p>
        </>
      ),
    },
    {
      title: "조작법",
      body: (
        <ul>
          <li>사무실의 <b>캐릭터를 클릭</b>하면 대화. 팀장에게 질문, 이하늘 선배에게 힌트.</li>
          <li>하단 바의 <b>[오디]</b>에서 일을 시키고, 쓸 만한 답은 <b>결과물로 담기</b>.</li>
          <li><b>[첨부 데이터]</b>에서 원본을 직접 봅니다. 다운로드는 없어요.</li>
          <li><b>[제출]</b>할 때 "무엇을 어떻게 확인했는지" 검증 메모를 씁니다.</li>
        </ul>
      ),
    },
  ];
  const s = slides[i];
  return (
    <div className="screen center">
      <div className="card narrow">
        <p className="tiny muted">
          {i + 1} / {slides.length}
        </p>
        <h2>{s.title}</h2>
        <div className="prose">{s.body}</div>
        <div className="row end">
          {i > 0 && (
            <button className="btn" onClick={() => setI(i - 1)}>
              이전
            </button>
          )}
          {i < slides.length - 1 ? (
            <button className="btn primary" onClick={() => setI(i + 1)}>
              다음
            </button>
          ) : (
            <button className="btn primary" onClick={onDone}>
              배치표 보기
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
