import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import {
  approveAllStaging,
  getStagingIssues,
  promoteStaging,
  reviewStagingIssue,
  skipAllStaging,
} from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";

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

export function StagingReview() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");
  const [page, setPage] = useState(0);

  const queryKey = ["staging", statusFilter, page];

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn: () =>
      getStagingIssues({
        status: statusFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    keepPreviousData: true,
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["staging"] });
  }

  const approveMutation = useMutation({
    mutationFn: (id) =>
      reviewStagingIssue(id, { review_status: "approved", reviewed_by: "admin" }),
    onSuccess: invalidate,
  });

  const skipMutation = useMutation({
    mutationFn: (id) =>
      reviewStagingIssue(id, { review_status: "skipped", reviewed_by: "admin" }),
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

  const counts = data
    ? { pending: data.pending, approved: data.approved, skipped: data.skipped, new: data.new, updated: data.updated, promoted: data.promoted }
    : null;

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;
  const canPromote = (counts?.approved ?? 0) > 0;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight text-ink">
            Staging review
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Review issues fetched from Jira before promoting them to Lumber.
          </p>
        </div>
        <Button
          variant="accent"
          onClick={() => promoteMutation.mutate()}
          disabled={!canPromote || promoteMutation.isPending}
          title={!canPromote ? "Approve at least one issue first" : undefined}
        >
          {promoteMutation.isPending ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <CheckCircle2 size={14} />
          )}
          Promote to Lumber
          {canPromote && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.5 text-[11px] font-semibold">
              {counts.approved}
            </span>
          )}
        </Button>
      </header>

      {/* Stat cards */}
      {counts && (
        <section className="grid grid-cols-5 gap-4">
          <StatCard label="New" value={counts.new} tone="ok" />
          <StatCard label="Updated" value={counts.updated} tone="info" />
          <StatCard label="Pending" value={counts.pending} tone={counts.pending > 0 ? "warn" : "default"} />
          <StatCard label="Approved" value={counts.approved} tone={counts.approved > 0 ? "ok" : "default"} />
          <StatCard label="Skipped" value={counts.skipped} />
        </section>
      )}

      {/* Actions + filter */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Button
            variant="default"
            size="sm"
            onClick={() => approveAllMutation.mutate()}
            disabled={!counts?.pending || approveAllMutation.isPending}
          >
            {approveAllMutation.isPending ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Approve all pending
            {counts?.pending > 0 && <span className="ml-1 font-mono text-[11px] text-ink-3">({counts.pending})</span>}
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

        {/* Filter tabs */}
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

      {/* Table */}
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
                      <span className="text-[12.5px] text-ink-3">
                        {row.issue_type || "—"}
                      </span>
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

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] text-ink-3">
                <span>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, data.total)} of {data.total.toLocaleString()}
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
