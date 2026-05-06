import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Bot, CheckCircle2, XCircle, Loader2, Pause, Wand2, X } from "lucide-react";
import { useSyncPolling } from "../lib/hooks/useSyncPolling";
import { getFailedRecords, triggerSanitize, triggerScore } from "../lib/api";
import {
  PHASE_META,
  estimatedEtaSeconds,
  formatEta,
  outcomeFromPhases,
  overallProgress,
  sortPhases,
} from "../lib/syncPhases";
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Button } from "../components/ui/Button";
import { ProgressBar } from "../components/ui/ProgressBar";
import { JiraLogo } from "../components/ui/Logos";

const statusToTone = {
  running: "info",
  success: "ok",
  error: "err",
};
const statusToLabel = {
  running: "Syncing",
  success: "Synced",
  error: "Failed",
};

export function SyncRun() {
  const { syncStateId } = useParams();
  const navigate = useNavigate();
  const idNum = Number(syncStateId);
  const { data: state, isLoading, error } = useSyncPolling(idNum);
  const { data: failed } = useQuery({
    queryKey: ["failedRecords", { syncStateId: idNum }],
    queryFn: () => getFailedRecords({ status: "open", syncStateId: idNum, limit: 1 }),
    enabled: !!state,
    refetchInterval: state?.status === "running" ? 3000 : false,
  });
  const sanitizeMutation = useMutation({
    mutationFn: triggerSanitize,
    onSuccess: (s) => navigate(`/integrations/sync/${s.id}`),
  });
  const scoreMutation = useMutation({
    mutationFn: triggerScore,
    onSuccess: (s) => { if (s.accepted && s.sync_state_id) navigate(`/integrations/sync/${s.sync_state_id}`); },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-ink-3">
        <Loader2 size={16} className="animate-spin" /> Loading run…
      </div>
    );
  }
  if (error || !state) {
    return (
      <div className="rounded border border-err/30 bg-err-soft p-4 text-err">
        Could not load sync run {syncStateId}: {error?.message || "not found"}
      </div>
    );
  }

  const phases = sortPhases(state.phases);
  const rawProgress = overallProgress(phases);
  // Jira's approximate count is intentionally imprecise — clamp to 100 on success.
  const progress = rawProgress && state.status === "success"
    ? { ...rawProgress, percent: 100 }
    : rawProgress;
  const eta = state.status === "running"
    ? formatEta(estimatedEtaSeconds(phases, state.started_at))
    : null;
  const outcome = outcomeFromPhases(phases);
  const reviewCount = failed?.open_count ?? 0;
  const isRunning = state.status === "running";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex items-center gap-3">
          <JiraLogo size={36} />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-[24px] font-semibold leading-tight text-ink">
                {statusToLabel[state.status] || state.status} Jira
              </h1>
              <Pill tone={statusToTone[state.status]} live={isRunning}>
                {state.status}
              </Pill>
              {state.triggered_by && state.triggered_by !== "api" && (
                <Pill tone="default">{state.triggered_by}</Pill>
              )}
            </div>
            <p className="mt-1 text-[12.5px] text-ink-3">
              Started{" "}
              {formatDistanceToNow(new Date(state.started_at), { addSuffix: true })}
              {" · "}
              Run #{state.id}
              {state.triggered_by && (
                <>
                  {" · "}
                  triggered by{" "}
                  <span className="font-medium text-ink-2">{state.triggered_by}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" disabled title="Coming soon">
            <Pause size={14} /> Pause
          </Button>
          <Button variant="danger" disabled title="Coming soon">
            <X size={14} /> Cancel run
          </Button>
        </div>
      </header>

      {state.status === "error" && state.error_message && (
        <div className="flex items-start gap-2 rounded border border-err/30 bg-err-soft p-3 text-[13px] text-err">
          <XCircle size={16} className="mt-0.5" />
          <span>{state.error_message}</span>
        </div>
      )}

      <div className="grid grid-cols-[1.5fr_1fr] gap-4">
        {/* Overall progress */}
        <Card>
          <CardHeader>
            <CardTitle>Overall progress</CardTitle>
            <span className="font-mono text-[13px] text-ink-3">
              {progress
                ? `${progress.processed.toLocaleString()} / ~${progress.total.toLocaleString()} items`
                : "starting…"}
            </span>
          </CardHeader>
          <CardBody pad="lg">
            <ProgressBar
              value={progress?.percent ?? 0}
              tone={state.status === "error" ? "err" : "accent"}
              shimmer={isRunning}
              height={10}
            />
            <div className="mt-3 flex items-center justify-between text-[12.5px] text-ink-3">
              <span>
                {progress ? `${progress.percent}% complete` : "0% complete"}
              </span>
              <span>
                {isRunning
                  ? `ETA ${eta}`
                  : state.finished_at
                    ? `Finished ${formatDistanceToNow(new Date(state.finished_at), { addSuffix: true })}`
                    : ""}
              </span>
            </div>
          </CardBody>
        </Card>

        {/* Outcome quad */}
        <Card>
          <CardHeader>
            <CardTitle>Outcome so far</CardTitle>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-3">
              <OutcomeTile
                label="Created"
                value={outcome.created}
                tone="ok"
                sub="new in Lumber"
              />
              <OutcomeTile
                label="Updated"
                value={outcome.updated}
                tone="info"
                sub="changed records"
              />
              <OutcomeTile
                label="Unchanged"
                value={outcome.unchanged}
                sub="already in sync"
              />
              <OutcomeTile
                label="Review"
                value={reviewCount}
                tone={reviewCount > 0 ? "warn" : "default"}
                sub="needs attention"
              />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Next step banner — shown when this step completes successfully */}
      {state.status === "success" && state.triggered_by === "api-promote" && (
        <div className="flex items-center justify-between rounded-lg border border-info/30 bg-info/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <Wand2 size={15} className="text-info" />
            <span>Promote complete — run <strong>Sanitize</strong> to extract plan text and prepare issues for AI scoring.</span>
          </div>
          <Button
            variant="accent"
            size="sm"
            onClick={() => sanitizeMutation.mutate()}
            disabled={sanitizeMutation.isPending}
          >
            {sanitizeMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Run sanitize
            <ArrowRight size={13} />
          </Button>
        </div>
      )}
      {state.status === "success" && state.triggered_by === "api-sanitize" && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] text-ink-2">
            <Bot size={15} className="text-accent" />
            <span>Sanitize complete — run <strong>Score</strong> to apply AI story point and complexity scoring.</span>
          </div>
          <Button
            variant="accent"
            size="sm"
            onClick={() => scoreMutation.mutate({})}
            disabled={scoreMutation.isPending}
          >
            {scoreMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <Bot size={13} />}
            Run score
            <ArrowRight size={13} />
          </Button>
        </div>
      )}

      {/* Per-phase progress */}
      <Card>
        <CardHeader>
          <CardTitle>Phase progress</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            {phases.filter((p) => p.status === "success").length} of{" "}
            {phases.length} complete
          </span>
        </CardHeader>
        <CardBody>
          {phases.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-ink-3">
              <Loader2 size={14} className="animate-spin" />
              Waiting for the first phase to start…
            </div>
          ) : (
            <ul className="flex flex-col gap-3.5">
              {phases.map((p) => (
                <PhaseRow key={p.id} phase={p} />
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function OutcomeTile({ label, value, sub, tone = "default" }) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "info"
        ? "text-info"
        : tone === "warn"
          ? "text-warn"
          : tone === "err"
            ? "text-err"
            : "text-ink";
  return (
    <div className="rounded border border-border bg-bg-sunken p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {label}
      </p>
      <p className={`mt-1 text-[22px] font-semibold leading-none ${toneClass}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] text-ink-3">{sub}</p>
    </div>
  );
}

function PhaseRow({ phase }) {
  const meta = PHASE_META[phase.phase] || { label: phase.phase };
  const pct =
    typeof phase.items_total === "number" && phase.items_total > 0
      ? Math.min(100, Math.round((phase.items_processed / phase.items_total) * 100))
      : phase.status === "success"
        ? 100
        : 0;
  const tone =
    phase.status === "error"
      ? "err"
      : phase.status === "success"
        ? "ok"
        : "accent";
  return (
    <li>
      <div className="flex items-center justify-between text-[13px]">
        <div className="flex items-center gap-2">
          <span
            className={`h-2 w-2 rounded-full ${
              phase.status === "running"
                ? "bg-accent animate-pulse"
                : phase.status === "success"
                  ? "bg-ok"
                  : phase.status === "error"
                    ? "bg-err"
                    : "bg-ink-5"
            }`}
          />
          <span className="font-medium text-ink-2">{meta.label}</span>
          {phase.metrics?.items != null && (
            <span className="text-[12px] text-ink-3">
              · {phase.metrics.items.toLocaleString()} items
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[12px] text-ink-3">
          <span>
            {(phase.items_processed ?? 0).toLocaleString()}
            {phase.items_total != null && (
              <> / {phase.items_total.toLocaleString()}</>
            )}
          </span>
          {phase.status === "success" && (
            <CheckCircle2 size={14} className="text-ok" />
          )}
          {phase.status === "error" && (
            <XCircle size={14} className="text-err" />
          )}
        </div>
      </div>
      <ProgressBar
        value={pct}
        tone={tone}
        shimmer={phase.status === "running"}
        className="mt-1.5"
      />
      {phase.error_message && (
        <p className="mt-1 text-[12px] text-err">{phase.error_message}</p>
      )}
    </li>
  );
}
