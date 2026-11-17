import { useEffect, useState } from "react";
import { Enter } from "./screens/Enter";
import { Onboarding } from "./screens/Onboarding";
import { Select } from "./screens/Select";
import { Office } from "./screens/Office";
import { SubmitScreen } from "./screens/Submit";
import { ReviewScreen } from "./screens/Review";
import { ReportScreen } from "./screens/Report";
import type { NpcId, Report, SubmitResult } from "./types";

// 04 문서 1절 흐름: S0 입장 → S1 온보딩 → S6 선택 → S2 오피스 → S3 제출 → S4 검토 → S5 리포트
type Screen = "enter" | "onboarding" | "select" | "office" | "submit" | "review" | "report";

const LS = {
  session: "oreum.session",
  onboarded: "oreum.onboarded",
  run: "oreum.run",
};

function load<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* private mode */
  }
}

export default function App() {
  const [session, setSession] = useState<{ id: string; nickname: string } | null>(() => load(LS.session));
  const [runId, setRunId] = useState<string | null>(() => load(LS.run));
  const [screen, setScreen] = useState<Screen>(() => {
    const s = load<{ id: string }>(LS.session);
    if (!s) return "enter";
    if (!load(LS.onboarded)) return "onboarding";
    return load(LS.run) ? "office" : "select";
  });
  const [review, setReview] = useState<{ result: SubmitResult; owner: NpcId } | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  useEffect(() => save(LS.session, session), [session]);
  useEffect(() => save(LS.run, runId), [runId]);

  const goSelect = () => {
    setRunId(null);
    setReport(null);
    setScreen("select");
  };

  switch (screen) {
    case "enter":
      return (
        <Enter
          onEnter={(s) => {
            setSession(s);
            setScreen(load(LS.onboarded) ? "select" : "onboarding");
          }}
        />
      );
    case "onboarding":
      return (
        <Onboarding
          nickname={session!.nickname}
          onDone={() => {
            save(LS.onboarded, true);
            setScreen("select");
          }}
        />
      );
    case "select":
      return (
        <Select
          sessionId={session!.id}
          nickname={session!.nickname}
          onStart={(rid) => {
            setRunId(rid);
            setScreen("office");
          }}
          onResume={(rid) => {
            setRunId(rid);
            setScreen("office");
          }}
          onSampleReport={(r) => {
            setReport(r);
            setScreen("report");
          }}
          onLogout={() => {
            setSession(null);
            setRunId(null);
            setScreen("enter");
          }}
        />
      );
    case "office":
      return (
        <Office
          runId={runId!}
          nickname={session!.nickname}
          onSubmit={() => setScreen("submit")}
          onClosed={(owner) => {
            // 이미 종료된 run 을 다시 열었을 때
            setReview(null);
            setReport(null);
            void owner;
            setScreen("report");
          }}
          onLeave={goSelect}
        />
      );
    case "submit":
      return (
        <SubmitScreen
          runId={runId!}
          onBack={() => setScreen("office")}
          onResult={(result, owner) => {
            setReview({ result, owner });
            setScreen("review");
          }}
        />
      );
    case "review":
      return (
        <ReviewScreen
          result={review!.result}
          owner={review!.owner}
          onRetry={() => setScreen("office")}
          onReport={() => {
            setReport(null);
            setScreen("report");
          }}
        />
      );
    case "report":
      return <ReportScreen runId={report ? null : runId} report={report} onDone={goSelect} />;
  }
}
