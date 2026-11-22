import express from "express";
import cors from "cors";
import http from "node:http";
import { config, limits } from "./config.js";
import { loadScenarios } from "./scenarios.js";
import { attachWebSocket } from "./events.js";
import { spentToday, clientIp } from "./guard.js";
import { sessionRouter } from "./routes/session.js";
import { runRouter } from "./routes/run.js";

const app = express();
// Railway 프록시 뒤에서 req.ip 가 실제 클라이언트 IP 가 되도록 (비용 방어의 IP별 횟수)
app.set("trust proxy", config.guard.trustProxy);
app.use(cors({ origin: config.corsOrigin.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (req, res) => {
  // 지출 액수는 숨기고 열림 여부만. your_ip 는 TRUST_PROXY 확인용 (모두 같은 IP 면 프록시 IP 를 읽는 중)
  res.json({ ok: true, scenarios: [...loadScenarios().keys()], limits, open: spentToday() < config.guard.dailyBudgetUsd, your_ip: clientIp(req) });
});

app.use(sessionRouter);
app.use(runRouter);

// 공통 에러 핸들러. express 5 는 async 핸들러의 reject 도 여기로 옴
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  // 본문이 너무 크거나 JSON 이 깨진 요청 (express.json). 서버 오류가 아니라 요청 문제로 돌려준다
  const status = (err as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    if (!res.headersSent) res.status(status).json({ error: status === 413 ? "보낸 글이 너무 길어요" : "요청 형식이 맞지 않아요" });
    return;
  }
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "서버 오류" });
});

const scenarios = loadScenarios();
const server = http.createServer(app);
attachWebSocket(server);
server.listen(config.port, () => {
  console.log(`oreum-server :${config.port} / scenarios ${[...scenarios.keys()].join(",")} / db ${config.dbPath}`);
});
