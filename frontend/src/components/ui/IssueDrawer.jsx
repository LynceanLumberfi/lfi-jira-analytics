import { Info, Loader2, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getIssueDetail, rescoreIssue } from "../../lib/api";
import { Drawer } from "./Drawer";
import { Pill } from "./Pill";
import { ScoreBar } from "../charts/ScoreBar";

function fmt(dt) {
  if (!dt) return "—";
  return new Date(dt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function hours(secs) {
  if (secs == null) return "—";
  const h = Math.round(secs / 3600 * 10) / 10;
  return `${h}h`;
}

function InfoTooltip({ text }) {
  return (
    <span className="group/tip relative ml-1 inline-flex items-center">
      <Info size={11} className="cursor-default text-ink-4" />
      <span className="pointer-events-none absolute bottom-full left-0 z-20 mb-2 w-60 rounded-lg border border-border bg-bg-elev px-3 py-2 text-[11.5px] leading-relaxed text-ink-2 shadow-lg opacity-0 transition-opacity duration-150 group-hover/tip:opacity-100">
        {text}
      </span>
    </span>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex gap-3 py-2 text-[13px]">
      <span className="inline-flex w-36 shrink-0 items-center text-ink-3">{label}</span>
      <span className="min-w-0 text-ink">{children}</span>
    </div>
  );
}

function Section({ title, action, children }) {
  return (
    <div className="border-t border-border px-5 py-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function ScoreAgainButton({ issueKey }) {
  const queryClient = useQueryClient();
  const { mutate, isPending, isError, error } = useMutation({
    mutationFn: () => rescoreIssue(issueKey),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["issue-detail", issueKey] });
      queryClient.invalidateQueries({ queryKey: ["issues"] });
    },
  });

  return (
    <button
      type="button"
      onClick={() => mutate()}
      disabled={isPending}
      title={isError ? `Error: ${error?.message}` : "Re-score this issue"}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-bg-elev px-2 py-1 text-[11px] font-medium text-ink-2 hover:bg-bg-hover disabled:opacity-60"
    >
      {isPending
        ? <Loader2 size={11} className="animate-spin" />
        : <RefreshCw size={11} className={isError ? "text-err" : ""} />}
      <span>{isPending ? "Scoring…" : "Score Again"}</span>
    </button>
  );
}

function AiTile({ label, children }) {
  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-bg-sunken px-3 py-2.5">
      <p className="text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</p>
      <div>{children}</div>
    </div>
  );
}

function TagList({ items }) {
  if (!items?.length) return <span className="text-ink-4">—</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {items.map((t) => <Pill key={t} tone="default">{t}</Pill>)}
    </span>
  );
}

function IssueDetail({ issueKey }) {
  const { data: issue, isLoading, isError } = useQuery({
    queryKey: ["issue-detail", issueKey],
    queryFn: () => getIssueDetail(issueKey),
    enabled: !!issueKey,
    staleTime: 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-5 py-8 text-[13px] text-ink-3">
        <Loader2 size={14} className="animate-spin" /> Loading…
      </div>
    );
  }

  if (isError || !issue) {
    return (
      <div className="px-5 py-8 text-[13px] text-err">Failed to load issue.</div>
    );
  }

  const ai = issue.ai_score;
  const m = issue.metrics;

  return (
    <div>
      {/* Summary + meta */}
      <div className="px-5 py-4">
        <p className="text-[15px] font-semibold leading-snug text-ink">{issue.summary || "—"}</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {issue.issue_type && <Pill tone="default">{issue.issue_type}</Pill>}
          {issue.status && <Pill tone={issue.is_done ? "ok" : "default"}>{issue.status}</Pill>}
          {issue.priority && <Pill tone="default">{issue.priority}</Pill>}
        </div>
      </div>

      {/* Core fields */}
      <Section title="Details">
        <Row label="Project">{issue.project || "—"}</Row>
        <Row label="Assignee">{issue.assignee?.display_name || <span className="text-ink-4">Unassigned</span>}</Row>
        <Row label="Reporter">{issue.reporter?.display_name || "—"}</Row>
        <Row label="Team">{issue.team?.name || "—"}</Row>
        <Row label="Sprint">
          {issue.sprints?.length > 0 ? (
            <span className="flex items-center gap-1.5">
              <span>{issue.sprints[0].name ?? "—"}</span>
              {issue.sprints.length > 1 && (
                <span className="text-[11px] text-ink-4">+{issue.sprints.length - 1} more</span>
              )}
            </span>
          ) : (
            <span className="text-ink-4">—</span>
          )}
        </Row>
        <Row label="Epic">{issue.epic_key || "—"}</Row>
        <Row label="Story points">{issue.story_points ?? "—"}</Row>
        <Row label="Estimate">{hours(issue.time_estimate_secs)}</Row>
        <Row label="Time spent">{hours(issue.time_spent_secs)}</Row>
        {issue.customers?.length > 0 && (
          <Row label="Customers"><TagList items={issue.customers} /></Row>
        )}
      </Section>

      {/* Dates */}
      <Section title="Dates">
        <Row label="Created">{fmt(issue.created_at)}</Row>
        <Row label="Updated">{fmt(issue.updated_at)}</Row>
        <Row label="Resolved">{fmt(issue.resolved_at)}</Row>
        <Row label="Synced">{fmt(issue.synced_at)}</Row>
      </Section>

      {/* Sprints */}
      {issue.sprints?.length > 0 && (
        <Section title="Sprints">
          {issue.sprints.map((s) => (
            <Row key={s.id} label={s.state ?? "—"}>
              {s.name ?? "—"}{" "}
              <span className="text-ink-4">({s.jira_sprint_id})</span>
            </Row>
          ))}
        </Section>
      )}

      {/* Labels / components / fix versions */}
      {(issue.labels?.length > 0 || issue.components?.length > 0 || issue.fix_versions?.length > 0) && (
        <Section title="Tags">
          {issue.labels?.length > 0 && <Row label="Labels"><TagList items={issue.labels} /></Row>}
          {issue.components?.length > 0 && <Row label="Components"><TagList items={issue.components} /></Row>}
          {issue.fix_versions?.length > 0 && <Row label="Fix versions"><TagList items={issue.fix_versions} /></Row>}
        </Section>
      )}

      {/* AI score */}
      <Section title="AI Score" action={<ScoreAgainButton issueKey={issueKey} />}>
        {!ai ? (
          <p className="text-[13px] text-ink-4">Not scored yet.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {/* Three stat tiles */}
            <div className="grid grid-cols-3 gap-2">
              <AiTile label="AI Score">
                <div className="flex items-center gap-1.5">
                  <Pill tone={ai.ai_plan_detected ? "ok" : "default"}>
                    {ai.ai_plan_detected ? "Detected" : "None"}
                  </Pill>
                  {ai.ai_score != null && (
                    <span className="text-[12px] text-ink-3">{ai.ai_score} / 5</span>
                  )}
                </div>
              </AiTile>
              <AiTile label="Quality Score">
                {ai.description_quality_score != null ? (
                  <ScoreBar value={ai.description_quality_score} width={56} showValue />
                ) : (
                  <span className="text-[13px] text-ink-4">—</span>
                )}
              </AiTile>
              <AiTile label="Skill">
                {ai.skill_usage_detected ? (
                  <span className="text-[12.5px] font-medium text-ok">
                    {ai.skill_name || "Detected"}
                  </span>
                ) : (
                  <span className="text-[12.5px] text-ink-4">None</span>
                )}
              </AiTile>
            </div>

            {/* Reasons */}
            {ai.scoring_notes ? (
              <div className="rounded-lg border border-border bg-bg-sunken p-3">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                  Reasons
                </p>
                <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
                  {ai.scoring_notes}
                </p>
              </div>
            ) : (
              <p className="text-[12.5px] text-ink-4">No scoring notes available.</p>
            )}

            {/* Meta */}
            <div className="flex gap-4 text-[11px] text-ink-4">
              {ai.complexity_estimate && <span>Complexity: {ai.complexity_estimate}</span>}
              {ai.model_used && <span>Model: {ai.model_used}</span>}
              {ai.scored_at && <span>Scored: {fmt(ai.scored_at)}</span>}
            </div>
          </div>
        )}
      </Section>

      {/* Metrics */}
      {m && (
        <Section title="Metrics">
          <Row label={<>Cycle time<InfoTooltip text="Time from when work actually started (first moved to In Progress) until resolved. Captures active development duration only." /></>}>
            {m.cycle_time_hours != null ? `${Math.round(m.cycle_time_hours)}h` : "—"}
          </Row>
          <Row label={<>Lead time<InfoTooltip text="Time from when the ticket was created until it was resolved. Includes backlog wait time. Lead time ≥ Cycle time always." /></>}>
            {m.lead_time_hours != null ? `${Math.round(m.lead_time_hours)}h` : "—"}
          </Row>
          <Row label="Reopens">{m.reopen_count ?? "—"}</Row>
          <Row label="Comments">{m.comment_count ?? "—"}</Row>
        </Section>
      )}

      {/* Description */}
      {issue.description && (
        <Section title="Description">
          <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">
            {issue.description}
          </p>
        </Section>
      )}

      {/* Comments */}
      {issue.comments?.length > 0 && (
        <Section title={`Comments (${issue.comments.length})`}>
          <div className="flex flex-col gap-3">
            {issue.comments.map((c) => (
              <div key={c.id} className="rounded border border-border bg-bg-sunken p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-ink-2">{c.author_name || "Unknown"}</span>
                  <span className="text-[11px] text-ink-4">{fmt(c.created_at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{c.body}</p>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export function IssueDrawer({ issueKey, onClose }) {
  return (
    <Drawer open={!!issueKey} onClose={onClose} title={issueKey ?? ""} width="w-[580px]">
      {issueKey && <IssueDetail issueKey={issueKey} />}
    </Drawer>
  );
}
