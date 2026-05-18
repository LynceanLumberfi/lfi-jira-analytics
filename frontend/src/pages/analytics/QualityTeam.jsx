import { useParams, Navigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { getAnalyticsIssueTypeTrends, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { QualityTrendsChart } from "../../components/charts/QualityTrendsChart";

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function weekLabel(weekStart) {
  if (!weekStart) return "";
  const [y, m, d] = weekStart.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
    : tone === "err"  ? "text-err"
    : tone === "ok"   ? "text-ok"
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

export function QualityTeam() {
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
    return <Navigate to="/analytics/quality" replace />;
  }

  const teamIds = [numTeamId];

  const { data: trends, isLoading } = useQuery({
    queryKey: ["analytics", "issue-type-trends", 12, teamIds],
    queryFn: () => getAnalyticsIssueTypeTrends({ last: 12, team_ids: teamIds }),
    enabled: isKnown,
  });

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.total > 0 && w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;
  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  const storyMix     = safeRate(lastWeek?.stories, lastWeek?.total);
  const prevStoryMix = safeRate(prevWeek?.stories, prevWeek?.total);
  const bugRate      = safeRate(lastWeek?.bugs,    lastWeek?.total);
  const prevBugRate  = safeRate(prevWeek?.bugs,    prevWeek?.total);
  const taskRate     = safeRate(lastWeek?.tasks,   lastWeek?.total);
  const prevTaskRate = safeRate(prevWeek?.tasks,   prevWeek?.total);

  const prevSub = prevWeek ? `wk of ${weekLabel(prevWeek.week_start)}` : undefined;

  const storyDelta = computeDelta({
    curr: storyMix, prev: prevStoryMix, higherIsBetter: true,
    fmtPrev: prevStoryMix != null ? pct(prevStoryMix) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.stories} stories` : prevSub,
  });
  const bugDelta = computeDelta({
    curr: bugRate, prev: prevBugRate, higherIsBetter: false,
    fmtPrev: prevBugRate != null ? pct(prevBugRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.bugs} bugs` : prevSub,
  });
  const taskDelta = computeDelta({
    curr: taskRate, prev: prevTaskRate, higherIsBetter: false,
    fmtPrev: prevTaskRate != null ? pct(prevTaskRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.tasks} tasks` : prevSub,
  });
  const totalDelta = computeDelta({
    curr: lastWeek?.total ?? null, prev: prevWeek?.total ?? null, higherIsBetter: true,
    fmtPrev: prevWeek?.total != null ? String(prevWeek.total) : undefined,
    prevSub,
  });

  const teamName = team?.name ?? `Team #${teamId}`;

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Stories vs Bugs vs Tasks mix across all delivered work.
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
          No delivered issues in the last 12 weeks.
        </div>
      ) : (
        <>
          <section className="grid grid-cols-4 gap-4">
            <KpiHero
              label="Story Mix"
              value={pct(storyMix)}
              sub={`${lastWeek.stories} of ${lastWeek.total} issues`}
              tone={storyMix != null && storyMix >= 0.6 ? "ok" : "default"}
              delta={storyDelta}
            />
            <KpiHero
              label="Bug Rate"
              value={pct(bugRate)}
              sub={`${lastWeek.bugs} bug${lastWeek.bugs !== 1 ? "s" : ""}`}
              tone={bugRate != null ? (bugRate < 0.2 ? "ok" : "warn") : "default"}
              delta={bugDelta}
            />
            <KpiHero
              label="Task Rate"
              value={pct(taskRate)}
              sub={`${lastWeek.tasks} task${lastWeek.tasks !== 1 ? "s" : ""}`}
              delta={taskDelta}
            />
            <KpiHero
              label="Total Delivered"
              value={lastWeek.total}
              sub={`${lastWeek.stories}S · ${lastWeek.bugs}B · ${lastWeek.tasks}T`}
              delta={totalDelta}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Delivery mix — last 12 weeks</CardTitle>
              <span className="text-[12.5px] text-ink-3">
                Completed weeks only · in-progress week excluded
              </span>
            </CardHeader>
            <CardBody pad="lg">
              <QualityTrendsChart data={completedTrends} />
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
