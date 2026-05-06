import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { TabStrip } from "../../components/ui/TabStrip";

export function AnalyticsLayout() {
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const visibleTeams = (teams || []).filter(
    (t) => (t.issue_count ?? 0) > 0 && isFeaturedTeam(t.name)
  );

  const tabs = [
    { to: "/analytics", label: "Overview", end: true },
    ...visibleTeams.map((t) => ({
      to: `/analytics/team/${t.id}`,
      label: t.name || `Team #${t.id}`,
      count: t.issue_count,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-ink">
          Analytics
        </h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Productivity, quality, and AI adoption signals from your Jira data.
        </p>
      </header>

      <TabStrip tabs={tabs} />

      <Outlet />
    </div>
  );
}
