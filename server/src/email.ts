// 결과물 제출 메일 (2026-11-18 회의 결정). 제출을 "팀장에게 보고 메일 보내기"라는 업무로 만든다.
// F축 보고 커뮤니케이션 10점은 전부 코드 채점 (같은 메일이면 항상 같은 점수). 말투·인사는 점수 없이 평가 코멘트만.
// 근거: NCS 직업공통능력 의사소통능력 > 문서소통능력 > 문서작성능력 (docs/09 §3-2)
//   받는 사람 2: 담당 팀장이 받는 사람에 있음 (팀장 + 다른 사람이면 1)
//   참조 2: 시나리오의 cc_required 전원이 참조에 있고 그 밖의 사람은 없음. 일부만 또는 필요 없는 사람까지면 1
//   첨부 2: 결과물을 첨부함. 본문에 "첨부"라고 쓰고 안 붙였으면 0
//   제목 1: 제목에 업무 대상(시나리오 정규식)이 있고 6자 이상
//   두괄식 3: 본문 첫 3줄 안에 보고 항목 중 핵심 칸(lead_fields)의 내가 낸 값이 있음 (맞는지는 안 봄. 그건 C·D)
import { z } from "zod";
import type { NpcId } from "./scenarios.js";
import type { FieldValue, SubmissionSpec } from "./grading.js";

export interface EmailConfig {
  cc_required: NpcId[];
  cc_why: string;
  subject: string;
  lead_fields: string[];
}

const Npc = z.enum(["kang", "park", "jung", "lee"]);
export const EmailInput = z.object({
  to: z.array(Npc).min(1, "받는 사람을 한 명 이상 넣어 주세요").max(4),
  cc: z.array(Npc).max(4).default([]),
  subject: z.string().trim().min(1, "제목을 써 주세요").max(120),
  body: z.string().trim().min(20, "본문을 20자 이상 써 주세요").max(4000),
  attach_result: z.boolean(),
});
export type Email = z.infer<typeof EmailInput>;

export function parseEmail(raw: unknown): { email: Email } | { error: string } {
  const r = EmailInput.safeParse(raw);
  if (!r.success) return { error: r.error.issues[0]?.message ?? "메일 형식이 맞지 않아요" };
  const email = r.data;
  // 같은 사람이 받는 사람·참조에 둘 다 있으면 받는 사람만
  return { email: { ...email, to: [...new Set(email.to)], cc: [...new Set(email.cc)].filter((n) => !email.to.includes(n)) } };
}

export interface EmailScore {
  to: number; // /2
  cc: number; // /2
  attach: number; // /2
  subject: number; // /1
  lead: number; // /3
  total: number; // /10
  cc_missing: NpcId[];
  cc_extra: NpcId[];
}

const digitsOnly = (s: string) => s.replace(/(\d),(?=\d{3})/g, "$1");

// 내가 낸 값이 본문 앞부분에 있는가. 숫자는 쉼표 유무 무관, 앞뒤가 다른 숫자에 붙지 않아야 함.
// 선택 칸은 보기 문구 중 숫자가 든 토막(예: 17:10) 또는 4자 이상 토막이 하나라도 있으면
export function valueAppears(text: string, f: SubmissionSpec["fields"][number], v: FieldValue | undefined): boolean {
  if (v === undefined) return false;
  const t = digitsOnly(text);
  if (f.type === "choice") {
    const label = f.options?.find((o) => o.id === v)?.label ?? "";
    const tokens = label.split(/[\s()·,]+/).filter((x) => /\d/.test(x) || x.length >= 4);
    return tokens.some((tok) => t.includes(tok));
  }
  const n = String(v);
  return new RegExp(`(?<![\\d.])${n.replace(".", "\\.")}(?![\\d])`).test(t);
}

export function scoreEmail(args: {
  email: Email | null;
  cfg: EmailConfig;
  owner: NpcId;
  spec?: SubmissionSpec;
  values?: Record<string, FieldValue>;
  basket: string;
}): EmailScore {
  const { email, cfg, owner } = args;
  if (!email) return { to: 0, cc: 0, attach: 0, subject: 0, lead: 0, total: 0, cc_missing: cfg.cc_required, cc_extra: [] };

  const to = email.to.includes(owner) ? (email.to.length === 1 ? 2 : 1) : 0;

  const cc_missing = cfg.cc_required.filter((n) => !email.cc.includes(n));
  const cc_extra = email.cc.filter((n) => !cfg.cc_required.includes(n));
  const hit = cfg.cc_required.length - cc_missing.length;
  const cc = cc_missing.length === 0 && cc_extra.length === 0 ? 2 : hit > 0 ? 1 : 0;

  const attached = email.attach_result && args.basket.trim().length > 0;
  const attach = attached ? 2 : 0;

  const subject = new RegExp(cfg.subject, "i").test(email.subject) && email.subject.trim().length >= 6 ? 1 : 0;

  const head = email.body
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  const fields = args.spec?.fields ?? [];
  const lead = cfg.lead_fields.some((id) => {
    const f = fields.find((x) => x.id === id);
    return f ? valueAppears(head, f, args.values?.[id]) : false;
  })
    ? 3
    : 0;

  return { to, cc, attach, subject, lead, total: to + cc + attach + subject + lead, cc_missing, cc_extra };
}
