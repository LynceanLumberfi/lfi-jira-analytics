import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getExecutionFailing,
  getExecutionFlaky,
  getExecutionFailingStreak,
  getExecutionStale,
} from "../../lib/api";
import { cn } from "../../lib/cn";

const TABS = [
  { key: "failing", label: "Failing", desc: "Latest result is failed/error" },
  { key: "flaky", label: "Flaky", desc: "Both pass and fail attempts in window" },
  { key: "streak", label: "Failing >7d", desc: "Consecutive fail streak ≥ 7 days" },
  { key: "stale", label: "Stale", desc: "Seen before window, absent in window" },
];

function StatusBadge({ status }) {
  const tone =
    status === "passed"
      ? "bg-ok/15 text-ok"
      : status === "skipped"
        ? "bg-warn/20 text-warn"
        : status === "error"
          ? "bg-err/20 text-err"
          : "bg-err/15 text-err";
  return (
    <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide", tone)}>
      {status}
    </span>
  );
}

function fmt(value, fallback = "—") {
  if (value == null || value === "") return fallback;
  return value;
}

function pctBar({ passed, total, fail }) {
  if (!total) return null;
  const passWidth = (passed / total) * 100;
  const failWidth = (fail / total) * 100;
  return (
    <div className="flex h-1.5 w-24 overflow-hidden rounded-full bg-bg-sunken">
      <div className="h-full bg-ok" style={{ width: `${passWidth}%` }} />
      <div className="h-full bg-err" style={{ width: `${failWidth}%` }} />
    </div>
  );
}

function TestRow({ row, columns }) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-bg-sunken/40">
      {columns.map((c) => (
        <td key={c.key} className={cn("px-3 py-2 align-top text-[12.5px]", c.cellClass)}>
          {c.render(row)}
        </td>
      ))}
    </tr>
  );
}

function Table({ rows, columns, emptyText }) {
  if (!rows || rows.length === 0) {
    return (
      <div className="rounded border border-dashed border-border bg-bg-sunken/40 px-4 py-8 text-center text-[12.5px] text-ink-3">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-left">
        <thead>
          <tr className="border-b border-border bg-bg-sunken/40 text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-3">
            {columns.map((c) => (
              <th key={c.key} className={cn("px-3 py-2", c.headerClass)}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <TestRow key={row.test_uid} row={row} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

const COMMON_TEST_COL = {
  key: "test",
  label: "Test",
  render: (r) => (
    <div className="flex flex-col">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-bold uppercase",
            r.kind === "playwright" ? "bg-info/15 text-info" : "bg-accent/15 text-accent",
          )}
        >
          {r.kind === "playwright" ? "PW" : "JUnit"}
        </span>
        <span className="font-medium text-ink">{r.test_name}</span>
      </div>
      <span className="mt-0.5 truncate text-[11px] text-ink-3" title={r.class_or_file || ""}>
        {fmt(r.class_or_file)}
        {r.package_or_suite ? ` · ${r.package_or_suite}` : ""}
      </span>
    </div>
  ),
};

const FAILING_COLUMNS = [
  COMMON_TEST_COL,
  {
    key: "status",
    label: "Last",
    headerClass: "w-[80px]",
    render: (r) => <StatusBadge status={r.last_status} />,
  },
  {
    key: "streak",
    label: "Streak",
    headerClass: "w-[80px]",
    render: (r) => (
      <span className={cn("font-semibold", r.fail_streak_days >= 7 ? "text-err" : "text-ink-2")}>
        {r.fail_streak_days}d
      </span>
    ),
  },
  {
    key: "since",
    label: "Last passed",
    headerClass: "w-[120px]",
    render: (r) => (
      <span className="text-ink-3">
        {r.last_passed ? r.last_passed : <span className="text-err">never (window)</span>}
      </span>
    ),
  },
  {
    key: "attempts",
    label: "Attempts",
    headerClass: "w-[160px]",
    render: (r) => (
      <div className="flex items-center gap-2">
        {pctBar({ passed: r.pass_attempts, total: r.total_attempts, fail: r.fail_attempts })}
        <span className="tabular-nums text-ink-3">
          {r.pass_attempts}/{r.total_attempts}
        </span>
      </div>
    ),
  },
  {
    key: "error",
    label: "Error",
    headerClass: "min-w-[200px]",
    render: (r) => (
      <span className="line-clamp-2 text-[11.5px] text-ink-3" title={r.error_message || ""}>
        {fmt(r.error_message, "—")}
      </span>
    ),
  },
];

const FLAKY_COLUMNS = [
  COMMON_TEST_COL,
  {
    key: "flakiness",
    label: "Flakiness",
    headerClass: "w-[100px]",
    render: (r) => (
      <span className="font-semibold text-warn">{(r.flakiness_pct ?? 0).toFixed(1)}%</span>
    ),
  },
  {
    key: "ratio",
    label: "Pass / Fail attempts",
    headerClass: "w-[180px]",
    render: (r) => (
      <div className="flex items-center gap-2">
        {pctBar({ passed: r.pass_attempts, total: r.total_attempts, fail: r.fail_attempts })}
        <span className="tabular-nums text-ink-3">
          {r.pass_attempts} / {r.fail_attempts}
        </span>
      </div>
    ),
  },
  {
    key: "lastStatus",
    label: "Last",
    headerClass: "w-[80px]",
    render: (r) => <StatusBadge status={r.last_status} />,
  },
  {
    key: "lastSeen",
    label: "Last seen",
    headerClass: "w-[100px]",
    render: (r) => <span className="text-ink-3">{r.last_seen}</span>,
  },
];

const STREAK_COLUMNS = [
  COMMON_TEST_COL,
  {
    key: "streak",
    label: "Streak",
    headerClass: "w-[80px]",
    render: (r) => <span className="font-semibold text-err">{r.fail_streak_days}d</span>,
  },
  {
    key: "lastSeen",
    label: "Last seen",
    headerClass: "w-[100px]",
    render: (r) => <span className="text-ink-3">{r.last_seen}</span>,
  },
  {
    key: "since",
    label: "Last passed",
    headerClass: "w-[120px]",
    render: (r) => (
      <span className="text-ink-3">
        {r.last_passed ? r.last_passed : <span className="text-err">never</span>}
      </span>
    ),
  },
  {
    key: "error",
    label: "Error",
    headerClass: "min-w-[240px]",
    render: (r) => (
      <span className="line-clamp-2 text-[11.5px] text-ink-3" title={r.error_message || ""}>
        {fmt(r.error_message, "—")}
      </span>
    ),
  },
];

const STALE_COLUMNS = [
  COMMON_TEST_COL,
  {
    key: "absent",
    label: "Days absent",
    headerClass: "w-[110px]",
    render: (r) => <span className="font-semibold text-warn">{r.days_absent}d</span>,
  },
  {
    key: "lastSeen",
    label: "Last seen",
    headerClass: "w-[110px]",
    render: (r) => <span className="text-ink-3">{r.last_seen}</span>,
  },
  {
    key: "lastStatus",
    label: "Status then",
    headerClass: "w-[100px]",
    render: (r) => <StatusBadge status={r.last_status_seen} />,
  },
];

function useTabQuery(activeTab, { days, kind }) {
  const failing = useQuery({
    queryKey: ["test-execution", "failing", days, kind],
    queryFn: () => getExecutionFailing({ days, kind, limit: 200 }),
    enabled: activeTab === "failing",
    staleTime: 60_000,
  });
  const flaky = useQuery({
    queryKey: ["test-execution", "flaky", days, kind],
    queryFn: () => getExecutionFlaky({ days, kind, limit: 200 }),
    enabled: activeTab === "flaky",
    staleTime: 60_000,
  });
  const streak = useQuery({
    queryKey: ["test-execution", "streak", kind],
    queryFn: () => getExecutionFailingStreak({ days: 30, streak_days: 7, kind, limit: 200 }),
    enabled: activeTab === "streak",
    staleTime: 60_000,
  });
  const stale = useQuery({
    queryKey: ["test-execution", "stale", days, kind],
    queryFn: () => getExecutionStale({ days, history_days: 30, kind, limit: 200 }),
    enabled: activeTab === "stale",
    staleTime: 60_000,
  });
  return { failing, flaky, streak, stale };
}

export function TestsOfInterestPanel({ days, kind, summary }) {
  const [activeTab, setActiveTab] = useState("failing");
  const counts = {
    failing: summary?.failing_tests,
    flaky: summary?.flaky_tests,
    streak: summary?.failing_streak,
    stale: summary?.stale_tests,
  };
  const queries = useTabQuery(activeTab, { days, kind });
  const active = queries[activeTab];

  let columns;
  let emptyText;
  if (activeTab === "failing") {
    columns = FAILING_COLUMNS;
    emptyText = "No failing tests in this window. Nice.";
  } else if (activeTab === "flaky") {
    columns = FLAKY_COLUMNS;
    emptyText = "No flaky tests in this window.";
  } else if (activeTab === "streak") {
    columns = STREAK_COLUMNS;
    emptyText = "No tests have been failing for 7+ consecutive days.";
  } else {
    columns = STALE_COLUMNS;
    emptyText = "No stale tests detected in this window.";
  }

  return (
    <div>
      <div className="flex items-end gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => {
          const isActive = activeTab === t.key;
          const count = counts[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              title={t.desc}
              className={cn(
                "relative -mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium transition-colors",
                isActive
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-3 hover:border-border-strong hover:text-ink-2",
              )}
            >
              {t.label}
              {count != null && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold",
                    isActive ? "bg-accent/15 text-accent" : "bg-bg-sunken text-ink-3",
                  )}
                >
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <div className="pt-4">
        {active.isLoading ? (
          <div className="text-[12.5px] text-ink-3">Loading…</div>
        ) : active.error ? (
          <div className="text-[12.5px] text-err">Error: {active.error.message}</div>
        ) : (
          <Table rows={active.data ?? []} columns={columns} emptyText={emptyText} />
        )}
      </div>
    </div>
  );
}
