import express from "express";
import cors from "cors";
import http from "node:http";
import { config, limits } from "./config.js";
import { loadScenarios } from "./scenarios.js";
import { attachWebSocket } from "./events.js";
import { sessionRouter } from "./routes/session.js";
import { runRouter } from "./routes/run.js";

const app = express();
app.use(cors({ origin: config.corsOrigin.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "256kb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, scenarios: [...loadScenarios().keys()], limits });
});

app.use(sessionRouter);
app.use(runRouter);

// 공통 에러 핸들러. express 5 는 async 핸들러의 reject 도 여기로 옴
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: "서버 오류" });
});

const scenarios = loadScenarios();
const server = http.createServer(app);
attachWebSocket(server);
server.listen(config.port, () => {
  console.log(`oreum-server :${config.port} / scenarios ${[...scenarios.keys()].join(",")} / db ${config.dbPath}`);
});
