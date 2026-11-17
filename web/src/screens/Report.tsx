import { useEffect, useState } from "react";
import { api, ApiError } from "../api";
import type { Report } from "../types";

const PATH_LABEL: Record<string, string> = {
  self: "스스로",
  hint1: "힌트 1단계 후",
  hint2: "힌트 2단계 후",
  hint3: "힌트 3단계 후",
  reject: "반려 후",
  none: "미발견",
};

// S5 평가 리포트. report 가 주어지면(샘플) 그대로, 아니면 runId 로 평가 호출
export function ReportScreen(props: { runId: string | null; report: Report | null; onDone: () => void }) {
  const [report, setReport] = useState<Report | null>(props.report);
  const [state, setState] = useState<"loading" | "ready" | "pending" | "error">(props.report ? "ready" : "loading");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (props.report || !props.runId) return;
    api
      .evaluate(props.runId)
      .then((r) => {
        setReport(r);
        setState("ready");
      })
      .catch((e) => {
        if (e instanceof ApiError && e.status === 501) {
          setState("pending");
          setMsg("평가 파이프라인은 다음 단계에서 열립니다. 플레이 기록은 저장돼 있어요.");
        } else {
          setState("error");
          setMsg(e instanceof ApiError ? e.message : "평가 실패");
        }
      });
  }, [props.runId, props.report]);

  if (state !== "ready" || !report) {
    return (
      <div className="screen center">
        <div className="card narrow">
          <h2>AI 활용 역량 리포트</h2>
          <p className="muted">{state === "loading" ? "교육 담당자가 기록을 읽는 중..." : msg}</p>
          <button className="btn" onClick={props.onDone}>
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
    <div className="screen">
      <header className="topbar">
        <b>AI 활용 역량 리포트</b>
        <span className="muted">
          {report.scenario.cert} · {report.scenario.title}
        </span>
        <span className="grow" />
        {props.report && <span className="tag">샘플</span>}
        <button className="btn small" onClick={props.onDone}>
          배치표로
        </button>
      </header>

      <div className="report">
        <section className="card hero">
          <div className="grade">{report.grade}</div>
          <div>
            <div className="total">
              {report.total} <span className="muted">/ 100</span>
            </div>
            <p>{report.summary}</p>
          </div>
        </section>

        <section className="card">
          <h3>축별 점수</h3>
          {bars.map((b) => (
            <div className="bar-row" key={b.name}>
              <span>{b.name}</span>
              <div className="bar">
                <div className="fill" style={{ width: `${(b.score / b.max) * 100}%` }} />
              </div>
              <span className="num">
                {b.score}/{b.max}
              </span>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>함정 발견</h3>
          <div className="row wrap">
            {a.C_traps.traps.map((t) => (
              <div className={`trap ${t.found ? "found" : "missed"}`} key={t.id}>
                <b>{t.id}</b> {t.desc}
                <div className="tiny">{t.found ? `발견 · ${PATH_LABEL[t.path] ?? t.path}` : "미발견"} · {t.score}점</div>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h3>오디에게 한 지시</h3>
          <div className="quote good">
            <span className="tag">잘한 지시</span>
            <blockquote>{report.highlights.good.quote}</blockquote>
            <p className="tiny">{report.highlights.good.why}</p>
          </div>
          <div className="quote improve">
            <span className="tag">아쉬운 지시</span>
            <blockquote>{report.highlights.improve.quote}</blockquote>
            <p className="tiny">{report.highlights.improve.why}</p>
          </div>
          <table className="mini">
            <tbody>
              {a.A_instruction.items.map((it) => (
                <tr key={it.name}>
                  <td>{it.name}</td>
                  <td className="num">{it.score}/5</td>
                  <td className="muted">{it.quote}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h3>다음에 해 볼 것</h3>
          <ul className="checks">
            {report.next_steps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>

        <footer className="resources">
          <span>오디 {report.resources.odi_calls}</span>
          <span>힌트 {report.resources.hints}</span>
          <span>반려 {report.resources.rejects}</span>
          <span>{report.resources.duration_min}분</span>
        </footer>
      </div>
    </div>
  );
}
