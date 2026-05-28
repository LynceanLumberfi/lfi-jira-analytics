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

export function ExecutionFilterBar({ kind, days, onChange }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-bg-elev px-4 py-3 shadow-sm">
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
    </div>
  );
}
