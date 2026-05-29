import { useQuery } from "@tanstack/react-query";
import { getExecutionModules } from "../../lib/api";
import { cn } from "../../lib/cn";

const KINDS = [
  { value: "all", label: "All" },
  { value: "playwright", label: "Playwright" },
  { value: "surefire", label: "Unit (Surefire)" },
];

const WINDOWS = [
  { value: 7, label: "7d" },
  { value: 10, label: "10d" },
  { value: 14, label: "14d" },
  { value: 30, label: "30d" },
];

export function ExecutionFilterBar({ kind, days, module, vendor, onChange }) {
  const { data: modulesData } = useQuery({
    queryKey: ["test-execution", "modules", days, kind],
    queryFn: () => getExecutionModules({ days, kind }),
    staleTime: 60_000,
  });
  const modules = modulesData?.modules ?? [];
  const vendors = modulesData?.vendors ?? [];

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-elev px-4 py-3 shadow-sm">
      {/* Kind */}
      <div className="flex items-center gap-1">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Kind
        </span>
        {KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            onClick={() => onChange({ kind: k.value })}
            className={cn(
              "rounded-md border px-3 py-1 text-[12.5px] font-medium transition-colors",
              kind === k.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-bg-elev text-ink-3 hover:border-border-strong hover:text-ink",
            )}
          >
            {k.label}
          </button>
        ))}
      </div>

      {/* Window */}
      <div className="flex items-center gap-1">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Window
        </span>
        {WINDOWS.map((w) => (
          <button
            key={w.value}
            type="button"
            onClick={() => onChange({ days: w.value })}
            className={cn(
              "rounded-md border px-3 py-1 text-[12.5px] font-medium transition-colors",
              Number(days) === w.value
                ? "border-accent bg-accent/10 text-accent"
                : "border-border bg-bg-elev text-ink-3 hover:border-border-strong hover:text-ink",
            )}
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Module */}
      <div className="flex items-center gap-1">
        <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Module
        </span>
        <select
          value={module || ""}
          onChange={(e) => onChange({ module: e.target.value || null, vendor: null })}
          className="rounded-md border border-border bg-bg-elev px-2 py-1 text-[12.5px] font-medium text-ink hover:border-border-strong"
        >
          <option value="">All modules</option>
          {modules.map((m) => (
            <option key={m.module} value={m.module}>
              {m.module} ({m.tests.toLocaleString()})
            </option>
          ))}
        </select>
      </div>

      {/* Vendor — only enabled when no module is selected OR Integrations is */}
      {(module === null || module === undefined || module === "" || module === "Integrations") && vendors.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
            Vendor
          </span>
          <select
            value={vendor || ""}
            onChange={(e) => onChange({ vendor: e.target.value || null })}
            className="rounded-md border border-border bg-bg-elev px-2 py-1 text-[12.5px] font-medium text-ink hover:border-border-strong"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v.module} value={v.module}>
                {v.module} ({v.tests.toLocaleString()})
              </option>
            ))}
          </select>
        </div>
      )}

      {(module || vendor) && (
        <button
          type="button"
          onClick={() => onChange({ module: null, vendor: null })}
          className="ml-auto text-[12px] font-medium text-ink-3 hover:text-ink"
        >
          Clear ×
        </button>
      )}
    </div>
  );
}
