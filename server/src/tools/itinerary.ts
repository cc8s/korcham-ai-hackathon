// 05 비서 출장 일정표: itinerary_kst 도구.
// 함정을 도구 기본값에 둔다 (planted_belief 대신. 기획 피드백 1번).
//   use_event_date_offset=false → 일정표 작성일(2026-10-23, 아직 서머타임 CEST)의 시차 7시간을 출장 전 일정에 고정 적용.
//                                  출장(10/27~11/02)은 서머타임 종료(10/25) 뒤라 실제는 8시간 (T2)
//   use_time_basis_column=false → 항공편 표의 시각기준 열을 안 보고 전부 현지시간으로 간주.
//                                  LH276 행만 UTC 라 출발이 1시간 틀림 (T1)
//   둘 다 true                  → answer_key.json 의 일정표 정답과 같음
// "작성일 기준 시차를 고정"은 사람이 손으로 바꿀 때도, 오늘 시차만 보는 변환기에서도 흔한 실수라 기본값으로 삼았다.
// 서머타임 종료일은 _shared/constants.json, 작성일은 itinerary_raw.md 머리말에서 읽는다 (날짜를 코드에 박지 않음)
import { z } from "zod";
import { constants } from "../config.js";
import { parseCsv } from "./csv.js";
import type { OdiTool } from "./types.js";

export const ItineraryInput = z
  .object({
    use_event_date_offset: z.boolean().default(false),
    use_time_basis_column: z.boolean().default(false),
  })
  .strict();
export type ItineraryInput = z.infer<typeof ItineraryInput>;

const KST = 9; // 한국은 서머타임 없음
// 공항 → 시간대. 유럽은 서머타임(CEST, UTC+2) / 표준시(CET, UTC+1)
const AIRPORT: Record<string, "KST" | "EU"> = { ICN: "KST", FRA: "EU", MXP: "EU" };

interface Stamp {
  현지: string;
  한국: string;
}
export interface ItineraryResult {
  적용_옵션: ItineraryInput;
  항공편: { 편명: string; 시각기준?: string; 출발: Stamp & { 공항: string }; 도착: Stamp & { 공항: string } }[];
  일정: { 날짜: string; 내용: string; 현지: string; 한국: string; 한국과_시차: string }[];
  보고_전화: { 근거: string; 현지: string; 한국: string }[];
}

const pad = (n: number) => String(n).padStart(2, "0");
// Date 는 UTC 기준으로만 쓴다 (서버 시간대와 무관하게 결정적)
const fmt = (d: Date) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const addH = (d: Date, h: number) => new Date(d.getTime() + h * 3_600_000);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export function itineraryKst(itineraryMd: string, flightsCsv: string, input: ItineraryInput, dstEnd: string): ItineraryResult {
  const written = /(\d{4})-(\d{2})-(\d{2})\s*작성/.exec(itineraryMd);
  if (!written) throw new Error("일정 원문에서 작성일(YYYY-MM-DD 작성)을 찾을 수 없음");
  const year = Number(written[1]);
  const writtenDate = `${written[1]}-${written[2]}-${written[3]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dstEnd)) throw new Error(`서머타임 종료일 형식: ${dstEnd}`);

  // 유럽 UTC 오프셋. 기본값은 날짜와 관계없이 작성일의 오프셋 (= 함정 T2)
  const euOffsetOn = (date: string) => (date < dstEnd ? 2 : 1);
  const euOffset = (date: string) => euOffsetOn(input.use_event_date_offset ? date : writtenDate);
  const offsetAt = (zone: "KST" | "EU", date: string) => (zone === "KST" ? KST : euOffset(date));

  // "2026-10-30 09:10" 을 벽시계 그대로 UTC Date 로 (나중에 오프셋을 빼서 실제 UTC 로 만든다)
  const wall = (s: string) => {
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(s.trim());
    if (!m) throw new Error(`일시 형식: ${s}`);
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  };
  const stamp = (airport: string, raw: string, basis: string) => {
    const zone = AIRPORT[airport];
    if (!zone) throw new Error(`모르는 공항: ${airport}`);
    const w = wall(raw);
    const date = ymd(w);
    // 시각기준 열을 읽을 때만 UTC 행을 UTC 로 본다. 기본값은 모든 행을 현지시간으로 (= 함정 T1)
    const utc = input.use_time_basis_column && basis === "UTC" ? w : addH(w, -offsetAt(zone, date));
    return { 공항: airport, 현지: fmt(addH(utc, offsetAt(zone, date))), 한국: fmt(addH(utc, KST)) };
  };

  const flights = parseCsv(flightsCsv).rows.map((r) => ({
    편명: r["편명"],
    // 시각기준 값은 옵션을 켰을 때만 결과에 넣는다. 기본 결과에 있으면 오디가 스스로 비교해 T1 을 먼저 짚는다 (02 와 같은 이유)
    ...(input.use_time_basis_column ? { 시각기준: r["시각기준"] } : {}),
    출발: stamp(r["출발지"], r["출발일시"], r["시각기준"]),
    도착: stamp(r["도착지"], r["도착일시"], r["시각기준"]),
  }));

  // 일정 원문: "- 10/28 10:00~12:00 내용" 처럼 날짜로 시작하고 시각이 있는 줄만. 유럽 일정이라 전부 유럽 현지시간
  const events: ItineraryResult["일정"] = [];
  const ranges: { date: string; end: Date }[] = [];
  const lines = itineraryMd.split(/\r?\n/);
  for (const line of lines) {
    const m = /^-\s*(\d{1,2})\/(\d{1,2})\s+(.*)$/.exec(line.trim());
    if (!m) continue;
    const date = `${year}-${pad(+m[1])}-${pad(+m[2])}`;
    const rest = m[3];
    const off = euOffset(date);
    const at = (hhmm: string) => {
      const [h, mi] = hhmm.split(":").map(Number);
      return addH(new Date(Date.UTC(year, +m[1] - 1, +m[2], h, mi)), -off); // 실제 UTC
    };
    const local = (d: Date) => fmt(addH(d, off)).slice(6);
    const label = rest.replace(/^\d{2}:\d{2}(\s*~\s*\d{2}:\d{2})?\s*/, "").trim();
    const range = /(\d{2}:\d{2})\s*~\s*(\d{2}:\d{2})/.exec(rest);
    if (range) {
      const [s, e] = [at(range[1]), at(range[2])];
      events.push({ 날짜: `${pad(+m[1])}/${pad(+m[2])}`, 내용: label, 현지: `${local(s)}~${local(e)}`, 한국: `${fmt(addH(s, KST))}~${fmt(addH(e, KST))}`, 한국과_시차: `${KST - off}시간` });
      ranges.push({ date, end: e });
      continue;
    }
    // 한 줄에 시각이 여럿이면(미팅 3건: 09:30 / 11:00 / 14:00) 각각 한 행
    const times = [...new Set([...rest.matchAll(/\b(\d{2}:\d{2})\b/g)].map((x) => x[1]))];
    for (const t of times) {
      const d = at(t);
      events.push({ 날짜: `${pad(+m[1])}/${pad(+m[2])}`, 내용: label, 현지: local(d), 한국: fmt(addH(d, KST)), 한국과_시차: `${KST - off}시간` });
    }
  }

  // 보고 전화: "보고 전화" 줄의 날짜마다, 그날 회의(시각 범위) 종료 + N시간
  const calls: ItineraryResult["보고_전화"] = [];
  for (const line of lines) {
    if (!line.includes("보고 전화")) continue;
    const plus = /종료\s*\+\s*(\d+)\s*시간/.exec(line);
    if (!plus) continue;
    const n = Number(plus[1]);
    for (const dm of line.matchAll(/(\d{1,2})\/(\d{1,2})/g)) {
      const date = `${year}-${pad(+dm[1])}-${pad(+dm[2])}`;
      const r = ranges.find((x) => x.date === date);
      if (!r) continue;
      const call = addH(r.end, n);
      const off = euOffset(date);
      calls.push({ 근거: `${pad(+dm[1])}/${pad(+dm[2])} 회의 종료 + ${n}시간`, 현지: fmt(addH(call, off)), 한국: fmt(addH(call, KST)) });
    }
  }

  return { 적용_옵션: input, 항공편: flights, 일정: events, 보고_전화: calls };
}

export const itineraryKstTool: OdiTool<ItineraryInput, ItineraryResult> = {
  name: "itinerary_kst",
  description:
    "출장 일정 원문(itinerary_raw.md)과 항공편 표(flights.csv)의 시각을 현지시간·한국시간(KST)으로 나란히 변환하고, 보고 전화 시각을 계산한다. " +
    "일정표, 한국시간 병기, 통화 가능 시간처럼 시각 변환이 필요한 요청이면 직접 계산하지 말고 항상 이 도구를 호출한다. " +
    "옵션은 사용자가 그 처리를 요청했을 때만 켠다.",
  inputSchema: {
    type: "object",
    properties: {
      use_event_date_offset: {
        type: "boolean",
        description:
          "true 면 일정 날짜마다 그날의 유럽 시차(서머타임 여부)를 따로 적용한다. 기본 false(일정 원문 작성일의 시차를 전 일정에 똑같이 적용). 사용자가 서머타임·날짜별 시차 확인을 요청했을 때만 true.",
      },
      use_time_basis_column: {
        type: "boolean",
        description:
          "true 면 항공편 표의 시각기준 열을 읽어 UTC 로 적힌 시각은 UTC 로 보고 변환한다. 기본 false(모든 시각을 현지시간으로 간주). 사용자가 시각기준 열·UTC 확인을 요청했을 때만 true.",
      },
    },
    additionalProperties: false,
  },
  parse: (raw) => ItineraryInput.parse(raw ?? {}),
  sources: ["itinerary", "flights"],
  run: (src, input) => itineraryKst(src.itinerary, src.flights, input, String(constants["유럽_서머타임_종료"])),
  summary: (r) => ({
    항공편_출발_한국: Object.fromEntries(r.항공편.map((f) => [f.편명, f.출발.한국])),
    한국과_시차: [...new Set(r.일정.map((e) => e.한국과_시차))],
    보고_전화_한국: r.보고_전화.map((c) => c.한국),
  }),
};
