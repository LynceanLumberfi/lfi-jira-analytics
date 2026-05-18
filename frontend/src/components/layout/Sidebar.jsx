import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Plug,
  History,
  AlertTriangle,
  ClipboardCheck,
  Settings,
  Search,
  LayoutDashboard,
  Bot,
  Users,
  Star,
  ChevronDown,
  FlaskConical,
  Upload,
} from "lucide-react";
import { LumberLogo } from "../ui/Logos";
import { Avatar } from "../ui/Avatar";
import { cn } from "../../lib/cn";
import { getStagingIssues } from "../../lib/api";

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

function SubNavItem({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 rounded py-1.5 pl-8 pr-2.5 text-[12.5px] font-medium",
          isActive
            ? "text-accent"
            : "text-ink-3 hover:bg-bg-sunken hover:text-ink-2",
        )
      }
    >
      <Icon size={13} />
      <span>{label}</span>
    </NavLink>
  );
}

function TestAutomationGroup() {
  const { pathname } = useLocation();
  const isUnder = pathname.startsWith("/workspace/test-automation");
  const [open, setOpen] = useState(isUnder);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-[13px] font-medium",
          isUnder ? "text-ink" : "text-ink-2 hover:bg-bg-sunken",
        )}
      >
        <FlaskConical size={15} />
        <span className="flex-1 text-left">Test Automation</span>
        <ChevronDown
          size={13}
          className={cn("text-ink-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-0.5">
          <SubNavItem to="/workspace/test-automation/coverage" label="Coverage" icon={Star} />
          <SubNavItem to="/workspace/test-automation/execution" label="Execution" icon={Bot} />
        </div>
      )}
    </div>
  );
}

function AnalyticsGroup() {
  const { pathname } = useLocation();
  const isUnderAnalytics = pathname.startsWith("/analytics");
  const [open, setOpen] = useState(isUnderAnalytics);

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex w-full items-center gap-2.5 rounded px-2.5 py-2 text-[13px] font-medium",
          isUnderAnalytics ? "text-ink" : "text-ink-2 hover:bg-bg-sunken",
        )}
      >
        <LayoutDashboard size={15} />
        <span className="flex-1 text-left">Analytics</span>
        <ChevronDown
          size={13}
          className={cn("text-ink-3 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div className="mt-0.5">
          <SubNavItem to="/analytics/ai-adoption" label="AI Adoption" icon={Bot} />
          <SubNavItem to="/analytics/resource" label="Resource" icon={Users} />
          <SubNavItem to="/analytics/quality" label="Quality" icon={Star} />
        </div>
      )}
    </div>
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
        <AnalyticsGroup />
        <TestAutomationGroup />

        <div className="my-3 border-t border-border" />

        <SectionLabel>Admin</SectionLabel>
        <NavItem to="/integrations" label="Integrations" icon={Plug} end />
        <NavItem to="/integrations/staging" label="Sync Review" icon={ClipboardCheck} badge={pendingCount} />
        <NavItem to="/integrations/history" label="Sync history" icon={History} />
        <NavItem to="/integrations/failed" label="Failed records" icon={AlertTriangle} />
        <NavItem to="/admin/test-coverage" label="Test Coverage" icon={Upload} />

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
