import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatWeekLabel(weekStart) {
  const [year, month, day] = weekStart.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatWeekRange(weekStart) {
  const [year, month, day] = weekStart.split("-").map(Number);
  const start = new Date(year, month - 1, day);
  const end = new Date(year, month - 1, day + 6);
  const fmt = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

const SERIES_POINTS = "Story Points";
const SERIES_DEVS = "Active Devs";

function useLegendColors() {
  const [colors, setColors] = useState(null);
  useEffect(() => {
    setColors({
      accent: cssVar("--accent"),
      ok: cssVar("--ok"),
    });
  }, []);
  return colors;
}

export function ResourceTrendsChart({ data = [], height = 280 }) {
  const [hoveredSeries, setHoveredSeries] = useState(null);
  const legendColors = useLegendColors();

  const option = useMemo(() => {
    if (!data.length) return null;

    const colors = {
      accent: cssVar("--accent"),
      ok: cssVar("--ok"),
      ink: cssVar("--ink"),
      ink3: cssVar("--ink-3"),
      border: cssVar("--border"),
      bgElev: cssVar("--bg-elev"),
    };

    const labels = data.map((r) => formatWeekLabel(r.week_start));
    const points = data.map((r) => (r.story_points != null ? +r.story_points.toFixed(1) : null));
    const devs = data.map((r) => r.active_resources ?? null);

    const dim = 0.15;
    const pointsOpacity = hoveredSeries == null || hoveredSeries === SERIES_POINTS ? 1 : dim;
    const devsOpacity = hoveredSeries == null || hoveredSeries === SERIES_DEVS ? 1 : dim;

    const axisBase = {
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.ink3, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    };

    return {
      backgroundColor: "transparent",
      grid: { top: 12, right: 48, bottom: 36, left: 12, containLabel: true },
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: colors.bgElev || "#fff",
        borderColor: colors.border,
        borderWidth: 1,
        textStyle: { color: colors.ink, fontSize: 12 },
        formatter(params) {
          const idx = params[0]?.dataIndex ?? 0;
          const row = data[idx];
          if (!row) return "";
          const ppr =
            row.active_resources > 0
              ? (row.story_points / row.active_resources).toFixed(1)
              : "—";
          const pts = Math.round(row.story_points ?? 0);
          return (
            `<div style="font-weight:600;margin-bottom:4px">${formatWeekRange(row.week_start)}</div>` +
            `<div style="display:flex;gap:8px;justify-content:space-between">` +
              `<span>${params[0]?.marker}${SERIES_POINTS}</span>` +
              `<span style="font-weight:600">${pts} · ${row.story_count} stories</span></div>` +
            `<div style="display:flex;gap:8px;justify-content:space-between">` +
              `<span>${params[1]?.marker}${SERIES_DEVS}</span>` +
              `<span style="font-weight:600">${row.active_resources ?? "—"}</span></div>` +
            `<div style="display:flex;gap:8px;justify-content:space-between">` +
              `<span style="padding-left:14px">Pts / Dev</span>` +
              `<span style="font-weight:600">${ppr}</span></div>`
          );
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: true,
        ...axisBase,
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          ...axisBase,
        },
        {
          type: "value",
          min: 0,
          splitLine: { show: false },
          axisLine: { lineStyle: { color: colors.border } },
          axisTick: { lineStyle: { color: colors.border } },
          axisLabel: { color: colors.ink3, fontSize: 11 },
        },
      ],
      series: [
        {
          name: SERIES_POINTS,
          type: "bar",
          yAxisIndex: 0,
          data: points,
          barMaxWidth: 32,
          itemStyle: { color: colors.accent, opacity: pointsOpacity },
        },
        {
          name: SERIES_DEVS,
          type: "line",
          yAxisIndex: 1,
          data: devs,
          smooth: 0.3,
          connectNulls: false,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: 2, color: colors.ok, opacity: devsOpacity },
          itemStyle: { color: colors.ok, opacity: devsOpacity },
        },
      ],
    };
  }, [data, hoveredSeries]);

  if (!option) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[13px] text-ink-3"
        style={{ height }}
      >
        No completed weeks in this period
      </div>
    );
  }

  const legendItems = [
    { name: SERIES_POINTS, color: legendColors?.accent, bar: true },
    { name: SERIES_DEVS, color: legendColors?.ok, bar: false },
  ];

  return (
    <div>
      <div className="mb-2 flex items-center gap-4">
        {legendItems.map(({ name, color, bar }) => {
          const dimmed = hoveredSeries != null && hoveredSeries !== name;
          return (
            <div
              key={name}
              className="flex cursor-default select-none items-center gap-1.5"
              style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 0.15s" }}
              onMouseEnter={() => setHoveredSeries(name)}
              onMouseLeave={() => setHoveredSeries(null)}
            >
              {bar ? (
                <svg width="12" height="12" style={{ flexShrink: 0 }}>
                  <rect x="0" y="2" width="12" height="8" fill={color || "currentColor"} rx="1" />
                </svg>
              ) : (
                <svg width="18" height="8" style={{ flexShrink: 0 }}>
                  <line x1="0" y1="4" x2="18" y2="4" stroke={color || "currentColor"} strokeWidth="2" />
                  <circle cx="9" cy="4" r="3" fill={color || "currentColor"} />
                </svg>
              )}
              <span className="text-[12px] text-ink-3">{name}</span>
            </div>
          );
        })}
      </div>
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
        opts={{ renderer: "svg" }}
        notMerge
      />
    </div>
  );
}
