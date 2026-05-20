import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsAiAdoption, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { cadenceLabel } from "../../lib/cadence";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { SkillAdoptionTrendsChart } from "../../components/charts/SkillAdoptionTrendsChart";
import { StoriesTable } from "../../components/ui/StoriesTable";
import { KpiHero, computeDelta } from "../../components/ui/KpiHero";

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
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
  const trends = payload?.story_trends ?? [];
  const teamRows = payload?.cadence_team_breakdown ?? [];
  const cadenceStories = payload?.cadence_stories;
  const hasCadence = payload?.cadence_end != null;

  const currentRow = trends.length > 0 ? trends[trends.length - 1] : null;
  const prevRow = trends.length > 1 ? trends[trends.length - 2] : null;

  const storyRate = currentRow ? safeRate(currentRow.skill_count, currentRow.story_count) : null;
  const prevStoryRate = prevRow ? safeRate(prevRow.skill_count, prevRow.story_count) : null;

  const devRate = currentRow
    ? safeRate(currentRow.skill_adopters, currentRow.active_delivered_devs)
    : null;
  const prevDevRate = prevRow
    ? safeRate(prevRow.skill_adopters, prevRow.active_delivered_devs)
    : null;

  const prevSub = prevRow
    ? cadenceLabel(prevRow.cadence_start, prevRow.cadence_end)
    : undefined;

  const storyDelta = computeDelta({
    curr: storyRate,
    prev: prevStoryRate,
    higherIsBetter: true,
    fmtPrev: prevStoryRate != null ? pct(prevStoryRate) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.skill_count}/${prevRow.story_count} stories` : prevSub,
  });

  const devDelta = computeDelta({
    curr: devRate,
    prev: prevDevRate,
    higherIsBetter: true,
    fmtPrev: prevDevRate != null ? pct(prevDevRate) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.skill_adopters}/${prevRow.active_delivered_devs} devs` : prevSub,
  });

  const topStoryTeam = teamRows.length
    ? teamRows
        .filter((r) => r.issue_count > 0)
        .reduce((best, r) =>
          r.skill_count / r.issue_count > (best ? best.skill_count / best.issue_count : -1) ? r : best,
          null,
        )
    : null;

  const topDevTeam = teamRows.length
    ? teamRows
        .filter((r) => r.active_devs > 0)
        .reduce((best, r) =>
          r.skill_adopters / r.active_devs > (best ? best.skill_adopters / best.active_devs : -1) ? r : best,
          null,
        )
    : null;

  const currentLabel = hasCadence
    ? cadenceLabel(payload.cadence_start, payload.cadence_end)
    : "";

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">AI Adoption</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Skill adoption across delivered Stories and the engineers shipping them.
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
              label="Stories delivered with Skill"
              value={pct(storyRate)}
              sub={
                currentRow?.story_count > 0
                  ? `${currentRow.skill_count} of ${currentRow.story_count} stories`
                  : "no stories delivered"
              }
              tone="ok"
              delta={storyDelta}
            />
            <KpiHero
              label="Developers using Skill"
              value={pct(devRate)}
              sub={
                currentRow?.active_delivered_devs > 0
                  ? `${currentRow.skill_adopters} of ${currentRow.active_delivered_devs} active devs`
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
              <CardTitle>Skill adoption — last 12 cadences</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Synchronized FS / BFX / HR sprints only
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <SkillAdoptionTrendsChart data={trends} />
            </CardBody>
          </Card>

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
