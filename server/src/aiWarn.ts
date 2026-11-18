import type { Scenario } from "./scenarios.js";
import type { OdiToolLog } from "./tools/index.js";

// 오디가 함정을 먼저 경고했는지 기록한다 (샌드박스 원칙 3: 경고는 지우지 않고, 별도 발견 경로로 채점).
// 답변은 그대로 스트리밍하고, 답변이 끝난 뒤 이 답변에서 경고한 함정 id 를 assistant 메시지 meta.ai_warned 에 남긴다.

// 사용자가 이미 짚은 함정: 사용자 발화가 keywords 에 걸리거나, 그 함정을 고치는 도구 옵션을 켬
export function raisedTraps(sc: Scenario, userTexts: string[], toolCalls: OdiToolLog[]): Set<string> {
  const raised = new Set<string>();
  for (const [id, cfg] of Object.entries(sc.evalCfg.traps)) {
    const kw = new RegExp(cfg.keywords);
    if (userTexts.some((t) => kw.test(t))) raised.add(id);
    if (toolCalls.some((c) => c.changed_flags.some((f) => cfg.tool_flags?.includes(f)))) raised.add(id);
  }
  return raised;
}

// 이 답변에서 오디가 먼저 경고한 함정: ai_warns 정규식이 답변에 걸리고, 사용자가 아직 짚지 않은 것 (id 순)
export function aiWarnedTraps(sc: Scenario, reply: string, raised: Set<string>): string[] {
  return Object.entries(sc.evalCfg.traps)
    .filter(([id, cfg]) => cfg.ai_warns && !raised.has(id) && new RegExp(cfg.ai_warns).test(reply))
    .map(([id]) => id)
    .sort();
}
