import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

const colName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : String.fromCharCode(64 + Math.floor(i / 26)) + String.fromCharCode(65 + (i % 26)));
const isNum = (v: string) => v !== "" && !isNaN(Number(v.replace(/,/g, "")));

// P4 첨부 데이터 뷰어. 스프레드시트 프로그램처럼 보여 준다: CSV 는 시트(정렬·찾기), 그 외는 문서.
// 열람·정렬·검색 사용을 서버에 기록. 다운로드·편집 없음
export function DataViewer(props: { runId: string; files: string[]; initial: string | null }) {
  const [file, setFile] = useState(props.initial ?? props.files[0]);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [query, setQuery] = useState("");
  const [flagged, setFlagged] = useState<{ sort: boolean; search: boolean }>({ sort: false, search: false });
  const [sel, setSel] = useState<{ r: number; c: number } | null>(null);

  useEffect(() => {
    if (props.initial) setFile(props.initial);
  }, [props.initial]);

  useEffect(() => {
    setLoading(true);
    setSortCol(null);
    setQuery("");
    setSel(null);
    setFlagged({ sort: false, search: false });
    api
      .getData(props.runId, file)
      .then((r) => setText(r.text))
      .finally(() => setLoading(false));
  }, [props.runId, file]);

  // 첫 정렬·검색 때만 기록용 재요청 (평가 B축 "능동 탐색")
  const markSort = () => {
    if (!flagged.sort) {
      setFlagged((f) => ({ ...f, sort: true }));
      void api.getData(props.runId, file, { sort: true });
    }
  };
  const markSearch = () => {
    if (!flagged.search) {
      setFlagged((f) => ({ ...f, search: true }));
      void api.getData(props.runId, file, { search: true });
    }
  };

  const isCsv = file.endsWith(".csv");
  const rows = useMemo(() => (isCsv ? parseCsv(text) : []), [text, isCsv]);
  const header = rows[0] ?? [];
  const body = useMemo(() => {
    let b = rows.slice(1);
    if (query) {
      const q = query.toLowerCase();
      b = b.filter((r) => r.some((c) => c.toLowerCase().includes(q)));
    }
    if (sortCol !== null) {
      const num = b.every((r) => r[sortCol] === "" || isNum(r[sortCol]));
      b = [...b].sort((x, y) => {
        const a = x[sortCol] ?? "";
        const c = y[sortCol] ?? "";
        const cmp = num ? Number(a.replace(/,/g, "")) - Number(c.replace(/,/g, "")) : a.localeCompare(c, "ko");
        return sortDesc ? -cmp : cmp;
      });
    }
    return b;
  }, [rows, query, sortCol, sortDesc]);

  const short = (f: string) => f.replace(/^(data|_shared)\//, "");
  // 선택 칸: r=0 은 제목 행, r>=1 은 화면에 보이는 본문 행
  const selValue = sel ? (sel.r === 0 ? header[sel.c] : body[sel.r - 1]?.[sel.c]) ?? "" : "";
  const sortBy = (i: number) => {
    markSort();
    if (sortCol === i) setSortDesc(!sortDesc);
    else {
      setSortCol(i);
      setSortDesc(false);
    }
  };

  return (
    <div className="panel-body app xl">
      <div className="xl-title">
        <span className="xl-logo">X</span>
        <span className="xl-fname">{short(file)}</span>
        <span className="xl-ro">읽기 전용</span>
      </div>

      {loading ? (
        <p className="xl-empty">여는 중...</p>
      ) : isCsv ? (
        <>
          <div className="xl-bar">
            <span className="xl-namebox">{sel ? `${colName(sel.c)}${sel.r + 1}` : ""}</span>
            <span className="xl-fx">fx</span>
            <span className="xl-formula">{selValue}</span>
            <input
              className="xl-find"
              placeholder="찾기"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSel(null);
                if (e.target.value) markSearch();
              }}
            />
          </div>
          <div className="xl-grid">
            <table>
              <thead>
                <tr className="xl-cols">
                  <th className="xl-corner" />
                  {header.map((_, i) => (
                    <th key={i} className={sel?.c === i ? "hot" : ""}>
                      {colName(i)}
                    </th>
                  ))}
                </tr>
                <tr className="xl-head">
                  <th className={`xl-rownum ${sel?.r === 0 ? "hot" : ""}`}>1</th>
                  {header.map((h, i) => (
                    <th key={i} className={sel?.r === 0 && sel.c === i ? "sel" : ""} onClick={() => setSel({ r: 0, c: i })}>
                      <span>{h}</span>
                      <button
                        className={`xl-filter ${sortCol === i ? "on" : ""}`}
                        title="정렬"
                        onClick={(e) => {
                          e.stopPropagation();
                          sortBy(i);
                        }}
                      >
                        {sortCol === i ? (sortDesc ? "▼" : "▲") : "▾"}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, i) => (
                  <tr key={i}>
                    <th className={`xl-rownum ${sel?.r === i + 1 ? "hot" : ""}`}>{i + 2}</th>
                    {r.map((c, j) => (
                      <td
                        key={j}
                        className={`${isNum(c) ? "n" : ""} ${sel?.r === i + 1 && sel.c === j ? "sel" : ""}`}
                        onClick={() => setSel({ r: i + 1, c: j })}
                      >
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="xl-docwrap">
          <pre className="xl-doc">{text}</pre>
        </div>
      )}

      <div className="xl-sheets">
        {props.files.map((f) => (
          <button key={f} className={`xl-sheet ${f === file ? "active" : ""}`} onClick={() => setFile(f)}>
            {short(f)}
          </button>
        ))}
      </div>
      <div className="xl-status">
        {isCsv && !loading ? (
          <>
            <span>
              {query ? `${rows.length - 1}개 중 ${body.length}개 행` : `${body.length}개 행`}
              {sortCol !== null ? ` · ${header[sortCol]} ${sortDesc ? "내림차순" : "오름차순"}` : ""}
            </span>
            <span>열 제목의 ▾ 로 정렬</span>
          </>
        ) : (
          <span>문서</span>
        )}
      </div>
    </div>
  );
}

// 따옴표 없는 단순 CSV (시나리오 생성기 출력 형식)
function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split(/\r?\n/)
    .filter((l) => l.length > 0)
    .map((l) => l.split(","));
}
