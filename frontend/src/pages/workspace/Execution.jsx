import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  getExecutionSummary,
  getExecutionHeatmap,
  getExecutionTrends,
} from "../../lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardSubtitle } from "../../components/ui/Card";
import { KpiHero, computeDelta } from "../../components/ui/KpiHero";
import { ExecutionFilterBar } from "../../components/execution/ExecutionFilterBar";
import { ExecutionHeatmap } from "../../components/execution/ExecutionHeatmap";
import { ExecutionTrendChart } from "../../components/execution/ExecutionTrendChart";
import { TestsOfInterestPanel } from "../../components/execution/TestsOfInterestPanel";

const VALID_KINDS = ["all", "playwright", "surefire"];
const VALID_DAYS = [7, 10, 14, 30];

function readFilters(searchParams) {
  const kindRaw = searchParams.get("kind") || "all";
  const kind = VALID_KINDS.includes(kindRaw) ? kindRaw : "all";
  const daysRaw = Number(searchParams.get("days") || 10);
  const days = VALID_DAYS.includes(daysRaw) ? daysRaw : 10;
  return { kind, days };
}

function fmtPct(v) {
  if (v == null) return "—";
  return v.toFixed(1) + "%";
}

export function Execution() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const { kind, days } = filters;

  const onChangeFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    setSearchParams(next, { replace: true });
  };

  const summaryQ = useQuery({
    queryKey: ["test-execution", "summary", days, kind],
    queryFn: () => getExecutionSummary({ days, kind }),
    staleTime: 60_000,
  });
  const heatmapQ = useQuery({
    queryKey: ["test-execution", "heatmap", days, kind],
    queryFn: () => getExecutionHeatmap({ days, kind }),
    staleTime: 60_000,
  });
  const trendsQ = useQuery({
    queryKey: ["test-execution", "trends", kind],
    queryFn: () => getExecutionTrends({ days: 30, kind }),
    staleTime: 60_000,
  });

  const summary = summaryQ.data;

  const passDelta =
    summary && summary.pass_rate != null && summary.pass_rate_prev != null
      ? computeDelta({
          curr: summary.pass_rate,
          prev: summary.pass_rate_prev,
          higherIsBetter: true,
          fmtPrev: fmtPct(summary.pass_rate_prev),
          fmtDiff: (abs) => abs.toFixed(1) + "pp",
          prevSub: `prev ${days}d`,
        })
      : null;

  const windowLabel = summary?.window
    ? `${summary.window.date_from} → ${summary.window.date_to}`
    : "";

  return (
    <div className="flex flex-col gap-5">
      <ExecutionFilterBar kind={kind} days={days} onChange={onChangeFilter} />

      {summaryQ.error ? (
        <Card>
          <CardBody>
            <div className="text-err">Error loading summary: {summaryQ.error.message}</div>
          </CardBody>
        </Card>
      ) : null}

      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <KpiHero
          label="Runs in window"
          value={summary ? summary.runs.toLocaleString() : "—"}
          sub={windowLabel}
          tone="info"
        />
        <KpiHero
          label="Pass rate"
          value={summary ? fmtPct(summary.pass_rate) : "—"}
          sub={
            summary?.pass_rate_prev != null
              ? `prev ${fmtPct(summary.pass_rate_prev)}`
              : "no prior data"
          }
          tone={
            summary?.pass_rate == null
              ? "default"
              : summary.pass_rate >= 95
                ? "ok"
                : summary.pass_rate >= 80
                  ? "warn"
                  : "err"
          }
          delta={passDelta}
        />
        <KpiHero
          label="Failing tests"
          value={summary ? summary.failing_tests.toLocaleString() : "—"}
          sub="latest day = fail/error"
          tone={summary && summary.failing_tests > 0 ? "err" : "ok"}
        />
        <KpiHero
          label="Flaky tests"
          value={summary ? summary.flaky_tests.toLocaleString() : "—"}
          sub="pass + fail in window"
          tone={summary && summary.flaky_tests > 0 ? "warn" : "ok"}
        />
        <KpiHero
          label="Failing > 7 days"
          value={summary ? summary.failing_streak.toLocaleString() : "—"}
          sub="7-day fail streak"
          tone={summary && summary.failing_streak > 0 ? "err" : "ok"}
        />
        <KpiHero
          label="Stale tests"
          value={summary ? summary.stale_tests.toLocaleString() : "—"}
          sub="seen before, absent now"
          tone={summary && summary.stale_tests > 0 ? "warn" : "ok"}
        />
      </div>

      {/* Heatmap */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Daily health</CardTitle>
            <CardSubtitle>
              One row per suite. Cell = pass rate of all runs that day.
            </CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <ExecutionHeatmap data={heatmapQ.data} loading={heatmapQ.isLoading} />
        </CardBody>
      </Card>

      {/* Trend */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Pass-rate trend (30 days)</CardTitle>
            <CardSubtitle>
              One line per {kind === "playwright" ? "Playwright suite" : "kind"}.
            </CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <ExecutionTrendChart data={trendsQ.data} loading={trendsQ.isLoading} />
        </CardBody>
      </Card>

      {/* Tests of interest */}
      <Card>
        <CardHeader>
          <div>
            <CardTitle>Tests of interest</CardTitle>
            <CardSubtitle>
              Failing, flaky, long-running failures, and stale tests.
            </CardSubtitle>
          </div>
        </CardHeader>
        <CardBody>
          <TestsOfInterestPanel days={days} kind={kind} summary={summary} />
        </CardBody>
      </Card>
    </div>
  );
}
