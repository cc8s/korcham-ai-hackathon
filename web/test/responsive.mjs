// 반응형 점검: 화면 × 창 폭마다 자동 검사 + 캡처, 마지막에 격자 한 장으로 모은다.
// 실행: npm run test:responsive   (web/ 에서. API 키 불필요: LLM mock 서버를 따로 띄움)
// 크롬 경로: CHROME 환경변수 (없으면 Playwright 기본 브라우저). 결과: test/out/responsive/
//
// 자동 검사 (실패면 표에 표시, 하나라도 있으면 종료 코드 1)
//   가로스크롤   페이지가 창보다 넓어짐
//   화면밖       눌러야 하는 요소(버튼·입력·링크)가 창 밖으로 나감
//   잘림         글자가 칸을 넘쳐 잘림 (말줄임표로 의도한 것은 제외)
//   겹침         버튼·입력끼리 서로 덮음
//   사원증겹침   입장·온보딩에서 3D 사원증 카드가 왼쪽 글·폼을 덮음 (카드 위치는 badge3d.tsx 상수로 계산)
//   본문좁음     제목(h1·h2)이 3줄 이상, 또는 280px(창의 60%)보다 좁은 칸에서 2줄 이상으로 꺾임 → 옆 사이드바 등에 밀린 상태
// 일부 화면만: ONLY=office,submit npm run test:responsive   /  폭 지정: W=360,390
// 검토 화면(반려)은 앱 메모리의 제출 결과로만 그려져 주소로 열 수 없어 제외.
// 모바일 전용 화면(M오늘업무·M메시지·M오디·M받는사람)은 640px 이하 폭에서만.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { startServer, testPort } from "../../server/test/_harness.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "out", "responsive");
const WIDTHS = process.env.W ? process.env.W.split(",").map(Number) : [1440, 1280, 1025, 1024, 960, 768, 641, 640, 560, 390]; // CSS 가 바뀌는 1024(사원증)·960·640(모바일 배치)·560 의 위아래 포함
const API_PORT = testPort(8797);
const WEB_PORT = testPort(5199);
const WEB = `http://localhost:${WEB_PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ONLY = process.env.ONLY?.split(",");
if (!ONLY) fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let srv;
let vite;
let browser;
let failed = false;
try {
  // ---------- 서버 2개 ----------
  srv = await startServer({ port: API_PORT, dbName: "responsive.db", env: { LLM_MOCK: "1", CORS_ORIGIN: WEB } });
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(WEB_PORT), "--strictPort"], {
    cwd: path.resolve(here, ".."),
    env: { ...process.env, VITE_API_BASE: `http://localhost:${API_PORT}` },
    stdio: "ignore",
  });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(WEB)).ok) break;
    } catch {}
    await sleep(500);
  }

  // ---------- 화면별 상태 (API 로 만든다) ----------
  const api = srv.api;
  const sess = (await api("POST", "/session", { nickname: "반응형" })).json.session_id;
  // 리포트용: 3번 반려로 끝난 업무 → 평가(mock)
  const sessR = (await api("POST", "/session", { nickname: "리포트" })).json.session_id;
  const ridR = (await api("POST", "/scenario/01/start", { session_id: sessR })).json.run_id;
  await api("PUT", `/run/${ridR}/basket`, { text: "거래처별 합계표" });
  for (let i = 0; i < 3; i++) {
    await api("POST", `/run/${ridR}/submit`, {
      verify_memo: "원본과 한 줄씩 대조했습니다",
      fields: { total_sales: 584030000, customer_count: 12, min_customer_sales: 6870000 },
    });
  }
  const ev = await api("POST", `/run/${ridR}/evaluate`);
  if (ev.status !== 200) throw new Error("평가(mock) 실패: " + ev.text);
  // 사무실·제출용: 진행 중 업무
  const ridO = (await api("POST", "/scenario/01/start", { session_id: sess })).json.run_id;

  const ls = (o) => ({
    "oreum.session": o.session ? JSON.stringify({ id: o.session, nickname: "반응형" }) : null,
    "oreum.onboarded": o.onboarded ? "true" : null,
    "oreum.run": o.run ? JSON.stringify(o.run) : null,
  });
  // 팀장 지시를 받아야 제출·오디가 열림: 하늘 선배에게 인사 → 팀장 지시 → 대화 닫기 (고정 대사, LLM 없음)
  const brief = async (p) => {
    // 모바일은 대화가 전체 화면이라 사람마다 ← 로 닫고 다음 사람에게 (실제 사용 순서와 같음)
    for (const who of ["이하늘", "박소연"]) {
      await p.locator(".sk-mate", { hasText: who }).click({ timeout: 3000 }).catch(() => {});
      await sleep(1500);
      await p.locator(".ws-iconbtn, .sk-m-back").first().click({ timeout: 1500 }).catch(() => {}); // PC ×, 모바일 ←
      await sleep(300);
    }
  };
  // open: 그 화면까지 가는 방법. 반환값 false 면 도달 실패
  const SCREENS = [
    { id: "enter", label: "입장", storage: ls({}) },
    { id: "onboarding", label: "온보딩", storage: ls({ session: sess }) },
    { id: "select", label: "배치표", storage: ls({ session: sess, onboarded: true }) },
    { id: "office", label: "사무실", storage: ls({ session: sess, onboarded: true, run: ridO }) },
    {
      id: "submit",
      label: "제출",
      storage: ls({ session: sess, onboarded: true, run: ridO }),
      open: async (p) => {
        await brief(p);
        await p.getByRole("button", { name: "제출하기" }).click({ timeout: 3000 }).catch(() => {});
        await sleep(1200);
        return (await p.getByText(/제출 작성하기|보고 메일 쓰기/).count()) > 0; // PC·모바일 제목
      },
    },
    { id: "report", label: "리포트", storage: ls({ session: sessR, onboarded: true, run: ridR }) },
    // 모바일 전용 화면 (640px 이하에만 있음)
    {
      id: "m-task",
      label: "M오늘업무",
      mobileOnly: true,
      storage: ls({ session: sess, onboarded: true, run: ridO }),
      open: async (p) => {
        await brief(p);
        await p.getByRole("button", { name: /오늘 업무/ }).click({ timeout: 3000 }).catch(() => {});
        await sleep(800);
        return (await p.locator(".sk-m-task").count()) > 0;
      },
    },
    {
      id: "m-msg",
      label: "M메시지",
      mobileOnly: true,
      storage: ls({ session: sess, onboarded: true, run: ridO }),
      open: async (p) => {
        await p.getByRole("button", { name: "메시지" }).click({ timeout: 3000 }).catch(() => {});
        await sleep(800);
        return (await p.locator(".sk-m-msgs").count()) > 0;
      },
    },
    {
      id: "m-odi",
      label: "M오디",
      mobileOnly: true,
      storage: ls({ session: sess, onboarded: true, run: ridO }),
      open: async (p) => {
        await brief(p);
        await p.getByRole("button", { name: "오디", exact: true }).click({ timeout: 3000 }).catch(() => {});
        await sleep(800);
        return (await p.locator(".ws-panel .ws-odi, .ws-panel textarea").count()) > 0;
      },
    },
    {
      id: "m-pick",
      label: "M받는사람",
      mobileOnly: true,
      storage: ls({ session: sess, onboarded: true, run: ridO }),
      open: async (p) => {
        await brief(p);
        await p.getByRole("button", { name: "제출", exact: true }).click({ timeout: 3000 }).catch(() => {});
        await sleep(1200);
        await p.getByRole("button", { name: "받는 사람 고르기" }).click({ timeout: 3000 }).catch(() => {});
        await sleep(500);
        return (await p.locator(".sk-m-pick").count()) > 0;
      },
    },
  ].filter((sc) => !ONLY || ONLY.includes(sc.id));

  // ---------- 페이지 안에서 도는 검사 ----------
  const inspect = () => {
    const W = innerWidth;
    const out = { hscroll: 0, offscreen: [], clipped: [], overlap: [], badgeOverForm: 0, narrow: [] };
    if (document.documentElement.scrollWidth > W + 1) out.hscroll = document.documentElement.scrollWidth;
    const visible = (el) => {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const label = (el) => {
      const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
      const t = (el.innerText || el.value || el.placeholder || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 18);
      return `${el.tagName.toLowerCase()}${cls}${t ? ` "${t}"` : ""}`;
    };
    // 스크롤·잘림 상자 안의 요소는 그 상자가 보여 주는 범위만 의미 있음 → 화면밖 검사에서 제외
    const inClipBox = (el) => {
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const s = getComputedStyle(a);
        if (s.overflowX !== "visible") return true;
      }
      return false;
    };
    const all = [...document.querySelectorAll("body *")].filter((el) => !el.closest(".sk-badge3d") && visible(el));
    const interactive = all.filter((el) => el.matches("button, a[href], input, textarea, select, [role=button]"));
    for (const el of interactive) {
      const r = el.getBoundingClientRect();
      if ((r.right > W + 1 || r.left < -1) && !inClipBox(el)) out.offscreen.push(`${label(el)} [${Math.round(r.left)}~${Math.round(r.right)}]`);
    }
    for (const el of all) {
      if (el.children.length || !(el.innerText || "").trim()) continue;
      const s = getComputedStyle(el);
      const clips = s.overflowX !== "visible" || s.overflow !== "visible";
      if (clips && s.textOverflow !== "ellipsis" && el.scrollWidth > el.clientWidth + 1) out.clipped.push(label(el));
    }
    // 겹침은 실제로 맨 위에 보이는(누를 수 있는) 요소끼리만 본다.
    // 전체 화면 패널에 가려진 사이드바, 탭 막대(BNV) 아래로 스크롤되어 지나가는 입력칸은 정상이라 제외
    const onTop = (el) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(Math.max(r.left + r.width / 2, 0), W - 1);
      const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el));
    };
    // 탭 막대(.sk-bnv)는 내용이 그 밑으로 스크롤되는 고정 막대라 겹침 비교에서 뺀다
    const topInteractive = interactive.filter((el) => onTop(el) && !el.closest(".sk-bnv"));
    for (let i = 0; i < topInteractive.length; i++) {
      for (let j = i + 1; j < topInteractive.length; j++) {
        const a = topInteractive[i];
        const b = topInteractive[j];
        if (a.contains(b) || b.contains(a)) continue;
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
        const h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
        if (w > 4 && h > 4) out.overlap.push(`${label(a)} × ${label(b)}`);
      }
    }
    for (const h of document.querySelectorAll("h1, h2")) {
      if (!visible(h) || h.closest(".sk-badge3d")) continue;
      // 글자 폭만큼만 차지하는 한 줄 제목은 정상. 좁은데 여러 줄로 꺾였거나, 3줄 이상이면 문제
      const r = h.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(h).lineHeight) || parseFloat(getComputedStyle(h).fontSize) * 1.3;
      const cs = getComputedStyle(h);
      const lines = Math.round((r.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) / lh); // 여백 빼고
      if (lines >= 3 || (lines >= 2 && r.width < Math.min(280, W * 0.6))) out.narrow.push(`${label(h)} ${Math.round(r.width)}px·${lines}줄`);
    }
    // 3D 사원증 카드 자리 (badge3d.tsx: 세로 60%, 1024:1440, 가운데 73.8%) vs 왼쪽 글·폼
    const badge = document.querySelector(".sk-badge3d");
    const copy = document.querySelector(".sk-intro-copy");
    if (badge && copy && visible(badge) && Number(getComputedStyle(badge).opacity) > 0.5) {
      const cw = innerHeight * 0.6 * (1024 / 1440);
      const cardLeft = W * 0.738 - cw / 2;
      const over = copy.getBoundingClientRect().right - cardLeft;
      if (over > 0) out.badgeOverForm = Math.round(over);
    }
    return out;
  };

  // ---------- 돌리기 ----------
  browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const results = [];
  // 칸 하나: 실패하면 한 번 더, 그래도 실패면 기록만 하고 다음 칸으로
  const runCell = async (sc, w) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: w <= 400 ? 800 : w <= 560 ? 844 : 900 }, reducedMotion: "reduce" });
    try {
      await ctx.addInitScript((st) => {
        localStorage.clear();
        for (const [k, v] of Object.entries(st)) if (v !== null) localStorage.setItem(k, v);
      }, sc.storage);
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(WEB);
      await sleep(2500);
      const reached = sc.open ? await sc.open(p) : true;
      const r = reached ? await p.evaluate(inspect) : null;
      const file = `${sc.id}-${w}.png`;
      await p.screenshot({ path: path.join(OUT, file), fullPage: false });
      return { screen: sc.id, label: sc.label, width: w, reached, errs, file, ...(r ?? {}) };
    } finally {
      await ctx.close().catch(() => {});
    }
  };
  const widthsFor = (sc) => (sc.mobileOnly ? WIDTHS.filter((w) => w <= 640) : WIDTHS);
  for (const sc of SCREENS) {
    for (const w of widthsFor(sc)) {
      let res;
      for (let attempt = 0; attempt < 2 && !res; attempt++) {
        try {
          res = await runCell(sc, w);
        } catch (e) {
          if (attempt === 1) res = { screen: sc.id, label: sc.label, width: w, reached: false, errs: ["점검 실패: " + String(e.message).split(/\r?\n/)[0]], file: "" };
        }
      }
      results.push(res);
      process.stdout.write(`${sc.label}-${w} `);
    }
  }

  // ---------- 결과 ----------
  const bad = (r) =>
    !r.reached || r.errs.length || r.hscroll || r.offscreen?.length || r.clipped?.length || r.overlap?.length || r.badgeOverForm || r.narrow?.length;
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(results, null, 2));
  console.log("\n화면 × 폭 자동 검사 (✔ 통과 / ✗ 문제 / · 해당 없음)\n");
  console.log(["화면".padEnd(8), ...WIDTHS.map((w) => String(w).padStart(5))].join(""));
  for (const sc of SCREENS) {
    const row = WIDTHS.map((w) => {
      const r = results.find((x) => x.screen === sc.id && x.width === w);
      return !r ? "    ·" : bad(r) ? "    ✗" : "    ✔";
    });
    console.log([sc.label.padEnd(7), ...row].join(""));
  }
  const issues = results.filter(bad);
  if (issues.length) {
    failed = true;
    console.log("\n문제 상세");
    for (const r of issues) {
      const parts = [];
      if (!r.reached) parts.push("화면 도달 실패");
      if (r.errs.length) parts.push("오류: " + r.errs.join(" | "));
      if (r.hscroll) parts.push(`가로스크롤 (페이지 ${r.hscroll}px)`);
      if (r.offscreen?.length) parts.push("화면밖: " + r.offscreen.slice(0, 4).join(", ") + (r.offscreen.length > 4 ? ` 외 ${r.offscreen.length - 4}` : ""));
      if (r.clipped?.length) parts.push("잘림: " + r.clipped.slice(0, 4).join(", ") + (r.clipped.length > 4 ? ` 외 ${r.clipped.length - 4}` : ""));
      if (r.overlap?.length) parts.push("겹침: " + r.overlap.slice(0, 3).join(", ") + (r.overlap.length > 3 ? ` 외 ${r.overlap.length - 3}` : ""));
      if (r.narrow?.length) parts.push("본문좁음: " + r.narrow.slice(0, 3).join(", "));
      if (r.badgeOverForm) parts.push(`사원증겹침 (폼 오른쪽 끝을 ${r.badgeOverForm}px 덮음)`);
      console.log(`- ${r.label} ${r.width}: ${parts.join(" / ")}`);
    }
  }

  // ---------- 격자 한 장 (행: 화면, 열: 폭) ----------
  const cell = 220;
  const html = `<!doctype html><meta charset="utf-8"><style>
    body{margin:0;padding:16px;font:13px/1.4 sans-serif;background:#f3f4f6}
    table{border-collapse:collapse} td,th{padding:4px;vertical-align:top;text-align:center}
    th{font-weight:600} .bad{outline:3px solid #e5484d} img{display:block;width:${cell}px;height:${Math.round((cell * 900) / 1440)}px;object-fit:contain;object-position:top;background:#fff}
  </style><table><tr><th></th>${WIDTHS.map((w) => `<th>${w}</th>`).join("")}</tr>${SCREENS.map(
    (sc) =>
      `<tr><th>${sc.label}</th>${WIDTHS.map((w) => {
        const r = results.find((x) => x.screen === sc.id && x.width === w);
        return r ? `<td><img class="${bad(r) ? "bad" : ""}" src="${r.file}"></td>` : "<td></td>";
      }).join("")}</tr>`,
  ).join("")}</table>`;
  fs.writeFileSync(path.join(OUT, "index.html"), html);
  const sheet = await browser.newPage({ viewport: { width: 120 + WIDTHS.length * (cell + 8), height: 400 } });
  await sheet.goto("file://" + path.join(OUT, "index.html").replace(/\\/g, "/"));
  await sheet.screenshot({ path: path.join(OUT, "grid.png"), fullPage: true });
  console.log(`\n격자 캡처: ${path.join(OUT, "grid.png")}  (빨간 테두리 = 자동 검사에서 문제)`);
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await browser?.close();
  vite?.kill();
  srv?.stop?.();
  srv?.child?.kill?.();
}
process.exit(failed ? 1 : 0);
