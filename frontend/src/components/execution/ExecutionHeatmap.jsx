import { useMemo } from "react";

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtWeekday(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// Map pass rate (0–100) to a tone class. Empty = no run.
function cellTone(cell) {
  if (!cell || cell.runs === 0) return "bg-bg-sunken border-border";
  if (cell.build_failed) return "bg-err/30 border-err";
  const p = cell.pass_rate;
  if (p == null) return "bg-bg-sunken border-border";
  if (p >= 95) return "bg-ok/35 border-ok/60";
  if (p >= 85) return "bg-ok/20 border-ok/40";
  if (p >= 70) return "bg-warn/30 border-warn/50";
  if (p >= 50) return "bg-warn/45 border-warn/70";
  return "bg-err/35 border-err/60";
}

function buildDateList(window) {
  if (!window) return [];
  const out = [];
  const start = new Date(window.date_from + "T00:00:00");
  for (let i = 0; i < window.days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

function cellsByDate(row) {
  const map = {};
  for (const c of row.cells) map[c.date] = c;
  return map;
}

export function ExecutionHeatmap({ data, loading }) {
  const dates = useMemo(() => buildDateList(data?.window), [data]);
  if (loading) {
    return <div className="text-[13px] text-ink-3">Loading heatmap…</div>;
  }
  if (!data || data.rows.length === 0) {
    return <div className="text-[13px] text-ink-3">No runs in this window.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-[12px]">
        <thead>
          <tr>
            <th className="sticky left-0 z-10 bg-bg-elev px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">
              Suite
            </th>
            {dates.map((d) => (
              <th
                key={d}
                className="px-1 py-1 text-center text-[11px] font-medium text-ink-3"
              >
                <div className="text-[10px] text-ink-4">{fmtWeekday(d)}</div>
                <div>{fmtDay(d)}</div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((row) => {
            const byDate = cellsByDate(row);
            return (
              <tr key={row.row_key}>
                <td className="sticky left-0 z-10 bg-bg-elev whitespace-nowrap px-3 py-1.5 text-[12.5px] font-medium text-ink">
                  {row.row_label}
                </td>
                {dates.map((d) => {
                  const c = byDate[d];
                  return (
                    <td key={d} className="px-1 py-1 align-middle">
                      <div
                        title={
                          c
                            ? `${row.row_label} · ${d}\nruns: ${c.runs}\npass rate: ${
                                c.pass_rate == null ? "—" : c.pass_rate + "%"
                              }\npassed: ${c.passed}  failed: ${c.failed}  errors: ${c.errors}  skipped: ${c.skipped}${
                                c.build_failed ? "\n⚠ build/import failure" : ""
                              }`
                            : `${row.row_label} · ${d}\nno run`
                        }
                        className={`mx-auto flex h-7 w-7 items-center justify-center rounded border ${cellTone(
                          c,
                        )}`}
                      >
                        {c && c.runs > 0 ? (
                          c.build_failed ? (
                            <span className="text-[12px] font-bold text-err">✗</span>
                          ) : c.runs > 1 ? (
                            <span className="text-[10px] font-semibold text-ink-2">{c.runs}</span>
                          ) : null
                        ) : (
                          <span className="text-[12px] text-ink-4">·</span>
                        )}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-ok/60 bg-ok/35" /> ≥95%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-warn/50 bg-warn/30" /> 70–94%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-err/60 bg-err/35" /> &lt;70%
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-err bg-err/30 text-[8px] text-err">
            ✗
          </span>
          build failed
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded border border-border bg-bg-sunken" /> no run
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="font-semibold text-ink-2">N</span> = multiple runs that day
        </span>
      </div>
    </div>
  );
}
