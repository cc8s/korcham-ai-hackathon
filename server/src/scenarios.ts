import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { validateSpec, type SubmissionSpec } from "./grading.js";
import { parseCsv } from "./tools/csv.js";
import type { EmailConfig } from "./email.js";

// scenarios/{NN}_{slug}/prompts.json 의 형태. scenarios/README.md 참고
export interface ScenarioPrompts {
  scenario_id: string;
  title: string;
  owner_npc: string; // NPC 한글 이름 (강지훈 / 박소연 / 정우진)
  cert: string;
  task_card: {
    title: string;
    due: string;
    body: string; // {nickname} 치환
    attachments: string[]; // "data/xxx.csv" 또는 "_shared/xxx.csv"
    deliverable: string;
  };
  scenario_context_for_npc: string;
  planted_belief_for_odi: string;
  hints: string[];
  review_rules: {
    approve_if: string[];
    reject_area: Record<string, string>;
  };
  traps: { id: string; type: string; desc: string; detect: string }[];
  mail_npc_reply_rule?: string; // 04 무역영어만
}

// scenarios/{NN}_{slug}/odi_tools.json (선택). 있으면 오디가 계산 도구를 쓰고, 함정은 도구 기본값이 담당.
// 없으면 예전처럼 planted_belief_for_odi 를 프롬프트에 넣는다. scenarios/README.md 참고
export interface OdiToolsConfig {
  tools: { name: string; sources: Record<string, string> }[];
  // true 면 첨부 원문도 오디 컨텍스트에 넣는다 (기본 false: 숫자는 도구로만)
  include_raw_data?: boolean;
}

// scenarios/{NN}_{slug}/eval.json. 평가(06 문서) 중 시나리오마다 다른 판정 재료
export interface EvalConfig {
  traps: Record<
    string,
    {
      // 이 함정을 발견했다고 볼 수 있는 표현 (정규식). 발견 "시점"만 정한다. 발견 여부는 제출 숫자·검토가 정함
      keywords: string;
      // 이 함정을 바로잡는 오디 계산 도구 옵션. 켜서 숫자가 바뀐 턴도 발견 시점 후보
      tool_flags?: string[];
      // (선택) 오디가 이 함정을 경고할 때 쓰는 말 (정규식). 사용자가 짚기 전에 답변에 걸리면 meta.ai_warned 로 기록.
      // 지우지 않고 별도 발견 경로(ai_warned)로 채점한다. src/aiWarn.ts
      ai_warns?: string;
      // 리포트에 보이는 함정 이름 (범주만). prompts.json 의 desc 는 정답이 들어 있어 재도전 공정성을 위해 리포트에 안 씀
      label: string;
      // '해설 보기' (도전이 끝난 뒤에만): 어디에 있었나 / 어떻게 찾나 / 숫자 영향
      explain: { where: string; how: string; impact: string };
    }
  >;
  // 검증 메모에서 "이 단어 + 원본/대조/파일" 이면 그 첨부를 실제로 열었어야 함 (값은 첨부 경로의 일부)
  memo_files?: Record<string, string>;
}

export interface Scenario {
  id: string; // "01"
  dir: string; // 절대 경로
  slug: string; // "01_컴활_매출집계"
  prompts: ScenarioPrompts;
  answerKey: unknown; // 검토·평가 전용. 사용자에게 절대 노출 금지
  ownerNpcId: NpcId;
  submission?: SubmissionSpec; // submission.json (선택). 있으면 구조화 제출 + 코드 채점
  odiTools?: OdiToolsConfig;
  evalCfg: EvalConfig;
  email: EmailConfig; // email.json. 결과물 제출 메일의 F축 채점 재료
}

export type NpcId = "kang" | "park" | "jung" | "lee";

export const NPC_NAME_TO_ID: Record<string, NpcId> = {
  강지훈: "kang",
  박소연: "park",
  정우진: "jung",
  이하늘: "lee",
};

const cache = new Map<string, Scenario>();

export function loadScenarios(): Map<string, Scenario> {
  if (cache.size > 0) return cache;
  const entries = fs.readdirSync(config.scenariosDir, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const m = /^(\d{2})_/.exec(e.name);
    if (!m) continue;
    const dir = path.join(config.scenariosDir, e.name);
    const prompts = JSON.parse(fs.readFileSync(path.join(dir, "prompts.json"), "utf8")) as ScenarioPrompts;
    const answerKey = JSON.parse(fs.readFileSync(path.join(dir, "answer_key.json"), "utf8"));
    const ownerNpcId = NPC_NAME_TO_ID[prompts.owner_npc];
    if (!ownerNpcId) throw new Error(`${e.name}: owner_npc '${prompts.owner_npc}' 를 모르는 NPC`);
    const subPath = path.join(dir, "submission.json");
    let submission: SubmissionSpec | undefined;
    if (fs.existsSync(subPath)) {
      submission = JSON.parse(fs.readFileSync(subPath, "utf8")) as SubmissionSpec;
      validateSpec(submission, prompts, answerKey, `${e.name}/submission.json`);
    }
    const toolsFile = path.join(dir, "odi_tools.json");
    const odiTools = fs.existsSync(toolsFile) ? (JSON.parse(fs.readFileSync(toolsFile, "utf8")) as OdiToolsConfig) : undefined;
    const evalFile = path.join(dir, "eval.json");
    if (!fs.existsSync(evalFile)) throw new Error(`${e.name}: eval.json 없음 (평가 판정 재료)`);
    const evalCfg = JSON.parse(fs.readFileSync(evalFile, "utf8")) as EvalConfig;
    for (const t of prompts.traps) {
      if (!evalCfg.traps[t.id]) throw new Error(`${e.name}/eval.json: 함정 ${t.id} 정의 없음`);
      new RegExp(evalCfg.traps[t.id].keywords); // 정규식이 틀리면 기동 시 실패
      if (evalCfg.traps[t.id].ai_warns) new RegExp(evalCfg.traps[t.id].ai_warns!);
      const { label, explain } = evalCfg.traps[t.id];
      if (!label || !explain?.where || !explain?.how || !explain?.impact) throw new Error(`${e.name}/eval.json: 함정 ${t.id} 의 label·explain(where·how·impact) 없음`);
    }
    const emailFile = path.join(dir, "email.json");
    if (!fs.existsSync(emailFile)) throw new Error(`${e.name}: email.json 없음 (보고 메일 F축 채점 재료)`);
    const email = JSON.parse(fs.readFileSync(emailFile, "utf8")) as EmailConfig;
    new RegExp(email.subject);
    for (const id of email.lead_fields) {
      if (!submission?.fields.some((f) => f.id === id)) throw new Error(`${e.name}/email.json: lead_fields '${id}' 가 submission.json 에 없음`);
    }
    if (email.cc_required.includes(ownerNpcId)) throw new Error(`${e.name}/email.json: 담당 팀장은 참조가 아니라 받는 사람`);
    cache.set(m[1], { id: m[1], dir, slug: e.name, prompts, answerKey, ownerNpcId, submission, evalCfg, email, ...(odiTools ? { odiTools } : {}) });
  }
  if (cache.size === 0) throw new Error(`시나리오 폴더가 비어 있음: ${config.scenariosDir}`);
  return cache;
}

export function getScenario(id: string): Scenario | undefined {
  return loadScenarios().get(id);
}

// 사용자에게 보여도 되는 요약 (S6 시나리오 선택용). answer_key·함정·힌트 제외
export function publicScenarioSummary(s: Scenario) {
  return {
    id: s.id,
    title: s.prompts.title,
    cert: s.prompts.cert,
    owner_npc: s.prompts.owner_npc,
    owner_npc_id: s.ownerNpcId,
    attachments: s.prompts.task_card.attachments,
  };
}

// 첨부 파일 경로 해석. "data/..." 는 시나리오 폴더, "_shared/..." 는 scenarios 루트.
// 경로 탈출 방지: 허용 목록(task_card.attachments)에 있는 것만 읽음
export function readAttachment(s: Scenario, rel: string): string {
  if (!s.prompts.task_card.attachments.includes(rel)) {
    throw new Error(`첨부 목록에 없는 파일: ${rel}`);
  }
  const base = rel.startsWith("_shared/") ? config.scenariosDir : s.dir;
  return fs.readFileSync(path.join(base, rel), "utf8");
}

// 오디 system prompt 의 {attached_data} 블록
export function attachedDataBlock(s: Scenario): string {
  return s.prompts.task_card.attachments
    .map((rel) => `### ${rel}\n\`\`\`\n${readAttachment(s, rel).trim()}\n\`\`\``)
    .join("\n\n");
}

// 도구 시나리오용 첨부 개요: 원문 대신 파일명·열·행 수만 (숫자는 도구로만 얻게)
export function attachmentOverview(s: Scenario): string {
  return s.prompts.task_card.attachments
    .map((rel) => {
      const text = readAttachment(s, rel);
      // 표(csv)만 열·행 수로 요약. 문서(md·txt)를 csv 로 읽으면 제목 줄이 열 이름처럼 나와 오디가 헷갈린다 (05)
      if (!rel.endsWith(".csv")) return `- ${rel}: 문서 ${text.trim().split(/\r?\n/).length}줄`;
      const { header, rows } = parseCsv(text);
      return `- ${rel}: 데이터 ${rows.length}행, 열: ${header.join(",")}`;
    })
    .join("\n");
}
