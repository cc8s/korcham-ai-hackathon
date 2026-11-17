// 시나리오 첨부 CSV 파서. 따옴표로 감싼 칸(쉼표 포함) 정도만 지원하면 충분하다 (02 거래 내역 적요)
export type CsvRow = Record<string, string>;

function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

// 엑셀에서 저장한 CSV 맨 앞의 BOM(U+FEFF) 제거
const BOM = String.fromCharCode(0xfeff);
export const stripBom = (s: string) => (s.startsWith(BOM) ? s.slice(1) : s);

export function parseCsv(text: string): { header: string[]; rows: CsvRow[] } {
  const lines = stripBom(text).split(/\r?\n/).filter((l) => l.trim() !== "");
  const header = splitLine(lines[0] ?? "");
  const rows = lines.slice(1).map((l) => {
    const cells = splitLine(l);
    return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { header, rows };
}

// "1,234" / "" → 숫자. 빈 칸은 0
export function num(s: string | undefined): number {
  const v = Number(String(s ?? "").replace(/,/g, "").trim() || "0");
  if (!Number.isFinite(v)) throw new Error(`숫자가 아닌 값: ${s}`);
  return v;
}
