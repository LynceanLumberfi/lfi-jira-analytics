import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsResource, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { cadenceLabel } from "../../lib/cadence";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { ResourceTrendsChart } from "../../components/charts/ResourceTrendsChart";
import { KpiHero, computeDelta } from "../../components/ui/KpiHero";
import { StoriesTable } from "../../components/ui/StoriesTable";
import { Pill } from "../../components/ui/Pill";

function fmt(v, dp = 0) {
  if (v == null) return "—";
  return dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
}

function safeRate(num, den) {
  if (!den || den <= 0) return null;
  return num / den;
}

export function ResourceTeam() {
  const { teamId } = useParams();
  const numTeamId = Number(teamId);
  const [searchParams, setSearchParams] = useSearchParams();
  const sprintIdParam = searchParams.get("sprint_id");
  const sprintId = sprintIdParam ? Number(sprintIdParam) : null;

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });
  const team = teams?.find((t) => t.id === numTeamId);
  const isKnown = teams !== undefined;

  const { data: sprints } = useQuery({
    queryKey: ["sprints", { team_id: numTeamId }],
    queryFn: () => getSprints({ team_id: numTeamId }),
    enabled: !Number.isNaN(numTeamId),
    staleTime: 5 * 60 * 1000,
  });

  if (isKnown && (!team || !isFeaturedTeam(team.name))) {
    return <Navigate to="/analytics/resource" replace />;
  }

  const { data: payload, isLoading } = useQuery({
    queryKey: ["analytics", "resource", numTeamId, sprintId],
    queryFn: () => getAnalyticsResource({ team_id: numTeamId, sprint_id: sprintId ?? undefined }),
    enabled: isKnown,
  });
  const trends = payload?.story_trends ?? [];
  const devRows = payload?.cadence_assignee_breakdown ?? [];
  const inactiveDevRows = payload?.prev_only_assignees ?? [];
  const prevAssigneeIds = payload?.prev_cadence_assignee_ids ?? [];
  const prevAssigneeIdSet = new Set(prevAssigneeIds);
  const hasPrevCadence = prevAssigneeIds.length > 0;
  const cadenceStories = payload?.cadence_stories;
  const hasCadence = payload?.cadence_end != null;

  function onSprintChange(e) {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set("sprint_id", e.target.value);
    else next.delete("sprint_id");
    setSearchParams(next, { replace: true });
  }

  // Pick the trend row that matches the selected cadence (backend returns the
  // chosen cadence as cadence_end on the payload). Default to the last entry
  // if no match, and use the row before for delta comparison.
  const currentIdx = (() => {
    if (!hasCadence || trends.length === 0) return -1;
    const target = payload.cadence_end;
    const idx = trends.findIndex((r) => r.cadence_end === target);
    return idx >= 0 ? idx : trends.length - 1;
  })();
  const currentRow = currentIdx >= 0 ? trends[currentIdx] : null;
  const prevRow = currentIdx > 0 ? trends[currentIdx - 1] : null;

  const storyPoints = currentRow?.story_points ?? null;
  const prevStoryPoints = prevRow?.story_points ?? null;
  const activeResources = currentRow?.active_resources ?? null;
  const prevActiveResources = prevRow?.active_resources ?? null;
  const ptsPerResource = safeRate(storyPoints, activeResources);
  const prevPtsPerResource = safeRate(prevStoryPoints, prevActiveResources);
  const hoursPerPoint = currentRow?.hours_per_point ?? null;
  const prevHoursPerPoint = prevRow?.hours_per_point ?? null;

  const prevSub = prevRow
    ? cadenceLabel(prevRow.cadence_start, prevRow.cadence_end)
    : undefined;

  const pointsDelta = computeDelta({
    curr: storyPoints,
    prev: prevStoryPoints,
    higherIsBetter: true,
    fmtPrev: prevStoryPoints != null ? fmt(prevStoryPoints) : undefined,
    prevSub: prevRow ? `${prevSub} · ${fmt(prevStoryPoints)} pts` : prevSub,
  });

  const devsDelta = computeDelta({
    curr: activeResources,
    prev: prevActiveResources,
    higherIsBetter: true,
    fmtPrev: prevActiveResources != null ? String(prevActiveResources) : undefined,
    prevSub,
  });

  const pprDelta = computeDelta({
    curr: ptsPerResource,
    prev: prevPtsPerResource,
    higherIsBetter: true,
    fmtPrev: prevPtsPerResource != null ? fmt(prevPtsPerResource, 1) : undefined,
    prevSub,
  });

  const hppDelta = computeDelta({
    curr: hoursPerPoint,
    prev: prevHoursPerPoint,
    higherIsBetter: false,
    fmtPrev: prevHoursPerPoint != null ? `${prevHoursPerPoint.toFixed(1)}h` : undefined,
    prevSub: prevRow
      ? `${prevSub} · ${prevRow.hour_logged_count} stories w/ hours`
      : prevSub,
  });

  const activeDevRows = devRows
    .filter((r) => r.issue_count > 0)
    .sort((a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0));
  const sortedInactiveDevs = [...inactiveDevRows].sort(
    (a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0),
  );
  const reactiveCount = hasPrevCadence
    ? activeDevRows.filter((r) => r.assignee_id != null && !prevAssigneeIdSet.has(r.assignee_id)).length
    : 0;
  const teamName = team?.name ?? `Team #${teamId}`;
  const currentLabel = hasCadence
    ? cadenceLabel(payload.cadence_start, payload.cadence_end)
    : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Capacity, velocity, and points-per-resource breakdown.
            {hasCadence && (
              <> Sprint <span className="font-medium text-ink-2">{currentLabel}</span>.</>
            )}
          </p>
        </div>
        {sprints?.length > 0 && (
          <select
            value={sprintId ?? ""}
            onChange={onSprintChange}
            className="rounded border border-border bg-bg-sunken px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">Latest closed</option>
            {sprints.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name ?? "Unnamed"} ({s.jira_sprint_id})
              </option>
            ))}
          </select>
        )}
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !hasCadence ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-sunken py-16 text-center text-[13px] text-ink-3">
          No closed sprint found for this team.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-4 gap-4">
            <KpiHero
              label="Story Points Delivered"
              value={storyPoints != null ? fmt(storyPoints) : "—"}
              sub={currentRow?.story_count > 0 ? `${currentRow.story_count} stories` : "no stories"}
              tone="accent"
              delta={pointsDelta}
            />
            <KpiHero
              label="Active Resources"
              value={activeResources ?? "—"}
              sub={activeResources != null ? "devs with ≥1 story" : undefined}
              tone="info"
              delta={devsDelta}
            />
            <KpiHero
              label="Points per Resource"
              value={ptsPerResource != null ? fmt(ptsPerResource, 1) : "—"}
              sub={
                storyPoints != null && activeResources
                  ? `${fmt(storyPoints)} pts / ${activeResources} devs`
                  : undefined
              }
              tone="ok"
              delta={pprDelta}
            />
            <KpiHero
              label="Hours per Point"
              value={hoursPerPoint != null ? `${hoursPerPoint.toFixed(1)}h` : "—"}
              sub={
                currentRow?.hour_logged_count > 0
                  ? `${currentRow.hour_logged_count} stories with hours`
                  : "no time data"
              }
              tone="warn"
              delta={hppDelta}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Resource trends — last 12 sprints</CardTitle>
              <span className="text-[12.5px] text-ink-3">Closed sprints only</span>
            </CardHeader>
            <CardBody pad="lg">
              <ResourceTrendsChart data={trends} />
            </CardBody>
          </Card>

          {(activeDevRows.length > 0 || sortedInactiveDevs.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle>Resource breakdown — {currentLabel}</CardTitle>
                <span className="text-[12.5px] text-ink-3">
                  {activeDevRows.length} active
                  {reactiveCount > 0 && ` · ${reactiveCount} reactive`}
                  {sortedInactiveDevs.length > 0 && ` · ${sortedInactiveDevs.length} inactive`}
                </span>
              </CardHeader>
              <CardBody pad="none">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 text-left">Developer</th>
                      <th className="px-4 py-2 text-right">Stories</th>
                      <th className="px-4 py-2 text-right">Points</th>
                      <th className="px-4 py-2 text-right">Avg Pts / Story</th>
                      <th className="px-4 py-2 text-right">Avg Hours / Story</th>
                      <th className="px-4 py-2 text-left">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeDevRows.map((r) => {
                      const isReactive =
                        hasPrevCadence && r.assignee_id != null && !prevAssigneeIdSet.has(r.assignee_id);
                      return (
                        <tr
                          key={`a-${r.assignee_id ?? r.assignee_name}`}
                          className="border-t border-border hover:bg-bg-sunken/50"
                        >
                          <td className="px-4 py-3 text-[13px] font-medium text-ink">
                            {r.assignee_name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.issue_count}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.total_story_points != null ? fmt(r.total_story_points, 1) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.avg_story_points != null ? fmt(r.avg_story_points, 1) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.avg_spent_hours != null ? `${fmt(r.avg_spent_hours, 1)}h` : "—"}
                          </td>
                          <td className="px-4 py-3">
                            {isReactive && <Pill tone="ok">Reactive</Pill>}
                          </td>
                        </tr>
                      );
                    })}
                    {sortedInactiveDevs.map((r) => (
                      <tr
                        key={`i-${r.assignee_id ?? r.assignee_name}`}
                        className="border-t border-border bg-bg-sunken/30 hover:bg-bg-sunken/60"
                      >
                        <td className="px-4 py-3 text-[13px] font-medium text-ink-3">
                          {r.assignee_name ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-4">
                          {r.issue_count}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-4">
                          {r.total_story_points != null ? fmt(r.total_story_points, 1) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-4">
                          {r.avg_story_points != null ? fmt(r.avg_story_points, 1) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-4">
                          {r.avg_spent_hours != null ? `${fmt(r.avg_spent_hours, 1)}h` : "—"}
                        </td>
                        <td className="px-4 py-3">
                          <Pill tone="warn">Inactive</Pill>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Stories delivered — {currentLabel}</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                {cadenceStories ? `${cadenceStories.total} stories` : ""}
              </span>
            </CardHeader>
            <CardBody pad="none">
              <StoriesTable
                items={cadenceStories?.items ?? []}
                isLoading={!cadenceStories}
                showTeamFilter={false}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
