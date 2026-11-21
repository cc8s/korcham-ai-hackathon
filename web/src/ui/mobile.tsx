import { useEffect, useState } from "react";

// 모바일 배치 (Figma 모바일 166:4308 · 대화목록 166:4603 · 오디대화 166:5943 · 제출 179:6908).
// 640px 이하에서 사무실·제출 화면이 사이드바 + 본문 대신 한 화면 + 아래 탭 막대(BNV)로 바뀐다.
// 반응형 점검(npm run test:responsive)에서 561~640px 도 제목이 단어 중간에서 꺾여 기준을 640 으로 (2026-11-22)
export const MOBILE_QUERY = "(max-width: 640px)";

export function useIsMobile() {
  const [m, setM] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const q = window.matchMedia(MOBILE_QUERY);
    const on = () => setM(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return m;
}

export type MobileTab = "home" | "msg" | "odi" | "submit";

// 제출 화면(따로 그려지는 화면)에서 다른 탭을 누르면 사무실로 돌아가며 그 탭을 열도록 넘겨 두는 값
export const mobileNav: { pending: MobileTab | null } = { pending: null };

const ICON: Record<MobileTab, React.ReactNode> = {
  home: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9L12 2L21 9V20C21 20.5304 20.7893 21.0391 20.4142 21.4142C20.0391 21.7893 19.5304 22 19 22H5C4.46957 22 3.96086 21.7893 3.58579 21.4142C3.21071 21.0391 3 20.5304 3 20V9Z" />
      <path d="M9 22V12H15V22" />
    </svg>
  ),
  msg: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5C21.0034 12.8199 20.6951 14.1219 20.1 15.3C19.3944 16.7117 18.3098 17.8992 16.9674 18.7293C15.6251 19.5594 14.0782 19.9994 12.5 20C11.1801 20.0034 9.87812 19.6951 8.7 19.1L3 21L4.9 15.3C4.30493 14.1219 3.99656 12.8199 4 11.5C4.00061 9.92176 4.44061 8.37485 5.27072 7.03255C6.10083 5.69025 7.28825 4.60557 8.7 3.9C9.87812 3.30493 11.1801 2.99656 12.5 3H13C15.0843 3.11499 17.053 3.99476 18.5291 5.47086C20.0052 6.94696 20.885 8.91565 21 11V11.5Z" />
    </svg>
  ),
  odi: (
    <svg width="23" height="23" viewBox="0 0 22.9 22.35" fill="currentColor">
      <path d="M13.3604 0C18.6261 0.000370502 22.8945 4.26939 22.8945 9.53516C22.8945 13.9048 19.9553 17.5814 15.9492 18.71L7.48242 22.2236C6.20296 22.7532 4.92107 21.4775 5.44043 20.1963L5.57812 19.8555L3.24023 21.3018H3.23926C1.54854 22.3461 -0.523407 20.6978 0.119141 18.8145L4.06348 7.25586C4.09228 7.17153 4.12589 7.0932 4.16113 7.02051C5.26467 2.97523 8.96382 0.000105997 13.3604 0ZM13.3604 2C9.8557 2.00011 6.9067 4.39371 6.06543 7.63672C6.04348 7.7213 6.01086 7.80289 5.96777 7.87891C5.95951 7.89347 5.95643 7.90124 5.95605 7.90234L2.01172 19.4609C1.99737 19.5032 2.00285 19.5229 2.00586 19.5322C2.01096 19.548 2.02466 19.5709 2.05078 19.5918C2.07685 19.6126 2.10237 19.6205 2.11914 19.6221C2.12907 19.6229 2.14947 19.6239 2.1875 19.6006L7.12793 16.5459C7.49559 16.3186 7.96831 16.3533 8.29883 16.6318C8.62937 16.9108 8.74353 17.3716 8.58105 17.7725L7.68848 19.9717L15.2324 16.8428L15.3516 16.8018C18.5472 15.9281 20.8945 13.0053 20.8945 9.53516C20.8945 5.50386 17.729 2.21186 13.748 2.00977L13.3604 2ZM13.4131 4.64648C13.8083 4.41829 14.3137 4.55408 14.542 4.94922L14.9551 5.66504C15.1833 6.06025 15.0484 6.56563 14.6533 6.79395C14.258 7.02202 13.7516 6.88646 13.5234 6.49121L13.1104 5.77539C12.8826 5.38022 13.0181 4.87467 13.4131 4.64648ZM16.124 3.11035C16.5193 2.88216 17.0246 3.01795 17.2529 3.41309L17.666 4.12891C17.8942 4.52412 17.7593 5.0295 17.3643 5.25781C16.969 5.48589 16.4626 5.35033 16.2344 4.95508L15.8213 4.23926C15.5935 3.84409 15.729 3.33854 16.124 3.11035Z" />
    </svg>
  ),
  submit: (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 12H16L14 15H10L8 12H2" />
      <path d="M5.45 5.11L2 12V18C2 18.5304 2.21071 19.0391 2.58579 19.4142C2.96086 19.7893 3.46957 20 4 20H20C20.5304 20 21.0391 19.7893 21.4142 19.4142C21.7893 19.0391 22 18.5304 22 18V12L18.55 5.11C18.3844 4.77679 18.1292 4.49637 17.813 4.30028C17.4967 4.10419 17.1321 4.0002 16.76 4H7.24C6.86792 4.0002 6.50326 4.10419 6.18704 4.30028C5.87083 4.49637 5.61558 4.77679 5.45 5.11Z" />
    </svg>
  ),
};
const LABEL: Record<MobileTab, string> = { home: "홈", msg: "메시지", odi: "오디", submit: "제출" };

// 아래 탭 막대 (Figma Frame 191): 홈 · 메시지 · 오디 · 제출. 켜진 탭은 브랜드 파랑
export function Bnv(props: { active: MobileTab; onTab: (t: MobileTab) => void; locked?: (t: MobileTab) => boolean }) {
  return (
    <nav className="sk-bnv" aria-label="탭">
      {(Object.keys(ICON) as MobileTab[]).map((t) => (
        <button
          key={t}
          className={`${props.active === t ? "on" : ""} ${props.locked?.(t) ? "locked" : ""}`}
          aria-label={LABEL[t]}
          aria-current={props.active === t ? "page" : undefined}
          onClick={() => props.onTab(t)}
        >
          {ICON[t]}
        </button>
      ))}
    </nav>
  );
}
