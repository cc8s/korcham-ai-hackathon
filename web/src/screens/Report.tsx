import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { Explanation, Report } from "../types";
import { Icon } from "../ui/kit";

const PATH_LABEL: Record<string, string> = {
  self: "스스로",
  hint1: "힌트 1단계 후",
  hint2: "힌트 2단계 후",
  hint3: "힌트 3단계 후",
  ai_warned: "AI 경고 후",
  reject: "반려 후",
  none: "미발견",
};

// S5 평가 리포트. report 가 주어지면(샘플) 그대로, 아니면 runId 로 평가 호출
export function ReportScreen(props: { runId: string | null; report: Report | null; onDone: () => void }) {
  const [report, setReport] = useState<Report | null>(props.report);
  const [state, setState] = useState<"loading" | "ready" | "error">(props.report ? "ready" : "loading");
  const [msg, setMsg] = useState("");
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
  }, [props.runId, props.report]);

  if (state !== "ready" || !report) {
    return (
      <div className="ws ws-center">
        <div className="ws-card ws-narrow">
          <h2 className="ws-title">AI 활용 역량 리포트</h2>
          <p className="ws-lead">{state === "loading" ? "교육 담당자가 기록을 읽는 중…" : msg}</p>
          <button className="ws-btn" onClick={props.onDone}>
            배치표로
          </button>
        </div>
      </div>
    );
  }

  const a = report.axes;
  const bars: { name: string; score: number; max: number }[] = [
    { name: "A 지시 품질", score: a.A_instruction.score, max: a.A_instruction.max },
    { name: "B 검증 행동", score: a.B_verification.score, max: a.B_verification.max },
    { name: "C 오류 발견", score: a.C_traps.score, max: a.C_traps.max },
    { name: "D 결과물", score: a.D_deliverable.score, max: a.D_deliverable.max },
    { name: "E 자원 효율", score: a.E_efficiency.score, max: a.E_efficiency.max },
  ];

  return (
    <div className="ws ws-col">
      <header className="ws-top">
        <b>AI 활용 역량 리포트</b>
        <small>
          {report.scenario.cert} · {report.scenario.title}
        </small>
        {props.report && <span className="ws-tag info">샘플</span>}
        <span className="ws-grow" />
        <button className="ws-btn" onClick={props.onDone}>
          배치표로
        </button>
      </header>

      <div className="ws-page slim">
        <section className="ws-card ws-hero">
          <div className="ws-grade">{report.grade}</div>
          <div>
            <div className="ws-total">
              {report.total} <small>/ 100</small>
            </div>
            <p>{report.summary}</p>
            {report.grade_note && <p className="ws-note">{report.grade_note}</p>}
          </div>
        </section>
        {report.partial && (
          <section className="ws-card">
            <span className="ws-tag warn">부분 리포트</span>
            <p className="ws-lead">지시 품질(A)과 코칭 문장은 아직 없어요. 배치표에서 다시 열면 다시 시도합니다.</p>
          </section>
        )}

        <section className="ws-card">
          <h3>축별 점수</h3>
          {bars.map((b) => (
            <div className="ws-score" key={b.name}>
              <span>{b.name}</span>
              <div className="ws-bar">
                <i style={{ width: `${(b.score / b.max) * 100}%` }} />
              </div>
              <em>
                {b.score}/{b.max}
              </em>
            </div>
          ))}
        </section>

        <section className="ws-card">
          <h3>함정 발견</h3>
          <div className="ws-traps">
            {a.C_traps.traps.map((t) => (
              <div className="ws-trap" key={t.id}>
                <div className="ws-trap-top">
                  <span>{t.id}</span>
                  <span className={`ws-tag ${t.found ? "accent" : "warn"}`}>{t.found ? `발견 · ${PATH_LABEL[t.path] ?? t.path}` : "미발견"}</span>
                  <em>{t.score}점</em>
                </div>
                {t.desc}
                {t.warned_ignored && <span className="ws-trap-note">오디가 경고했지만 확인하지 않음</span>}
              </div>
            ))}
          </div>
          {/* 해설은 정답을 담고 있어 버튼을 눌러야 연다 (샘플 리포트에는 없음) */}
          {!props.report && !explain && (
            <button className="ws-btn block" onClick={openExplain}>
              해설 보기 (함정 위치와 정답)
            </button>
          )}
          {explainErr && <p className="ws-notice flat">{explainErr}</p>}
          {explain && (
            <div className="ws-stack">
              {explain.traps.map((t) => (
                <div className="ws-trap" key={t.id}>
                  <div className="ws-trap-top">
                    <span>{t.id}</span>
                    <b>{t.label}</b>
                    <span className={`ws-tag ${t.found ? "accent" : "warn"}`}>{t.found ? "찾음" : "놓침"}</span>
                  </div>
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
              <p className="ws-fine">해설을 본 뒤 같은 업무에 다시 도전하면 이미 답을 아는 상태라, 그 점수는 참고용으로 봐 주세요.</p>
            </div>
          )}
        </section>

        <section className="ws-card">
          <h3>오디에게 한 지시</h3>
          <div className="ws-quote">
            <span className="ws-tag accent">잘한 지시</span>
            <blockquote>{report.highlights.good.quote}</blockquote>
            <p>{report.highlights.good.why}</p>
          </div>
          <div className="ws-quote">
            <span className="ws-tag warn">아쉬운 지시</span>
            <blockquote>{report.highlights.improve.quote}</blockquote>
            <p>{report.highlights.improve.why}</p>
          </div>
          <table className="ws-table">
            <tbody>
              {a.A_instruction.items.map((it) => (
                <tr key={it.name}>
                  <td>{it.name}</td>
                  <td>{it.score}/5</td>
                  <td>{it.quote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="ws-card">
          <h3>다음에 해 볼 것</h3>
          <ul className="ws-checks">
            {report.next_steps.map((s, i) => (
              <li key={i}>
                <Icon name="check" />
                <span>{s}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="ws-chips">
          <span className="ws-tag">오디 {report.resources.odi_calls}</span>
          <span className="ws-tag">힌트 {report.resources.hints}</span>
          <span className="ws-tag">반려 {report.resources.rejects}</span>
          <span className="ws-tag">{report.resources.duration_min}분</span>
        </div>
      </div>
    </div>
  );
}
