import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsAiAdoption, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { SkillAdoptionTrendsChart } from "../../components/charts/SkillAdoptionTrendsChart";
import { StoriesTable } from "../../components/ui/StoriesTable";
import { KpiHero, computeDelta } from "../../components/ui/KpiHero";

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
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

export function AiAdoption() {
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
    queryKey: ["analytics", "ai-adoption", featuredIds],
    queryFn: () => getAnalyticsAiAdoption({ team_ids: featuredIds }),
    enabled: teamIdsReady,
  });
  const trends = payload?.story_trends;
  const teamRows = payload?.week_team_breakdown;
  const weekIssues = payload?.week_stories;

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;

  const storyRate = lastWeek ? safeRate(lastWeek.skill_count, lastWeek.story_count) : null;
  const prevStoryRate = prevWeek ? safeRate(prevWeek.skill_count, prevWeek.story_count) : null;

  const devRate = lastWeek
    ? safeRate(lastWeek.skill_adopters, lastWeek.active_delivered_devs)
    : null;
  const prevDevRate = prevWeek
    ? safeRate(prevWeek.skill_adopters, prevWeek.active_delivered_devs)
    : null;

  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  const prevSub = prevWeek
    ? weekLabel(prevWeek.week_start)
    : undefined;

  const storyDelta = computeDelta({
    curr: storyRate,
    prev: prevStoryRate,
    higherIsBetter: true,
    fmtPrev: prevStoryRate != null ? pct(prevStoryRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.skill_count}/${prevWeek.story_count} stories` : prevSub,
  });

  const devDelta = computeDelta({
    curr: devRate,
    prev: prevDevRate,
    higherIsBetter: true,
    fmtPrev: prevDevRate != null ? pct(prevDevRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.skill_adopters}/${prevWeek.active_delivered_devs} devs` : prevSub,
  });

  const topStoryTeam = teamRows?.length
    ? teamRows
        .filter((r) => r.issue_count > 0)
        .reduce((best, r) =>
          r.skill_count / r.issue_count > (best ? best.skill_count / best.issue_count : -1) ? r : best,
          null,
        )
    : null;

  const topDevTeam = teamRows?.length
    ? teamRows
        .filter((r) => r.active_devs > 0)
        .reduce((best, r) =>
          r.skill_adopters / r.active_devs > (best ? best.skill_adopters / best.active_devs : -1) ? r : best,
          null,
        )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">AI Adoption</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Skill adoption across delivered Stories and the engineers shipping them.
          {lastWeek && (
            <> Sprint week <span className="font-medium text-ink-2">{weekLabel(lastWeek.week_start)}</span>.</>
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
              label="Stories delivered with Skill"
              value={pct(storyRate)}
              sub={
                lastWeek.story_count > 0
                  ? `${lastWeek.skill_count} of ${lastWeek.story_count} stories`
                  : "no stories delivered"
              }
              tone="ok"
              delta={storyDelta}
            />
            <KpiHero
              label="Developers using Skill"
              value={pct(devRate)}
              sub={
                lastWeek.active_delivered_devs > 0
                  ? `${lastWeek.skill_adopters} of ${lastWeek.active_delivered_devs} active devs`
                  : "no active devs"
              }
              tone="info"
              delta={devDelta}
            />
            <KpiHero
              label="Top team · Stories with Skill"
              value={
                topStoryTeam?.team_id != null ? (
                  <Link
                    to={`/analytics/ai-adoption/team/${topStoryTeam.team_id}`}
                    className="hover:underline text-accent"
                  >
                    {topStoryTeam.team_name ?? "—"}
                  </Link>
                ) : "—"
              }
              sub={
                topStoryTeam
                  ? `${pct(topStoryTeam.skill_count / topStoryTeam.issue_count)} · ${topStoryTeam.skill_count}/${topStoryTeam.issue_count} stories`
                  : undefined
              }
              tone="accent"
            />
            <KpiHero
              label="Top team · Developers using Skill"
              value={
                topDevTeam?.team_id != null ? (
                  <Link
                    to={`/analytics/ai-adoption/team/${topDevTeam.team_id}`}
                    className="hover:underline text-accent"
                  >
                    {topDevTeam.team_name ?? "—"}
                  </Link>
                ) : "—"
              }
              sub={
                topDevTeam
                  ? `${pct(topDevTeam.skill_adopters / topDevTeam.active_devs)} · ${topDevTeam.skill_adopters}/${topDevTeam.active_devs} devs`
                  : undefined
              }
              tone="warn"
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Skill adoption — last 12 weeks</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Completed weeks only · in-progress week excluded
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <SkillAdoptionTrendsChart data={completedTrends} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Stories delivered — {weekLabel(lastWeek.week_start)}</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                {weekIssues ? `${weekIssues.total} stories` : ""}
              </span>
            </CardHeader>
            <CardBody pad="none">
              <StoriesTable
                items={weekIssues?.items ?? []}
                isLoading={!weekIssues}
                showTeamFilter
              />
            </CardBody>
          </Card>
        </>
      )}

    </div>
  );
}
