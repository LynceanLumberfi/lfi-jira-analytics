import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";
import { cadenceLabel, cadenceTickLabel } from "../../lib/cadence";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SERIES_STORIES = "Stories";
const SERIES_CUSTOMER_BUGS = "Customer Bugs";
const SERIES_QA_BUGS = "QA Bugs";
const SERIES_TASKS = "Tasks";

const SERIES_COLORS = {
  [SERIES_STORIES]: "#86efac",
  [SERIES_CUSTOMER_BUGS]: "#b91c1c",
  [SERIES_QA_BUGS]: "#f59e0b",
  [SERIES_TASKS]: "#fef08a",
};

export function QualityTrendsChart({ data = [], height = 280 }) {
  const [hoveredSeries, setHoveredSeries] = useState(null);

  const option = useMemo(() => {
    if (!data.length) return null;

    const colors = {
      ink: cssVar("--ink"),
      ink3: cssVar("--ink-3"),
      ink4: cssVar("--ink-4"),
      border: cssVar("--border"),
      bgElev: cssVar("--bg-elev"),
    };

    const labels = data.map((r) => cadenceTickLabel(r.cadence_start, r.cadence_end));
    const stories = data.map((r) => r.stories ?? 0);
    const customerBugs = data.map((r) => r.customer_bugs ?? 0);
    const qaBugs = data.map((r) => r.qa_bugs ?? 0);
    const tasks = data.map((r) => r.tasks ?? 0);

    const dim = 0.15;
    const opacityFor = (name) =>
      hoveredSeries == null || hoveredSeries === name ? 1 : dim;

    const axisBase = {
      axisLine: { lineStyle: { color: colors.border } },
      axisTick: { lineStyle: { color: colors.border } },
      axisLabel: { color: colors.ink3, fontSize: 11 },
      splitLine: { lineStyle: { color: colors.border, type: "dashed" } },
    };

    return {
      backgroundColor: "transparent",
      grid: { top: 12, right: 24, bottom: 36, left: 12, containLabel: true },
      legend: { show: false },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow" },
        backgroundColor: colors.bgElev || "#fff",
        borderColor: colors.border,
        borderWidth: 1,
        textStyle: { color: colors.ink, fontSize: 12 },
        formatter(params) {
          const idx = params[0]?.dataIndex ?? 0;
          const row = data[idx];
          if (!row) return "";
          const total = row.total || 0;
          const pct = (v) => total > 0 ? `${Math.round((v / total) * 100)}%` : "0%";
          return (
            `<div style="font-weight:600;margin-bottom:4px">${cadenceLabel(row.cadence_start, row.cadence_end)}</div>` +
            params
              .map((p) =>
                `<div style="display:flex;gap:12px;justify-content:space-between">` +
                `<span>${p.marker}${p.seriesName}</span>` +
                `<span style="font-weight:600">${p.value} <span style="color:${colors.ink4}">(${pct(p.value)})</span></span>` +
                `</div>`
              )
              .join("") +
            `<div style="margin-top:4px;border-top:1px solid ${colors.border};padding-top:4px;` +
            `display:flex;gap:12px;justify-content:space-between">` +
            `<span>Total</span><span style="font-weight:600">${total}</span></div>`
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
      yAxis: {
        type: "value",
        min: 0,
        minInterval: 1,
        ...axisBase,
      },
      series: [
        {
          name: SERIES_STORIES,
          type: "bar",
          stack: "total",
          data: stories,
          barMaxWidth: 40,
          itemStyle: { color: SERIES_COLORS[SERIES_STORIES], opacity: opacityFor(SERIES_STORIES) },
        },
        {
          name: SERIES_CUSTOMER_BUGS,
          type: "bar",
          stack: "total",
          data: customerBugs,
          itemStyle: { color: SERIES_COLORS[SERIES_CUSTOMER_BUGS], opacity: opacityFor(SERIES_CUSTOMER_BUGS) },
        },
        {
          name: SERIES_QA_BUGS,
          type: "bar",
          stack: "total",
          data: qaBugs,
          itemStyle: { color: SERIES_COLORS[SERIES_QA_BUGS], opacity: opacityFor(SERIES_QA_BUGS) },
        },
        {
          name: SERIES_TASKS,
          type: "bar",
          stack: "total",
          data: tasks,
          itemStyle: { color: SERIES_COLORS[SERIES_TASKS], opacity: opacityFor(SERIES_TASKS) },
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
        No closed sprints in this period
      </div>
    );
  }

  const legendItems = [SERIES_STORIES, SERIES_CUSTOMER_BUGS, SERIES_QA_BUGS, SERIES_TASKS];

  return (
    <div>
      <div className="mb-2 flex items-center gap-4">
        {legendItems.map((name) => {
          const dimmed = hoveredSeries != null && hoveredSeries !== name;
          return (
            <div
              key={name}
              className="flex cursor-default select-none items-center gap-1.5"
              style={{ opacity: dimmed ? 0.3 : 1, transition: "opacity 0.15s" }}
              onMouseEnter={() => setHoveredSeries(name)}
              onMouseLeave={() => setHoveredSeries(null)}
            >
              <svg width="12" height="12" style={{ flexShrink: 0 }}>
                <rect x="0" y="2" width="12" height="8" fill={SERIES_COLORS[name]} rx="1" />
              </svg>
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
