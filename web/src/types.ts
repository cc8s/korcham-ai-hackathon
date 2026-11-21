// 서버 응답 타입. server/src/routes/*.ts 와 맞춤
export type NpcId = "kang" | "park" | "jung" | "lee";

export const NPC_INFO: Record<NpcId, { name: string; role: string; color: string }> = {
  kang: { name: "강지훈", role: "경영지원팀장", color: "#5b7bd5" },
  park: { name: "박소연", role: "영업팀장", color: "#d56b8a" },
  jung: { name: "정우진", role: "무역팀장", color: "#4f9d8a" },
  lee: { name: "이하늘", role: "인턴 담당 사수", color: "#e0a94a" },
};

// 메일 주소록에 보이는 팀별 업무. 참조를 누구에게 걸지 판단하는 근거 (scenarios/*/email.json 의 cc_why 와 맞춤)
export const NPC_DUTY: Record<NpcId, string> = {
  kang: "경영지원팀 · 회계·결산, 대표 보고·일정",
  park: "영업팀 · 국내 판매 채널, 매출, 발주 계획",
  jung: "무역팀 · 수입 계약·발주, 해외 거래처",
  lee: "영업팀 2년차 · 수습 사수",
};

export type RunState = "assigned" | "working" | "reviewing" | "rejected" | "approved" | "evaluated" | "abandoned";

export interface ScenarioSummary {
  id: string;
  title: string;
  cert: string;
  owner_npc: string;
  owner_npc_id: NpcId;
  attachments: string[];
  run: { id: string; state: RunState; reject_count: number; odi_calls_used: number } | null;
}

export interface SessionInfo {
  session_id: string;
  nickname: string;
  scenarios: ScenarioSummary[];
}

export interface TaskCard {
  title: string;
  due: string;
  body: string;
  attachments: string[];
  deliverable: string;
}

export interface Message {
  id: number;
  agent: string; // "odi" | NpcId
  role: "user" | "assistant";
  content: string;
  at: string;
}

export interface Review {
  decision: "approve" | "reject";
  area: string | null;
  wrong_areas?: string[]; // 구조화 제출만
  message: string;
  trap_caught: { id: string; caught: boolean; evidence: string }[];
  graded_by?: "code" | "llm";
}

// 구조화 제출 칸 (submission.json 있는 시나리오만). 정답은 서버에만 있음
export interface SubmissionField {
  id: string;
  label: string;
  type: "integer" | "number" | "choice";
  unit: string;
  required: boolean;
  options?: { id: string; label: string }[]; // choice 전용. 정답 표시는 서버가 보내지 않음
}

export interface Flow {
  met_mentor: boolean;
  briefed: boolean;
}
export type MentorStage = "start" | "work" | "reject";
export interface MentorQuestion {
  id: string;
  q: string;
  stages: MentorStage[];
}

export interface RunInfo {
  run: {
    id: string;
    state: RunState;
    reject_count: number;
    hint_level: number;
    odi_calls_used: number;
    odi_calls_limit: number;
    basket_text: string;
    closed: boolean;
  };
  scenario: { id: string; title: string; owner_npc_id: NpcId };
  // 수습 흐름: 이하늘 첫 만남 → 담당 팀장 지시 → 업무. 마치기 전에는 다른 메뉴를 잠근다
  flow: Flow;
  mentor_questions: MentorQuestion[];
  submission_fields: SubmissionField[] | null;
  task_card: TaskCard;
  messages: Message[];
  submissions: { attempt: number; verify_memo: string; fields: Record<string, number | string> | null; email: Email | null; review: Review | null; at: string }[];
  evaluation: Report | null;
}

export interface SubmitResult {
  attempt: number;
  decision: "approve" | "reject";
  area: string | null;
  wrong_areas?: string[];
  message: string;
  state: RunState;
  reject_count: number;
  closed: boolean;
}

export interface PixelEvent {
  type: string;
  run_id: string;
  npc_id?: NpcId;
  text?: string;
}

// '해설 보기' (도전이 끝난 뒤에만 서버가 줌). 정답이 들어 있음
export interface Explanation {
  scenario: { id: string; title: string };
  traps: { id: string; label: string; found: boolean; where: string; how: string; impact: string }[];
}

// 06 문서 6절 리포트 JSON
export interface Report {
  run_id: string;
  scenario: { id: string; title: string; cert: string };
  total: number;
  grade: "S" | "A" | "B" | "C";
  grade_note?: string; // 등급 상한이 걸린 이유 (AI 결과를 고치게 한 기록 없음 → B)
  partial?: boolean; // 평가 에이전트 실패로 코드 점수만. 다시 열면 재시도
  summary: string;
  axes: {
    A_instruction: { score: number; max: number; items: { name: string; score: number; quote: string }[] };
    B_verification: {
      score: number;
      max: number;
      code: { data_viewed: number; active_explore: number; ask_back: number; memo_consistent: number };
      llm: { score: number; quote: string };
    };
    C_traps: { score: number; max: number; traps: { id: string; desc: string; found: boolean; path: string; coef: number; score: number; warned_ignored?: boolean }[] };
    D_deliverable: { score: number; max: number; approved: boolean; reject_count: number; format_ok: boolean };
    E_efficiency: { score: number; max: number; odi_calls: number; redundant_questions: number };
    // 보고 메일 (2026-11-18 추가). 그 전 리포트에는 없음
    F_report?: {
      score: number;
      max: number;
      to: number;
      cc: number;
      attach: number;
      subject: number;
      lead: number;
      cc_missing: NpcId[];
      cc_extra: NpcId[];
      cc_why: string;
      sent: boolean;
    };
  };
  highlights: { good: { quote: string; why: string }; improve: { quote: string; why: string } };
  next_steps: string[];
  resources: { odi_calls: string; mentor_questions?: number; rejects: string; duration_min: number };
}

export interface Email {
  to: NpcId[];
  cc: NpcId[];
  subject: string;
  body: string;
  attach_result: boolean;
}
