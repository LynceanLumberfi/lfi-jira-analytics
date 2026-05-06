import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, formatDistanceStrict } from "date-fns";
import { Link } from "react-router-dom";
import { CheckCircle2, XCircle, Loader2, Clock } from "lucide-react";
import { getSyncHistory } from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { PHASE_META, sortPhases } from "../lib/syncPhases";

const statusToTone = { success: "ok", running: "info", error: "err" };

function durationLabel(started, finished) {
  if (!started) return "—";
  const end = finished ? new Date(finished) : new Date();
  return formatDistanceStrict(end, new Date(started));
}

const KIND_LABELS = {
  "api":          "Sync",
  "api-promote":  "Promote",
  "api-sanitize": "Sanitize",
  "api-score":    "Score",
  "api-resume":   "Resumed",
};

function kindLabel(triggered_by) {
  return KIND_LABELS[triggered_by] ?? triggered_by ?? "—";
}

export function SyncHistory() {
  const [selectedId, setSelectedId] = useState(null);
  const { data: history, isLoading } = useQuery({
    queryKey: ["syncHistory", "all", 50],
    queryFn: () => getSyncHistory({ kind: null, limit: 50 }),
    refetchInterval: 10_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-ink">
          Sync history
        </h1>
        <p className="mt-1 text-[13px] text-ink-3">
          The 50 most recent runs across sync, promote, sanitize, and score.
        </p>
      </header>

      <div className="grid grid-cols-[1.5fr_1fr] gap-6">
        <Card>
          <Table className="rounded-none border-0">
            <THead>
              <TR>
                <TH>Run</TH>
                <TH>Kind</TH>
                <TH>Started</TH>
                <TH>Duration</TH>
                <TH className="text-right">Records</TH>
                <TH>Status</TH>
              </TR>
            </THead>
            <TBody>
              {isLoading && (
                <TR>
                  <TD colSpan={6}>
                    <div className="flex items-center gap-2 text-ink-3">
                      <Loader2 size={14} className="animate-spin" /> Loading…
                    </div>
                  </TD>
                </TR>
              )}
              {!isLoading && (history?.length ?? 0) === 0 && (
                <TR>
                  <TD colSpan={6} className="text-center text-ink-3">
                    No runs yet — trigger one from the Integrations page.
                  </TD>
                </TR>
              )}
              {history?.map((run, i) => {
                const isActive = selectedId === run.id;
                const prevRun = history[i - 1];
                const isGrouped =
                  run.sync_group_id != null &&
                  prevRun?.sync_group_id === run.sync_group_id;
                return (
                  <TR
                    key={run.id}
                    onClick={() => setSelectedId(run.id)}
                    className={`cursor-pointer ${isActive ? "bg-accent-soft" : ""}`}
                  >
                    <TD>
                      <div className={isGrouped ? "pl-4 border-l-2 border-border" : ""}>
                        <Link
                          to={`/integrations/sync/group/${run.sync_group_id ?? run.id}`}
                          className="font-mono text-[12px] font-semibold text-ink hover:text-accent"
                          onClick={(e) => e.stopPropagation()}
                        >
                          #{run.sync_group_id ?? run.id}
                        </Link>
                      </div>
                    </TD>
                    <TD>
                      <span className="text-[12px] text-ink-3">
                        {kindLabel(run.triggered_by)}
                      </span>
                    </TD>
                    <TD className="text-[12.5px]">
                      {format(new Date(run.started_at), "MMM d, HH:mm")}
                    </TD>
                    <TD className="font-mono text-[12px]">
                      {durationLabel(run.started_at, run.finished_at)}
                    </TD>
                    <TD className="text-right font-mono text-[12px]">
                      {run.issues_synced ?? "—"}
                    </TD>
                    <TD>
                      <Pill tone={statusToTone[run.status] || "default"} live={run.status === "running"}>
                        {run.status}
                      </Pill>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>

        <RunDetail id={selectedId} history={history} />
      </div>
    </div>
  );
}

function stepDotClass(status) {
  if (status === "success") return "bg-ok";
  if (status === "error")   return "bg-err";
  if (status === "running") return "bg-accent animate-pulse";
  return "bg-ink-5";
}

function StepIcon({ status, size = 14 }) {
  if (status === "success") return <CheckCircle2 size={size} className="text-ok" />;
  if (status === "error")   return <XCircle size={size} className="text-err" />;
  if (status === "running") return <Loader2 size={size} className="text-accent animate-spin" />;
  return <Clock size={size} className="text-ink-4" />;
}

function PhaseList({ phases }) {
  const sorted = sortPhases(phases);
  if (sorted.length === 0) return null;
  return (
    <ol className="mt-2 flex flex-col gap-2 pl-4 border-l border-border">
      {sorted.map((p) => (
        <li key={p.id} className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${stepDotClass(p.status)}`} />
              <span className="text-[12.5px] font-medium text-ink-2">
                {PHASE_META[p.phase]?.label || p.phase}
              </span>
            </div>
            <span className="font-mono text-[11px] text-ink-4 shrink-0">
              {format(new Date(p.started_at), "HH:mm:ss")}
              {p.finished_at && (
                <> · {durationLabel(p.started_at, p.finished_at)}</>
              )}
            </span>
          </div>
          {p.items_processed != null && p.items_total != null && (
            <p className="ml-3 font-mono text-[11px] text-ink-4">
              {p.items_processed.toLocaleString()} / {p.items_total.toLocaleString()} items
            </p>
          )}
          {p.metrics && Object.keys(p.metrics).length > 0 && (
            <p className="ml-3 font-mono text-[11px] text-ink-4">
              {Object.entries(p.metrics).map(([k, v]) => `${k}=${v}`).join("  ")}
            </p>
          )}
          {p.error_message && (
            <p className="ml-3 text-[11.5px] text-err">{p.error_message}</p>
          )}
        </li>
      ))}
    </ol>
  );
}

function RunDetail({ id, history }) {
  if (id == null) {
    return (
      <Card>
        <CardBody>
          <p className="text-[12.5px] text-ink-3">
            Select a run to see its step timeline.
          </p>
        </CardBody>
      </Card>
    );
  }

  const clicked = history?.find((r) => r.id === id);
  if (!clicked) {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-2 text-[13px] text-ink-3">
            <Loader2 size={14} className="animate-spin" /> Loading…
          </div>
        </CardBody>
      </Card>
    );
  }

  const groupId = clicked.sync_group_id;

  // All steps in this group, sorted by started_at ascending
  const steps = (history || [])
    .filter((r) =>
      groupId != null ? r.sync_group_id === groupId : r.id === id
    )
    .sort((a, b) => new Date(a.started_at) - new Date(b.started_at));

  const groupStarted = steps[0]?.started_at;
  const groupFinished = steps.every((s) => s.finished_at)
    ? steps.at(-1)?.finished_at
    : null;
  const overallStatus = steps.some((s) => s.status === "error")
    ? "error"
    : steps.some((s) => s.status === "running")
      ? "running"
      : "success";

  return (
    <Card className="self-start">
      <CardHeader>
        <CardTitle>Sync #{groupId ?? id}</CardTitle>
        <Pill tone={statusToTone[overallStatus] || "default"} live={overallStatus === "running"}>
          {overallStatus}
        </Pill>
      </CardHeader>
      <CardBody>
        <div className="mb-4 flex items-center gap-4 text-[12px] text-ink-3">
          {groupStarted && (
            <span>
              Started{" "}
              <span className="font-mono text-ink-2">
                {format(new Date(groupStarted), "MMM d, HH:mm:ss")}
              </span>
            </span>
          )}
          {groupStarted && (
            <span>
              Total{" "}
              <span className="font-mono text-ink-2">
                {durationLabel(groupStarted, groupFinished)}
              </span>
            </span>
          )}
        </div>

        <ol className="flex flex-col gap-4">
          {steps.map((step) => (
            <li key={step.id}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <StepIcon status={step.status} />
                  <span className="text-[13px] font-semibold text-ink">
                    {kindLabel(step.triggered_by)}
                  </span>
                  <Pill tone={statusToTone[step.status] || "default"} live={step.status === "running"}>
                    {step.status}
                  </Pill>
                </div>
                <span className="font-mono text-[11.5px] text-ink-3 shrink-0">
                  {format(new Date(step.started_at), "HH:mm:ss")}
                  {" · "}
                  {durationLabel(step.started_at, step.finished_at)}
                </span>
              </div>
              {step.issues_synced > 0 && (
                <p className="ml-6 mt-0.5 text-[11.5px] text-ink-3">
                  {step.issues_synced.toLocaleString()} records
                </p>
              )}
              {step.error_message && (
                <p className="ml-6 mt-1 rounded border border-err/30 bg-err-soft p-2 text-[12px] text-err">
                  {step.error_message}
                </p>
              )}
              <PhaseList phases={step.phases || []} />
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
