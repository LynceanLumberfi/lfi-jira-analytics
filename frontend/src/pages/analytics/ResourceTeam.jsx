import { useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { getAnalyticsByAssignee, getAnalyticsStoryTrends, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { ResourceTrendsChart } from "../../components/charts/ResourceTrendsChart";

function fmt(v, dp = 0) {
  if (v == null) return "—";
  return dp === 0 ? String(Math.round(v)) : v.toFixed(dp);
}

function weekLabel(weekStart) {
  if (!weekStart) return "";
  const [y, m, d] = weekStart.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nextMonday(weekStart) {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 7);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function currentIsoWeekMonday() {
  const dt = new Date();
  const day = dt.getDay() || 7;
  dt.setDate(dt.getDate() - day + 1);
  dt.setHours(0, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function DeltaArrow({ direction, tone, prevValue, prevSub }) {
  const colorClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink-4";
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <div className="relative group">
      <Icon size={15} className={colorClass} strokeWidth={2.5} />
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden
                      -translate-x-1/2 whitespace-nowrap rounded-md border border-border
                      bg-bg-elev px-3 py-2 shadow-md group-hover:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">
          Prev week
        </p>
        <p className="text-[13px] font-semibold text-ink">{prevValue}</p>
        {prevSub && <p className="mt-0.5 text-[11px] text-ink-4">{prevSub}</p>}
      </div>
    </div>
  );
}

function KpiHero({ label, value, sub, delta }) {
  return (
    <Card>
      <CardBody>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            {label}
          </p>
          <div className="mt-2 flex items-center gap-1.5">
            <p className="text-[26px] font-semibold leading-tight text-ink">{value}</p>
            {delta && (
              <DeltaArrow
                direction={delta.direction}
                tone={delta.tone}
                prevValue={delta.prevValue}
                prevSub={delta.prevSub}
              />
            )}
          </div>
          {sub && <p className="mt-1 text-[12.5px] text-ink-3">{sub}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

function computeDelta({ curr, prev, higherIsBetter = true, fmtPrev, prevSub }) {
  if (curr == null || prev == null) return null;
  const direction = curr > prev ? "up" : curr < prev ? "down" : null;
  if (!direction) return null;
  const isGood = higherIsBetter ? direction === "up" : direction === "down";
  return {
    direction,
    tone: isGood ? "ok" : "warn",
    prevValue: fmtPrev ?? String(prev),
    prevSub: prevSub ?? "",
  };
}

function safeRate(num, den) {
  if (!den || den <= 0) return null;
  return num / den;
}

export function ResourceTeam() {
  const { teamId } = useParams();
  const numTeamId = Number(teamId);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const team = teams?.find((t) => t.id === numTeamId);
  const isKnown = teams !== undefined;

  if (isKnown && (!team || !isFeaturedTeam(team.name))) {
    return <Navigate to="/analytics/resource" replace />;
  }

  const teamIds = [numTeamId];

  const { data: trends, isLoading } = useQuery({
    queryKey: ["analytics", "story-trends", 12, teamIds, "has_sprint"],
    queryFn: () => getAnalyticsStoryTrends({ last: 12, team_ids: teamIds, has_sprint: true }),
    enabled: isKnown,
  });

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.story_count > 0 && w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;
  const weekResolved = lastWeek ? nextMonday(lastWeek.week_start) : null;
  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  const { data: devRows } = useQuery({
    queryKey: ["analytics", "by-assignee", teamIds, lastWeek?.week_start, "has_sprint"],
    queryFn: () =>
      getAnalyticsByAssignee({
        issue_type: "Story",
        team_ids: teamIds,
        resolved_since: lastWeek.week_start,
        resolved_until: weekResolved,
        has_sprint: true,
      }),
    enabled: isKnown && !!lastWeek,
  });

  const storyPoints = lastWeek?.story_points ?? null;
  const prevStoryPoints = prevWeek?.story_points ?? null;
  const activeResources = lastWeek?.active_resources ?? null;
  const prevActiveResources = prevWeek?.active_resources ?? null;
  const ptsPerResource = safeRate(storyPoints, activeResources);
  const prevPtsPerResource = safeRate(prevWeek?.story_points ?? null, prevWeek?.active_resources ?? null);
  const hoursPerPoint = lastWeek?.hours_per_point ?? null;
  const prevHoursPerPoint = prevWeek?.hours_per_point ?? null;

  const prevSub = prevWeek ? `wk of ${weekLabel(prevWeek.week_start)}` : undefined;

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

  const teamName = team?.name ?? `Team #${teamId}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Capacity, velocity, and points-per-resource breakdown.
          {lastWeek && (
            <> Week of <span className="font-medium text-ink-2">{weekLabel(lastWeek.week_start)}</span>.</>
          )}
        </p>
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
              delta={pointsDelta}
            />
            <KpiHero
              label="Active Resources"
              value={activeResources ?? "—"}
              sub={activeResources != null ? "devs with ≥1 story" : undefined}
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

          <Card>
            <CardHeader>
              <CardTitle>Resources — week of {weekLabel(lastWeek.week_start)}</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                {devRows ? `${devRows.length} developers` : ""}
              </span>
            </CardHeader>
            <CardBody pad="none">
              {!devRows ? (
                <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-3">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : devRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-ink-4">
                  No developers found for this week.
                </div>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 text-left">Developer</th>
                      <th className="px-4 py-2 text-right">Stories</th>
                      <th className="px-4 py-2 text-right">Points</th>
                      <th className="px-4 py-2 text-right">Pts / Story</th>
                      <th className="px-4 py-2 text-right">Hrs / Story</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...devRows]
                      .sort((a, b) => (b.total_story_points ?? 0) - (a.total_story_points ?? 0))
                      .map((r) => (
                        <tr key={r.assignee_id} className="border-t border-border hover:bg-bg-sunken/50">
                          <td className="px-4 py-3 text-[13px] font-medium text-ink">
                            {r.assignee_name || <span className="text-ink-4">Unassigned</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.issue_count}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {fmt(r.total_story_points)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {fmt(r.avg_story_points, 1)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.avg_spent_hours != null && r.avg_spent_hours > 0
                              ? `${r.avg_spent_hours.toFixed(1)}h`
                              : <span className="text-ink-4">—</span>}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              )}
            </CardBody>
          </Card>

        </>
      )}
    </div>
  );
}
