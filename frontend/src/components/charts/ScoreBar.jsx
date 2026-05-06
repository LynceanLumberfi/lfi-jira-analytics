import { cn } from "../../lib/cn";

function scoreToColor(score) {
  // 0 (red) → 5 (green)
  if (score == null) return "var(--ink-5)";
  const clamped = Math.max(0, Math.min(5, score));
  // Interpolate hue between 27 (err) and 155 (ok)
  const hue = 27 + (clamped / 5) * (155 - 27);
  return `oklch(0.58 0.13 ${hue})`;
}

export function ScoreBar({ value, max = 5, width = 64, className, showValue = true }) {
  const pct = value == null ? 0 : Math.max(0, Math.min(1, value / max)) * 100;
  const color = scoreToColor(value);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        className="inline-block overflow-hidden rounded-full bg-bg-sunken"
        style={{ width, height: 6 }}
      >
        <span
          className="block h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      {showValue && (
        <span className="font-mono text-[12px] tabular-nums text-ink-2">
          {value == null ? "—" : value.toFixed(1)}
        </span>
      )}
    </span>
  );
}
