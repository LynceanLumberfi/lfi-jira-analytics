import { NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Plug,
  History,
  AlertTriangle,
  ClipboardCheck,
  Settings,
  Search,
  LayoutDashboard,
} from "lucide-react";
import { LumberLogo } from "../ui/Logos";
import { Avatar } from "../ui/Avatar";
import { cn } from "../../lib/cn";
import { getStagingIssues } from "../../lib/api";

const analyticsNav = [
  { to: "/analytics", label: "Analytics", icon: LayoutDashboard },
];

function SectionLabel({ children }) {
  return (
    <div className="px-2.5 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-4">
      {children}
    </div>
  );
}

function NavItem({ to, label, icon: Icon, end, badge }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] font-medium",
          isActive
            ? "bg-accent-soft text-accent"
            : "text-ink-2 hover:bg-bg-sunken",
        )
      }
    >
      <Icon size={15} />
      <span className="flex-1">{label}</span>
      {badge > 0 && (
        <span className="rounded-full bg-warn px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
          {badge}
        </span>
      )}
    </NavLink>
  );
}

export function Sidebar() {
  const { data: stagingData } = useQuery({
    queryKey: ["staging-pending-count"],
    queryFn: () => getStagingIssues({ status: "pending", limit: 1, offset: 0 }),
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
  const pendingCount = stagingData?.pending ?? 0;

  return (
    <aside className="flex h-full w-[240px] flex-col border-r border-border bg-bg-elev">
      {/* brand */}
      <div className="flex items-center gap-2.5 px-5 py-4">
        <LumberLogo size={28} />
        <div className="flex flex-col leading-tight">
          <span className="text-[14px] font-semibold text-ink">Lumber</span>
          <span className="text-[10.5px] uppercase tracking-[0.08em] text-ink-4">
            prod · analytics
          </span>
        </div>
      </div>

      {/* search */}
      <div className="px-5 pb-3">
        <div className="flex items-center gap-2 rounded border border-border bg-bg-sunken px-2.5 py-1.5 text-[12.5px] text-ink-3">
          <Search size={14} />
          <span>Search…</span>
          <span className="ml-auto rounded bg-bg-elev px-1.5 py-0.5 text-[10px] text-ink-4">
            ⌘K
          </span>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 px-3 py-1">
        <SectionLabel>Workspace</SectionLabel>
        {analyticsNav.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}

        <div className="my-3 border-t border-border" />

        <SectionLabel>Admin</SectionLabel>
        <NavItem to="/integrations" label="Integrations" icon={Plug} end />
        <NavItem to="/integrations/staging" label="Sync Review" icon={ClipboardCheck} badge={pendingCount} />
        <NavItem to="/integrations/history" label="Sync history" icon={History} />
        <NavItem to="/integrations/failed" label="Failed records" icon={AlertTriangle} />

        <div className="my-3 border-t border-border" />
        <SectionLabel>Coming soon</SectionLabel>
        <div
          className="flex items-center gap-2.5 rounded px-2.5 py-2 text-[13px] font-medium text-ink-4"
          title="Later phase"
        >
          <Settings size={15} />
          <span>Settings</span>
        </div>
      </nav>

      {/* user */}
      <div className="flex items-center gap-2.5 border-t border-border px-5 py-3">
        <Avatar name="Lumber Admin" size={28} />
        <div className="flex flex-col leading-tight">
          <span className="text-[13px] font-semibold text-ink">
            Lumber Admin
          </span>
          <span className="text-[11px] text-ink-3">Admin · Lumber</span>
        </div>
      </div>
    </aside>
  );
}
