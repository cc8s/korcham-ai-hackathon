import type { Explanation, NpcId, PixelEvent, RunInfo, SessionInfo, SubmitResult, TaskCard, ScenarioSummary, Report, Flow } from "./types";

// 서버 주소. 로컬은 server/.env 의 PORT, 배포는 Railway 도메인 (VITE_API_BASE)
// import.meta.env 는 Vite 가 넣어 줌. 테스트(tsx)에서는 process.env 로 대체
const envBase: string | undefined =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ??
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.VITE_API_BASE;
export const API_BASE = envBase?.replace(/\/$/, "") ?? "http://localhost:8787";
const WS_BASE = API_BASE.replace(/^http/, "ws");

export class ApiError extends Error {
  status: number;
  body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* 비 JSON */
  }
  if (!res.ok) {
    const msg = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, msg, json);
  }
  return json as T;
}

export const api = {
  createSession: (nickname: string) => req<{ session_id: string; nickname: string }>("POST", "/session", { nickname }),
  getSession: (id: string) => req<SessionInfo>("GET", `/session/${id}`),
  startScenario: (sid: string, session_id: string) =>
    req<{ run_id: string; state: string; scenario: ScenarioSummary; task_card: TaskCard }>("POST", `/scenario/${sid}/start`, { session_id }),
  getRun: (rid: string) => req<RunInfo>("GET", `/run/${rid}`),
  getData: (rid: string, file: string, flags: { sort?: boolean; search?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (flags.sort) q.set("sort", "1");
    if (flags.search) q.set("search", "1");
    const qs = q.toString();
    return req<{ file: string; text: string }>("GET", `/run/${rid}/data/${file}${qs ? "?" + qs : ""}`);
  },
  putBasket: (rid: string, text: string) => req<{ ok: true; notice?: string }>("PUT", `/run/${rid}/basket`, { text }),
  npc: (rid: string, npc: NpcId, message: string) =>
    req<{ npc: NpcId; name: string; text: string; notice?: string }>("POST", `/run/${rid}/npc/${npc}`, { message }),
  // 고정 대사 (LLM 없음): intro=이하늘 첫 만남, brief=담당 팀장 지시, faq=이하늘 추천 질문
  scripted: (rid: string, npc: NpcId, kind: "intro" | "brief" | "faq", faq_id?: string) =>
    req<{ npc: NpcId; text: string; question: string | null; flow: Flow }>("POST", `/run/${rid}/npc/${npc}/scripted`, { kind, faq_id }),
  // fields: 구조화 제출 칸 {id: 값}. 칸이 없는 시나리오는 생략
  submit: (rid: string, verify_memo: string, fields?: Record<string, number | string>) =>
    req<SubmitResult>("POST", `/run/${rid}/submit`, fields ? { verify_memo, fields } : { verify_memo }),
  evaluate: (rid: string) => req<Report>("POST", `/run/${rid}/evaluate`),
  explanation: (rid: string) => req<Explanation>("GET", `/run/${rid}/explanation`),
};

// 오디 SSE. delta 마다 onDelta, 끝나면 done 페이로드 반환. error 이벤트는 throw
// tool 이벤트는 오디가 계산 도구를 부르기 시작했다는 신호뿐 (옵션 값은 오지 않음). 모르는 이벤트는 무시
export async function odiStream(
  rid: string,
  message: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  onTool?: () => void,
): Promise<{ odi_calls_used: number; odi_calls_limit: number; truncated: boolean; notice?: string }> {
  const res = await fetch(`${API_BASE}/run/${rid}/odi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, j?.error ?? `HTTP ${res.status}`, j);
  }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let done: { odi_calls_used: number; odi_calls_limit: number; truncated: boolean; notice?: string } | null = null;
  for (;;) {
    const { value, done: end } = await reader.read();
    if (end) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (\w+)$/m.exec(chunk)?.[1];
      const dataLine = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (!ev || !dataLine) continue;
      const data = JSON.parse(dataLine.slice(6));
      if (ev === "delta") onDelta(data.text);
      else if (ev === "tool") onTool?.();
      else if (ev === "done") done = data;
      else if (ev === "error") throw new ApiError(data.status ?? 500, data.message ?? "오디 오류");
    }
  }
  if (!done) throw new ApiError(0, "응답이 끊겼습니다");
  return done;
}

// onOpen: 연결이 열릴 때마다 (재연결 포함). 테스트가 이벤트를 놓치지 않게 기다리는 데 씀
export function connectEvents(rid: string, onEvent: (ev: PixelEvent) => void, onOpen?: () => void): () => void {
  let ws: WebSocket | null = null;
  let closed = false;
  const open = () => {
    ws = new WebSocket(`${WS_BASE}/ws/${rid}`);
    ws.onopen = () => onOpen?.();
    ws.onmessage = (m) => {
      try {
        onEvent(JSON.parse(m.data));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = () => {
      if (!closed) setTimeout(open, 2000);
    };
  };
  open();
  return () => {
    closed = true;
    ws?.close();
  };
}
