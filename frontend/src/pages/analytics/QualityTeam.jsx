import { useMemo } from "react";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { getAnalyticsQuality, getSprints, getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { cadenceLabel } from "../../lib/cadence";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { QualityTrendsChart } from "../../components/charts/QualityTrendsChart";
import { KpiHero, DeltaArrow, computeDelta } from "../../components/ui/KpiHero";

function pct(v) {
  if (v == null) return "—";
  return `${Math.round(v * 100)}%`;
}

function BugsSplitCard({ customerRate, qaRate, customerBugs, qaBugs, customerDelta, qaDelta }) {
  const customerTone =
    customerRate == null ? "default" : customerRate >= 0.05 ? "err" : "ok";
  const qaTone = qaRate == null ? "default" : qaRate >= 0.2 ? "warn" : "default";
  const valueClass = (tone) =>
    tone === "err" ? "text-err"
    : tone === "warn" ? "text-warn"
    : tone === "ok" ? "text-ok"
    : "text-ink";
  return (
    <div className="relative overflow-hidden rounded-lg border border-border bg-bg-elev shadow-sm transition-shadow hover:shadow-md">
      <div className="absolute inset-x-0 top-0 h-1 bg-err" />
      <div className="p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">Bugs</p>
        <div className="mt-2 flex gap-4">
          <div className="flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-4">Customer</p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <p className={`text-[22px] font-bold leading-tight ${valueClass(customerTone)}`}>{pct(customerRate)}</p>
              {customerDelta && <DeltaArrow {...customerDelta} />}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3">{customerBugs ?? 0} bug{customerBugs === 1 ? "" : "s"}</p>
          </div>
          <div className="flex-1 border-l border-border pl-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.05em] text-ink-4">QA</p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <p className={`text-[22px] font-bold leading-tight ${valueClass(qaTone)}`}>{pct(qaRate)}</p>
              {qaDelta && <DeltaArrow {...qaDelta} />}
            </div>
            <p className="mt-0.5 text-[11px] text-ink-3">{qaBugs ?? 0} bug{qaBugs === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function safeRate(num, den) {
  if (!den || den <= 0) return null;
  return num / den;
}

export function QualityTeam() {
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
    return <Navigate to="/analytics/quality" replace />;
  }

  const { data: payload, isLoading } = useQuery({
    queryKey: ["analytics", "quality", numTeamId, sprintId],
    queryFn: () => getAnalyticsQuality({ team_id: numTeamId, sprint_id: sprintId ?? undefined }),
    enabled: isKnown,
  });
  const trends = payload?.issue_type_trends ?? [];
  const storyDevRows = payload?.cadence_assignee_breakdown?.story;
  const bugDevRows = payload?.cadence_assignee_breakdown?.bug;
  const taskDevRows = payload?.cadence_assignee_breakdown?.task;
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

  const devData = useMemo(() => {
    if (!storyDevRows || !bugDevRows || !taskDevRows) return null;
    const map = {};
    const merge = (rows, type) => {
      for (const r of rows) {
        const key = r.assignee_id ?? `name:${r.assignee_name}`;
        if (!map[key]) {
          map[key] = {
            assignee_id: r.assignee_id,
            assignee_name: r.assignee_name,
            stories: 0,
            bugs: 0,
            tasks: 0,
          };
        }
        map[key][type] = r.issue_count;
      }
    };
    merge(storyDevRows, "stories");
    merge(bugDevRows, "bugs");
    merge(taskDevRows, "tasks");
    return Object.values(map)
      .map((r) => ({ ...r, total: r.stories + r.bugs + r.tasks }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.stories - a.stories);
  }, [storyDevRows, bugDevRows, taskDevRows]);

  const storyMix     = safeRate(currentRow?.stories, currentRow?.total);
  const prevStoryMix = safeRate(prevRow?.stories, prevRow?.total);
  const customerRate = safeRate(currentRow?.customer_bugs, currentRow?.total);
  const qaRate       = safeRate(currentRow?.qa_bugs,       currentRow?.total);
  const prevCustomerRate = safeRate(prevRow?.customer_bugs, prevRow?.total);
  const prevQaRate       = safeRate(prevRow?.qa_bugs,       prevRow?.total);
  const taskRate     = safeRate(currentRow?.tasks,   currentRow?.total);
  const prevTaskRate = safeRate(prevRow?.tasks,   prevRow?.total);

  const prevSub = prevRow ? cadenceLabel(prevRow.cadence_start, prevRow.cadence_end) : undefined;

  const storyDelta = computeDelta({
    curr: storyMix, prev: prevStoryMix, higherIsBetter: true,
    fmtPrev: prevStoryMix != null ? pct(prevStoryMix) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.stories} stories` : prevSub,
  });
  const customerDelta = computeDelta({
    curr: customerRate, prev: prevCustomerRate, higherIsBetter: false,
    fmtPrev: prevCustomerRate != null ? pct(prevCustomerRate) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.customer_bugs} cust bugs` : prevSub,
  });
  const qaDelta = computeDelta({
    curr: qaRate, prev: prevQaRate, higherIsBetter: false,
    fmtPrev: prevQaRate != null ? pct(prevQaRate) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.qa_bugs} QA bugs` : prevSub,
  });
  const taskDelta = computeDelta({
    curr: taskRate, prev: prevTaskRate, higherIsBetter: false,
    fmtPrev: prevTaskRate != null ? pct(prevTaskRate) : undefined,
    prevSub: prevRow ? `${prevSub} · ${prevRow.tasks} tasks` : prevSub,
  });
  const totalDelta = computeDelta({
    curr: currentRow?.total ?? null, prev: prevRow?.total ?? null, higherIsBetter: true,
    fmtPrev: prevRow?.total != null ? String(prevRow.total) : undefined,
    prevSub,
  });

  const teamName = team?.name ?? `Team #${teamId}`;
  const currentLabel = hasCadence ? cadenceLabel(payload.cadence_start, payload.cadence_end) : "";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">{teamName}</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            Stories vs Bugs vs Tasks mix across all delivered work.
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
          <section className="grid grid-cols-4 gap-4">
            <KpiHero
              label="Story Mix"
              value={pct(storyMix)}
              sub={`${currentRow.stories} of ${currentRow.total} issues`}
              tone="ok"
              delta={storyDelta}
            />
            <BugsSplitCard
              customerRate={customerRate}
              qaRate={qaRate}
              customerBugs={currentRow.customer_bugs}
              qaBugs={currentRow.qa_bugs}
              customerDelta={customerDelta}
              qaDelta={qaDelta}
            />
            <KpiHero
              label="Task Rate"
              value={pct(taskRate)}
              sub={`${currentRow.tasks} task${currentRow.tasks !== 1 ? "s" : ""}`}
              tone="warn"
              delta={taskDelta}
            />
            <KpiHero
              label="Total Delivered"
              value={currentRow.total}
              sub={`${currentRow.stories}S · ${currentRow.bugs}B · ${currentRow.tasks}T`}
              tone="accent"
              delta={totalDelta}
            />
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Delivery mix — last 12 sprints</CardTitle>
              <span className="text-[12.5px] text-ink-3">Closed sprints only</span>
            </CardHeader>
            <CardBody pad="lg">
              <QualityTrendsChart data={trends} />
            </CardBody>
          </Card>

          {devData && devData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resource breakdown — {currentLabel}</CardTitle>
                <span className="text-[12.5px] text-ink-3">
                  {devData.length} developer{devData.length === 1 ? "" : "s"}
                </span>
              </CardHeader>
              <CardBody pad="none">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-bg-sunken text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
                    <tr>
                      <th className="px-4 py-2 text-left">Developer</th>
                      <th className="px-4 py-2 text-right">Stories</th>
                      <th className="px-4 py-2 text-right">Bugs</th>
                      <th className="px-4 py-2 text-right">Tasks</th>
                      <th className="px-4 py-2 text-right">Total</th>
                      <th className="px-4 py-2 text-right">Story %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {devData.map((r) => {
                      const mix = safeRate(r.stories, r.total);
                      return (
                        <tr
                          key={`q-${r.assignee_id ?? r.assignee_name}`}
                          className="border-t border-border hover:bg-bg-sunken/50"
                        >
                          <td className="px-4 py-3 text-[13px] font-medium text-ink">
                            {r.assignee_name ?? "—"}
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
