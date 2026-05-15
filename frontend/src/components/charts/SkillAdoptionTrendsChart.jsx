import { useEffect, useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatWeekLabel(weekStart) {
  const [year, month, day] = weekStart.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function safeRate(num, den) {
  if (!den || den <= 0) return null;
  return num / den;
}

const SERIES_STORY = "Stories with Skill %";
const SERIES_DEV = "Devs using Skill %";

function useCssColors() {
  const [colors, setColors] = useState(null);
  useEffect(() => {
    setColors({
      accent: cssVar("--accent"),
      ok: cssVar("--ok"),
    });
  }, []);
  return colors;
}

export function SkillAdoptionTrendsChart({ data = [], height = 280 }) {
  const [hoveredSeries, setHoveredSeries] = useState(null);
  const legendColors = useCssColors();

  const option = useMemo(() => {
    if (!data.length) return null;

    const labels = data.map((r) => formatWeekLabel(r.week_start));
    const storyRates = data.map((r) => {
      const v = safeRate(r.skill_count, r.story_count);
      return v == null ? null : +(v * 100).toFixed(1);
    });
    const devRates = data.map((r) => {
      const v = safeRate(r.skill_adopters, r.active_delivered_devs);
      return v == null ? null : +(v * 100).toFixed(1);
    });

    const colors = {
      accent: cssVar("--accent"),
      ok: cssVar("--ok"),
      ink: cssVar("--ink"),
      ink3: cssVar("--ink-3"),
      border: cssVar("--border"),
    };

    const axisBase = {
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.ink3, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    };

    const dim = 0.15;
    const storyOpacity = hoveredSeries == null || hoveredSeries === SERIES_STORY ? 1 : dim;
    const devOpacity = hoveredSeries == null || hoveredSeries === SERIES_DEV ? 1 : dim;
    const storyWidth = hoveredSeries === SERIES_STORY ? 3 : 2;
    const devWidth = hoveredSeries === SERIES_DEV ? 3 : 2;

    return {
      backgroundColor: "transparent",
      color: [colors.accent, colors.ok],
      grid: { top: 12, right: 24, bottom: 36, left: 48, containLabel: false },
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        backgroundColor: cssVar("--bg-elev") || "#fff",
        borderColor: colors.border,
        borderWidth: 1,
        textStyle: { color: colors.ink, fontSize: 12 },
        formatter(params) {
          const idx = params[0]?.dataIndex ?? 0;
          const row = data[idx];
          if (!row) return "";
          const lines = [
            `<div style="font-weight:600;margin-bottom:4px">Week of ${formatWeekLabel(row.week_start)}</div>`,
          ];
          for (const p of params) {
            if (p.value == null) continue;
            const detail =
              p.seriesName === SERIES_STORY
                ? ` (${row.skill_count}/${row.story_count})`
                : ` (${row.skill_adopters}/${row.active_delivered_devs})`;
            lines.push(
              `<div style="display:flex;gap:8px;justify-content:space-between">` +
                `<span>${p.marker}${p.seriesName}</span>` +
                `<span style="font-weight:600">${p.value.toFixed(1)}%${detail}</span></div>`,
            );
          }
          return lines.join("");
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        ...axisBase,
        splitLine: { show: false },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: {
          color: colors.ink3,
          fontSize: 11,
          formatter(v) {
            return `${v}%`;
          },
        },
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { lineStyle: { color: colors.border } },
        splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
      },
      series: [
        {
          name: SERIES_STORY,
          type: "line",
          data: storyRates,
          smooth: 0.3,
          connectNulls: false,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: storyWidth, opacity: storyOpacity },
          itemStyle: { opacity: storyOpacity },
          areaStyle: { opacity: 0.08 * storyOpacity },
        },
        {
          name: SERIES_DEV,
          type: "line",
          data: devRates,
          smooth: 0.3,
          connectNulls: false,
          symbol: "circle",
          symbolSize: 6,
          lineStyle: { width: devWidth, type: "dashed", opacity: devOpacity },
          itemStyle: { opacity: devOpacity },
        },
      ],
    };
  }, [data, hoveredSeries]);

  const legendItems = [
    { name: SERIES_STORY, color: legendColors?.accent, dashed: false },
    { name: SERIES_DEV, color: legendColors?.ok, dashed: true },
  ];

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

  return (
    <div>
      <div className="mb-2 flex items-center gap-4">
        {legendItems.map(({ name, color, dashed }) => {
          const dimmed = hoveredSeries != null && hoveredSeries !== name;
          return (
            <div
              key={name}
              className="flex cursor-default items-center gap-1.5 select-none"
              style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 0.15s" }}
              onMouseEnter={() => setHoveredSeries(name)}
              onMouseLeave={() => setHoveredSeries(null)}
            >
              <svg width="18" height="8" style={{ flexShrink: 0 }}>
                <line
                  x1="0" y1="4" x2="18" y2="4"
                  stroke={color || "currentColor"}
                  strokeWidth="2"
                  strokeDasharray={dashed ? "4 3" : undefined}
                />
              </svg>
              <span className="text-[12px] text-ink-3">{name}</span>
            </div>
          );
        })}
      </div>
      <ReactECharts
        option={option}
        style={{ height, width: "100%" }}
      />
    </div>
  );
}
