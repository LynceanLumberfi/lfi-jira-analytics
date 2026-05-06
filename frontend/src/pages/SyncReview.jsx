import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import {
  Bot, CheckCircle2, ChevronLeft, ChevronRight, Loader2,
  RefreshCw, Wand2, X,
} from "lucide-react";
import {
  approveAllStaging,
  getLatestSyncState,
  getPipelineStatus,
  getScoringState,
  getStagingIssues,
  promoteStaging,
  reviewStagingIssue,
  skipAllStaging,
  triggerSanitize,
  triggerScore,
  triggerSync,
} from "../lib/api";
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter, ModalHeader } from "../components/ui/Modal";
import { JiraLogo } from "../components/ui/Logos";

const CHANGE_TONE = { new: "ok", updated: "info" };
const CHANGE_LABEL = { new: "New", updated: "Updated" };
const STATUS_TONE = {
  pending: "warn",
  approved: "ok",
  skipped: "default",
  promoted: "info",
  failed: "err",
};

const FILTERS = [
  { key: null, label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "skipped", label: "Skipped" },
];

const PAGE_SIZE = 50;

function toDatetimeLocal(isoString) {
  if (!isoString) return "";
  const d = new Date(isoString);
  d.setDate(d.getDate() - 1);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

export function SyncReview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(0);
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [sinceValue, setSinceValue] = useState("");

  const { data: latestSync } = useQuery({
    queryKey: ["syncState", "latest", "sync"],
    queryFn: () => getLatestSyncState("sync"),
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });
  const { data: latestSanitize } = useQuery({
    queryKey: ["syncState", "latest", "sanitize"],
    queryFn: () => getLatestSyncState("sanitize"),
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });
  const { data: scoringState } = useQuery({
    queryKey: ["scoringState"],
    queryFn: getScoringState,
    refetchInterval: (q) => q.state.data?.is_running ? 2000 : 15_000,
  });
  const { data: pipeline, isLoading: pipelineLoading } = useQuery({
    queryKey: ["pipelineStatus"],
    queryFn: getPipelineStatus,
    refetchInterval: 15_000,
  });
  const { data, isLoading } = useQuery({
    queryKey: ["staging", statusFilter, page],
    queryFn: () => getStagingIssues({ status: statusFilter, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    keepPreviousData: true,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["staging"] });
  }

  const triggerMutation = useMutation({
    mutationFn: (since) => triggerSync(since || undefined),
    onSuccess: (state) => {
      setSyncModalOpen(false);
      qc.invalidateQueries({ queryKey: ["syncState", "latest", "sync"] });
      navigate(`/integrations/sync/${state.id}`);
    },
  });

  const sanitizeMutation = useMutation({
    mutationFn: triggerSanitize,
    onSuccess: (state) => {
      qc.invalidateQueries({ queryKey: ["syncState", "latest", "sanitize"] });
      navigate(`/integrations/sync/${state.id}`);
    },
  });

  const scoreMutation = useMutation({
    mutationFn: triggerScore,
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["scoringState"] });
      if (result.accepted && result.sync_state_id) {
        navigate(`/integrations/sync/${result.sync_state_id}`);
      }
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id) => reviewStagingIssue(id, { review_status: "approved", reviewed_by: "admin" }),
    onSuccess: invalidate,
  });
  const skipMutation = useMutation({
    mutationFn: (id) => reviewStagingIssue(id, { review_status: "skipped", reviewed_by: "admin" }),
    onSuccess: invalidate,
  });
  const approveAllMutation = useMutation({
    mutationFn: approveAllStaging,
    onSuccess: () => { invalidate(); setStatusFilter("approved"); setPage(0); },
  });
  const skipAllMutation = useMutation({
    mutationFn: skipAllStaging,
    onSuccess: invalidate,
  });
  const promoteMutation = useMutation({
    mutationFn: promoteStaging,
    onSuccess: (state) => navigate(`/integrations/sync/${state.id}`),
  });

  function openSyncModal() {
    setSinceValue(toDatetimeLocal(latestSync?.synced_until));
    setSyncModalOpen(true);
  }

  const counts = data
    ? { pending: data.pending, approved: data.approved, skipped: data.skipped, new: data.new, updated: data.updated }
    : null;
  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const canPromote = (counts?.approved ?? 0) > 0;
  const syncRunning = latestSync?.status === "running";
  const sanitizeRunning = latestSanitize?.status === "running";
  const scoreRunning = scoringState?.is_running ?? false;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight text-ink">Sync Review</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Review and advance the Jira sync pipeline.
          </p>
        </div>
        <Button
          variant={syncRunning ? "default" : "accent"}
          onClick={() => syncRunning ? navigate(`/integrations/sync/${latestSync.id}`) : openSyncModal()}
          disabled={triggerMutation.isPending}
        >
          <RefreshCw size={14} />
          {syncRunning ? "View sync" : "Sync now"}
        </Button>
      </header>

      {/* Last sync info */}
      {latestSync && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-bg-elev px-4 py-3">
          <JiraLogo size={24} />
          <span className="text-[13px] font-medium text-ink-2">Last sync</span>
          <Pill
            tone={latestSync.status === "success" ? "ok" : latestSync.status === "error" ? "err" : "info"}
            live={syncRunning}
          >
            {latestSync.status}
          </Pill>
          <span className="text-[12.5px] text-ink-3">
            {latestSync.started_at
              ? formatDistanceToNow(new Date(latestSync.started_at), { addSuffix: true })
              : "—"}
          </span>
          {latestSync.issues_synced != null && (
            <span className="text-[12.5px] text-ink-3">
              · {latestSync.issues_synced.toLocaleString()} issues
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => navigate(`/integrations/sync/${latestSync.id}`)}
          >
            View run
          </Button>
        </div>
      )}

      {/* Pipeline funnel */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Pipeline status
        </h2>
        <Card>
          <CardBody>
            {pipelineLoading ? (
              <div className="flex items-center gap-2 text-[13px] text-ink-3">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            ) : (
              <div className="flex items-center">
                <FunnelStage
                  label="Staged"
                  value={(pipeline?.staging_pending ?? 0) + (pipeline?.staging_approved ?? 0)}
                  sub={(pipeline?.staging_approved ?? 0) > 0 ? `${pipeline.staging_approved} approved` : "pending review"}
                  tone={(pipeline?.staging_pending ?? 0) > 0 ? "warn" : "default"}
                />
                <FunnelArrow />
                <FunnelStage
                  label="In Lumber"
                  value={pipeline?.in_lumber ?? 0}
                  sub="promoted issues"
                  tone={(pipeline?.in_lumber ?? 0) > 0 ? "ok" : "default"}
                />
                <FunnelArrow />
                <FunnelStage
                  label="Unscored"
                  value={pipeline?.score_pending ?? 0}
                  sub="awaiting AI"
                  tone={(pipeline?.score_pending ?? 0) > 0 ? "warn" : "default"}
                />
                <FunnelArrow />
                <FunnelStage
                  label="Scored"
                  value={pipeline?.score_completed ?? 0}
                  sub="AI complete"
                  tone={(pipeline?.score_completed ?? 0) > 0 ? "ok" : "default"}
                />
                <div className="ml-auto flex items-center">
                  <div className="mx-4 h-10 w-px bg-border" />
                  <FunnelStage
                    label="Failed"
                    value={pipeline?.failed_open ?? 0}
                    sub="open records"
                    tone={(pipeline?.failed_open ?? 0) > 0 ? "err" : "default"}
                    href="/integrations/failed"
                  />
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </section>

      {/* Next steps */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Next steps
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {/* Sanitize */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-info/10">
                  <Wand2 size={18} className="text-info" />
                </div>
                <div>
                  <CardTitle>Sanitize</CardTitle>
                  <CardSubtitle>Extract plan text &amp; prep AI scores</CardSubtitle>
                </div>
              </div>
              {latestSanitize && (
                <Pill
                  tone={latestSanitize.status === "success" ? "ok" : latestSanitize.status === "error" ? "err" : "info"}
                  live={sanitizeRunning}
                >
                  {latestSanitize.status}
                </Pill>
              )}
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-2 gap-4">
                <Stat
                  label="Last run"
                  value={latestSanitize?.started_at ? formatDistanceToNow(new Date(latestSanitize.started_at), { addSuffix: true }) : "—"}
                />
                <Stat
                  label="Finished"
                  value={latestSanitize?.finished_at ? formatDistanceToNow(new Date(latestSanitize.finished_at), { addSuffix: true }) : "—"}
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                {latestSanitize?.id && (
                  <Button variant="ghost" onClick={() => navigate(`/integrations/sync/${latestSanitize.id}`)}>
                    View last run
                  </Button>
                )}
                <Button
                  variant={sanitizeRunning ? "default" : "accent"}
                  onClick={() =>
                    sanitizeRunning
                      ? navigate(`/integrations/sync/${latestSanitize.id}`)
                      : sanitizeMutation.mutate()
                  }
                  disabled={sanitizeMutation.isPending}
                >
                  {sanitizeMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
                  {sanitizeRunning ? "View run" : "Run sanitize"}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Score */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/10">
                  <Bot size={18} className="text-accent" />
                </div>
                <div>
                  <CardTitle>Score</CardTitle>
                  <CardSubtitle>AI story point &amp; complexity scoring</CardSubtitle>
                </div>
              </div>
              {scoreRunning && <Pill tone="info" live>Running</Pill>}
            </CardHeader>
            <CardBody>
              <div className="grid grid-cols-3 gap-4">
                <Stat
                  label="Pending"
                  value={scoringState?.pending ?? "—"}
                  tone={scoringState?.pending > 0 ? "warn" : "default"}
                />
                <Stat label="Total scored" value={scoringState?.total_scored ?? "—"} />
                <Stat
                  label="Last scored"
                  value={scoringState?.last_scored_at ? formatDistanceToNow(new Date(scoringState.last_scored_at), { addSuffix: true }) : "—"}
                />
              </div>
              <div className="mt-5 flex items-center justify-end gap-2">
                {scoringState?.latest_sync_state_id && (
                  <Button variant="ghost" onClick={() => navigate(`/integrations/sync/${scoringState.latest_sync_state_id}`)}>
                    View last run
                  </Button>
                )}
                <Button
                  variant={scoreRunning ? "default" : "accent"}
                  onClick={() =>
                    scoreRunning
                      ? navigate(`/integrations/sync/${scoringState.latest_sync_state_id}`)
                      : scoreMutation.mutate({})
                  }
                  disabled={scoreMutation.isPending || (!scoreRunning && scoringState?.pending === 0)}
                  title={!scoreRunning && scoringState?.pending === 0 ? "No pending issues to score" : undefined}
                >
                  {scoreMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />}
                  {scoreRunning ? "View run" : "Run score"}
                  {!scoreRunning && (scoringState?.pending ?? 0) > 0 && (
                    <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">
                      {scoringState.pending}
                    </span>
                  )}
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>
      </section>

      {/* Staging */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Staging
          </h2>
          <Button
            variant="accent"
            size="sm"
            onClick={() => promoteMutation.mutate()}
            disabled={!canPromote || promoteMutation.isPending}
            title={!canPromote ? "Approve at least one issue first" : undefined}
          >
            {promoteMutation.isPending ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CheckCircle2 size={13} />
            )}
            Promote to Lumber
            {canPromote && (
              <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">
                {counts.approved}
              </span>
            )}
          </Button>
        </div>

        {counts && (
          <div className="mb-4 grid grid-cols-5 gap-4">
            <StatCard label="New" value={counts.new} tone="ok" />
            <StatCard label="Updated" value={counts.updated} tone="info" />
            <StatCard label="Pending" value={counts.pending} tone={counts.pending > 0 ? "warn" : "default"} />
            <StatCard label="Approved" value={counts.approved} tone={counts.approved > 0 ? "ok" : "default"} />
            <StatCard label="Skipped" value={counts.skipped} />
          </div>
        )}

        <div className="mb-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Button
              variant="default"
              size="sm"
              onClick={() => approveAllMutation.mutate()}
              disabled={!counts?.pending || approveAllMutation.isPending}
            >
              {approveAllMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Approve all pending
              {counts?.pending > 0 && (
                <span className="ml-1 font-mono text-[11px] text-ink-3">({counts.pending})</span>
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => skipAllMutation.mutate()}
              disabled={!counts?.pending || skipAllMutation.isPending}
            >
              {skipAllMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
              Skip all pending
            </Button>
          </div>

          <div className="flex items-center gap-1 rounded border border-border bg-bg-sunken p-1">
            {FILTERS.map((f) => (
              <button
                key={String(f.key)}
                onClick={() => { setStatusFilter(f.key); setPage(0); }}
                className={`rounded px-3 py-1 text-[12.5px] font-medium transition-colors ${
                  statusFilter === f.key
                    ? "bg-bg-elev text-ink shadow-sm"
                    : "text-ink-3 hover:text-ink"
                }`}
              >
                {f.label}
                {f.key === "pending" && counts?.pending > 0 && (
                  <span className="ml-1.5 rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-semibold text-white">
                    {counts.pending}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        <Card>
          {isLoading ? (
            <CardBody>
              <div className="flex items-center gap-2 text-[13px] text-ink-3">
                <Loader2 size={14} className="animate-spin" /> Loading…
              </div>
            </CardBody>
          ) : !data?.items?.length ? (
            <CardBody>
              <p className="text-[13px] text-ink-3">
                {statusFilter === "pending"
                  ? "No pending issues — approve some or wait for the next sync."
                  : "No issues in this state."}
              </p>
            </CardBody>
          ) : (
            <>
              <Table>
                <THead>
                  <TR>
                    <TH>Jira Key</TH>
                    <TH>Change</TH>
                    <TH>Summary</TH>
                    <TH>Type</TH>
                    <TH>Updated in Jira</TH>
                    <TH>Status</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.items.map((row) => (
                    <TR key={row.id}>
                      <TD>
                        <span className="font-mono text-[12px] font-semibold text-ink">
                          {row.jira_key}
                        </span>
                      </TD>
                      <TD>
                        <Pill tone={CHANGE_TONE[row.change_type] || "default"}>
                          {CHANGE_LABEL[row.change_type] || row.change_type}
                        </Pill>
                      </TD>
                      <TD className="max-w-[280px]">
                        <span className="line-clamp-2 text-[12.5px] text-ink-2">
                          {row.summary || <span className="text-ink-4 italic">no summary</span>}
                        </span>
                      </TD>
                      <TD>
                        <span className="text-[12.5px] text-ink-3">{row.issue_type || "—"}</span>
                      </TD>
                      <TD>
                        <span className="text-[12.5px] text-ink-3">
                          {row.jira_updated_at
                            ? formatDistanceToNow(new Date(row.jira_updated_at), { addSuffix: true })
                            : "—"}
                        </span>
                      </TD>
                      <TD>
                        <Pill tone={STATUS_TONE[row.review_status] || "default"}>
                          {row.review_status}
                        </Pill>
                      </TD>
                      <TD className="text-right">
                        {row.review_status === "pending" && (
                          <div className="flex items-center justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="default"
                              onClick={() => approveMutation.mutate(row.id)}
                              disabled={approveMutation.isPending}
                            >
                              <CheckCircle2 size={12} /> Approve
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => skipMutation.mutate(row.id)}
                              disabled={skipMutation.isPending}
                            >
                              <X size={12} /> Skip
                            </Button>
                          </div>
                        )}
                        {row.review_status === "approved" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => skipMutation.mutate(row.id)}
                            disabled={skipMutation.isPending}
                          >
                            <X size={12} /> Undo
                          </Button>
                        )}
                        {row.review_status === "skipped" && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => approveMutation.mutate(row.id)}
                            disabled={approveMutation.isPending}
                          >
                            <CheckCircle2 size={12} /> Restore
                          </Button>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] text-ink-3">
                  <span>
                    {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of{" "}
                    {data.total.toLocaleString()}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
                      <ChevronLeft size={14} />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </Card>
      </section>

      {/* Sync trigger modal */}
      <Modal open={syncModalOpen} onClose={() => setSyncModalOpen(false)}>
        <ModalHeader title="Sync Jira" onClose={() => setSyncModalOpen(false)} />
        <ModalBody>
          <p className="mb-4 text-[13px] text-ink-3">
            Only issues updated on or after this date will be fetched from Jira. Clear the field to
            run a full sync.
          </p>
          <Label htmlFor="sync-since">Sync from</Label>
          <Input
            id="sync-since"
            type="datetime-local"
            value={sinceValue}
            onChange={(e) => setSinceValue(e.target.value)}
          />
          {!sinceValue && (
            <p className="mt-2 text-[12px] text-warn">
              No date set — this will be a full sync and may take a while.
            </p>
          )}
          {latestSync?.synced_until && sinceValue && (
            <p className="mt-2 text-[12px] text-ink-3">
              Last successful sync ended{" "}
              {formatDistanceToNow(new Date(latestSync.synced_until), { addSuffix: true })}.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setSyncModalOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="accent"
            onClick={() => triggerMutation.mutate(sinceValue ? new Date(sinceValue).toISOString() : null)}
            disabled={triggerMutation.isPending}
          >
            {triggerMutation.isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Sync now
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

function Stat({ label, value, tone = "default" }) {
  const valueTone = tone === "warn" ? "text-warn" : tone === "err" ? "text-err" : "text-ink";
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</p>
      <p className={`mt-1 text-[18px] font-semibold ${valueTone}`}>{value}</p>
    </div>
  );
}

function StatCard({ label, value, tone = "default" }) {
  const valueTone =
    tone === "ok" ? "text-ok"
    : tone === "info" ? "text-info"
    : tone === "warn" ? "text-warn"
    : "text-ink";
  return (
    <Card>
      <CardBody>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</p>
        <p className={`mt-2 text-[26px] font-semibold leading-tight ${valueTone}`}>{value}</p>
      </CardBody>
    </Card>
  );
}

function FunnelArrow() {
  return <ChevronRight size={18} className="mx-1 flex-shrink-0 text-ink-4" />;
}

function FunnelStage({ label, value, sub, tone = "default", href }) {
  const valueColor =
    tone === "ok" ? "text-ok"
    : tone === "warn" ? "text-warn"
    : tone === "err" ? "text-err"
    : "text-ink";

  const inner = (
    <div className="flex min-w-[100px] flex-col items-center px-3 py-1 text-center">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-ink-3">{label}</p>
      <p className={`mt-1 text-[28px] font-semibold leading-tight tabular-nums ${valueColor}`}>
        {value ?? "—"}
      </p>
      <p className="mt-0.5 text-[11.5px] text-ink-3">{sub}</p>
    </div>
  );

  if (href) {
    return (
      <Link to={href} className="rounded transition-colors hover:bg-bg-sunken">
        {inner}
      </Link>
    );
  }
  return inner;
}
