import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { getAnalyticsByTeam, getAnalyticsStoryTrends, getIssues, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { SkillAdoptionTrendsChart } from "../../components/charts/SkillAdoptionTrendsChart";
import { StoriesTable } from "../../components/ui/StoriesTable";

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

function nextMonday(weekStart) {
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 7);
  const pad = (n) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function weekEndSunday(weekStart) {
  // weekStart is a Monday (YYYY-MM-DD); returns its Sunday (start + 6 days).
  const [y, m, d] = weekStart.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 6);
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

function KpiHero({ label, value, sub, tone = "default", delta }) {
  const subTone =
    tone === "warn" ? "text-warn"
    : tone === "err" ? "text-err"
    : tone === "ok" ? "text-ok"
    : "text-ink-3";
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
          {sub && <p className={`mt-1 text-[12.5px] ${subTone}`}>{sub}</p>}
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

  const { data: trends, isLoading } = useQuery({
    queryKey: ["analytics", "story-trends", 12, featuredIds, "has_sprint"],
    queryFn: () => getAnalyticsStoryTrends({ last: 12, team_ids: featuredIds, has_sprint: true }),
    enabled: teamIdsReady,
  });

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;

  // Find every sprint whose end_date falls in lastWeek (Mon-Sun). All other
  // data on this page is keyed off this sprint_ids list — no resolved_at.
  const { data: weekSprints } = useQuery({
    queryKey: ["sprints", "week", lastWeek?.week_start],
    queryFn: () =>
      getSprints({
        end_from: lastWeek.week_start,
        end_to: weekEndSunday(lastWeek.week_start),
      }),
    enabled: !!lastWeek,
    staleTime: 5 * 60 * 1000,
  });
  const weekSprintIds = (weekSprints || []).map((s) => s.id);

  const { data: teamRows } = useQuery({
    queryKey: ["analytics", "by-team", "Story", featuredIds, weekSprintIds],
    queryFn: () =>
      getAnalyticsByTeam({
        issue_type: "Story",
        is_done: true,
        team_ids: featuredIds,
        sprint_ids: weekSprintIds,
        has_sprint: true,
      }),
    enabled: teamIdsReady && weekSprintIds.length > 0,
  });

  const { data: weekIssues } = useQuery({
    queryKey: ["issues", "week-stories", featuredIds, weekSprintIds],
    queryFn: () =>
      getIssues({
        issue_type: "Story",
        is_done: true,
        has_sprint: true,
        team_ids: featuredIds,
        sprint_ids: weekSprintIds,
        sort: "jira_key",
        order: "asc",
        limit: 200,
      }),
    enabled: teamIdsReady && weekSprintIds.length > 0,
  });

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
              tone={storyRate != null && storyRate >= 0.5 ? "ok" : "default"}
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
              tone={devRate != null && devRate >= 0.5 ? "ok" : "default"}
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
