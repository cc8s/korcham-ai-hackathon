// 통합 테스트 공통: 서버를 자식 프로세스로 띄우고 HTTP 로 친다. 끝나면 자식만 종료.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const serverDir = path.resolve(here, "..");

// 여러 작업 트리에서 테스트를 동시에 돌릴 때 포트가 겹치지 않게: TEST_PORT_OFFSET=100 처럼 준다
export const testPort = (n) => n + Number(process.env.TEST_PORT_OFFSET ?? 0);

export async function startServer({ port, dbName, env = {} }) {
  const db = path.join(serverDir, "data", dbName);
  const base = `http://localhost:${port}`;
  const rmDb = () => {
    for (const f of [db, `${db}-wal`, `${db}-shm`]) fs.rmSync(f, { force: true });
  };
  rmDb();
  const child = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/index.ts"], {
    cwd: serverDir,
    env: {
      ...process.env,
      ANTHROPIC_API_KEY: "sk-ant-dummy",
      PORT: String(port),
      DB_PATH: db,
      CORS_ORIGIN: "http://localhost:5173",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => (log += d));
  child.stderr.on("data", (d) => (log += d));

  let up = false;
  for (let i = 0; i < 40 && !up; i++) {
    await sleep(500);
    try {
      up = (await fetch(base + "/health")).ok;
    } catch {}
  }
  if (!up) {
    child.kill();
    throw new Error("server boot failed:\n" + log);
  }

  const api = async (method, url, body) => {
    const res = await fetch(base + url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };

  const stop = async () => {
    child.kill();
    await sleep(300);
    rmDb();
  };
  return { api, stop, base, log: () => log };
}

export function makeChecker() {
  let failed = 0;
  const check = (name, cond, detail = "") => {
    console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond || !detail ? "" : "  " + detail}`);
    if (!cond) failed++;
  };
  const finish = (label) => {
    console.log(failed === 0 ? `\n${label}: ALL PASS` : `\n${label}: ${failed} FAILED`);
    process.exit(failed === 0 ? 0 : 1);
  };
  return { check, finish, fail: () => failed++ };
}
