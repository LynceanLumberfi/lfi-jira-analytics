import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsAiAdoption, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { SkillAdoptionTrendsChart } from "../../components/charts/SkillAdoptionTrendsChart";
import { DevSkillAdoptionChart } from "../../components/charts/DevSkillAdoptionChart";
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

export function AiAdoptionTeam() {
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
    return <Navigate to="/analytics/ai-adoption" replace />;
  }

  const { data: payload, isLoading } = useQuery({
    queryKey: ["analytics", "ai-adoption", numTeamId, sprintId],
    queryFn: () => getAnalyticsAiAdoption({ team_id: numTeamId, sprint_id: sprintId ?? undefined }),
    enabled: isKnown,
  });
  const trends = payload?.story_trends;
  const weekIssues = payload?.week_stories;
  const devRows = payload?.week_assignee_breakdown ?? [];

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

  const storyRate = lastWeek ? safeRate(lastWeek.skill_count, lastWeek.story_count) : null;
  const prevStoryRate = prevWeek ? safeRate(prevWeek.skill_count, prevWeek.story_count) : null;

  const devRate = lastWeek
    ? safeRate(lastWeek.skill_adopters, lastWeek.active_delivered_devs)
    : null;
  const prevDevRate = prevWeek
    ? safeRate(prevWeek.skill_adopters, prevWeek.active_delivered_devs)
    : null;

  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  const prevSub = prevWeek ? weekLabel(prevWeek.week_start) : undefined;

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

  const teamName = team?.name ?? `Team #${teamId}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Skill adoption across delivered Stories and the engineers shipping them.
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
          <section className="grid grid-cols-2 gap-4">
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
              <CardTitle>Skill usage by developer — {weekLabel(lastWeek.week_start)}</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Stories delivered with Skill ÷ stories delivered
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <DevSkillAdoptionChart data={devRows} />
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
                showTeamFilter={false}
              />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
