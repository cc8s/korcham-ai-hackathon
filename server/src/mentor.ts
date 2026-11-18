// 이하늘(인턴 담당 사수)의 고정 대사·추천 질문과 수습 흐름 (하늘 → 담당 팀장 지시 → 업무).
// 2026-11-18 회의 결정: 힌트 3단계를 없애고, 하늘은 함정을 모르는 사수로 둔다.
// 고정 문장은 LLM 을 부르지 않아 비용 0, 매번 같고, 함정이 샐 수 없다. 원문은 scenarios/_shared/mentor.json
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { NpcId, Scenario } from "./scenarios.js";
import type { MessageRow } from "./db.js";

export type MentorStage = "start" | "work" | "reject";
interface FaqItem {
  id: string;
  stages: MentorStage[];
  q: string;
  a?: string;
  by_owner?: Partial<Record<NpcId, string>>;
}
interface MentorFile {
  intro: string;
  faq: FaqItem[];
}

export const mentorFile: MentorFile = JSON.parse(fs.readFileSync(path.join(config.scenariosDir, "_shared", "mentor.json"), "utf8"));

const OWNER: Record<NpcId, { name: string; role: string }> = {
  kang: { name: "강지훈", role: "경영지원팀장" },
  park: { name: "박소연", role: "영업팀장" },
  jung: { name: "정우진", role: "무역팀장" },
  lee: { name: "이하늘", role: "사수" },
};

function fill(text: string, sc: Scenario, nickname: string): string {
  const o = OWNER[sc.ownerNpcId];
  const files = sc.prompts.task_card.attachments.map((a) => a.split("/").pop()).join(", ");
  return text
    .replaceAll("{nickname}", nickname)
    .replaceAll("{owner_name}", o.name)
    .replaceAll("{owner_role}", o.role)
    .replaceAll("{attachments}", files);
}

export function mentorIntro(sc: Scenario, nickname: string): string {
  return fill(mentorFile.intro, sc, nickname);
}

// 추천 질문 목록 (답은 빼고 보냄. 답은 누른 뒤에만)
export function mentorQuestions(sc: Scenario, nickname: string): { id: string; q: string; stages: MentorStage[] }[] {
  return mentorFile.faq
    .filter((f) => f.a !== undefined || f.by_owner?.[sc.ownerNpcId] !== undefined)
    .map((f) => ({ id: f.id, q: fill(f.q, sc, nickname), stages: f.stages }));
}

export function mentorAnswer(sc: Scenario, nickname: string, id: string): { q: string; a: string } | null {
  const f = mentorFile.faq.find((x) => x.id === id);
  const a = f?.by_owner?.[sc.ownerNpcId] ?? f?.a;
  if (!f || a === undefined) return null;
  return { q: fill(f.q, sc, nickname), a: fill(a, sc, nickname) };
}

// 담당 팀장의 업무 지시 = 업무 카드 본문 (이미 팀장 말투로 쓰여 있음)
export function leaderBrief(sc: Scenario, nickname: string): string {
  return sc.prompts.task_card.body.replaceAll("{nickname}", nickname);
}

// 흐름 상태는 고정 대사 기록(meta.scripted)으로만 정한다.
// 이 기능 전에 시작한 도전도 다시 들어오면 하늘 인사·팀장 지시를 한 번 거친다 (기록은 그대로라 해가 없음)
export function flowOf(messages: MessageRow[], ownerNpcId: NpcId): { met_mentor: boolean; briefed: boolean } {
  const scripted = (agent: string, kind: string) =>
    messages.some((m) => m.agent === agent && m.role === "assistant" && (m.meta ?? "").includes(`"scripted":"${kind}"`));
  return { met_mentor: scripted("lee", "intro"), briefed: scripted(ownerNpcId, "brief") };
}

// 하늘이 자유 질문에 답할 때 쓰는 과제 정보. 함정·정답이 들어 있는 scenario_context_for_npc 는 주지 않는다
export function mentorContextBlock(sc: Scenario, nickname: string): string {
  const o = OWNER[sc.ownerNpcId];
  return `[현재 과제]
담당: ${o.name} ${o.role}
과제: ${sc.prompts.task_card.title}
첨부: ${sc.prompts.task_card.attachments.map((a) => a.split("/").pop()).join(", ")}
요구 형식: ${sc.prompts.task_card.deliverable}
팀장 지시: ${leaderBrief(sc, nickname)}

당신은 이 과제의 정답 숫자, 데이터 속 오류의 위치나 종류를 모릅니다. 원본을 직접 보지도 않았습니다.
"어디가 틀렸어요?", "정답이 뭐예요?", "이거 맞아요?"에는 모른다고 하고 확인 방법(원본 대조, 오디에게 기준 묻기)만 말합니다.`;
}
