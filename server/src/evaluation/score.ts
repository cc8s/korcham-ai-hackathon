import type { Scenario } from "../scenarios.js";
import type { Evidence } from "./evidence.js";

// 코드 채점 (06 문서 3절 B-코드·C·D·E). 같은 입력이면 항상 같은 점수. LLM 은 여기 관여하지 않는다

// 오디에게 결과를 확인·수정하라고 한 지시 (06 9절 되묻기 정규식)
export const ASK_BACK = /확인|맞아|맞는지|다시|근거|검산|비교|중복|정규화/;
// 도구 없는 시나리오에서 "오디 답이 실제로 바뀌었다"의 근사: 되묻기 직후 답변에 정정 표현
const REPLY_CORRECTED = /정정|수정했|수정하면|잘못|틀렸|바로잡|다시 계산한 결과|죄송/;

// 검증 메모: 행동을 서술했는가 / 원본을 봤다고 하는가 / 재계산을 했다고 하는가
const MEMO_ACTION = /원본|원문|대조|비교|정렬|검색|검산|재계산|다시 계산|중복|정규화|띄어쓰기|증빙|열어|확인했/;
const MEMO_VIEW = /원본|원문|대조|열어|열람|파일/;
const MEMO_SORT = /정렬/;
const MEMO_SEARCH = /검색/; // "찾아"는 "차이도 찾아" 같은 일반 서술에도 나와서 뺌
const MEMO_RECALC = /중복|정규화|띄어쓰기|재계산|다시 계산|검산|10 ?%|정정/;

const HINT_COEF = [1, 0.8, 0.6, 0.4];
const REJECT_COEF = 0.5;
// 오디가 먼저 경고한 함정을 사용자가 확인해 잡은 경우 (샌드박스 원칙 3). 임시값, 사용자 결정 대기
const AI_WARN_COEF = 0.7;

export type TrapPath = "self" | "hint1" | "hint2" | "hint3" | "ai_warned" | "reject" | "none";

export interface TrapScore {
  id: string;
  desc: string;
  found: boolean;
  path: TrapPath;
  coef: number;
  score: number;
  // 오디가 경고했는데 끝내 못 잡음 (found=false 일 때만 true 로 붙음). 리포트·평가 코칭용
  warned_ignored?: boolean;
}

export interface CodeScore {
  B: { data_viewed: number; active_explore: number; ask_back: number; memo_consistent: number; total: number };
  C: { traps: TrapScore[]; total: number };
  D: { approved: boolean; reject_count: number; format_ok: boolean; total: number };
  E_partial: { odi_calls: number; hints: number; odi_score: number; hint_score: number };
  // AI 최소 조건 (10 문서 7절 결정 1, 2026-11-18): 오디에게 결과를 고치게 해서 실제로 바뀐 적이 있는가.
  // 없으면 등급 상한 B
  aiMinMet: boolean;
  durationMin: number;
}

function askBackChanged(ev: Evidence): boolean {
  if (ev.odi.some((t) => t.toolCalls.some((c) => c.defaults_changed && c.differs_from_default === true))) return true;
  return ev.odi.some((t) => ASK_BACK.test(t.text) && REPLY_CORRECTED.test(t.reply));
}

// 메모 신뢰성: 3 = 서술한 행동이 기록과 맞음, 1 = 형식적, 0 = 기록과 어긋남
export function memoConsistency(memo: string, ev: Evidence, sc: Scenario): number {
  if (!MEMO_ACTION.test(memo)) return 1;
  const viewed = (part: string) => ev.views.some((v) => v.file.includes(part));
  if (MEMO_VIEW.test(memo) && ev.views.length === 0) return 0;
  if (MEMO_SORT.test(memo) && !ev.views.some((v) => v.sort)) return 0;
  if (MEMO_SEARCH.test(memo) && !ev.views.some((v) => v.search)) return 0;
  // "신고필증 + 원본/대조/파일" 처럼 특정 첨부를 봤다고 하면 그 파일 열람 기록이 있어야 함 (문장 단위)
  for (const clause of memo.split(/[.,。\n]/)) {
    if (!MEMO_VIEW.test(clause)) continue;
    for (const [kw, part] of Object.entries(sc.evalCfg.memo_files ?? {})) {
      if (new RegExp(kw).test(clause) && !viewed(part)) return 0;
    }
  }
  if (MEMO_RECALC.test(memo)) {
    const evidence =
      ev.views.length > 0 || ev.odi.some((t) => t.toolCalls.some((c) => c.defaults_changed)) || ev.odi.some((t) => ASK_BACK.test(t.text));
    if (!evidence) return 0;
  }
  return 3;
}

export function scoreCode(ev: Evidence, sc: Scenario): CodeScore {
  // ---- B 코드 15 ----
  const attachments = sc.prompts.task_card.attachments;
  const viewedFiles = new Set(ev.views.map((v) => v.file));
  const viewedCount = attachments.filter((a) => viewedFiles.has(a)).length;
  const data_viewed = viewedCount === attachments.length ? 5 : viewedCount > 0 ? 3 : 0;
  const active_explore = ev.views.some((v) => v.sort || v.search) ? 3 : 0;
  const changed = askBackChanged(ev);
  const ask_back = (ev.odi.some((t) => ASK_BACK.test(t.text)) ? 2 : 0) + (changed ? 2 : 0);
  const lastSub = ev.subs.at(-1);
  const memo_consistent = lastSub ? memoConsistency(lastSub.memo, ev, sc) : 0;

  // ---- C 25: 함정마다 12.5 × 발견 경로 계수 ----
  const per = 25 / sc.prompts.traps.length;
  const traps = sc.prompts.traps.map((t): TrapScore => {
    const cfg = sc.evalCfg.traps[t.id];
    const kw = new RegExp(cfg.keywords);
    const caughtSub = ev.subs.find((s) => s.trapCaught[t.id]);
    const warnIdx = ev.odi.findIndex((turn) => turn.aiWarned.includes(t.id));
    if (!caughtSub) {
      return { id: t.id, desc: t.desc, found: false, path: "none", coef: 0, score: 0, ...(warnIdx >= 0 ? { warned_ignored: true } : {}) };
    }
    // 발견 시점 = 정답 제출, 교정 옵션으로 숫자가 바뀐 턴, 함정 키워드가 처음 나온 턴 중 가장 이른 것
    const candidates = [caughtSub.at];
    for (const turn of ev.odi) {
      if (kw.test(turn.text)) candidates.push(turn.at);
      const flagHit = turn.toolCalls.some(
        (c) => c.differs_from_default === true && c.changed_flags.some((f) => cfg.tool_flags?.includes(f)),
      );
      if (flagHit) candidates.push(turn.at);
    }
    const at = Math.min(...candidates.filter((x) => x <= caughtSub.at));
    const hintsBefore = Math.min(3, ev.npc.filter((n) => n.hint && n.at < at).length);
    const rejectsBefore = ev.subs.filter((s) => s.decision === "reject" && s.at < at).length;
    // 오디 경고가 발견 경로가 되려면: 사용자가 스스로 짚은 첫 턴(키워드 또는 교정 옵션)보다 앞선 턴의 경고이고,
    // 발견 시점 이전이어야 한다. 사용자가 이미 짚은 뒤의 경고는 meta.ai_warned 에도 안 남지만 여기서 한 번 더 막는다
    const firstOwnIdx = ev.odi.findIndex(
      (turn) => kw.test(turn.text) || turn.toolCalls.some((c) => c.changed_flags.some((f) => cfg.tool_flags?.includes(f))),
    );
    const warned = warnIdx >= 0 && (firstOwnIdx < 0 || warnIdx < firstOwnIdx) && ev.odi[warnIdx].at <= at;
    // 계수는 해당하는 경로(힌트·AI 경고·반려) 중 가장 낮은 것이고, 경로 이름도 그 계수를 낸 쪽.
    // 같으면 반려 > AI 경고 > 힌트 순으로 이름을 붙인다 (예전 규칙: 반려 0.5 와 힌트가 같으면 반려)
    // 예: 힌트 1(0.8) + 경고 → ai_warned 0.7, 힌트 2(0.6) + 경고 → hint2 0.6, 경고 + 반려 → reject 0.5
    let coef = HINT_COEF[hintsBefore];
    let path: TrapPath = hintsBefore === 0 ? "self" : (`hint${hintsBefore}` as TrapPath);
    if (warned && AI_WARN_COEF <= coef) {
      coef = AI_WARN_COEF;
      path = "ai_warned";
    }
    if (rejectsBefore > 0 && REJECT_COEF <= coef) {
      coef = REJECT_COEF;
      path = "reject";
    }
    return { id: t.id, desc: t.desc, found: true, path, coef, score: per * coef };
  });

  // ---- D 20 ----
  const approved = lastSub?.decision === "approve";
  const closedByRejects = ev.rejectCount >= 3;
  const approval = approved ? 10 : closedByRejects ? 3 : 0;
  const rejectScore = [6, 4, 2, 0][Math.min(ev.rejectCount, 3)];
  let format: number;
  const checks = lastSub?.checks;
  if (checks && checks.length > 0) {
    const ok = checks.filter((c) => c.ok).length;
    format = ok === checks.length ? 4 : ok > 0 ? 2 : 0;
  } else {
    format = approved ? 4 : 2; // 구조화 칸이 없는 시나리오는 팀장 승인 여부로 근사
  }

  // ---- E 중 코드 부분 (팀장에게 데이터 질문 수는 LLM 분류 후 합산) ----
  const n = ev.odiCallsUsed;
  const odi_score = n <= 6 ? 4 : n <= 10 ? 3 : n <= 14 ? 2 : 1;
  const hint_score = [3, 2, 1, 0][Math.min(ev.hintLevel, 3)];

  const endAt = lastSub?.at ?? ev.startedAt;
  return {
    B: { data_viewed, active_explore, ask_back, memo_consistent, total: data_viewed + active_explore + ask_back + memo_consistent },
    C: { traps, total: traps.reduce((s, t) => s + t.score, 0) },
    D: { approved, reject_count: ev.rejectCount, format_ok: format === 4, total: approval + rejectScore + format },
    E_partial: { odi_calls: n, hints: ev.hintLevel, odi_score, hint_score },
    aiMinMet: changed,
    durationMin: Math.max(0, Math.round((endAt - ev.startedAt) / 60000)),
  };
}

// 팀장 등에게 "첨부에 답이 있는 걸" 물은 횟수 → E 3점 항목
export const redundantScore = (count: number) => (count === 0 ? 3 : count === 1 ? 2 : 0);

export function gradeOf(total: number): "S" | "A" | "B" | "C" {
  return total >= 85 ? "S" : total >= 70 ? "A" : total >= 55 ? "B" : "C";
}
