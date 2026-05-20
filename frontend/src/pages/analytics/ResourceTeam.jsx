import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsResource, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { ResourceTrendsChart } from "../../components/charts/ResourceTrendsChart";
import { KpiHero, computeDelta } from "../../components/ui/KpiHero";
import { StoriesTable } from "../../components/ui/StoriesTable";

function fmt(v, dp = 0) {
  if (v == null) return "—";
  return dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
}

function weekLabel(weekStart) {
  if (!weekStart) return "";
  const [y, m, d] = weekStart.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const end = new Date(y, m - 1, d + 6);
  const fmt = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

function currentIsoWeekMonday() {
  const dt = new Date();
  const day = dt.getDay() || 7;
  dt.setDate(dt.getDate() - day + 1);
  dt.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
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
  const trends = payload?.story_trends;
  const devRows = payload?.week_assignee_breakdown ?? [];
  const weekStories = payload?.week_stories;

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;

  function onSprintChange(e) {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set("sprint_id", e.target.value);
    else next.delete("sprint_id");
    setSearchParams(next, { replace: true });
  }

  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  const storyPoints = lastWeek?.story_points ?? null;
  const prevStoryPoints = prevWeek?.story_points ?? null;
  const activeResources = lastWeek?.active_resources ?? null;
  const prevActiveResources = prevWeek?.active_resources ?? null;
  const ptsPerResource = safeRate(storyPoints, activeResources);
  const prevPtsPerResource = safeRate(prevWeek?.story_points ?? null, prevWeek?.active_resources ?? null);
  const hoursPerPoint = lastWeek?.hours_per_point ?? null;
  const prevHoursPerPoint = prevWeek?.hours_per_point ?? null;

  const prevSub = prevWeek ? weekLabel(prevWeek.week_start) : undefined;

  const pointsDelta = computeDelta({
    curr: storyPoints,
    prev: prevStoryPoints,
    higherIsBetter: true,
    fmtPrev: prevStoryPoints != null ? fmt(prevStoryPoints) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${fmt(prevStoryPoints)} pts` : prevSub,
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
    prevSub: prevWeek
      ? `${prevSub} · ${prevWeek.hour_logged_count} stories w/ hours`
      : prevSub,
  });

  const activeDevRows = devRows
    .filter((r) => r.issue_count > 0)
    .sort((a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0));
  const teamName = team?.name ?? `Team #${teamId}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Capacity, velocity, and points-per-resource breakdown.
            {lastWeek && (
              <> Sprint week <span className="font-medium text-ink-2">{weekLabel(lastWeek.week_start)}</span>.</>
            )}
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
      </header>

      {isLoading ? (
        <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : !lastWeek ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-sunken py-16 text-center text-[13px] text-ink-3">
          No completed Stories in the last 12 weeks.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-4 gap-4">
            <KpiHero
              label="Story Points Delivered"
              value={storyPoints != null ? fmt(storyPoints) : "—"}
              sub={lastWeek.story_count > 0 ? `${lastWeek.story_count} stories` : "no stories"}
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
                lastWeek.hour_logged_count > 0
                  ? `${lastWeek.hour_logged_count} stories with hours`
                  : "no time data"
              }
              tone="warn"
              delta={hppDelta}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Resource trends — last 12 weeks</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Completed weeks only · in-progress week excluded
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <ResourceTrendsChart data={completedTrends} />
            </CardBody>
          </Card>

          {activeDevRows.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resource breakdown — {weekLabel(lastWeek.week_start)}</CardTitle>
                <span className="text-[12.5px] text-ink-3">Sprint stories only</span>
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
                    </tr>
                  </thead>
                  <tbody>
                    {activeDevRows.map((r) => (
                      <tr
                        key={r.assignee_id ?? r.assignee_name}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Stories delivered — {weekLabel(lastWeek.week_start)}</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                {weekStories ? `${weekStories.total} stories` : ""}
              </span>
            </CardHeader>
            <CardBody pad="none">
              <StoriesTable
                items={weekStories?.items ?? []}
                isLoading={!weekStories}
                showTeamFilter={false}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
