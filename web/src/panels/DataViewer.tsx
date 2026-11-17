import { useEffect, useMemo, useState } from "react";
import { api } from "../api";

// P4 첨부 데이터 뷰어: CSV 는 표(정렬·검색), 그 외는 원문. 열람·정렬·검색 사용을 서버에 기록. 다운로드 없음
export function DataViewer(props: { runId: string; files: string[]; initial: string | null }) {
  const [file, setFile] = useState(props.initial ?? props.files[0]);
  const [text, setText] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDesc, setSortDesc] = useState(false);
  const [query, setQuery] = useState("");
  const [flagged, setFlagged] = useState<{ sort: boolean; search: boolean }>({ sort: false, search: false });

  useEffect(() => {
    if (props.initial) setFile(props.initial);
  }, [props.initial]);

  useEffect(() => {
    setLoading(true);
    setSortCol(null);
    setQuery("");
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
      const num = b.every((r) => r[sortCol] === "" || !isNaN(Number(r[sortCol].replace(/,/g, ""))));
      b = [...b].sort((x, y) => {
        const a = x[sortCol] ?? "";
        const c = y[sortCol] ?? "";
        const cmp = num ? Number(a.replace(/,/g, "")) - Number(c.replace(/,/g, "")) : a.localeCompare(c, "ko");
        return sortDesc ? -cmp : cmp;
      });
    }
    return b;
  }, [rows, query, sortCol, sortDesc]);

  return (
    <div className="panel-body data">
      <div className="tabs">
        {props.files.map((f) => (
          <button key={f} className={`tab ${f === file ? "active" : ""}`} onClick={() => setFile(f)}>
            {f.replace(/^(data|_shared)\//, "")}
          </button>
        ))}
      </div>
      {loading ? (
        <p className="muted">여는 중...</p>
      ) : isCsv ? (
        <>
          <div className="row">
            <input
              placeholder="검색"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                if (e.target.value) markSearch();
              }}
            />
            <span className="tiny muted">
              {body.length} / {rows.length - 1}행 · 열 제목 클릭 = 정렬
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  {header.map((h, i) => (
                    <th
                      key={i}
                      onClick={() => {
                        markSort();
                        if (sortCol === i) setSortDesc(!sortDesc);
                        else {
                          setSortCol(i);
                          setSortDesc(false);
                        }
                      }}
                    >
                      {h} {sortCol === i ? (sortDesc ? "▼" : "▲") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {body.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <pre className="doc">{text}</pre>
      )}
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
