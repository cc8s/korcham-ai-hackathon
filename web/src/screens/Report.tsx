import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import { NPC_INFO, type Explanation, type NpcId, type Report } from "../types";

// S5 AI 활용 역량 리포트. 디자인: Figma "ai 역량 리포트결과" (132:4573)
// 오각형은 A~E 다섯 축(만점은 실제 채점 기준 20/25/25/15/5), 보고 메일(F)은 아래 '제출 보고 점수'로 따로

const PATH_TAG: Record<string, { label: string; tone: "ok" | "warn" | "none" }> = {
  self: { label: "스스로 발견", tone: "ok" },
  ai_warned: { label: "AI 경고 후 발견", tone: "warn" },
  reject: { label: "반려 후 발견", tone: "warn" },
  // hint1~3 은 2026-11-18 힌트 제거 전 리포트용
  hint1: { label: "힌트 후 발견", tone: "warn" },
  hint2: { label: "힌트 후 발견", tone: "warn" },
  hint3: { label: "힌트 후 발견", tone: "warn" },
  none: { label: "미발견", tone: "none" },
};

// 받침 따라 조사 고르기 (이/가, 은/는)
const josa = (w: string, withB: string, without: string) => {
  const c = w.charCodeAt(w.length - 1);
  return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 !== 0 ? withB : without);
};

// 상단바: 로고 + 돌아가기만 (Figma 리포트 평가 112:3003). 리포트 제목은 카드 맨 위로 옮김 (Frame 125)
function ReportTop(props: { onDone: () => void }) {
  return (
    <header className="sk-top between">
      <img src="/assets/ui/simtern-logo.svg" width={162} height={41} alt="Simtern" />
      <button className="sk-leave" onClick={props.onDone}>
        <img src="/assets/ui/ic-arrow-left.svg" width={16} height={16} alt="" />
        돌아가기
      </button>
    </header>
  );
}

// 오각형 그래프: 위(A)부터 시계 방향 A 지시 → C 오류 → D 결과물 → E 자원 → B 검증 (Figma 배치)
function Radar(props: { grade: string; axes: { label: string; score: number; max: number }[] }) {
  const cx = 240;
  const cy = 157;
  const R = 118;
  const pt = (i: number, r: number) => {
    const a = ((-90 + i * 72) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  };
  const ring = (k: number) =>
    props.axes
      .map((_, i) => pt(i, R * k))
      .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
      .join(" ");
  const data = props.axes
    .map((a, i) => pt(i, R * Math.max(0.06, Math.min(1, a.max ? a.score / a.max : 0))))
    .map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`)
    .join(" ");
  // 라벨 위치: 꼭짓점 바깥쪽
  const label = (i: number) => {
    const [x, y] = pt(i, R);
    if (i === 0) return { x, y: y - 16, anchor: "middle" as const };
    if (i === 1) return { x: x + 14, y: y + 5, anchor: "start" as const };
    if (i === 4) return { x: x - 14, y: y + 5, anchor: "end" as const };
    return { x, y: y + 30, anchor: "middle" as const };
  };
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, ""));
  return (
    <svg className="sk-radar" viewBox="0 0 480 300" role="img" aria-label={`등급 ${props.grade}, ${props.axes.map((a) => `${a.label} ${fmt(a.score)}/${a.max}`).join(", ")}`}>
      {[1 / 3, 2 / 3].map((k) => (
        <polygon key={k} points={ring(k)} className="sk-radar-grid" />
      ))}
      {props.axes.map((_, i) => {
        const [x, y] = pt(i, R);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} className="sk-radar-grid" />;
      })}
      <polygon points={data} className="sk-radar-data" />
      <polygon points={ring(1)} className="sk-radar-outer" />
      <text x={cx} y={cy + 18} textAnchor="middle" className="sk-radar-grade">
        {props.grade}
      </text>
      {props.axes.map((a, i) => {
        const l = label(i);
        return (
          <text key={a.label} x={l.x} y={l.y} textAnchor={l.anchor} className="sk-radar-label">
            {a.label} {fmt(a.score)} / {a.max}
          </text>
        );
      })}
    </svg>
  );
}

export function ReportScreen(props: { runId: string | null; report: Report | null; onDone: () => void }) {
  const [report, setReport] = useState<Report | null>(props.report);
  const [state, setState] = useState<"loading" | "ready" | "error">(props.report ? "ready" : "loading");
  const [msg, setMsg] = useState("");
  const [owner, setOwner] = useState<NpcId | null>(null);
  const [explain, setExplain] = useState<Explanation | null>(null);
  const [explainErr, setExplainErr] = useState<string | null>(null);
  const openExplain = () => {
    if (!props.runId) return;
    setExplainErr(null);
    api
      .explanation(props.runId)
      .then(setExplain)
      .catch((e) => setExplainErr(e instanceof ApiError ? e.message : "해설을 불러오지 못했어요"));
  };

  useEffect(() => {
    if (props.report || !props.runId) return;
    api
      .evaluate(props.runId)
      .then((r) => {
        setReport(r);
        setState("ready");
      })
      .catch((e) => {
        setState("error");
        setMsg(e instanceof ApiError ? e.message : "평가 실패");
      });
    // 보고 메일 문장에 담당 팀장 이름을 넣으려고 (리포트 JSON 에는 없음). 실패해도 문장은 이름 없이 나감
    api
      .getRun(props.runId)
      .then((r) => setOwner(r.scenario.owner_npc_id))
      .catch(() => {});
  }, [props.runId, props.report]);

  if (state !== "ready" || !report) {
    return (
      <div className="ws ws-col sk-report">
        <ReportTop onDone={props.onDone} />
        <div className="sk-report-page">
          <section className="sk-report-card sk-report-wait">
            <p>{state === "loading" ? "교육 담당자가 기록을 읽는 중…" : msg}</p>
          </section>
        </div>
      </div>
    );
  }

  const a = report.axes;
  const radar = [
    { label: "지시 품질", score: a.A_instruction.score, max: a.A_instruction.max },
    { label: "오류 발견", score: a.C_traps.score, max: a.C_traps.max },
    { label: "결과물 완성도", score: a.D_deliverable.score, max: a.D_deliverable.max },
    { label: "자원 효율", score: a.E_efficiency.score, max: a.E_efficiency.max },
    { label: "검증 행동", score: a.B_verification.score, max: a.B_verification.max },
  ];
  const F = a.F_report;
  const names = (ids: NpcId[]) => ids.map((id) => `${NPC_INFO[id].name} ${id === "lee" ? "사수" : "팀장님"}`).join(", ");
  const ownerName = owner ? `${NPC_INFO[owner].name} 팀장님` : "지시한 팀장님";
  const mailRows = F?.sent
    ? [
        {
          k: "받는 사람",
          text: F.to === 2 ? `${ownerName}에게 보냈어요` : F.to === 1 ? `${ownerName} 말고 다른 사람도 받는 사람에 있어요` : `받는 사람에 ${josa(ownerName, "이", "가")} 없어요`,
          s: `${F.to}/2`,
        },
        {
          k: "참조",
          text:
            F.cc === 2
              ? "필요한 사람만 정확히 참조에 넣었어요"
              : [F.cc_missing.length ? `${josa(names(F.cc_missing), "이", "가")} 빠졌어요` : "", F.cc_extra.length ? `${josa(names(F.cc_extra), "은", "는")} 참조가 필요 없어요` : ""].filter(Boolean).join(" · "),
          s: `${F.cc}/2`,
          sub: F.cc === 2 ? undefined : F.cc_why,
        },
        { k: "첨부", text: F.attach === 2 ? "결과물 파일을 첨부했어요" : "결과물을 첨부하지 않았어요", s: `${F.attach}/2` },
        { k: "제목", text: F.subject === 1 ? "제목만 봐도 무슨 건인지 알 수 있어요" : "제목만 봐서는 무슨 건인지 알기 어려워요", s: `${F.subject}/1` },
        { k: "첫 줄", text: F.lead === 3 ? "핵심 숫자와 판단을 첫 줄에 먼저 썼어요" : "첫 줄에 핵심 숫자·판단이 없어요. 결론부터 써 보세요", s: `${F.lead}/3` },
      ]
    : [];
  const pts = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

  return (
    <div className="ws ws-col sk-report">
      <ReportTop onDone={props.onDone} />
      <div className="sk-report-page">
        <section className="sk-report-card">
          {/* Figma Frame 125: 제목 20 세미볼드 + 자격증 태그, 아래 업무 제목 14 */}
          <div className="sk-report-title">
            <div>
              <h2>AI 활용 역량 리포트</h2>
              {report.scenario.cert && <span className="sk-cert">{report.scenario.cert}</span>}
            </div>
            <p>{report.scenario.title}</p>
          </div>
          {report.partial && (
            <p className="sk-report-partial">
              <span className="sk-state warn">부분 리포트</span>
              지시 품질과 코칭 문장은 아직 없어요. 배치표에서 다시 열면 다시 시도합니다.
            </p>
          )}

          <div className="sk-report-top">
            <Radar grade={report.grade} axes={radar} />
            <div className="sk-report-side">
              <div className="sk-report-block">
                <h3>총 점수</h3>
                <div className="sk-report-box">
                  <p className="sk-report-total">
                    <b>{pts(report.total)}</b>
                    <span>/100</span>
                  </p>
                  <p className="sk-report-summary">{report.summary}</p>
                  {report.grade_note && <p className="sk-report-note">{report.grade_note}</p>}
                </div>
              </div>
              <div className="sk-report-block">
                <h3>함정 발견</h3>
                <div className="sk-report-box sk-traps">
                  {a.C_traps.traps.map((t) => {
                    const tag = t.found ? PATH_TAG[t.path] ?? { label: "발견", tone: "ok" } : PATH_TAG.none;
                    return (
                      <div className="sk-trap" key={t.id}>
                        <div className="sk-trap-top">
                          <span className="sk-trap-id">{t.id}</span>
                          <span className={`sk-state ${tag.tone === "ok" ? "accent" : tag.tone === "warn" ? "warn" : ""}`}>{tag.label}</span>
                        </div>
                        <div className="sk-trap-row">
                          <span className="sk-trap-desc">{t.desc}</span>
                          <span className="sk-trap-score">
                            <b>{pts(t.score)}</b>점
                          </span>
                        </div>
                        {t.warned_ignored && <small className="sk-trap-note">오디가 경고했지만 확인하지 않았어요</small>}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {F && (
            <div className="sk-report-mail">
              <div className="sk-report-mail-score">
                <h3>제출 보고 점수</h3>
                <p>
                  <b>{pts(F.score)}</b>
                  <span>/{F.max}</span>
                </p>
              </div>
              {F.sent ? (
                <dl className="sk-report-mail-rows">
                  {mailRows.map((r) => (
                    <div key={r.k}>
                      <dt>{r.k}</dt>
                      <dd>
                        {r.text} {r.s}
                        {r.sub && <small>{r.sub}</small>}
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="sk-report-mail-none">이 도전은 메일 없이 제출된 기록이라 보고 점수가 없어요.</p>
              )}
            </div>
          )}

          <div className="sk-report-block">
            <h3>오디에게 한 지시</h3>
            <div className="sk-report-box lg sk-quotes">
              <div className="sk-quote">
                <p className="sk-quote-why">
                  <span className="sk-state accent">잘한 점</span>
                  {report.highlights.good.why}
                </p>
                <blockquote>{report.highlights.good.quote}</blockquote>
              </div>
              <div className="sk-quote">
                <p className="sk-quote-why">
                  <span className="sk-state warn">아쉬운 점</span>
                  {report.highlights.improve.why}
                </p>
                <blockquote>{report.highlights.improve.quote}</blockquote>
              </div>
              <table className="sk-items">
                <tbody>
                  {a.A_instruction.items.map((it) => (
                    <tr key={it.name}>
                      <th>{it.name}</th>
                      <td className="sk-items-score">{it.score}/5</td>
                      <td>{it.quote}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="sk-report-block">
            <h3>다음에 해보면 좋아요</h3>
            <ul className="sk-next">
              {report.next_steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>

          {/* 디자인에 없는 것들은 아래에 같은 톤으로 (2026-11-21 결정): 해설, 자원 기록 */}
          <div className="sk-report-foot">
            {props.runId && !explain && (
              <button className="sk-btn ghost" onClick={openExplain}>
                해설 보기 (함정 위치와 정답)
              </button>
            )}
            {explainErr && <p className="sk-fine err">{explainErr}</p>}
            {explain && (
              <div className="sk-explain">
                {explain.traps.map((t) => (
                  <div className="sk-explain-item" key={t.id}>
                    <p className="sk-trap-top">
                      <span className="sk-trap-id">{t.id}</span>
                      <b>{t.label}</b>
                      <span className={`sk-state ${t.found ? "accent" : "warn"}`}>{t.found ? "찾음" : "놓침"}</span>
                    </p>
                    <p>
                      <b>어디에</b> {t.where}
                    </p>
                    <p>
                      <b>찾는 법</b> {t.how}
                    </p>
                    <p>
                      <b>숫자 영향</b> {t.impact}
                    </p>
                  </div>
                ))}
                <p className="sk-fine">해설을 본 뒤 같은 업무에 다시 도전하면 이미 답을 아는 상태라, 그 점수는 참고용으로 봐 주세요.</p>
              </div>
            )}
            <p className="sk-report-res">
              <span>오디 호출 {report.resources.odi_calls}</span>
              {report.resources.mentor_questions !== undefined && <span>하늘 선배 질문 {report.resources.mentor_questions}</span>}
              <span>반려 {report.resources.rejects}</span>
              <span>{report.resources.duration_min}분</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
