import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getTeams } from "../../lib/api";
import { isFeaturedTeam } from "../../lib/config";
import { TabStrip } from "../../components/ui/TabStrip";

export function QualityLayout() {
  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const visibleTeams = (teams || []).filter(
    (t) => (t.issue_count ?? 0) > 0 && isFeaturedTeam(t.name)
  );

  const tabs = [
    { to: "/analytics/quality", label: "Overview", end: true },
    ...visibleTeams.map((t) => ({
      to: `/analytics/quality/team/${t.id}`,
      label: t.name || `Team #${t.id}`,
      count: t.issue_count,
    })),
  ];

  return (
    <div className="flex flex-col gap-5">
      <TabStrip tabs={tabs} />
      <Outlet />
    </div>
  );
}
