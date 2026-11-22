import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { config } from "./config.js";

// API 키는 ANTHROPIC_API_KEY 환경변수에서만 읽음. 사용자는 키를 입력하지 않음
// LLM_MOCK=1 이면 Claude 를 호출하지 않고 규칙 기반 가짜 응답을 돌려줌 (CI·테스트용)
export const MOCK = process.env.LLM_MOCK === "1";
// mock 응답 지연 (ms). 실제 Claude 처럼 응답을 기다리는 동안 동시 요청이 겹치는 경우를 테스트하려고 (test/guard.mjs)
const MOCK_DELAY_MS = Number(process.env.LLM_MOCK_DELAY_MS ?? 0);
const mockWait = () => (MOCK_DELAY_MS > 0 ? new Promise((r) => setTimeout(r, MOCK_DELAY_MS)) : Promise.resolve());
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
// 이력이 길어져도 입력 비용이 크게 늘지 않는다 (캐시 읽기는 입력가의 0.05배).
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
  if (MOCK) {
    await mockWait();
    return { text: mockReply(args.turns), usage: mockUsage, stopReason: "end_turn" };
  }
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
    await mockWait();
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

const addUsage = (a: Usage, b: Usage): Usage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
  cacheWrite: a.cacheWrite + b.cacheWrite,
});

// 스트리밍 + 계산 도구 루프 (도구 시나리오의 오디). 사용자 한 턴 = 오디 1회 차감이지만 API 요청은 여러 번일 수 있다.
// - 도구는 서버에서 실행(client tool). 텍스트 델타는 매 요청마다 그대로 onText 로 흘린다
// - 요청이 끝날 때마다 onUsage → 호출부가 recordSpend. 중간에 실패해도 이미 쓴 요청은 지출에 남는다
// - 도구 라운드는 maxToolRounds 까지. 넘으면 마지막 요청은 tool_choice none 으로 글 답변만 받는다
//   (tool_choice any/tool 강제는 Opus 5.5 에서 400 이 나서 auto·none 만 쓴다)
// - 루프 안에서는 assistant 응답(thinking 블록 포함)을 바꾸지 않고 그대로 다시 보낸다 (preserved thinking).
//   턴이 끝나면 DB 에는 글만 저장하므로 다음 턴 이력에는 thinking·도구 블록이 없다 (재전송하지 않으니 검사 대상도 없음)
export type ToolRunner = (name: string, input: unknown) => { content: string; isError: boolean };

export async function chatStreamTools(args: {
  model: string;
  system: SystemBlock[];
  turns: ChatTurn[];
  tools: Anthropic.Tool[];
  runTool: ToolRunner;
  maxToolRounds: number;
  maxTokens: number;
  effort?: "low" | "medium" | "high";
  onText: (delta: string) => void;
  onToolStart?: () => void;
  onUsage: (u: Usage) => void;
  signal?: AbortSignal;
  // LLM_MOCK=1 일 때 가짜 도구 호출의 입력을 정함 (도구 이름, 사용자 마지막 메시지)
  mockInput: (toolName: string, userText: string) => Record<string, unknown>;
}): Promise<{ text: string; usage: Usage; stopReason: string | null; requests: number }> {
  if (MOCK) {
    await mockWait();
    return mockToolTurn(args);
  }

  const messages: Anthropic.MessageParam[] = toMessages(args.turns);
  let text = "";
  let usage: Usage = { ...mockUsage };
  let stopReason: string | null = null;
  let requests = 0;
  for (let round = 0; ; round++) {
    const lastRound = round >= args.maxToolRounds;
    const stream = client.messages.stream(
      {
        model: args.model,
        max_tokens: args.maxTokens,
        system: toSystem(args.system),
        messages,
        tools: args.tools,
        ...(lastRound ? { tool_choice: { type: "none" as const } } : {}),
        ...(args.effort ? { output_config: { effort: args.effort } } : {}),
      },
      { signal: args.signal },
    );
    let firstDelta = true;
    stream.on("text", (d) => {
      // 도구 전후로 글이 나뉘면 한 답변처럼 이어지게 빈 줄 하나
      if (firstDelta && text && !text.endsWith("\n\n")) {
        text += "\n\n";
        args.onText("\n\n");
      }
      firstDelta = false;
      text += d;
      args.onText(d);
    });
    stream.on("streamEvent", (ev) => {
      if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") args.onToolStart?.();
    });
    const final = await stream.finalMessage();
    requests++;
    const u = usageOf(final);
    usage = addUsage(usage, u);
    args.onUsage(u);
    stopReason = final.stop_reason;

    const uses = final.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    // end_turn·max_tokens·refusal 등은 여기서 끝. max_tokens 로 잘린 tool_use 는 실행하지 않는다
    if (final.stop_reason !== "tool_use" || uses.length === 0 || lastRound) break;

    messages.push({ role: "assistant", content: final.content });
    messages.push({
      role: "user",
      content: uses.map((b) => {
        const r = args.runTool(b.name, b.input);
        return { type: "tool_result" as const, tool_use_id: b.id, content: r.content, ...(r.isError ? { is_error: true } : {}) };
      }),
    });
  }
  return { text, usage, stopReason, requests };
}

// mock: 요청 2번(도구 호출 → 답변)을 흉내. 도구는 진짜로 실행하고 결과의 숫자 칸만 글로 보여 준다
function mockToolTurn(args: Parameters<typeof chatStreamTools>[0]): { text: string; usage: Usage; stopReason: string; requests: number } {
  const last = args.turns.at(-1)?.content ?? "";
  const tool = args.tools[0];
  args.onToolStart?.();
  const r = args.runTool(tool.name, args.mockInput(tool.name, last));
  args.onUsage(mockUsage);
  let tail = "";
  try {
    const obj = JSON.parse(r.content) as Record<string, unknown>;
    tail = Object.entries(obj)
      .filter(([, v]) => typeof v === "number")
      .map(([k, v]) => `${k}: ${(v as number).toLocaleString("ko-KR")}`)
      .join(", ");
  } catch {
    /* 오류 결과 */
  }
  const text = `[mock] ${last.slice(0, 60)}${tail ? `\n\n${tail}` : ""}`;
  for (const piece of text.match(/.{1,8}/gs) ?? []) args.onText(piece);
  args.onUsage(mockUsage);
  return { text, usage: mockUsage, stopReason: "end_turn", requests: 2 };
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
  if (MOCK) {
    await mockWait();
    return { parsed: args.mock(args.turns), usage: mockUsage };
  }
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

// 사용자에게 보여 줄 수 있는 오류 분류
export function describeLlmError(err: unknown): { status: number; message: string } {
  if (err instanceof Anthropic.RateLimitError) return { status: 503, message: "잠깐만요, 다시 말해 줄래요?" };
  if (err instanceof Anthropic.AuthenticationError) return { status: 500, message: "서버 설정 오류 (API 키)" };
  if (err instanceof Anthropic.APIError) return { status: 502, message: "잠깐만요, 다시 말해 줄래요?" };
  return { status: 500, message: "서버 오류" };
}

export const models = config.model;
