import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsResource, getTeams } from "../../lib/api";
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

export function Resource() {
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const featuredIds = teams
    ? teams.filter((t) => isFeaturedTeam(t.name)).map((t) => t.id)
    : undefined;
  const teamIdsReady = featuredIds !== undefined;

  const { data: payload, isLoading } = useQuery({
    queryKey: ["analytics", "resource", featuredIds],
    queryFn: () => getAnalyticsResource({ team_ids: featuredIds }),
    enabled: teamIdsReady,
  });
  const trends = payload?.story_trends ?? [];
  const teamRows = payload?.cadence_team_breakdown ?? [];
  const devRows = payload?.cadence_assignee_breakdown ?? [];
  const inactiveDevRows = payload?.prev_only_assignees ?? [];
  const prevAssigneeIds = payload?.prev_cadence_assignee_ids ?? [];
  const prevAssigneeIdSet = new Set(prevAssigneeIds);
  // Only flag "Reactive" when we actually have prev-cadence data to compare
  // against — otherwise every current dev would falsely look new.
  const hasPrevCadence = prevAssigneeIds.length > 0;
  const cadenceStories = payload?.cadence_stories;
  const hasCadence = payload?.cadence_end != null;

  const currentRow = trends.length > 0 ? trends[trends.length - 1] : null;
  const prevRow = trends.length > 1 ? trends[trends.length - 2] : null;

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

  const activeTeamRows = (teamRows || []).filter((r) => r.issue_count > 0);
  const activeDevRows = devRows
    .filter((r) => r.issue_count > 0)
    .sort((a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0));
  const sortedInactiveDevs = [...inactiveDevRows].sort(
    (a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0),
  );
  const reactiveCount = hasPrevCadence
    ? activeDevRows.filter((r) => r.assignee_id != null && !prevAssigneeIdSet.has(r.assignee_id)).length
    : 0;

  const currentLabel = hasCadence
    ? cadenceLabel(payload.cadence_start, payload.cadence_end)
    : "";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">Resource</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Capacity, velocity, and points-per-resource breakdown across teams.
          {hasCadence && (
            <> Sprint cadence <span className="font-medium text-ink-2">{currentLabel}</span>.</>
          )}
        </p>
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !hasCadence ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-sunken py-16 text-center text-[13px] text-ink-3">
          No synchronized sprint cadence has closed yet.
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
              <CardTitle>Resource trends — last 12 cadences</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Synchronized FS / BFX / HR sprints only
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <ResourceTrendsChart data={trends} />
            </CardBody>
          </Card>

          {activeTeamRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Team breakdown — {currentLabel}</CardTitle>
                <span className="text-[12.5px] text-ink-3">Sprint stories only</span>
              </CardHeader>
              <CardBody pad="none">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 text-left">Team</th>
                      <th className="px-4 py-2 text-right">Stories</th>
                      <th className="px-4 py-2 text-right">Points</th>
                      <th className="px-4 py-2 text-right">Active Devs</th>
                      <th className="px-4 py-2 text-right">Pts / Dev</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTeamRows.map((r) => {
                      const ppr = safeRate(r.total_story_points, r.active_devs);
                      return (
                        <tr
                          key={r.team_id}
                          className="border-t border-border hover:bg-bg-sunken/50"
                        >
                          <td className="px-4 py-3 text-[13px] font-medium text-ink">
                            {r.team_name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.issue_count}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {fmt(r.total_story_points)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.active_devs}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {ppr != null ? fmt(ppr, 1) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

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
                      <th className="px-4 py-2 text-left">Team</th>
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
                          <td className="px-4 py-3 text-[12.5px] text-ink-3">
                            {r.team_name ?? "—"}
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
                        <td className="px-4 py-3 text-[12.5px] text-ink-4">
                          {r.team_name ?? "—"}
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
                showTeamFilter
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
