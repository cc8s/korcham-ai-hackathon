import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "node:http";

// 서버 이벤트 → 사무실 화면의 팀원 상태. run 하나당 WS 구독자 집합
export type PixelEvent = {
  type:
    | "scenario.start"
    | "odi.call.begin"
    | "odi.call.end"
    | "npc.call.begin"
    | "npc.call.end"
    | "submit"
    | "review.reject"
    | "review.approve"
    | "evaluated";
  run_id: string;
  npc_id?: string;
  text?: string;
};

const subscribers = new Map<string, Set<WebSocket>>();

export function emit(ev: PixelEvent): void {
  const set = subscribers.get(ev.run_id);
  if (!set) return;
  const payload = JSON.stringify(ev);
  for (const ws of set) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

export function attachWebSocket(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const m = /^\/ws\/([0-9a-f-]{36})$/.exec(url.pathname);
    if (!m) {
      socket.destroy();
      return;
    }
    const runId = m[1];
    wss.handleUpgrade(req, socket, head, (ws) => {
      let set = subscribers.get(runId);
      if (!set) {
        set = new Set();
        subscribers.set(runId, set);
      }
      set.add(ws);
      ws.on("close", () => {
        set!.delete(ws);
        if (set!.size === 0) subscribers.delete(runId);
      });
    });
  });
}
