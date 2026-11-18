// 오디 계산 도구 (기획 피드백 1번: 함정 재현성).
// 함정을 LLM 프롬프트에 걸지 않고 도구의 기본값으로 구현한다. 오디는 사용자가 요청할 때만 옵션을 켠다.
// - 같은 옵션이면 매번 같은 숫자 → 정답과 다르면 함정 때문인지 우연한 계산 실수인지 구분할 수 있다
// - 호출 기록(어떤 옵션으로 다시 계산했고 숫자가 바뀌었나)이 검증 행동의 증거로 남는다
// 시나리오는 odi_tools.json 이 있을 때만 도구를 쓴다. 없으면 예전 planted_belief 방식 그대로
import type Anthropic from "@anthropic-ai/sdk";
import { readAttachment, type Scenario } from "../scenarios.js";
import { aggregateSalesTool } from "./sales.js";
import { vatSummaryTool } from "./vat.js";
import { orderQuantityTool } from "./order.js";
import { itineraryKstTool } from "./itinerary.js";
import { readDocumentsTool } from "./docs.js";
import type { AnyOdiTool, OdiToolLog } from "./types.js";

export type { OdiToolLog } from "./types.js";

export const TOOL_REGISTRY: Record<string, AnyOdiTool> = {
  [aggregateSalesTool.name]: aggregateSalesTool,
  [vatSummaryTool.name]: vatSummaryTool,
  [orderQuantityTool.name]: orderQuantityTool,
  [itineraryKstTool.name]: itineraryKstTool,
  [readDocumentsTool.name]: readDocumentsTool,
};

export interface OdiToolset {
  defs: Anthropic.Tool[];
  run: (name: string, rawInput: unknown) => { content: string; isError: boolean; log: OdiToolLog };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 모델에게는 옵션(불리언) 목록을 보여 주지 않는다. 옵션 이름·설명이 곧 "고칠 수 있는 함정 목록"이라
// 오디가 "신고필증 기준이나 10% 검산이 필요하면 말씀해 주세요"처럼 매번 먼저 안내했다 (2026-11-18 실측, 02·03).
// 대신 사용자가 말한 계산 기준을 문장으로 받고, 서버가 FLAG_PATTERNS 로 옵션을 켠다.
// 실무로 치면 가정이 문서화되지 않은 계산 매크로: 무엇을 바꿀 수 있는지는 사람이 기준을 말해야 드러난다
const CRITERIA_SCHEMA: Anthropic.Tool.InputSchema = {
  type: "object",
  properties: {
    criteria: {
      type: "string",
      description:
        "이번 대화에서 사용자가 직접 말한 계산 기준·처리 지시를 사용자 표현 그대로 옮긴다 (여러 개면 이어서). " +
        "사용자가 기준을 말하지 않았으면 비운다. 사용자가 말하지 않은 기준을 지어내지 않는다.",
    },
  },
  additionalProperties: false,
};
const forModel = (result: unknown) => {
  if (result === null || typeof result !== "object") return result;
  const { 적용_옵션: _omit, ...rest } = result as Record<string, unknown>;
  return rest;
};
const CRITERIA_NOTE = "계산 기준을 바꾸라는 사용자 지시가 있으면 그 말을 criteria 에 그대로 넣어 다시 호출한다.";

// 시나리오의 도구 묶음. odi_tools.json 이 없으면 null. 설정이 틀리면 throw (로드 시점에 드러나게)
// userTexts 를 주면(실제 오디 경로) 모델 입력은 { criteria } 만 받고, 옵션은
// "criteria 에도 있고 사용자 발화에도 있는" 기준만 켠다 → 오디가 스스로 교정 옵션을 켤 수 없다.
// userTexts 가 없으면(테스트·평가 하네스) 옵션을 직접 받는다
export function odiToolsFor(sc: Scenario, opts?: { userTexts: string[] }): OdiToolset | null {
  const cfg = sc.odiTools;
  if (!cfg) return null;
  const entries = cfg.tools.map((t) => {
    const tool = TOOL_REGISTRY[t.name];
    if (!tool) throw new Error(`${sc.slug}/odi_tools.json: 모르는 도구 ${t.name}`);
    for (const key of tool.sources) {
      if (!t.sources?.[key]) throw new Error(`${sc.slug}/odi_tools.json: ${t.name} 에 sources.${key} 없음`);
    }
    return { tool, sources: t.sources };
  });

  // 도구 정의는 이름순으로 고정 (도구 목록은 캐시 맨 앞이라 순서가 바뀌면 캐시가 깨짐)
  // eager_input_streaming 은 끈다: 입력이 짧은 문장 하나라 버퍼링 지연이 없고, 서버 쪽 검증을 그대로 받는 편이 낫다
  const defs: Anthropic.Tool[] = entries
    .map(({ tool }) => ({ name: tool.name, description: `${tool.description} ${CRITERIA_NOTE}`, input_schema: CRITERIA_SCHEMA }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const run: OdiToolset["run"] = (name, rawInput) => {
    const entry = entries.find((e) => e.tool.name === name);
    const fail = (error: string) => ({
      content: JSON.stringify({ 오류: error }),
      isError: true,
      log: { name, input: (rawInput ?? {}) as Record<string, unknown>, changed_flags: [], defaults_changed: false, summary: null, differs_from_default: null, is_error: true, error },
    });
    if (!entry) return fail(`없는 도구: ${name}`);
    const { tool, sources } = entry;
    let input: Record<string, unknown>;
    let criteria: string | undefined;
    try {
      if (opts) {
        const raw = (rawInput ?? {}) as Record<string, unknown>;
        const extra = Object.keys(raw).filter((k) => k !== "criteria");
        if (extra.length > 0 || (raw.criteria !== undefined && typeof raw.criteria !== "string")) {
          throw new Error(`criteria(문장) 하나만 받음: ${JSON.stringify(raw)}`);
        }
        criteria = typeof raw.criteria === "string" ? raw.criteria : "";
        const fromCriteria = mockToolInput(tool, criteria);
        const saidByUser = (k: string) => opts.userTexts.some((t) => FLAG_PATTERNS[k]?.test(t) ?? false);
        input = tool.parse(Object.fromEntries(Object.entries(fromCriteria).map(([k, v]) => [k, v === true && saidByUser(k)])));
      } else {
        input = tool.parse(rawInput);
      }
    } catch (e) {
      return fail(`입력 형식 오류: ${e instanceof Error ? e.message : String(e)}`);
    }
    const defaults = tool.parse({});
    const changed = Object.keys(input).filter((k) => !sameJson(input[k], defaults[k]));
    try {
      const src = Object.fromEntries(Object.entries(sources).map(([k, rel]) => [k, readAttachment(sc, rel)]));
      const result = tool.run(src, input);
      const summary = tool.summary(result);
      // 바꾼 옵션이 실제로 숫자를 바꿨는지: 같은 데이터를 기본값으로 다시 돌려 비교 (몇 ms)
      const differs = changed.length === 0 ? false : !sameJson(summary, tool.summary(tool.run(src, defaults)));
      return {
        // 모델에게 주는 결과에서는 적용_옵션(옵션 이름·값)을 뺀다. 이름이 곧 "아직 안 고친 함정 목록"이라
        // 오디가 "작년 같은 달 실적, 입고 전 수요, 단위 환산은 반영하지 않았습니다"라고 그대로 읊었다 (2026-11-18 실측 03).
        // 어떤 옵션으로 계산했는지는 log.input 에 남는다
        content: JSON.stringify(forModel(result)),
        isError: false,
        log: {
          name,
          input: criteria !== undefined ? { ...input, criteria } : input,
          changed_flags: changed,
          defaults_changed: changed.length > 0,
          summary,
          differs_from_default: differs,
          is_error: false,
        },
      };
    } catch (e) {
      return fail(`계산 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return { defs, run };
}

// 계산 기준 문장 → 도구 옵션. 서버가 결정적으로 해석한다 (모델에게 옵션 목록을 보여 주지 않기 위해).
// "다시 확인/검증" 처럼 무엇을 볼지 특정하지 않은 말은 어떤 옵션도 켜지 않는다 (2026-11-17 결정)
export const FLAG_PATTERNS: Record<string, RegExp> = {
  dedupe_order_ids: /중복/,
  normalize_customer_names: /정규화|이름\s*정리|표기|띄어쓰기|공백/,
  recheck_vat_rate: /10\s*%|부가세\s*확인|부가세율/,
  // "무슨 근거로?" 같은 질문만으로 켜지지 않게 '근거'는 뺀다. 기준 서류를 짚어야 켬
  use_import_declarations: /신고필증|수입\s*신고|과세\s*가격/,
  // 03: 무엇을 고칠지 특정한 말만. "리빙박스" 같은 품명의 '박스'로 켜지지 않게 앞 글자를 막는다
  use_last_year_same_month: /전년|작년|동월|시즌|계절|성수기/,
  include_pre_arrival_demand: /입고\s*전|입고되기\s*전|소진/,
  convert_stock_units: /단위|환산|낱개|입수|\d+\s*입(?!고)|box|(?<!리빙)박스/i,
  // 05: "시차 확인해 줘" 처럼 막연한 말은 안 켠다. 서머타임·UTC·시각기준을 특정해야 켬
  use_event_date_offset: /서머\s*타임|썸머\s*타임|DST|일광\s*절약|날짜별\s*시차/,
  use_time_basis_column: /UTC|시각\s*기준/,
  // 04: 어떤 문서를 볼지 사용자가 짚어야 켬. "확인해 줘"만으로는 안 켜짐
  include_contract: /계약|인코텀즈|FOB|위험\s*이전|적하\s*보험|보험\s*(조건|조항|가입|누가|누구)/i,
  include_survey: /검정|survey|조사\s*보고서|손상\s*원인/i,
};

// 문장 하나 → 옵션. mock 오디와 테스트가 쓴다
export function mockToolInput(tool: AnyOdiTool, userText: string): Record<string, unknown> {
  const defaults = tool.parse({});
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, FLAG_PATTERNS[k]?.test(userText) ?? false]));
}
