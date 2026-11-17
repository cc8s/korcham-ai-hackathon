import { NPC_INFO, type NpcId, type SubmitResult } from "../types";
import { Avatar } from "../ui/kit";

// S4 팀장 검토 결과
export function ReviewScreen(props: { result: SubmitResult; owner: NpcId; onRetry: () => void; onReport: () => void }) {
  const { result, owner } = props;
  const npc = NPC_INFO[owner];
  const approved = result.decision === "approve";
  return (
    <div className="ws ws-center">
      <div className="ws-card ws-narrow">
        <p className="ws-fine">
          {result.attempt}차 제출 · 반려 {result.reject_count}/3
        </p>
        <div className="ws-person">
          <Avatar who={owner} size={40} />
          <span>
            <b>{npc.name}</b>
            <small>{npc.role}</small>
          </span>
          <span className={`ws-tag ${approved ? "accent" : "warn"}`}>{approved ? "승인" : "반려"}</span>
        </div>
        <blockquote className={`ws-callout ${approved ? "ok" : "warn"}`}>{result.message}</blockquote>
        {!approved && result.area && (
          <p>
            틀린 영역: <b>{(result.wrong_areas?.length ? result.wrong_areas : [result.area]).join(", ")}</b>
          </p>
        )}
        {approved ? (
          <>
            <p className="ws-lead">승인됐습니다. 이제 "AI를 어떻게 썼는지" 리포트를 봅니다.</p>
            <button className="ws-btn primary block lg" onClick={props.onReport}>
              리포트 보기
            </button>
          </>
        ) : result.closed ? (
          <>
            <p className="ws-lead">"이번엔 제가 마무리하죠. 리포트 보고 다음에 다시 해 봅시다."</p>
            <button className="ws-btn primary block lg" onClick={props.onReport}>
              리포트 보기
            </button>
          </>
        ) : (
          <>
            <p className="ws-lead">오디 대화와 결과물은 그대로 남아 있어요. 어디가 문제인지 원본을 다시 보세요.</p>
            <button className="ws-btn primary block lg" onClick={props.onRetry}>
              다시 작업
            </button>
          </>
        )}
      </div>
    </div>
  );
}
