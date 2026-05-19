import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2 } from "lucide-react";
import { getAnalyticsByTeam, getAnalyticsIssueTypeTrends, getTeams } from "../../lib/api";
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

function BugsSplitCard({ customerRate, qaRate, customerBugs, qaBugs, customerDelta, qaDelta }) {
  const customerTone =
    customerRate == null ? "default" : customerRate >= 0.05 ? "warn" : "ok";
  const qaTone = qaRate == null ? "default" : qaRate >= 0.2 ? "warn" : "default";
  const valueClass = (tone) =>
    tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-ink";
  return (
    <Card>
      <CardBody>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Bugs</p>
        <div className="mt-2 flex gap-4">
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-4">Customer</p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <p className={`text-[20px] font-semibold leading-tight ${valueClass(customerTone)}`}>{pct(customerRate)}</p>
              {customerDelta && (
                <DeltaArrow
                  direction={customerDelta.direction}
                  tone={customerDelta.tone}
                  prevValue={customerDelta.prevValue}
                  prevSub={customerDelta.prevSub}
                />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3">{customerBugs ?? 0} bug{customerBugs === 1 ? "" : "s"}</p>
          </div>
          <div className="flex-1 border-l border-border pl-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-4">QA</p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <p className={`text-[20px] font-semibold leading-tight ${valueClass(qaTone)}`}>{pct(qaRate)}</p>
              {qaDelta && (
                <DeltaArrow
                  direction={qaDelta.direction}
                  tone={qaDelta.tone}
                  prevValue={qaDelta.prevValue}
                  prevSub={qaDelta.prevSub}
                />
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3">{qaBugs ?? 0} bug{qaBugs === 1 ? "" : "s"}</p>
          </div>
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

export function Quality() {
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
    queryKey: ["analytics", "issue-type-trends", 12, featuredIds],
    queryFn: () => getAnalyticsIssueTypeTrends({ last: 12, team_ids: featuredIds }),
    enabled: teamIdsReady,
  });

  const currentWeek = currentIsoWeekMonday();
  const completedWeeks = trends
    ? [...trends].reverse().filter((w) => w.week_start < currentWeek)
    : [];
  const lastWeek = completedWeeks[0] ?? null;
  const prevWeek = completedWeeks[1] ?? null;
  const weekResolved = lastWeek ? nextMonday(lastWeek.week_start) : null;
  const completedTrends = (trends || []).filter((w) => w.week_start < currentWeek);

  // Three parallel queries for the team breakdown table
  const teamQueryBase = {
    team_ids: featuredIds,
    resolved_since: lastWeek?.week_start,
    resolved_until: weekResolved,
  };
  const { data: storyTeamRows } = useQuery({
    queryKey: ["analytics", "by-team", "Story", featuredIds, lastWeek?.week_start],
    queryFn: () => getAnalyticsByTeam({ issue_type: "Story", ...teamQueryBase }),
    enabled: teamIdsReady && !!lastWeek,
  });
  const { data: bugTeamRows } = useQuery({
    queryKey: ["analytics", "by-team", "Bug", featuredIds, lastWeek?.week_start],
    queryFn: () => getAnalyticsByTeam({ issue_type: "Bug", ...teamQueryBase }),
    enabled: teamIdsReady && !!lastWeek,
  });
  const { data: taskTeamRows } = useQuery({
    queryKey: ["analytics", "by-team", "Task", featuredIds, lastWeek?.week_start],
    queryFn: () => getAnalyticsByTeam({ issue_type: "Task", ...teamQueryBase }),
    enabled: teamIdsReady && !!lastWeek,
  });

  const teamData = useMemo(() => {
    if (!storyTeamRows || !bugTeamRows || !taskTeamRows) return null;
    const map = {};
    const merge = (rows, type) => {
      for (const r of rows) {
        if (!map[r.team_id]) {
          map[r.team_id] = { team_id: r.team_id, team_name: r.team_name, stories: 0, bugs: 0, tasks: 0 };
        }
        map[r.team_id][type] = r.issue_count;
      }
    };
    merge(storyTeamRows, "stories");
    merge(bugTeamRows, "bugs");
    merge(taskTeamRows, "tasks");
    return Object.values(map)
      .map((r) => ({ ...r, total: r.stories + r.bugs + r.tasks }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.stories - a.stories);
  }, [storyTeamRows, bugTeamRows, taskTeamRows]);

  // KPI computations
  const storyMix     = safeRate(lastWeek?.stories, lastWeek?.total);
  const prevStoryMix = safeRate(prevWeek?.stories, prevWeek?.total);
  const customerRate = safeRate(lastWeek?.customer_bugs, lastWeek?.total);
  const qaRate       = safeRate(lastWeek?.qa_bugs,       lastWeek?.total);
  const prevCustomerRate = safeRate(prevWeek?.customer_bugs, prevWeek?.total);
  const prevQaRate       = safeRate(prevWeek?.qa_bugs,       prevWeek?.total);
  const taskRate     = safeRate(lastWeek?.tasks,   lastWeek?.total);
  const prevTaskRate = safeRate(prevWeek?.tasks,   prevWeek?.total);

  const prevSub = prevWeek ? weekLabel(prevWeek.week_start) : undefined;

  const storyDelta = computeDelta({
    curr: storyMix, prev: prevStoryMix, higherIsBetter: true,
    fmtPrev: prevStoryMix != null ? pct(prevStoryMix) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.stories} stories` : prevSub,
  });
  const customerDelta = computeDelta({
    curr: customerRate, prev: prevCustomerRate, higherIsBetter: false,
    fmtPrev: prevCustomerRate != null ? pct(prevCustomerRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.customer_bugs} cust bugs` : prevSub,
  });
  const qaDelta = computeDelta({
    curr: qaRate, prev: prevQaRate, higherIsBetter: false,
    fmtPrev: prevQaRate != null ? pct(prevQaRate) : undefined,
    prevSub: prevWeek ? `${prevSub} · ${prevWeek.qa_bugs} QA bugs` : prevSub,
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

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h2 className="text-[18px] font-semibold text-ink">Quality</h2>
        <p className="mt-1 text-[13px] text-ink-3">
          Stories vs Bugs vs Tasks mix across all delivered work.
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
            <BugsSplitCard
              customerRate={customerRate}
              qaRate={qaRate}
              customerBugs={lastWeek.customer_bugs}
              qaBugs={lastWeek.qa_bugs}
              customerDelta={customerDelta}
              qaDelta={qaDelta}
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

          {teamData && teamData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Team breakdown — {weekLabel(lastWeek.week_start)}</CardTitle>
              </CardHeader>
              <CardBody pad="none">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 text-left">Team</th>
                      <th className="px-4 py-2 text-right">Stories</th>
                      <th className="px-4 py-2 text-right">Bugs</th>
                      <th className="px-4 py-2 text-right">Tasks</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Story %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {teamData.map((r) => {
                      const mix = safeRate(r.stories, r.total);
                      return (
                        <tr key={r.team_id} className="border-t border-border hover:bg-bg-sunken/50">
                          <td className="px-4 py-3 text-[13px] font-medium text-ink">
                            {r.team_name ?? "—"}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.stories}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px]">
                            {r.bugs > 0
                              ? <span className="font-medium text-err">{r.bugs}</span>
                              : <span className="text-ink-4">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.tasks > 0 ? r.tasks : <span className="text-ink-4">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px] text-ink-2">
                            {r.total}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-[12px]">
                            <span className={mix != null && mix >= 0.6 ? "font-semibold text-ok" : "text-ink-2"}>
                              {pct(mix)}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
