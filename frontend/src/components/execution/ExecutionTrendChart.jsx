import ReactECharts from "echarts-for-react";
import { useMemo } from "react";

const PALETTE = [
  "#6366f1", // indigo
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#0ea5e9", // sky
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#f97316", // orange
  "#ec4899", // pink
  "#22c55e", // green
];

function fmtDay(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function buildDateList(window) {
  if (!window) return [];
  const out = [];
  const start = new Date(window.date_from + "T00:00:00");
  for (let i = 0; i < window.days; i++) {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function ExecutionTrendChart({ data, loading }) {
  const option = useMemo(() => {
    if (!data || !data.series?.length) return null;
    const dates = buildDateList(data.window);
    const xLabels = dates.map(fmtDay);
    const series = data.series.map((s, idx) => {
      const byDate = {};
      s.points.forEach((p) => (byDate[p.date] = p.pass_rate));
      return {
        name: s.label,
        type: "line",
        data: dates.map((d) => (byDate[d] == null ? null : byDate[d])),
        smooth: true,
        connectNulls: true,
        symbol: "circle",
        symbolSize: 5,
        lineStyle: { width: 2, color: PALETTE[idx % PALETTE.length] },
        itemStyle: { color: PALETTE[idx % PALETTE.length] },
      };
    });
    return {
      grid: { top: 30, right: 16, bottom: 32, left: 48 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (v) => (v == null ? "—" : v.toFixed(1) + "%"),
      },
      legend: {
        top: 0,
        textStyle: { fontSize: 11, color: "#475569" },
        itemWidth: 12,
        itemHeight: 8,
      },
      xAxis: {
        type: "category",
        data: xLabels,
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
      series,
    };
  }, [data]);

  if (loading) {
    return <div className="text-[13px] text-ink-3">Loading trends…</div>;
  }
  if (!option) {
    return <div className="text-[13px] text-ink-3">No trend data.</div>;
  }
  return (
    <ReactECharts option={option} style={{ height: 260 }} opts={{ renderer: "svg" }} notMerge />
  );
}
