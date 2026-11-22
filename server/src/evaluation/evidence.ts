import { getRun, listMessages, listDataViews, listSubmissions, type RunRow } from "../db.js";
import type { OdiToolLog } from "../tools/index.js";
import type { NpcId } from "../scenarios.js";
import type { FieldValue } from "../grading.js";
import type { Email } from "../email.js";

// 평가 입력. DB 에서 모으지만 형태는 순수 데이터라, 골든셋 테스트가 DB 없이 직접 만들 수 있다.
// at = 시각(ms). 같은 초에 생긴 기록은 순서를 장담할 수 없으므로 판정은 "이전(<)" 기준으로 한다
export interface EvOdiTurn {
  at: number;
  text: string; // 사용자 지시 원문
  reply: string; // 오디 답변
  toolCalls: OdiToolLog[]; // 이 답변을 만들며 부른 계산 도구 (도구 시나리오만)
  aiWarned: string[]; // 이 답변에서 오디가 사용자보다 먼저 경고한 함정 id (meta.ai_warned, src/aiWarn.ts)
}
export interface EvNpcTurn {
  at: number;
  to: NpcId;
  text: string;
  hint: boolean; // 이하늘(사수)에게 한 질문 (이름은 예전 힌트 기능에서 이어짐)
}
export interface EvView {
  at: number;
  file: string;
  sort: boolean;
  search: boolean;
}
export interface EvSub {
  at: number;
  attempt: number;
  memo: string;
  basket: string;
  decision: "approve" | "reject" | null; // 검토 실패로 결과가 없으면 null
  trapCaught: Record<string, boolean>;
  checks: { id: string; ok: boolean }[] | null; // 구조화 제출의 text_checks (없으면 null)
  values: Record<string, FieldValue> | null; // 구조화 제출 칸 값
  email: Email | null; // 결과물 제출 메일 (이 기능 전 제출은 null)
}
export interface Evidence {
  startedAt: number;
  odi: EvOdiTurn[];
  npc: EvNpcTurn[];
  views: EvView[];
  subs: EvSub[];
  odiCallsUsed: number;
  hintLevel: number;
  rejectCount: number;
}

const NPC_IDS = new Set(["kang", "park", "jung", "lee"]);

// SQLite datetime('now') = "YYYY-MM-DD HH:MM:SS" (UTC)
export const parseAt = (s: string) => Date.parse(s.replace(" ", "T") + "Z");

const parseJson = <T>(s: string | null): T | null => {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};

export function collectEvidence(runId: string): { run: RunRow; ev: Evidence } {
  const run = getRun(runId);
  if (!run) throw new Error(`run 없음: ${runId}`);

  // 오디: user 다음 assistant 가 한 쌍. 실패한 호출은 저장되지 않으므로 쌍이 깨지지 않는다
  const odi: EvOdiTurn[] = [];
  const odiMsgs = listMessages(runId, "odi");
  for (let i = 0; i < odiMsgs.length; i++) {
    const m = odiMsgs[i];
    if (m.role !== "user") continue;
    const next = odiMsgs[i + 1]?.role === "assistant" ? odiMsgs[i + 1] : undefined;
    const meta = parseJson<{ tool_calls?: OdiToolLog[]; ai_warned?: string[] }>(next?.meta ?? null);
    odi.push({
      at: parseAt(m.created_at),
      text: m.content,
      reply: next?.content ?? "",
      toolCalls: meta?.tool_calls ?? [],
      aiWarned: meta?.ai_warned ?? [],
    });
  }

  // 팀원: 사용자 발화만. 제출 기록(meta.submission)은 대화가 아니므로 뺀다
  const npc: EvNpcTurn[] = [];
  for (const m of listMessages(runId)) {
    if (!NPC_IDS.has(m.agent) || m.role !== "user") continue;
    const meta = parseJson<{ hint_request?: boolean; submission?: number }>(m.meta);
    if (meta?.submission !== undefined) continue;
    npc.push({ at: parseAt(m.created_at), to: m.agent as NpcId, text: m.content, hint: meta?.hint_request === true });
  }

  const views: EvView[] = listDataViews(runId).map((v) => ({
    at: parseAt(v.opened_at),
    file: v.file,
    sort: v.used_sort === 1,
    search: v.used_search === 1,
  }));

  const subs: EvSub[] = listSubmissions(runId).map((s) => {
    const review = parseJson<{ decision?: "approve" | "reject"; trap_caught?: { id: string; caught: boolean }[] }>(s.review_json);
    const grading = parseJson<{ checks?: { id: string; ok: boolean }[] }>(s.grading_json);
    return {
      at: parseAt(s.created_at),
      attempt: s.attempt,
      memo: s.verify_memo,
      basket: s.basket_text,
      decision: review?.decision ?? null,
      trapCaught: Object.fromEntries((review?.trap_caught ?? []).map((t) => [t.id, t.caught])),
      checks: grading?.checks ?? null,
      values: parseJson<Record<string, FieldValue>>(s.fields_json),
      email: parseJson<Email>(s.email_json),
    };
  });

  return {
    run,
    ev: {
      startedAt: parseAt(run.created_at),
      odi,
      npc,
      views,
      subs,
      odiCallsUsed: run.odi_calls_used,
      hintLevel: run.hint_level,
      rejectCount: run.reject_count,
    },
  };
}
