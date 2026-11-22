import { limits } from "./config.js";
import type { RunRow } from "./db.js";

// 끝난 도전: 승인·평가됨, 또는 반려 상한에 닿음. 리포트를 받을 수 있는 상태
export function isClosed(run: RunRow): boolean {
  return run.state === "approved" || run.state === "evaluated" || run.reject_count >= limits.rejects;
}

// 진행 중인 도전: 그만두지 않았고 아직 끝나지 않음.
// 한 세션은 진행 중인 도전을 하나만 가질 수 있다 (Figma 업무 선택 144:1680)
export function isActive(run: RunRow): boolean {
  return run.state !== "abandoned" && !isClosed(run);
}
