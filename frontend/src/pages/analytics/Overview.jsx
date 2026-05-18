import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import {
  getAnalyticsIssueTypeTrends,
  getAnalyticsStoryTrends,
  getTeams,
} from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Sparkline } from "../../components/charts/Sparkline";
import { IssueTypeTrendsChart } from "../../components/charts/IssueTypeTrendsChart";
import { StoryTrendsChart } from "../../components/charts/StoryTrendsChart";

function DeltaArrow({ direction, tone, prevValue, prevSub }) {
  const colorClass =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-ink-4";
  const Icon = direction === "up" ? ArrowUp : ArrowDown;
  return (
    <div className="relative group">
      <Icon size={15} className={colorClass} strokeWidth={2.5} />
      {/* hover tooltip */}
      <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1.5 hidden
                      -translate-x-1/2 whitespace-nowrap rounded-md border border-border
                      bg-bg-elev px-3 py-2 shadow-md group-hover:block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-3 mb-1">
          Prev week
        </p>
        <p className="text-[13px] font-semibold text-ink">{prevValue}</p>
        {prevSub && (
          <p className="mt-0.5 text-[11px] text-ink-4">{prevSub}</p>
        )}
      </div>
    </div>
  );
}

function KpiHero({ label, value, sub, spark, sparkTone = "accent", tone = "default", delta }) {
  const subTone =
    tone === "warn"
      ? "text-warn"
      : tone === "err"
        ? "text-err"
        : tone === "ok"
          ? "text-ok"
          : "text-ink-3";
  return (
    <Card>
      <CardBody>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
              {label}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <p className="text-[26px] font-semibold leading-tight text-ink">
                {value}
              </p>
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
          {spark?.length > 0 && (
            <Sparkline data={spark} tone={sparkTone} width={110} height={36} />
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function weekLabel(weekStart) {
  if (!weekStart) return "";
  const [y, m, d] = weekStart.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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

  const { data: issueTypes, isLoading: itLoading } = useQuery({
    queryKey: ["analytics", "issue-type-trends", 12, featuredIds],
    queryFn: () => getAnalyticsIssueTypeTrends({ last: 12, team_ids: featuredIds }),
    enabled: teamIdsReady,
  });
  const { data: trends, isLoading: tLoading } = useQuery({
    queryKey: ["analytics", "story-trends", 12, featuredIds],
    queryFn: () => getAnalyticsStoryTrends({ last: 12, team_ids: featuredIds }),
    enabled: teamIdsReady,
  });
  // Last and second-to-last ISO weeks that had ≥1 completed Story
  const activeWeeks = trends ? [...trends].reverse().filter((w) => w.story_count > 0) : [];
  const lastActiveWeek = activeWeeks[0] ?? null;
  const prevActiveWeek = activeWeeks[1] ?? null;

  // Sparklines over the full 12-week window (null → 0 so the shape is continuous)
  const spSpark    = (trends || []).map((w) => w.story_points ?? 0);
  const skillSpark = (trends || []).map((w) => w.skill_adoption_rate != null ? w.skill_adoption_rate * 100 : 0);
  const pprSpark   = (trends || []).map((w) => w.points_per_active_resource ?? 0);
  const hppSpark   = (trends || []).map((w) => w.hours_per_point ?? 0);

  const noData = !tLoading && !lastActiveWeek;

  const prevSub = prevActiveWeek
    ? `wk of ${weekLabel(prevActiveWeek.week_start)} · ${prevActiveWeek.story_count} stories`
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
            lastActiveWeek ? `${lastActiveWeek.story_count} stories · wk of ${weekLabel(lastActiveWeek.week_start)}` : ""
          }
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
          tone={
            lastActiveWeek?.skill_adoption_rate != null && lastActiveWeek.skill_adoption_rate >= 0.5
              ? "ok"
              : "default"
          }
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

