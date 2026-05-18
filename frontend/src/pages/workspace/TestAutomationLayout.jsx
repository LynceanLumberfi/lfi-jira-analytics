import { Outlet } from "react-router-dom";
import { TabStrip } from "../../components/ui/TabStrip";

const TABS = [
  { to: "/workspace/test-automation/coverage", label: "Coverage", end: true },
  { to: "/workspace/test-automation/execution", label: "Execution", end: true },
];

export function TestAutomationLayout() {
  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-ink">Test Automation</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Test coverage and execution statistics across all products.
        </p>
      </header>
      <TabStrip tabs={TABS} />
      <Outlet />
    </div>
  );
}
