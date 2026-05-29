import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getExecutionSummary,
  getExecutionHeatmap,
  getExecutionTrends,
  getSyncState,
  triggerS3Pull,
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
  const module = searchParams.get("module") || null;
  const vendor = searchParams.get("vendor") || null;
  return { kind, days, module, vendor };
}

function fmtPct(v) {
  if (v == null) return "—";
  return v.toFixed(1) + "%";
}

function parseS3PullSummary(errorMessage) {
  if (!errorMessage) return null;
  try {
    const obj = JSON.parse(errorMessage);
    if (typeof obj === "object" && obj && "files_downloaded" in obj) return obj;
  } catch {}
  return null;
}

function useS3Pull() {
  const queryClient = useQueryClient();
  const [pullId, setPullId] = useState(null);

  const mutation = useMutation({
    mutationFn: () => triggerS3Pull(),
    onSuccess: (state) => setPullId(state.id),
  });

  const stateQ = useQuery({
    queryKey: ["s3-pull-state", pullId],
    queryFn: () => getSyncState(pullId),
    enabled: pullId != null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 2000 : false),
  });

  const status = stateQ.data?.status ?? (mutation.isPending ? "running" : null);
  const isRunning = mutation.isPending || status === "running";

  useEffect(() => {
    if (status === "success") {
      queryClient.invalidateQueries({ queryKey: ["test-execution"] });
    }
  }, [status, queryClient]);

  return {
    trigger: () => mutation.mutate(),
    isRunning,
    status,
    summary: status === "success" ? parseS3PullSummary(stateQ.data?.error_message) : null,
    errorMessage:
      status === "error"
        ? stateQ.data?.error_message || "S3 pull failed"
        : mutation.isError
          ? mutation.error?.message || "S3 pull failed to start"
          : null,
    reset: () => {
      setPullId(null);
      mutation.reset();
    },
  };
}

export function Execution() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => readFilters(searchParams), [searchParams]);
  const { kind, days, module, vendor } = filters;
  const s3Pull = useS3Pull();

  const onChangeFilter = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(patch)) {
      if (v == null || v === "") next.delete(k);
      else next.set(k, String(v));
    }
    setSearchParams(next, { replace: true });
  };

  const summaryQ = useQuery({
    queryKey: ["test-execution", "summary", days, kind, module, vendor],
    queryFn: () => getExecutionSummary({ days, kind, module, vendor }),
    staleTime: 60_000,
  });
  const heatmapQ = useQuery({
    queryKey: ["test-execution", "heatmap", days, kind, module, vendor],
    queryFn: () => getExecutionHeatmap({ days, kind, module, vendor }),
    staleTime: 60_000,
  });
  const trendsQ = useQuery({
    queryKey: ["test-execution", "trends", kind, module, vendor],
    queryFn: () => getExecutionTrends({ days: 30, kind, module, vendor }),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[12px] text-ink-3">
          Test reports are pulled from S3 on demand. Already-ingested files are skipped.
        </div>
        <div className="flex items-center gap-3">
          {s3Pull.status === "success" && s3Pull.summary ? (
            <span className="text-[12px] text-ink-3">
              {s3Pull.summary.files_downloaded > 0
                ? `Downloaded ${s3Pull.summary.files_downloaded} new file${s3Pull.summary.files_downloaded === 1 ? "" : "s"}, inserted ${s3Pull.summary.runs_inserted} run${s3Pull.summary.runs_inserted === 1 ? "" : "s"}.`
                : "No new files — already up to date."}
            </span>
          ) : null}
          {s3Pull.errorMessage ? (
            <span className="text-[12px] text-err">{s3Pull.errorMessage}</span>
          ) : null}
          <button
            type="button"
            onClick={s3Pull.trigger}
            disabled={s3Pull.isRunning}
            className="rounded-md border border-accent bg-accent/10 px-3 py-1.5 text-[12.5px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:cursor-wait disabled:opacity-60"
          >
            {s3Pull.isRunning ? "Pulling from S3…" : "Pull from S3"}
          </button>
        </div>
      </div>
      <ExecutionFilterBar
        kind={kind}
        days={days}
        module={module}
        vendor={vendor}
        onChange={onChangeFilter}
      />

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
          <TestsOfInterestPanel
            days={days}
            kind={kind}
            module={module}
            vendor={vendor}
            summary={summary}
          />
        </CardBody>
      </Card>
    </div>
  );
}
