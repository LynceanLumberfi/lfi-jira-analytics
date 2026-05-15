import { Outlet } from "react-router-dom";
import { TabStrip } from "../../components/ui/TabStrip";

const TABS = [
  { to: "/integrations/staging", label: "Sync Review", end: true },
  { to: "/integrations/all-records", label: "ALL Records", end: true },
];

export function AdminReviewLayout() {
  return (
    <div className="flex flex-col gap-5">
      <TabStrip tabs={TABS} />
      <Outlet />
    </div>
  );
}
