import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsOverview, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { IssueTypeTrendsChart } from "../../components/charts/IssueTypeTrendsChart";
import { StoryTrendsChart } from "../../components/charts/StoryTrendsChart";
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


export function TeamPage() {
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

  if (Number.isNaN(numTeamId)) return <Navigate to="/analytics" replace />;
  if (isKnown && (!team || !isFeaturedTeam(team.name))) {
    return <Navigate to="/analytics" replace />;
  }

  const { data: payload, isLoading: oLoading } = useQuery({
    queryKey: ["analytics", "overview", numTeamId, sprintId],
    queryFn: () => getAnalyticsOverview({ team_id: numTeamId, sprint_id: sprintId ?? undefined }),
    enabled: isKnown,
  });
  const trends = payload?.story_trends;
  const issueTypes = payload?.issue_type_trends;

  function onSprintChange(e) {
    const next = new URLSearchParams(searchParams);
    if (e.target.value) next.set("sprint_id", e.target.value);
    else next.delete("sprint_id");
    setSearchParams(next, { replace: true });
  }

  const currentWeek = currentIsoWeekMonday();
  const activeWeeks = trends ? [...trends].reverse().filter((w) => w.week_start < currentWeek) : [];
  const lastActiveWeek = activeWeeks[0] ?? null;
  const prevActiveWeek = activeWeeks[1] ?? null;

  const spSpark    = (trends || []).map((w) => w.story_points ?? 0);
  const skillSpark = (trends || []).map((w) => w.skill_adoption_rate != null ? w.skill_adoption_rate * 100 : 0);
  const pprSpark   = (trends || []).map((w) => w.points_per_active_resource ?? 0);
  const hppSpark   = (trends || []).map((w) => w.hours_per_point ?? 0);

  const noData = !oLoading && !lastActiveWeek;

  const prevSub = prevActiveWeek
    ? `${weekLabel(prevActiveWeek.week_start)} · ${prevActiveWeek.story_count} stories`
    : undefined;

  const spDelta = computeDelta({
    curr: lastActiveWeek?.story_points,
    prev: prevActiveWeek?.story_points,
    higherIsBetter: true,
    fmtPrev: prevActiveWeek ? `${Math.round(prevActiveWeek.story_points)} pts` : undefined,
    prevSub,
  });

  const skillDelta = computeDelta({
    curr: lastActiveWeek?.skill_adoption_rate,
    prev: prevActiveWeek?.skill_adoption_rate,
    higherIsBetter: true,
    fmtPrev: prevActiveWeek?.skill_adoption_rate != null ? pct(prevActiveWeek.skill_adoption_rate) : undefined,
    prevSub,
  });

  const pprDelta = computeDelta({
    curr: lastActiveWeek?.points_per_active_resource,
    prev: prevActiveWeek?.points_per_active_resource,
    higherIsBetter: true,
    fmtPrev: prevActiveWeek?.points_per_active_resource != null
      ? `${prevActiveWeek.points_per_active_resource.toFixed(1)} pts`
      : undefined,
    prevSub,
  });

  const hppDelta = computeDelta({
    curr: lastActiveWeek?.hours_per_point,
    prev: prevActiveWeek?.hours_per_point,
    higherIsBetter: false,
    fmtPrev: prevActiveWeek?.hours_per_point != null
      ? `${prevActiveWeek.hours_per_point.toFixed(1)} h`
      : undefined,
    prevSub,
  });

  const teamName = team?.name ?? `Team #${teamId}`;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          {lastActiveWeek && (
            <p className="mt-1 text-[13px] text-ink-3">
              Sprint week <span className="font-medium text-ink-2">{weekLabel(lastActiveWeek.week_start)}</span>.
            </p>
          )}
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

      {/* KPIs — last completed Story week */}
      <section className="grid grid-cols-4 gap-4">
        <KpiHero
          label="Story Points"
          value={lastActiveWeek ? `${Math.round(lastActiveWeek.story_points)} pts` : "—"}
          sub={
            noData ? "no completed stories yet" :
            lastActiveWeek ? `${lastActiveWeek.story_count} stories · ${weekLabel(lastActiveWeek.week_start)}` : ""
          }
          tone="accent"
          spark={spSpark}
          sparkTone="accent"
          delta={spDelta}
        />
        <KpiHero
          label="Skill Adoption"
          value={lastActiveWeek?.skill_adoption_rate != null ? pct(lastActiveWeek.skill_adoption_rate) : "—"}
          sub={
            lastActiveWeek?.scored_count
              ? `${lastActiveWeek.scored_count} stories scored`
              : noData ? "no scored stories yet" : ""
          }
          tone="ok"
          spark={skillSpark}
          sparkTone="ok"
          delta={skillDelta}
        />
        <KpiHero
          label="Pts / Resource"
          value={lastActiveWeek?.points_per_active_resource != null ? `${lastActiveWeek.points_per_active_resource.toFixed(1)} pts` : "—"}
          sub={
            lastActiveWeek?.active_resources
              ? `${lastActiveWeek.active_resources} active dev${lastActiveWeek.active_resources !== 1 ? "s" : ""}`
              : noData ? "no data yet" : ""
          }
          tone="info"
          spark={pprSpark}
          sparkTone="info"
          delta={pprDelta}
        />
        <KpiHero
          label="Hours / Story Point"
          value={lastActiveWeek?.hours_per_point != null ? `${lastActiveWeek.hours_per_point.toFixed(1)} h` : "—"}
          sub={
            lastActiveWeek?.hour_logged_count
              ? `${lastActiveWeek.hour_logged_count} stories w/ time logged`
              : noData ? "no time tracking data" : ""
          }
          tone="warn"
          spark={hppSpark}
          sparkTone="warn"
          delta={hppDelta}
        />
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Story trends — last 12 weeks</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            Throughput, efficiency, and AI-skill coverage for completed Stories
          </span>
        </CardHeader>
        <CardBody pad="lg">
          {oLoading ? (
            <LoadingRow />
          ) : (
            <StoryTrendsChart data={trends || []} />
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Completed by type — last 12 weeks</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            Stories · Bugs · Tasks shipped per week
          </span>
        </CardHeader>
        <CardBody pad="lg">
          {oLoading ? (
            <LoadingRow />
          ) : (
            <IssueTypeTrendsChart data={issueTypes || []} />
          )}
        </CardBody>
      </Card>
    </div>
  );
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-3">
      <Loader2 size={14} className="animate-spin" /> Loading…
    </div>
  );
}
