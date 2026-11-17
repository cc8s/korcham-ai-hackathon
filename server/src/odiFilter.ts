import type { Scenario } from "./scenarios.js";
import type { OdiToolLog } from "./tools/index.js";

// 오디가 함정을 먼저 짚는 문단을 걸러 낸다 (2026-11-18 결정: 데이터 품질 지적은 요청받을 때만).
// 프롬프트만으로는 실제 모델(Opus)이 표의 비슷한 이름이나 회계 상식으로 함정을 먼저 말했다
// (실측: 01 3/4, 02 4/4). 그래서 출력에서 결정적으로 막는다.
// - 문단(빈 줄로 나뉜 블록) 단위로 모았다가 내보낸다. 함정 설명 문단은 버리고, 바로 앞 제목도 같이 버린다
// - 사용자가 그 함정을 이미 짚었으면(키워드, 또는 그 함정을 고치는 도구 옵션을 켬) 거르지 않는다

export function raisedTraps(sc: Scenario, userTexts: string[], toolCalls: OdiToolLog[]): Set<string> {
  const raised = new Set<string>();
  for (const [id, cfg] of Object.entries(sc.evalCfg.traps)) {
    const kw = new RegExp(cfg.keywords);
    if (userTexts.some((t) => kw.test(t))) raised.add(id);
    if (toolCalls.some((c) => c.changed_flags.some((f) => cfg.tool_flags?.includes(f)))) raised.add(id);
  }
  return raised;
}

// 함정 내용을 뺀 뒤 남는 "확인하실 점이 있습니다", "이 상태로는 안 됩니다" 같은 예고 문단.
// 이것만 남아도 단서가 되므로, 아직 안 짚은 함정이 있고 숫자가 없는 문단이면 같이 뺀다
// (실제 결과 문단은 거의 항상 숫자를 담고 있어서 숫자 유무로 구분)
const LEAD_IN = /(확인|주의|짚|살펴|검토)(하실|해 주실|해야 할|할|볼|봐야 할)? ?(점|부분|사항)|문제가 (있|보)|이 상태로는|그대로 (쓰|넣|붙이|신고하)면|(보고서|신고)에 (넣|붙이|쓰)기 전에|신고 전에|바꿔야|고쳐야/;
const HAS_NUMBER = /\d/;

// 걸러서 남은 게 거의 없을 때 붙이는 문장 (막연한 질문에 되묻는 기존 규칙과 같은 말)
export const ASK_BACK_FALLBACK = "어떤 기준으로 다시 볼지 알려 주시면 그 기준으로 확인해 드리겠습니다.";

const proseLength = (text: string) =>
  text
    .split("\n")
    .filter((l) => l.trim() !== "" && !/^\s*(\||#)/.test(l))
    .join("")
    .replace(/\*\*/g, "").length;

const isHeadingOnly = (block: string) => {
  const lines = block.split("\n").filter((l) => l.trim() !== "");
  return lines.length > 0 && lines.every((l) => /^\s*(#{1,6}\s|\*\*[^*]+\*\*:?\s*$)/.test(l));
};

export class OdiParagraphFilter {
  private buf = "";
  private pendingHeading = "";
  private dropSectionOf: string | null = null;
  kept = "";
  dropped: { trap: string; text: string }[] = [];

  // raised 는 호출할 때마다 다시 계산 (도구 호출이 글 중간에 생길 수 있음)
  constructor(
    private sc: Scenario,
    private raised: () => Set<string>,
    private out: (text: string) => void,
  ) {}

  push(delta: string) {
    this.buf += delta;
    let i: number;
    while ((i = this.buf.indexOf("\n\n")) >= 0) {
      const block = this.buf.slice(0, i + 2);
      this.buf = this.buf.slice(i + 2);
      this.handle(block);
    }
  }

  end() {
    if (this.buf) this.handle(this.buf);
    this.buf = "";
    if (this.pendingHeading) this.emit(this.pendingHeading);
    this.pendingHeading = "";
    // 표가 남아 있으면 결과는 전달된 것이라 되묻기를 붙이지 않는다
    const hasTable = /^\s*\|/m.test(this.kept);
    if (this.dropped.length > 0 && !hasTable && proseLength(this.kept) < 40) {
      this.emit(`${this.kept && !this.kept.endsWith("\n") ? "\n\n" : ""}${ASK_BACK_FALLBACK}`);
    }
  }

  private hit(block: string): string | null {
    const raised = this.raised();
    let anyOpen = false;
    for (const [id, cfg] of Object.entries(this.sc.evalCfg.traps)) {
      if (!cfg.odi_suppress || raised.has(id)) continue;
      anyOpen = true;
      if (new RegExp(cfg.odi_suppress).test(block)) return id;
    }
    if (anyOpen && LEAD_IN.test(block) && !HAS_NUMBER.test(block)) return "lead-in";
    return null;
  }

  private handle(block: string) {
    // 표·목록 블록은 통째로 버리면 숫자까지 사라지므로 걸리는 줄만 뺀다
    const lines = block.split("\n");
    const content = lines.filter((l) => l.trim() !== "");
    if (content.length > 1 && content.every((l) => /^\s*(\||[-*•]\s|\d+[.)]\s|\s{2,}\S)/.test(l))) {
      const keptLines = lines.filter((l) => {
        const trap = l.trim() !== "" ? this.hit(l) : null;
        if (trap) this.dropped.push({ trap, text: l.trim() });
        return !trap;
      });
      if (keptLines.some((l) => l.trim() !== "")) block = keptLines.join("\n");
      else {
        this.pendingHeading = "";
        return;
      }
    }
    // 제목이 걸려 빠졌으면 그 아래 본문 한 덩어리도 같은 함정으로 뺀다 ("**1. 띄어쓰기만 다른 거래처명**" + 설명)
    if (this.dropSectionOf && !isHeadingOnly(block)) {
      this.dropped.push({ trap: this.dropSectionOf, text: block.trim() });
      this.dropSectionOf = null;
      return;
    }
    this.dropSectionOf = null;
    const trap = this.hit(block);
    if (trap) {
      this.dropped.push({ trap, text: (this.pendingHeading + block).trim() });
      this.pendingHeading = "";
      // 예고 제목("확인하실 점:")은 본문을 따로 판정한다. 본문이 사용자가 짚은 함정 설명일 수 있어서
      if (isHeadingOnly(block) && trap !== "lead-in") this.dropSectionOf = trap;
      return;
    }
    if (isHeadingOnly(block)) {
      // 제목은 다음 문단을 보고 같이 내보내거나 같이 버린다
      if (this.pendingHeading) this.emit(this.pendingHeading);
      this.pendingHeading = block;
      return;
    }
    if (this.pendingHeading) {
      this.emit(this.pendingHeading);
      this.pendingHeading = "";
    }
    this.emit(block);
  }

  private emit(text: string) {
    this.kept += text;
    this.out(text);
  }
}
