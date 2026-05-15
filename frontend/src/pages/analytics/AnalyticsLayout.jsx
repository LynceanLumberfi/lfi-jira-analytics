import { Outlet } from "react-router-dom";

export function AnalyticsLayout() {
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

      <Outlet />
    </div>
  );
}
