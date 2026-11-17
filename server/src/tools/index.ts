// 오디 계산 도구 (기획 피드백 1번: 함정 재현성).
// 함정을 LLM 프롬프트에 걸지 않고 도구의 기본값으로 구현한다. 오디는 사용자가 요청할 때만 옵션을 켠다.
// - 같은 옵션이면 매번 같은 숫자 → 정답과 다르면 함정 때문인지 우연한 계산 실수인지 구분할 수 있다
// - 호출 기록(어떤 옵션으로 다시 계산했고 숫자가 바뀌었나)이 검증 행동의 증거로 남는다
// 시나리오는 odi_tools.json 이 있을 때만 도구를 쓴다. 없으면 예전 planted_belief 방식 그대로
import type Anthropic from "@anthropic-ai/sdk";
import { readAttachment, type Scenario } from "../scenarios.js";
import { aggregateSalesTool } from "./sales.js";
import { vatSummaryTool } from "./vat.js";
import type { AnyOdiTool, OdiToolLog } from "./types.js";

export type { OdiToolLog } from "./types.js";

export const TOOL_REGISTRY: Record<string, AnyOdiTool> = {
  [aggregateSalesTool.name]: aggregateSalesTool,
  [vatSummaryTool.name]: vatSummaryTool,
};

export interface OdiToolset {
  defs: Anthropic.Tool[];
  run: (name: string, rawInput: unknown) => { content: string; isError: boolean; log: OdiToolLog };
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// 시나리오의 도구 묶음. odi_tools.json 이 없으면 null. 설정이 틀리면 throw (로드 시점에 드러나게)
export function odiToolsFor(sc: Scenario): OdiToolset | null {
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
  // eager_input_streaming 은 끈다: 입력이 불리언 두 개뿐이라 버퍼링 지연이 없고, 서버 쪽 검증을 그대로 받는 편이 낫다
  const defs: Anthropic.Tool[] = entries
    .map(({ tool }) => ({ name: tool.name, description: tool.description, input_schema: tool.inputSchema }))
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
    try {
      input = tool.parse(rawInput);
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
        content: JSON.stringify(result),
        isError: false,
        log: { name, input, changed_flags: changed, defaults_changed: changed.length > 0, summary, differs_from_default: differs, is_error: false },
      };
    } catch (e) {
      return fail(`계산 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return { defs, run };
}

// LLM_MOCK=1 용: 사용자 메시지의 낱말로 옵션을 정한다 (실제 오디가 하라고 프롬프트에 적은 규칙의 축소판)
// "다시 확인/검증" 처럼 특정하지 않은 재확인 요청은 모든 옵션을 켠다
export function mockToolInput(tool: AnyOdiTool, userText: string): Record<string, unknown> {
  const all = /검증|다시\s*확인|재확인|검산/.test(userText);
  const want: Record<string, RegExp> = {
    dedupe_order_ids: /중복/,
    normalize_customer_names: /정규화|이름\s*정리|표기|띄어쓰기|공백/,
    recheck_vat_rate: /10\s*%|검산|부가세\s*확인/,
    use_import_declarations: /신고필증|근거/,
  };
  const defaults = tool.parse({});
  return Object.fromEntries(Object.keys(defaults).map((k) => [k, all || (want[k]?.test(userText) ?? false)]));
}
