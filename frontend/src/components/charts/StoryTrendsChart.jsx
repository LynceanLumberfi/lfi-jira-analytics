import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatWeekLabel(weekStart) {
  // weekStart is "YYYY-MM-DD" (ISO Monday)
  const [year, month, day] = weekStart.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function nullableData(rows, key, transform) {
  return rows.map((r) => (r[key] == null ? null : transform ? transform(r[key]) : r[key]));
}

export function StoryTrendsChart({ data = [], height = 280 }) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[13px] text-ink-3"
        style={{ height }}
      >
        No completed Stories in this period
      </div>
    );
  }

  const weeks = data.map((r) => r.week_start);
  const labels = weeks.map(formatWeekLabel);

  const colors = {
    accent: cssVar("--accent"),
    info: cssVar("--info"),
    ok: cssVar("--ok"),
    warn: cssVar("--warn"),
    ink3: cssVar("--ink-3"),
    ink4: cssVar("--ink-4"),
    border: cssVar("--border"),
    bgSunken: cssVar("--bg-sunken"),
  };

  const axisBase = {
    axisLine: { lineStyle: { color: colors.border } },
    axisTick: { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.ink3, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
  };

  const option = {
    backgroundColor: "transparent",
    color: [colors.accent, colors.info, colors.ok, colors.warn],
    grid: { top: 48, right: 60, bottom: 36, left: 56, containLabel: false },
    legend: {
      top: 4,
      left: 0,
      textStyle: { color: colors.ink3, fontSize: 12 },
      itemWidth: 14,
      itemHeight: 3,
      data: ["Story Points", "Pts / Resource", "Skill Adoption %", "Hours / Pt"],
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: cssVar("--bg-elev") || "#fff",
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: cssVar("--ink"), fontSize: 12 },
      formatter(params) {
        const idx = params[0]?.dataIndex ?? 0;
        const row = data[idx];
        if (!row) return "";
        const week = formatWeekLabel(row.week_start);
        const lines = [
          `<div style="font-weight:600;margin-bottom:4px">Week of ${week}</div>`,
        ];
        for (const p of params) {
          if (p.value == null) continue;
          const valStr =
            p.seriesName === "Skill Adoption %"
              ? `${(p.value * 100).toFixed(1)}%`
              : p.seriesName === "Hours / Pt"
                ? `${p.value.toFixed(1)} h`
                : p.seriesName === "Pts / Resource"
                  ? `${p.value.toFixed(1)} pts`
                  : `${p.value.toFixed(0)} pts`;
          lines.push(
            `<div style="display:flex;gap:8px;justify-content:space-between">` +
              `<span>${p.marker}${p.seriesName}</span>` +
              `<span style="font-weight:600">${valStr}</span></div>`,
          );
        }
        lines.push(
          `<div style="margin-top:4px;font-size:11px;opacity:0.6">` +
            `${row.story_count} stories · ${row.active_resources} active devs` +
            (row.hour_logged_count ? ` · ${row.hour_logged_count} w/ time logged` : "") +
            `</div>`,
        );
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
    yAxis: [
      {
        type: "value",
        name: "Points",
        nameTextStyle: { color: colors.ink4, fontSize: 11 },
        position: "left",
        min: 0,
        ...axisBase,
      },
      {
        type: "value",
        name: "Rate / Hours",
        nameTextStyle: { color: colors.ink4, fontSize: 11 },
        position: "right",
        min: 0,
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { lineStyle: { color: colors.border } },
        axisLabel: {
          color: colors.ink3,
          fontSize: 11,
          formatter(v) {
            return v < 1 ? `${(v * 100).toFixed(0)}%` : v.toFixed(1);
          },
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: "Story Points",
        type: "line",
        yAxisIndex: 0,
        data: nullableData(data, "story_points"),
        smooth: 0.3,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.06 },
        emphasis: { scale: true },
      },
      {
        name: "Pts / Resource",
        type: "line",
        yAxisIndex: 0,
        data: nullableData(data, "points_per_active_resource"),
        smooth: 0.3,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2 },
        emphasis: { scale: true },
      },
      {
        name: "Skill Adoption %",
        type: "line",
        yAxisIndex: 1,
        data: nullableData(data, "skill_adoption_rate"),
        smooth: 0.3,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, type: "dashed" },
        emphasis: { scale: true },
      },
      {
        name: "Hours / Pt",
        type: "line",
        yAxisIndex: 1,
        data: nullableData(data, "hours_per_point"),
        smooth: 0.3,
        connectNulls: false,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, type: "dotted" },
        emphasis: { scale: true },
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height, width: "100%" }}
      notMerge
      lazyUpdate={false}
    />
  );
}
