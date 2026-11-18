// 구조화 제출 채점. 시나리오 폴더의 submission.json 이 있으면 코드가 숫자·선택지를 정답과 대조한다.
// 팀장 LLM 은 이 결과를 받아 멘트만 쓴다 (기획 피드백 2·3). submission.json 이 없는 시나리오는 기존 LLM 검토.
import type { ScenarioPrompts } from "./scenarios.js";

// 선택 칸의 보기 하나. id 는 API 로 오가는 값, label 은 화면 글자.
// 둘 다 사용자에게 보이므로 정답 여부를 암시하는 낱말을 넣지 않는다
export interface ChoiceOption {
  id: string;
  label: string;
}

// 칸 값: 숫자 칸은 number, 선택 칸은 보기 id(string)
export type FieldValue = number | string;

export interface SubmissionField {
  id: string; // 영문 소문자·숫자·_ (API 키)
  label: string; // 화면에 보이는 한국어 이름
  // choice: 글로 써야 하는 판단(청구 방향, 회의록 분류 등)을 자유 텍스트 대신 보기 하나로 받는다.
  // 텍스트를 LLM 이 읽고 판정하면 오디가 쓴 문장을 사용자의 발견으로 쳐 주게 되므로 (03 실측), 사용자의 선택만 본다
  type: "integer" | "number" | "choice";
  unit: string; // "원", "곳" 등. 화면 표시용 (choice 는 보통 "")
  required: boolean;
  options?: ChoiceOption[]; // choice 전용. 함정을 놓쳤을 때 고를 법한 보기(기본 오답)를 꼭 넣는다
  // 정답 위치. path 는 answer_key.json 의 키를 "." 으로 이은 것.
  // derive: count = 객체 키 개수(배열 길이), min/max = 객체·배열 값의 최솟값·최댓값 (숫자 칸 전용)
  // value: 정답을 직접 적음 (submission.json 도 사용자에게 안 보냄). path 와 둘 중 하나. choice 면 보기 id
  answer: { path?: string; derive?: "count" | "min" | "max"; value?: FieldValue };
  tolerance: number; // 정답과의 허용 차이 (절댓값). 0 = 정확히 일치. choice 는 안 씀 (항상 id 일치 비교)
  reject_area: string; // 틀리면 이 반려 영역. prompts.json review_rules.reject_area 또는 extra_reject_area 의 키
  proves: string[]; // 맞으면 증명되는 함정 id (prompts.json traps)
  // 다른 칸 값에서 계산되는 합계 칸이면 true. 다른 칸이 다 맞을 때만 이 칸의 반려 영역을 보고
  derived?: boolean;
  why?: string; // 사람용 설명 (서버는 안 씀)
}

// 숫자가 아닌 승인 조건 중 코드가 결정적으로 볼 수 있는 것 (존재 여부만. 정답 여부가 아님)
export interface SubmissionTextCheck {
  id: string;
  label: string;
  target: "basket" | "basket_or_memo";
  pattern: string; // 정규식 (대소문자 무시)
  reject_area: string;
  why?: string;
}

export interface SubmissionSpec {
  fields: SubmissionField[];
  text_checks?: SubmissionTextCheck[];
  // prompts.json 에 없는 반려 영역의 팀장 말투 (prompts.json 은 수정하지 않기 위해 여기에 둠)
  extra_reject_area?: Record<string, string>;
}

// 사용자에게 보내는 칸 정의. 정답 위치·허용오차·함정은 빼고 보냄. 선택 칸은 보기(id·label)만 붙임
export function publicFields(spec: SubmissionSpec) {
  return spec.fields.map((f) => ({
    id: f.id,
    label: f.label,
    type: f.type,
    unit: f.unit,
    required: f.required,
    ...(f.type === "choice" ? { options: (f.options ?? []).map((o) => ({ id: o.id, label: o.label })) } : {}),
  }));
}

function lookup(answerKey: unknown, path: string): unknown {
  let cur: unknown = answerKey;
  for (const k of path.split(".")) {
    if (cur === null || typeof cur !== "object" || !(k in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

// 칸의 정답 값. 못 찾으면 throw (시나리오 로드 때 걸러짐)
export function expectedValue(f: SubmissionField, answerKey: unknown): FieldValue {
  if (f.type === "choice") {
    // 선택 칸: 정답 = 보기 id. 보기 목록에 있는지는 validateSpec 이 본다
    const v = f.answer.value !== undefined ? f.answer.value : f.answer.path ? lookup(answerKey, f.answer.path) : undefined;
    if (typeof v !== "string") throw new Error(`submission.json ${f.id}: 선택 칸 정답(answer.path 또는 answer.value)이 보기 id 문자열이 아님`);
    return v;
  }
  if (f.answer.value !== undefined) {
    if (typeof f.answer.value !== "number") throw new Error(`submission.json ${f.id}: answer.value 가 숫자가 아님`);
    return f.answer.value;
  }
  const path = f.answer.path ?? "";
  const v = lookup(answerKey, path);
  const fail = (why: string) => new Error(`submission.json ${f.id}: answer.path '${path}' ${why}`);
  if (v === undefined) throw fail("가 answer_key 에 없음");
  if (!f.answer.derive) {
    if (typeof v !== "number") throw fail("가 숫자가 아님");
    return v;
  }
  if (v === null || typeof v !== "object") throw fail("가 객체·배열이 아님");
  const vals = Array.isArray(v) ? v : Object.values(v);
  if (f.answer.derive === "count") return vals.length;
  const nums = vals.filter((x): x is number => typeof x === "number");
  if (nums.length === 0) throw fail("에 숫자 값이 없음");
  return f.answer.derive === "min" ? Math.min(...nums) : Math.max(...nums);
}

// 시나리오 로드 때 한 번 검사. 잘못된 정의는 서버 시작 시 바로 드러나게 throw
export function validateSpec(spec: SubmissionSpec, prompts: ScenarioPrompts, answerKey: unknown, where: string): void {
  const areas = new Set([...Object.keys(prompts.review_rules.reject_area), ...Object.keys(spec.extra_reject_area ?? {})]);
  const traps = new Set(prompts.traps.map((t) => t.id));
  const ids = new Set<string>();
  if (!Array.isArray(spec.fields) || spec.fields.length === 0) throw new Error(`${where}: fields 가 비어 있음`);
  for (const f of spec.fields) {
    if (!/^[a-z][a-z0-9_]*$/.test(f.id)) throw new Error(`${where}: 칸 id '${f.id}' 형식`);
    if (ids.has(f.id)) throw new Error(`${where}: 칸 id '${f.id}' 중복`);
    ids.add(f.id);
    if (f.type !== "integer" && f.type !== "number" && f.type !== "choice") throw new Error(`${where}: ${f.id} type`);
    if (!(f.tolerance >= 0)) throw new Error(`${where}: ${f.id} tolerance`);
    if (!areas.has(f.reject_area)) throw new Error(`${where}: ${f.id} reject_area '${f.reject_area}' 가 반려 영역에 없음`);
    for (const t of f.proves) if (!traps.has(t)) throw new Error(`${where}: ${f.id} proves '${t}' 가 traps 에 없음`);
    if (f.type === "choice") {
      // 보기는 2개 이상 (하나뿐이면 고를 게 없음), id 중복 금지, 정답이 보기 중 하나
      const opts = f.options ?? [];
      if (!Array.isArray(opts) || opts.length < 2) throw new Error(`${where}: ${f.id} options 가 2개 미만`);
      const optIds = new Set<string>();
      for (const o of opts) {
        if (typeof o?.id !== "string" || !/^[a-z0-9_]+$/.test(o.id)) throw new Error(`${where}: ${f.id} 보기 id '${o?.id}' 형식`);
        if (typeof o.label !== "string" || !o.label.trim()) throw new Error(`${where}: ${f.id} 보기 ${o.id} label 없음`);
        if (optIds.has(o.id)) throw new Error(`${where}: ${f.id} 보기 id '${o.id}' 중복`);
        optIds.add(o.id);
      }
      if (f.answer.derive) throw new Error(`${where}: ${f.id} 선택 칸에는 derive 를 쓸 수 없음`);
      const exp = expectedValue(f, answerKey);
      if (!optIds.has(exp as string)) throw new Error(`${where}: ${f.id} 정답 '${exp}' 가 보기에 없음`);
    } else {
      if (f.options !== undefined) throw new Error(`${where}: ${f.id} 숫자 칸에 options`);
      expectedValue(f, answerKey);
    }
  }
  for (const c of spec.text_checks ?? []) {
    if (!areas.has(c.reject_area)) throw new Error(`${where}: ${c.id} reject_area '${c.reject_area}' 가 반려 영역에 없음`);
    new RegExp(c.pattern, "i");
  }
}

// 선택 칸 입력 해석. 보기 id 문자열만 받는다 (label 글자나 순번은 안 받음). 실패 시 null
export function parseChoiceValue(raw: unknown, f: SubmissionField): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return (f.options ?? []).some((o) => o.id === id) ? id : null;
}

// 입력 한 칸 해석. 숫자 또는 "580,300,000원" 같은 문자열을 받음. 실패 시 null
export function parseFieldValue(raw: unknown, type: "integer" | "number"): number | null {
  let n: number;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string") {
    const s = raw.replace(/[\s,]/g, "").replace(/(원|곳|개|건)$/, "");
    if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n) || Math.abs(n) > 1e15) return null;
  if (type === "integer" && !Number.isInteger(n)) return null;
  return n;
}

// 요청 본문의 fields 검증 + 해석. 오류면 { error } (400 메시지)
export function parseFields(
  spec: SubmissionSpec,
  body: unknown,
): { values: Record<string, FieldValue> } | { error: string } {
  if (body === undefined || body === null) body = {};
  if (typeof body !== "object" || Array.isArray(body)) return { error: "fields 는 {칸 id: 값} 객체" };
  const known = new Map(spec.fields.map((f) => [f.id, f]));
  const values: Record<string, FieldValue> = {};
  for (const [id, raw] of Object.entries(body as Record<string, unknown>)) {
    const f = known.get(id);
    if (!f) return { error: `모르는 칸: ${id}` };
    if (raw === "" || raw === null || raw === undefined) continue;
    if (f.type === "choice") {
      const c = parseChoiceValue(raw, f);
      if (c === null) return { error: `${f.label}: 보기 중 하나를 골라 주세요` };
      values[id] = c;
      continue;
    }
    const n = parseFieldValue(raw, f.type);
    if (n === null) return { error: `${f.label}: 숫자로 읽을 수 없음` };
    values[id] = n;
  }
  for (const f of spec.fields) {
    if (f.required && !(f.id in values)) return { error: `${f.label} 칸을 채워 주세요` };
  }
  return { values };
}

export interface Grading {
  decision: "approve" | "reject";
  area: string | null; // 대표 반려 영역 (wrong_areas 의 첫 번째)
  wrong_areas: string[];
  fields: { id: string; value: FieldValue | null; correct: boolean }[]; // 정답 값은 저장하지 않음
  checks: { id: string; ok: boolean }[];
  trap_caught: { id: string; caught: boolean; evidence: string }[];
}

// 칸 하나가 정답인가. 숫자는 허용오차 안, 선택은 보기 id 일치
export function isCorrect(f: SubmissionField, v: FieldValue, answerKey: unknown): boolean {
  const exp = expectedValue(f, answerKey);
  if (f.type === "choice") return v === exp;
  return typeof v === "number" && Math.abs(v - (exp as number)) <= f.tolerance;
}

// 코드 채점. 승인 = 필수 칸 전부 정답 + 입력한 비필수 칸 정답 + text_checks 통과
export function grade(args: {
  spec: SubmissionSpec;
  answerKey: unknown;
  traps: { id: string }[];
  values: Record<string, FieldValue>;
  basket: string;
  memo: string;
}): Grading {
  const { spec, answerKey, values } = args;
  const fields = spec.fields.map((f) => {
    const v = f.id in values ? values[f.id] : null;
    const correct = v !== null && isCorrect(f, v, answerKey);
    return { f, value: v, correct };
  });
  const checks = (spec.text_checks ?? []).map((c) => {
    const text = c.target === "basket" ? args.basket : `${args.basket}\n${args.memo}`;
    return { c, ok: new RegExp(c.pattern, "i").test(text) };
  });

  // 비어 있는 선택 칸은 채점 대상 아님. 입력했으면 틀린 값은 반려
  const wrongFields = fields.filter((x) => (x.value !== null || x.f.required) && !x.correct);
  const primaryWrong = wrongFields.filter((x) => !x.f.derived);
  const reported = primaryWrong.length > 0 ? primaryWrong : wrongFields;
  const wrong_areas: string[] = [];
  for (const a of [...reported.map((x) => x.f.reject_area), ...checks.filter((x) => !x.ok).map((x) => x.c.reject_area)]) {
    if (!wrong_areas.includes(a)) wrong_areas.push(a);
  }

  // 함정 발견 = 그 함정을 증명하는 칸이 하나 이상 있고, 전부 정답 (키워드는 보지 않음)
  const trap_caught = args.traps.map((t) => {
    const provers = fields.filter((x) => x.f.proves.includes(t.id));
    const caught = provers.length > 0 && provers.every((x) => x.correct);
    return {
      id: t.id,
      caught,
      evidence: caught ? `제출 칸 일치: ${provers.map((x) => x.f.label).join(", ")}` : "",
    };
  });

  return {
    decision: wrong_areas.length === 0 ? "approve" : "reject",
    area: wrong_areas[0] ?? null,
    wrong_areas,
    fields: fields.map((x) => ({ id: x.f.id, value: x.value, correct: x.correct })),
    checks: checks.map((x) => ({ id: x.c.id, ok: x.ok })),
    trap_caught,
  };
}

// 팀장 멘트 입력용 칸 값 글자. 선택 칸은 보기 label (id 는 팀장이 읽을 말이 아님), 숫자는 천 단위 쉼표 + 단위
export function displayValue(f: SubmissionField, v: FieldValue | undefined): string {
  if (v === undefined) return "(빈칸)";
  if (f.type === "choice") return f.options?.find((o) => o.id === v)?.label ?? String(v);
  return (typeof v === "number" ? v.toLocaleString("ko-KR") : String(v)) + f.unit;
}

// 반려 영역 → 팀장 말투 한 줄
export function areaLine(spec: SubmissionSpec, prompts: ScenarioPrompts, area: string): string {
  return prompts.review_rules.reject_area[area] ?? spec.extra_reject_area?.[area] ?? area;
}
