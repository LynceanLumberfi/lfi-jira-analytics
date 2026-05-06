import { useState } from "react";
import { useParams, Navigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  getAnalyticsByAssignee,
  getAnalyticsByTeam,
  getAnalyticsSummary,
  getIssues,
  getSprints,
  getTeams,
} from "../../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Pill } from "../../components/ui/Pill";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import { Avatar } from "../../components/ui/Avatar";
import { ScoreBar } from "../../components/charts/ScoreBar";
import { IssueDrawer } from "../../components/ui/IssueDrawer";

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function KpiTile({ label, value, sub, tone = "default" }) {
  const valueTone =
    tone === "warn"
      ? "text-warn"
      : tone === "err"
        ? "text-err"
        : tone === "ok"
          ? "text-ok"
          : "text-ink";
  return (
    <Card>
      <CardBody>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          {label}
        </p>
        <p className={`mt-2 text-[26px] font-semibold leading-tight ${valueTone}`}>
          {value}
        </p>
        {sub && <p className="mt-1 text-[12.5px] text-ink-3">{sub}</p>}
      </CardBody>
    </Card>
  );
}

function SortTH({ col, sortCol, sortDir, onSort, className = "", children }) {
  const active = sortCol === col;
  return (
    <TH
      className={`cursor-pointer select-none whitespace-nowrap ${className}`}
      onClick={() => onSort(col)}
    >
      {children}{" "}
      <span className="font-normal opacity-50">
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </TH>
  );
}

export function TeamPage() {
  const { teamId } = useParams();
  const teamIdNum = Number(teamId);
  const [searchParams, setSearchParams] = useSearchParams();
  const sprintIdParam = searchParams.get("sprint_id");
  const sprintId = sprintIdParam ? Number(sprintIdParam) : null;

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });
  const team = teams?.find((t) => t.id === teamIdNum);

  const { data: sprints } = useQuery({
    queryKey: ["sprints", { team_id: teamIdNum }],
    queryFn: () => getSprints({ team_id: teamIdNum }),
    enabled: !Number.isNaN(teamIdNum),
    staleTime: 5 * 60 * 1000,
  });

  const filter = { team_id: teamIdNum, sprint_id: sprintId ?? undefined };

  const { data: summary } = useQuery({
    queryKey: ["analytics", "summary", filter],
    queryFn: () => getAnalyticsSummary(filter),
    enabled: !Number.isNaN(teamIdNum),
  });
  const { data: teamAgg } = useQuery({
    queryKey: ["analytics", "by-team", filter],
    queryFn: () => getAnalyticsByTeam(filter),
    enabled: !Number.isNaN(teamIdNum),
  });
  const { data: byAssignee, isLoading: aLoading } = useQuery({
    queryKey: ["analytics", "by-assignee", filter],
    queryFn: () => getAnalyticsByAssignee(filter),
    enabled: !Number.isNaN(teamIdNum),
  });
  const { data: issues, isLoading: iLoading } = useQuery({
    queryKey: ["issues", { ...filter, limit: 50 }],
    queryFn: () =>
      getIssues({ ...filter, limit: 50, sort: "updated_at", order: "desc" }),
    enabled: !Number.isNaN(teamIdNum),
  });

  function onSprintChange(e) {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set("sprint_id", e.target.value);
    else next.delete("sprint_id");
    setSearchParams(next, { replace: true });
  }

  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [colFilters, setColFilters] = useState({ key: "", type: "", summary: "", assignee: "", sp: "", quality: "" });
  const [selectedKey, setSelectedKey] = useState(null);

  function onSortClick(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const allItems = issues?.items ?? [];
  const uniqueTypes = [...new Set(allItems.map((it) => it.issue_type).filter(Boolean))].sort();
  const uniqueAssignees = [...new Set(allItems.map((it) => it.assignee_name).filter(Boolean))].sort();

  let displayedIssues = allItems;
  if (colFilters.key) displayedIssues = displayedIssues.filter((it) => it.jira_key?.toLowerCase().includes(colFilters.key.toLowerCase()));
  if (colFilters.type) displayedIssues = displayedIssues.filter((it) => it.issue_type === colFilters.type);
  if (colFilters.summary) displayedIssues = displayedIssues.filter((it) => it.summary?.toLowerCase().includes(colFilters.summary.toLowerCase()));
  if (colFilters.assignee) displayedIssues = displayedIssues.filter((it) => it.assignee_name === colFilters.assignee);
  if (colFilters.sp !== "") displayedIssues = displayedIssues.filter((it) => (it.story_points ?? 0) >= Number(colFilters.sp));
  if (colFilters.quality !== "") displayedIssues = displayedIssues.filter((it) => it.quality_score != null && it.quality_score >= Number(colFilters.quality));
  if (sortCol) {
    displayedIssues = [...displayedIssues].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }

  if (Number.isNaN(teamIdNum)) return <Navigate to="/analytics" replace />;

  const agg = teamAgg?.[0];
  const totalIssues = summary?.total_issues ?? agg?.issue_count ?? 0;
  const scoredCount = summary?.scored_issues ?? agg?.scored_count ?? 0;
  const noDescCount = summary?.no_description_count ?? agg?.no_description_count ?? 0;
  const noDescPct = totalIssues > 0 ? noDescCount / totalIssues : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">
            {team?.name || `Team #${teamIdNum}`}
          </h2>
          <p className="text-[12.5px] text-ink-3">
            {totalIssues} issues · {scoredCount} scored
          </p>
        </div>
        {sprints?.length > 0 && (
          <select
            value={sprintId ?? ""}
            onChange={onSprintChange}
            className="rounded border border-border bg-bg-sunken px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">All sprints</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? "Unnamed"} ({s.jira_sprint_id})
              </option>
            ))}
          </select>
        )}
      </div>

      {/* KPIs */}
      <section className="grid grid-cols-4 gap-4">
        <KpiTile
          label="Avg quality"
          value={
            summary?.avg_quality != null ? summary.avg_quality.toFixed(1) : "—"
          }
          sub="0–5 score"
          tone={
            summary?.avg_quality == null
              ? "default"
              : summary.avg_quality >= 3.5
                ? "ok"
                : summary.avg_quality >= 2.5
                  ? "warn"
                  : "err"
          }
        />
        <KpiTile
          label="AI plan detected"
          value={pct(summary?.avg_ai_plan_pct)}
          sub={
            summary?.scored_issues
              ? `among ${summary.scored_issues} scored issues`
              : "no scored issues yet"
          }
          tone={
            summary?.avg_ai_plan_pct == null
              ? "default"
              : summary.avg_ai_plan_pct >= 0.5
                ? "ok"
                : "default"
          }
        />
        <KpiTile
          label="Skill usage"
          value={pct(summary?.avg_skill_pct)}
          sub={
            agg?.skill_count != null
              ? `${agg.skill_count} issues mentioned a skill`
              : ""
          }
        />
        <KpiTile
          label="No description"
          value={pct(noDescPct)}
          sub={`${noDescCount} of ${totalIssues} issues`}
          tone={
            noDescPct == null ? "default" : noDescPct >= 0.2 ? "warn" : "default"
          }
        />
      </section>

      {/* By assignee */}
      <Card>
        <CardHeader>
          <CardTitle>By assignee</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            {byAssignee?.length ?? 0} people
          </span>
        </CardHeader>
        <CardBody pad="sm">
          {aLoading ? (
            <Loading />
          ) : !byAssignee?.length ? (
            <Empty text="No assignees with promoted issues yet." />
          ) : (
            <Table className="rounded-none border-0">
              <THead>
                <TR>
                  <TH>Assignee</TH>
                  <TH className="text-right">Issues</TH>
                  <TH className="text-right">Points</TH>
                  <TH>Avg quality</TH>
                  <TH className="text-right">AI plan</TH>
                  <TH className="text-right">Skill</TH>
                </TR>
              </THead>
              <TBody>
                {byAssignee.map((a) => {
                  const aiPct =
                    a.scored_count > 0 ? a.ai_plan_count / a.scored_count : null;
                  const skillPct =
                    a.scored_count > 0 ? a.skill_count / a.scored_count : null;
                  return (
                    <TR key={a.assignee_id ?? `nobody-${a.assignee_name}`}>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          <Avatar
                            name={a.assignee_name || "Unassigned"}
                            size={22}
                          />
                          <span className="text-[13px] text-ink">
                            {a.assignee_name || (
                              <span className="text-ink-4">Unassigned</span>
                            )}
                          </span>
                        </span>
                      </TD>
                      <TD className="text-right font-mono text-[12px]">
                        {a.issue_count}
                      </TD>
                      <TD className="text-right font-mono text-[12px]">
                        {a.total_story_points
                          ? Math.round(a.total_story_points)
                          : 0}
                      </TD>
                      <TD>
                        <ScoreBar value={a.avg_quality} />
                      </TD>
                      <TD className="text-right font-mono text-[12px]">
                        {aiPct == null ? "—" : pct(aiPct)}
                      </TD>
                      <TD className="text-right font-mono text-[12px]">
                        {skillPct == null ? "—" : pct(skillPct)}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Tickets */}
      <Card>
        <CardHeader>
          <CardTitle>Tickets</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            Showing {displayedIssues.length} of {issues?.total ?? 0}
          </span>
        </CardHeader>
        <CardBody pad="sm">
          {iLoading ? (
            <Loading />
          ) : !allItems.length ? (
            <Empty text="No promoted tickets yet for this team." />
          ) : (
            <Table className="rounded-none border-0">
              <THead>
                <TR>
                  <SortTH col="jira_key" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Key</SortTH>
                  <SortTH col="issue_type" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Type</SortTH>
                  <SortTH col="summary" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Summary</SortTH>
                  <SortTH col="assignee_name" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Assignee</SortTH>
                  <SortTH col="story_points" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick} className="text-right">SP</SortTH>
                  <SortTH col="quality_score" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Quality</SortTH>
                  <TH>Skill</TH>
                  <TH>AI</TH>
                  <TH>Status</TH>
                </TR>
                <TR>
                  <TH className="py-1">
                    <input
                      className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                      placeholder="Filter…"
                      value={colFilters.key}
                      onChange={(e) => setColFilters((f) => ({ ...f, key: e.target.value }))}
                    />
                  </TH>
                  <TH className="py-1">
                    <select
                      className="w-full rounded border border-border bg-bg px-1 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink"
                      value={colFilters.type}
                      onChange={(e) => setColFilters((f) => ({ ...f, type: e.target.value }))}
                    >
                      <option value="">All</option>
                      {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </TH>
                  <TH className="py-1">
                    <input
                      className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                      placeholder="Filter…"
                      value={colFilters.summary}
                      onChange={(e) => setColFilters((f) => ({ ...f, summary: e.target.value }))}
                    />
                  </TH>
                  <TH className="py-1">
                    <select
                      className="w-full rounded border border-border bg-bg px-1 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink"
                      value={colFilters.assignee}
                      onChange={(e) => setColFilters((f) => ({ ...f, assignee: e.target.value }))}
                    >
                      <option value="">All</option>
                      {uniqueAssignees.map((a) => <option key={a} value={a}>{a}</option>)}
                    </select>
                  </TH>
                  <TH className="py-1">
                    <input
                      type="number"
                      min="0"
                      className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                      placeholder="≥"
                      value={colFilters.sp}
                      onChange={(e) => setColFilters((f) => ({ ...f, sp: e.target.value }))}
                    />
                  </TH>
                  <TH className="py-1">
                    <input
                      type="number"
                      min="0"
                      max="5"
                      step="0.1"
                      className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                      placeholder="≥"
                      value={colFilters.quality}
                      onChange={(e) => setColFilters((f) => ({ ...f, quality: e.target.value }))}
                    />
                  </TH>
                  <TH /><TH /><TH />
                </TR>
              </THead>
              <TBody>
                {displayedIssues.length === 0 ? (
                  <TR>
                    <TD colSpan={9} className="py-6 text-center text-[13px] text-ink-4">
                      No tickets match the current filters.
                    </TD>
                  </TR>
                ) : displayedIssues.map((it) => (
                  <TR key={it.issue_id}>
                    <TD>
                      <button
                        className="font-mono text-[12px] font-semibold text-accent hover:underline"
                        onClick={() => setSelectedKey(it.jira_key)}
                      >
                        {it.jira_key}
                      </button>
                    </TD>
                    <TD>
                      <Pill tone="default">{it.issue_type || "—"}</Pill>
                    </TD>
                    <TD className="max-w-[360px]">
                      <span className="line-clamp-1 text-[13px] text-ink-2">
                        {it.summary}
                      </span>
                    </TD>
                    <TD>
                      <span className="text-[12.5px] text-ink-2">
                        {it.assignee_name || (
                          <span className="text-ink-4">—</span>
                        )}
                      </span>
                    </TD>
                    <TD className="text-right font-mono text-[12px]">
                      {it.story_points ?? "—"}
                    </TD>
                    <TD>
                      {it.quality_score != null ? (
                        <ScoreBar value={it.quality_score} width={48} showValue />
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </TD>
                    <TD>
                      {it.quality_score == null ? (
                        <span className="text-[12px] text-ink-4">NS</span>
                      ) : it.skill_usage_detected ? (
                        <span className="text-[12px] text-ink-2">{it.skill_name || "yes"}</span>
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </TD>
                    <TD>
                      {it.ai_plan_detected ? (
                        <Pill tone="ok">plan</Pill>
                      ) : it.quality_score != null ? (
                        <Pill tone="default">no</Pill>
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </TD>
                    <TD>
                      <Pill tone={it.is_done ? "ok" : "default"}>
                        {it.status || "—"}
                      </Pill>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <IssueDrawer issueKey={selectedKey} onClose={() => setSelectedKey(null)} />
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-3">
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}

function Empty({ text }) {
  return (
    <div className="rounded border border-dashed border-border bg-bg-sunken py-8 text-center text-[13px] text-ink-3">
      {text}
    </div>
  );
}
