import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

const SERIES_CUSTOMER = "Customer Bugs";
const SERIES_INTERNAL = "Internal Bugs";

const SERIES_COLORS = {
  [SERIES_CUSTOMER]: "#b91c1c",
  [SERIES_INTERNAL]: "#f59e0b",
};

function parseISODate(str) {
  if (!str) return null;
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function weekTickLabel(str) {
  const dt = parseISODate(str);
  if (!dt) return "";
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekRangeLabel(str) {
  const start = parseISODate(str);
  if (!start) return "";
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const fmt = (dt) => dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    const [month] = fmt(start).split(" ");
    return `${month} ${start.getDate()}–${end.getDate()}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}

export function BugsWeeklyTrendChart({ data = [], height = 280 }) {
  const [hoveredSeries, setHoveredSeries] = useState(null);

  const hasAny = data.some((r) => (r.total ?? 0) > 0);

  const option = useMemo(() => {
    if (!data.length || !hasAny) return null;

    const colors = {
      ink: cssVar("--ink"),
      ink3: cssVar("--ink-3"),
      ink4: cssVar("--ink-4"),
      border: cssVar("--border"),
      bgElev: cssVar("--bg-elev"),
    };

    const labels = data.map((r) => weekTickLabel(r.week_start));
    const customer = data.map((r) => r.customer_bugs ?? 0);
    const internal = data.map((r) => r.internal_bugs ?? 0);

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
          return (
            `<div style="font-weight:600;margin-bottom:4px">${weekRangeLabel(row.week_start)}</div>` +
            params
              .map((p) =>
                `<div style="display:flex;gap:12px;justify-content:space-between">` +
                `<span>${p.marker}${p.seriesName}</span>` +
                `<span style="font-weight:600">${p.value}</span>` +
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
          name: SERIES_CUSTOMER,
          type: "bar",
          stack: "total",
          data: customer,
          barMaxWidth: 40,
          itemStyle: { color: SERIES_COLORS[SERIES_CUSTOMER], opacity: opacityFor(SERIES_CUSTOMER) },
        },
        {
          name: SERIES_INTERNAL,
          type: "bar",
          stack: "total",
          data: internal,
          itemStyle: { color: SERIES_COLORS[SERIES_INTERNAL], opacity: opacityFor(SERIES_INTERNAL) },
        },
      ],
    };
  }, [data, hoveredSeries, hasAny]);

  if (!option) {
    return (
      <div
        className="flex items-center justify-center rounded border border-dashed border-border bg-bg-sunken text-[13px] text-ink-3"
        style={{ height }}
      >
        No bugs in the last 12 weeks
      </div>
    );
  }

  const legendItems = [SERIES_CUSTOMER, SERIES_INTERNAL];

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
