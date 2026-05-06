import { cn } from "../../lib/cn";

const toneFill = {
  accent: "bg-accent",
  ok: "bg-ok",
  warn: "bg-warn",
  err: "bg-err",
  info: "bg-info",
  muted: "bg-ink-5",
};

export function ProgressBar({
  value = 0,
  tone = "accent",
  shimmer = false,
  height = 6,
  className,
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-full bg-bg-sunken",
        className,
      )}
      style={{ height }}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          shimmer ? "shimmer-bg animate-shimmer" : toneFill[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
