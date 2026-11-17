import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "./config.js";

// API 키는 ANTHROPIC_API_KEY 환경변수에서만 읽음. 사용자는 키를 입력하지 않음 (01 문서 A안)
// LLM_MOCK=1 이면 Claude 를 호출하지 않고 규칙 기반 가짜 응답을 돌려줌 (07 문서 9-4, CI 용)
export const MOCK = process.env.LLM_MOCK === "1";
export const client = new Anthropic({ maxRetries: 2, ...(MOCK ? { apiKey: "sk-ant-mock" } : {}) });

const mockUsage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
function mockReply(turns: ChatTurn[]): string {
  const last = turns.at(-1)?.content ?? "";
  return `[mock] ${last.slice(0, 60)}`;
}

export type SystemBlock = { text: string; cache: boolean };

function toSystem(blocks: SystemBlock[]): Anthropic.TextBlockParam[] {
  return blocks.map((b) => ({
    type: "text",
    text: b.text,
    ...(b.cache ? { cache_control: { type: "ephemeral" as const } } : {}),
  }));
}

export type ChatTurn = { role: "user" | "assistant"; content: string };

// 대화 이력 캐시: 마지막 턴에 캐시 지점을 둔다. 다음 호출은 여기까지를 캐시에서 읽어서
// 이력이 길어져도 입력 비용이 크게 늘지 않는다 (캐시 읽기는 Opus 5.5 기준 입력가의 0.05배).
// 시스템 프롬프트의 캐시 지점(최대 2개)과 합쳐 4개 제한 안쪽
function toMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  return turns.map((t, i) =>
    i === turns.length - 1
      ? { role: t.role, content: [{ type: "text" as const, text: t.content, cache_control: { type: "ephemeral" as const } }] }
      : { role: t.role, content: t.content },
  );
}

export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}
function usageOf(m: Anthropic.Message): Usage {
  return {
    input: m.usage.input_tokens,
    output: m.usage.output_tokens,
    cacheRead: m.usage.cache_read_input_tokens ?? 0,
    cacheWrite: m.usage.cache_creation_input_tokens ?? 0,
  };
}

// 비스트리밍 대화 (NPC). 짧은 응답 전용
export async function chat(args: {
  model: string;
  system: SystemBlock[];
  turns: ChatTurn[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
}): Promise<{ text: string; usage: Usage; stopReason: string | null }> {
  if (MOCK) return { text: mockReply(args.turns), usage: mockUsage, stopReason: "end_turn" };
  const res = await client.messages.create({
    model: args.model,
    max_tokens: args.maxTokens,
    system: toSystem(args.system),
    messages: toMessages(args.turns),
    ...(args.effort ? { output_config: { effort: args.effort } } : {}),
  });
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, usage: usageOf(res), stopReason: res.stop_reason };
}

// 스트리밍 대화 (오디). onText 로 델타를 흘리고 최종 메시지를 돌려줌
export async function chatStream(args: {
  model: string;
  system: SystemBlock[];
  turns: ChatTurn[];
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  onText: (delta: string) => void;
  signal?: AbortSignal;
}): Promise<{ text: string; usage: Usage; stopReason: string | null }> {
  if (MOCK) {
    const text = mockReply(args.turns);
    for (const piece of text.match(/.{1,8}/gs) ?? []) args.onText(piece);
    return { text, usage: mockUsage, stopReason: "end_turn" };
  }
  const stream = client.messages.stream(
    {
      model: args.model,
      max_tokens: args.maxTokens,
      system: toSystem(args.system),
      messages: toMessages(args.turns),
      ...(args.effort ? { output_config: { effort: args.effort } } : {}),
    },
    { signal: args.signal },
  );
  stream.on("text", args.onText);
  const final = await stream.finalMessage();
  const text = final.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, usage: usageOf(final), stopReason: final.stop_reason };
}

// 구조화 출력 (팀장 검토, 평가). zod 스키마 강제
export async function structured<T extends z.ZodType>(args: {
  model: string;
  system: SystemBlock[];
  turns: ChatTurn[];
  schema: T;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  // LLM_MOCK=1 일 때 쓰는 규칙 기반 대체. 호출부가 스키마에 맞는 값을 만들어 줌
  mock: (turns: ChatTurn[]) => z.infer<T>;
}): Promise<{ parsed: z.infer<T>; usage: Usage }> {
  if (MOCK) return { parsed: args.mock(args.turns), usage: mockUsage };
  const res = await client.messages.parse({
    model: args.model,
    max_tokens: args.maxTokens,
    system: toSystem(args.system),
    messages: toMessages(args.turns),
    output_config: {
      format: zodOutputFormat(args.schema),
      ...(args.effort ? { effort: args.effort } : {}),
    },
  });
  if (res.parsed_output == null) {
    throw new Error(`구조화 출력 파싱 실패 (stop_reason=${res.stop_reason})`);
  }
  return { parsed: res.parsed_output as z.infer<T>, usage: usageOf(res) };
}

// 사용자에게 보여 줄 수 있는 오류 분류 (04 문서 7절 예외 처리)
export function describeLlmError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.RateLimitError) return { status: 503, message: "잠깐만요, 다시 말해 줄래요?" };
  if (err instanceof Anthropic.AuthenticationError) return { status: 500, message: "서버 설정 오류 (API 키)" };
  if (err instanceof Anthropic.APIError) return { status: 502, message: "잠깐만요, 다시 말해 줄래요?" };
  return { status: 500, message: "서버 오류" };
}

export const models = config.model;
