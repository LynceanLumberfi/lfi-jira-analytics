import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Loader2,
  RefreshCw,
  X,
} from "lucide-react";
import {
  dismissFailedRecord,
  getFailedRecords,
  retryFailedRecord,
} from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Button } from "../components/ui/Button";

const FIX_RECIPES = {
  DEPENDENCY: [
    "Verify the referenced parent or epic exists in Lumber.",
    "Re-run the sync — it may have been imported on a later page.",
  ],
  CONFLICT_UNIQUE: [
    "Check whether two Jira issues collide on the same Lumber key.",
    "Manually resolve and re-promote the staging row.",
  ],
  CONFLICT_FIELDS: [
    "Inspect the diff in the audit log for the run.",
    "Approve or skip the staging row and re-promote.",
  ],
  VALIDATION: [
    "Open the raw response below and look for the offending field.",
    "Fix the Jira data, then re-trigger a sync.",
  ],
  RATE_LIMITED: [
    "Wait a few minutes — Jira limits are recovering.",
    "Re-trigger the sync; partial progress is preserved.",
  ],
};

const DISMISSED_BY = "Lumber Admin";

export function FailedRecords() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["failedRecords", { status: "open" }],
    queryFn: () => getFailedRecords({ status: "open", limit: 200 }),
    refetchInterval: 10_000,
  });

  const dismissMutation = useMutation({
    mutationFn: (id) => dismissFailedRecord(id, DISMISSED_BY),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["failedRecords"] }),
  });
  const retryMutation = useMutation({
    mutationFn: (id) => retryFailedRecord(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["failedRecords"] }),
  });

  const grouped = groupByCode(data?.items || []);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[24px] font-semibold leading-tight text-ink">
            Failed records
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Errors that need attention. Dismiss to hide; retry to re-queue (stub
            in Phase 1).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Pill tone={data?.open_count ? "warn" : "ok"}>
            {data?.open_count ?? 0} open
          </Pill>
          <Pill tone="default">{data?.dismissed_count ?? 0} dismissed</Pill>
        </div>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 text-ink-3">
          <Loader2 size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {!isLoading && grouped.length === 0 && (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center gap-2 py-8 text-center">
              <div className="rounded-full bg-ok-soft p-3 text-ok">
                <AlertTriangle size={20} className="rotate-180" />
              </div>
              <p className="text-[15px] font-semibold text-ink">All clear</p>
              <p className="text-[12.5px] text-ink-3">
                No open failed records — every entity is synced cleanly.
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      {grouped.map(([code, items]) => (
        <ErrorGroup
          key={code}
          code={code}
          items={items}
          onDismiss={(id) => dismissMutation.mutate(id)}
          onRetry={(id) => retryMutation.mutate(id)}
          isPending={(id) =>
            (dismissMutation.isPending && dismissMutation.variables === id) ||
            (retryMutation.isPending && retryMutation.variables === id)
          }
        />
      ))}
    </div>
  );
}

function groupByCode(items) {
  const map = new Map();
  for (const r of items) {
    const key = r.error_code || "UNKNOWN";
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

function ErrorGroup({ code, items, onDismiss, onRetry, isPending }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <Pill tone="err">{code}</Pill>
          <CardTitle>{describeCode(code)}</CardTitle>
        </div>
        <span className="text-[12.5px] text-ink-3">
          {items.length} {items.length === 1 ? "record" : "records"}
        </span>
      </CardHeader>
      <CardBody pad="sm">
        <ul className="flex flex-col">
          {items.map((it) => (
            <FailureItem
              key={it.id}
              item={it}
              onDismiss={onDismiss}
              onRetry={onRetry}
              busy={isPending(it.id)}
            />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function FailureItem({ item, onDismiss, onRetry, busy }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start justify-between gap-3 px-3 py-3 text-left hover:bg-bg-sunken/40"
      >
        <div className="flex items-start gap-2 min-w-0">
          {open ? (
            <ChevronDown size={14} className="mt-1 text-ink-3" />
          ) : (
            <ChevronRight size={14} className="mt-1 text-ink-3" />
          )}
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">
              {item.title}
            </p>
            <p className="text-[12px] text-ink-3">
              {item.phase} · {item.entity}
              {item.jira_ref && (
                <>
                  {" · "}
                  <span className="font-mono">{item.jira_ref}</span>
                </>
              )}
              {" · "}
              {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {item.retry_count > 0 && (
            <Pill tone="default">{item.retry_count} retries</Pill>
          )}
        </div>
      </button>

      {open && (
        <div className="border-t border-border bg-bg-sunken/40 px-3 py-4 pl-9">
          <div className="grid grid-cols-1 gap-4">
            <Section title="What happened">
              <p className="text-[12.5px] text-ink-2">
                {item.detail || "—"}
              </p>
            </Section>
            <Section title="How to resolve">
              <ul className="ml-4 list-disc text-[12.5px] text-ink-2">
                {(item.fix_steps || FIX_RECIPES[item.error_code] || [
                  "Inspect the raw response below.",
                ]).map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ul>
            </Section>
            {item.raw_response && (
              <Section title="Raw response">
                <pre className="max-h-64 overflow-auto rounded border border-border bg-bg-elev p-3 font-mono text-[11.5px] leading-[1.5] text-ink-2">
                  {JSON.stringify(item.raw_response, null, 2)}
                </pre>
              </Section>
            )}
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="default"
                size="sm"
                onClick={() => onRetry(item.id)}
                disabled={busy}
              >
                <RefreshCw size={13} /> Retry
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => onDismiss(item.id)}
                disabled={busy}
              >
                <X size={13} /> Dismiss
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
        {title}
      </p>
      {children}
    </div>
  );
}

function describeCode(code) {
  switch (code) {
    case "DEPENDENCY":
      return "Referenced parent or related record is missing";
    case "CONFLICT_UNIQUE":
      return "Two records collide on a unique key";
    case "CONFLICT_FIELDS":
      return "Field-level conflict needs review";
    case "VALIDATION":
      return "Payload failed validation";
    case "RATE_LIMITED":
      return "Jira API rate-limited the sync";
    default:
      return "Failure";
  }
}
