import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsAiAdoption, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { cadenceLabel } from "../../lib/cadence";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { SkillAdoptionTrendsChart } from "../../components/charts/SkillAdoptionTrendsChart";
import { DevSkillAdoptionChart } from "../../components/charts/DevSkillAdoptionChart";
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
  const trends = payload?.story_trends ?? [];
  const cadenceStories = payload?.cadence_stories;
  const devRows = payload?.cadence_assignee_breakdown ?? [];
  const hasCadence = payload?.cadence_end != null;

  function onSprintChange(e) {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set("sprint_id", e.target.value);
    else next.delete("sprint_id");
    setSearchParams(next, { replace: true });
  }

  const currentIdx = (() => {
    if (!hasCadence || trends.length === 0) return -1;
    const target = payload.cadence_end;
    const idx = trends.findIndex((r) => r.cadence_end === target);
    return idx >= 0 ? idx : trends.length - 1;
  })();
  const currentRow = currentIdx >= 0 ? trends[currentIdx] : null;
  const prevRow = currentIdx > 0 ? trends[currentIdx - 1] : null;

  const storyRate = currentRow ? safeRate(currentRow.skill_count, currentRow.story_count) : null;
  const prevStoryRate = prevRow ? safeRate(prevRow.skill_count, prevRow.story_count) : null;

  const devRate = currentRow
    ? safeRate(currentRow.skill_adopters, currentRow.active_delivered_devs)
    : null;
  const prevDevRate = prevRow
    ? safeRate(prevRow.skill_adopters, prevRow.active_delivered_devs)
    : null;

  const prevSub = prevRow ? cadenceLabel(prevRow.cadence_start, prevRow.cadence_end) : undefined;

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

  const teamName = team?.name ?? `Team #${teamId}`;
  const currentLabel = hasCadence ? cadenceLabel(payload.cadence_start, payload.cadence_end) : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Skill adoption across delivered Stories and the engineers shipping them.
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
          <section className="grid grid-cols-2 gap-4">
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
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Skill adoption — last 12 sprints</CardTitle>
              <span className="text-[12.5px] text-ink-3">Closed sprints only</span>
            </CardHeader>
            <CardBody pad="lg">
              <SkillAdoptionTrendsChart data={trends} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Skill usage by developer — {currentLabel}</CardTitle>
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
