import { cn } from "../../lib/cn";

const toneStroke = {
  accent: "var(--accent)",
  ok: "var(--ok)",
  warn: "var(--warn)",
  err: "var(--err)",
  info: "var(--info)",
};

export function Sparkline({
  data,
  width = 120,
  height = 32,
  tone = "accent",
  className,
}) {
  if (!data || data.length === 0) {
    return (
      <div
        className={cn("text-[11px] text-ink-4", className)}
        style={{ width, height }}
      >
        —
      </div>
    );
  }
  const values = data.map((d) => (typeof d === "number" ? d : (d?.value ?? 0)));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return [x, y];
  });
  const linePath = points
    .map(([x, y], i) => (i === 0 ? `M${x},${y}` : `L${x},${y}`))
    .join(" ");
  const areaPath = `${linePath} L${width},${height} L0,${height} Z`;
  const stroke = toneStroke[tone] || toneStroke.accent;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("inline-block", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={areaPath} fill={stroke} opacity="0.14" />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="1.5" />
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1][0]}
          cy={points[points.length - 1][1]}
          r={2}
          fill={stroke}
        />
      )}
    </svg>
  );
}
