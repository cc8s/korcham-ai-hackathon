import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
// src/ 또는 dist/ 어느 쪽에서 실행돼도 server/ 를 가리킴
const serverRoot = path.resolve(here, "..");

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v !== undefined && v !== "") return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`환경변수 ${name} 가 없습니다. server/.env.example 참고`);
}

export const config = {
  port: Number(env("PORT", "8787")),
  corsOrigin: env("CORS_ORIGIN", "http://localhost:5173"),
  dbPath: path.resolve(serverRoot, env("DB_PATH", "./data/oreum.db")),
  scenariosDir: path.resolve(serverRoot, env("SCENARIOS_DIR", "../scenarios")),
  model: {
    main: env("MODEL_MAIN", "claude-opus-5-5"), // 팀장·오디·검토·평가
    mentor: env("MODEL_MENTOR", "claude-opus-5-5"), // 이하늘. 비용 줄이려면 claude-haiku-5-5
  },
  maxTokens: {
    npc: 1024, // 3~5문장
    odi: 8000, // 표·초안. 스트리밍
    review: 2000,
  },
};

// scenarios/_shared/constants.json 의 상한값. 시나리오 폴더가 단일 진실 공급원
type Constants = {
  AI비서_호출상한: number;
  힌트_상한: number;
  반려_상한: number;
  [k: string]: unknown;
};

export const constants: Constants = JSON.parse(
  fs.readFileSync(path.join(config.scenariosDir, "_shared", "constants.json"), "utf8"),
);

export const limits = {
  odiCalls: constants.AI비서_호출상한,
  hints: constants.힌트_상한,
  rejects: constants.반려_상한,
};
