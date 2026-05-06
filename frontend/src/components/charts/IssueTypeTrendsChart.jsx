import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function formatWeekLabel(weekStart) {
  const [year, month, day] = weekStart.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function IssueTypeTrendsChart({ data = [], height = 220 }) {
  if (!data.length) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[13px] text-ink-3"
        style={{ height }}
      >
        No completed issues in this period
      </div>
    );
  }

  const labels = data.map((r) => formatWeekLabel(r.week_start));

  const colors = {
    accent: cssVar("--accent"),
    err:    cssVar("--err"),
    info:   cssVar("--info"),
    ink3:   cssVar("--ink-3"),
    ink4:   cssVar("--ink-4"),
    border: cssVar("--border"),
  };

  const axisBase = {
    axisLine:  { lineStyle: { color: colors.border } },
    axisTick:  { lineStyle: { color: colors.border } },
    axisLabel: { color: colors.ink3, fontSize: 11 },
    splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
  };

  const option = {
    backgroundColor: "transparent",
    color: [colors.accent, colors.err, colors.info],
    grid: { top: 40, right: 16, bottom: 36, left: 40, containLabel: false },
    legend: {
      top: 4,
      left: 0,
      textStyle: { color: colors.ink3, fontSize: 12 },
      itemWidth: 10,
      itemHeight: 10,
      data: ["Stories", "Bugs", "Tasks"],
    },
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      backgroundColor: cssVar("--bg-elev") || "#fff",
      borderColor: colors.border,
      borderWidth: 1,
      textStyle: { color: cssVar("--ink"), fontSize: 12 },
      formatter(params) {
        const idx = params[0]?.dataIndex ?? 0;
        const row = data[idx];
        if (!row) return "";
        const lines = [
          `<div style="font-weight:600;margin-bottom:4px">Week of ${formatWeekLabel(row.week_start)}</div>`,
        ];
        for (const p of params) {
          lines.push(
            `<div style="display:flex;gap:8px;justify-content:space-between">` +
              `<span>${p.marker}${p.seriesName}</span>` +
              `<span style="font-weight:600">${p.value}</span></div>`,
          );
        }
        lines.push(
          `<div style="margin-top:4px;border-top:1px solid ${colors.border};padding-top:4px;` +
            `display:flex;gap:8px;justify-content:space-between">` +
            `<span style="opacity:0.6">Total</span>` +
            `<span style="font-weight:600">${row.total}</span></div>`,
        );
        return lines.join("");
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      ...axisBase,
      splitLine: { show: false },
    },
    yAxis: {
      type: "value",
      minInterval: 1,
      ...axisBase,
    },
    series: [
      {
        name: "Stories",
        type: "bar",
        stack: "total",
        data: data.map((r) => r.stories),
        barMaxWidth: 32,
        emphasis: { focus: "series" },
        itemStyle: { borderRadius: [0, 0, 0, 0] },
      },
      {
        name: "Bugs",
        type: "bar",
        stack: "total",
        data: data.map((r) => r.bugs),
        barMaxWidth: 32,
        emphasis: { focus: "series" },
      },
      {
        name: "Tasks",
        type: "bar",
        stack: "total",
        data: data.map((r) => r.tasks),
        barMaxWidth: 32,
        emphasis: { focus: "series" },
        itemStyle: { borderRadius: [3, 3, 0, 0] },
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
