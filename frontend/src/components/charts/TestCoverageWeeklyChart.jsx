import ReactECharts from "echarts-for-react";

function fmtWeek(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function TestCoverageWeeklyChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-[200px] items-center justify-center text-[13px] text-ink-3">
        No trend data available
      </div>
    );
  }

  const weeks = data.map((d) => fmtWeek(d.week_start));
  const pcts = data.map((d) => d.pct);

  const option = {
    grid: { top: 16, right: 16, bottom: 32, left: 48 },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const p = params[0];
        const row = data[p.dataIndex];
        return `<b>${p.name}</b><br/>Coverage: <b>${p.value}%</b><br/>${row.covered.toLocaleString()} / ${row.total.toLocaleString()} tests`;
      },
    },
    xAxis: {
      type: "category",
      data: weeks,
      axisLabel: { fontSize: 11, color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#e2e8f0" } },
      axisTick: { show: false },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      interval: 25,
      axisLabel: { formatter: "{value}%", fontSize: 11, color: "#94a3b8" },
      splitLine: { lineStyle: { color: "#f1f5f9" } },
    },
    series: [
      {
        type: "line",
        data: pcts,
        smooth: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, color: "#6366f1" },
        itemStyle: { color: "#6366f1" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(99,102,241,0.18)" },
              { offset: 1, color: "rgba(99,102,241,0)" },
            ],
          },
        },
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 220 }}
      opts={{ renderer: "svg" }}
      notMerge
    />
  );
}
