import { NPC_INFO, type NpcId, type SubmitResult } from "../types";

// S4 팀장 검토 결과
export function ReviewScreen(props: { result: SubmitResult; owner: NpcId; onRetry: () => void; onReport: () => void }) {
  const { result, owner } = props;
  const npc = NPC_INFO[owner];
  const approved = result.decision === "approve";
  return (
    <div className="screen center">
      <div className="card narrow">
        <p className="tiny muted">
          {result.attempt}차 제출 · 반려 {result.reject_count}/3
        </p>
        <div className="row">
          <span className="avatar" style={{ background: npc.color }}>
            {npc.name[0]}
          </span>
          <div>
            <b>{npc.name}</b> <span className="muted">{npc.role}</span>
          </div>
        </div>
        <blockquote className={approved ? "ok" : "warn"}>{result.message}</blockquote>
        {!approved && result.area && (
          <p>
            틀린 영역: <b>{result.area}</b>
          </p>
        )}
        {approved ? (
          <>
            <p className="ok-text">승인됐습니다. 이제 "AI를 어떻게 썼는지" 리포트를 봅니다.</p>
            <button className="btn primary" onClick={props.onReport}>
              리포트 보기
            </button>
          </>
        ) : result.closed ? (
          <>
            <p className="muted">"이번엔 제가 마무리하죠. 리포트 보고 다음에 다시 해 봅시다."</p>
            <button className="btn primary" onClick={props.onReport}>
              리포트 보기
            </button>
          </>
        ) : (
          <>
            <p className="muted">오디 대화와 결과물은 그대로 남아 있어요. 어디가 문제인지 원본을 다시 보세요.</p>
            <button className="btn primary" onClick={props.onRetry}>
              다시 작업
            </button>
          </>
        )}
      </div>
    </div>
  );
}
