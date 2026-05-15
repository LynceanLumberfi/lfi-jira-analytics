import { useMemo } from "react";
import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function DevSkillAdoptionChart({ data = [], height = 240 }) {
  const option = useMemo(() => {
    if (!data.length) return null;

    const sorted = [...data].sort((a, b) => {
      const ra = a.issue_count > 0 ? a.skill_count / a.issue_count : 0;
      const rb = b.issue_count > 0 ? b.skill_count / b.issue_count : 0;
      return rb - ra;
    });

    const colors = {
      ok: cssVar("--ok"),
      accent: cssVar("--accent"),
      ink: cssVar("--ink"),
      ink3: cssVar("--ink-3"),
      ink4: cssVar("--ink-4"),
      border: cssVar("--border"),
      bgElev: cssVar("--bg-elev"),
    };

    const names = sorted.map((r) => r.assignee_name || "Unknown");
    const rates = sorted.map((r) =>
      r.issue_count > 0 ? +(r.skill_count / r.issue_count * 100).toFixed(1) : 0
    );
    const barColors = rates.map((v) => (v >= 50 ? colors.ok : colors.accent));

    return {
      backgroundColor: "transparent",
      grid: { top: 8, right: 48, bottom: 8, left: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "none" },
        backgroundColor: colors.bgElev,
        borderColor: colors.border,
        borderWidth: 1,
        textStyle: { color: colors.ink, fontSize: 12 },
        formatter(params) {
          const idx = params[0]?.dataIndex ?? 0;
          const row = sorted[idx];
          const rate = rates[idx];
          return (
            `<div style="font-weight:600;margin-bottom:4px">${row.assignee_name || "Unknown"}</div>` +
            `<div>${row.skill_count} of ${row.issue_count} stories · <strong>${rate.toFixed(1)}%</strong></div>`
          );
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLabel: { color: colors.ink3, fontSize: 11, formatter: (v) => `${v}%` },
        axisLine: { lineStyle: { color: colors.border } },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
      },
      yAxis: {
        type: "category",
        data: names,
        axisLabel: { color: colors.ink, fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: "bar",
          data: rates.map((v, i) => ({ value: v, itemStyle: { color: barColors[i] } })),
          barMaxWidth: 24,
          label: {
            show: true,
            position: "right",
            formatter: (p) => `${p.value.toFixed(1)}%`,
            color: colors.ink3,
            fontSize: 11,
          },
        },
      ],
    };
  }, [data]);

  if (!option) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[13px] text-ink-3"
        style={{ height }}
      >
        No developer data
      </div>
    );
  }

  const chartHeight = Math.max(height, data.length * 36 + 32);

  return (
    <ReactECharts
      option={option}
      style={{ height: chartHeight, width: "100%" }}
    />
  );
}
