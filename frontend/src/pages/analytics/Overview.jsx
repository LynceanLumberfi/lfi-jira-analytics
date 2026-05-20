import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsOverview, getTeams } from "../../lib/api";
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

export function Overview() {
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  // IDs of the 4 featured teams — undefined until teams load (queries wait via enabled)
  const featuredIds = teams
    ? teams.filter((t) => isFeaturedTeam(t.name)).map((t) => t.id)
    : undefined;
  const teamIdsReady = featuredIds !== undefined;

  const { data: overview, isLoading: oLoading } = useQuery({
    queryKey: ["analytics", "overview", featuredIds],
    queryFn: () => getAnalyticsOverview({ team_ids: featuredIds }),
    enabled: teamIdsReady,
  });
  const trends = overview?.story_trends;
  const issueTypes = overview?.issue_type_trends;
  const tLoading = oLoading;
  const itLoading = oLoading;
  // Last full week (week of last Sunday) and the one before
  const currentWeek = currentIsoWeekMonday();
  const activeWeeks = trends ? [...trends].reverse().filter((w) => w.week_start < currentWeek) : [];
  const lastActiveWeek = activeWeeks[0] ?? null;
  const prevActiveWeek = activeWeeks[1] ?? null;

  // Sparklines over the full 12-week window (null → 0 so the shape is continuous)
  const spSpark    = (trends || []).map((w) => w.story_points ?? 0);
  const skillSpark = (trends || []).map((w) => w.skill_adoption_rate != null ? w.skill_adoption_rate * 100 : 0);
  const pprSpark   = (trends || []).map((w) => w.points_per_active_resource ?? 0);
  const hppSpark   = (trends || []).map((w) => w.hours_per_point ?? 0);

  const noData = !tLoading && !lastActiveWeek;

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
    higherIsBetter: false,  // fewer hours per point = more efficient
    fmtPrev: prevActiveWeek?.hours_per_point != null
      ? `${prevActiveWeek.hours_per_point.toFixed(1)} h`
      : undefined,
    prevSub,
  });

  return (
    <div className="flex flex-col gap-6">
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
          spark={skillSpark}
          sparkTone="ok"
          tone="ok"
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

      {/* Story trends chart */}
      <Card>
        <CardHeader>
          <CardTitle>Story trends — last 12 weeks</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            Throughput, efficiency, and AI-skill coverage for completed Stories
          </span>
        </CardHeader>
        <CardBody pad="lg">
          {tLoading ? (
            <LoadingRow />
          ) : (
            <StoryTrendsChart data={trends || []} />
          )}
        </CardBody>
      </Card>

      {/* Issue type breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Completed by type — last 12 weeks</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            Stories · Bugs · Tasks shipped per week
          </span>
        </CardHeader>
        <CardBody pad="lg">
          {itLoading ? (
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

