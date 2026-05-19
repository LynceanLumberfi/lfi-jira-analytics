import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTestCoverageSummary, getTestCoverageByProduct, getTestCoverageModules, getTestCoverageTrends } from "../../lib/api";
import { TestCoverageWeeklyChart } from "../../components/charts/TestCoverageWeeklyChart";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";

const FEATURE_COLORS = {
  "Timesheet Web":    { bg: "#6366f1", light: "#ede9fe" },
  "Builderfax":       { bg: "#f59e0b", light: "#fef3c7" },
  "Onboarding":       { bg: "#10b981", light: "#d1fae5" },
  "Timesheet App":    { bg: "#ef4444", light: "#fee2e2" },
  "New Foreman Mode": { bg: "#8b5cf6", light: "#f5f3ff" },
  "Builderfax App":   { bg: "#0ea5e9", light: "#e0f2fe" },
};

function pct(c, t) { return t === 0 ? 0 : Math.round((c / t) * 100); }

function statusColor(p) {
  if (p === 0) return "#ef4444";
  if (p < 50) return "#f97316";
  if (p < 80) return "#f59e0b";
  return "#10b981";
}

function RadialGauge({ value, size, color }) {
  const s = size || 80;
  const r = s / 2 - 8;
  const circ = 2 * Math.PI * r;
  const dash = (value / 100) * circ;
  return (
    <svg width={s} height={s}>
      <circle cx={s/2} cy={s/2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={8} />
      <circle cx={s/2} cy={s/2} r={r} fill="none" stroke={color} strokeWidth={8}
        strokeDasharray={dash + " " + circ} strokeLinecap="round"
        transform={"rotate(-90 " + (s/2) + " " + (s/2) + ")"} />
      <text x={s/2} y={s/2+1} textAnchor="middle" dominantBaseline="middle"
        fontSize={s < 70 ? 11 : 14} fontWeight="700" fill="#111827">
        {value}%
      </text>
    </svg>
  );
}

function MiniBar({ value, color }) {
  return (
    <div style={{ width:"100%", background:"#f1f5f9", borderRadius:4, height:6, overflow:"hidden" }}>
      <div style={{ width: value + "%", background: color, height:"100%", borderRadius:4, transition:"width 0.4s" }} />
    </div>
  );
}

// Delta = current pct vs prev pct (both already 0–100). Returns null when no prev.
function DeltaArrow({ pct, prevPct, size = 12 }) {
  if (prevPct == null || pct == null) return null;
  const diff = Math.round((pct - prevPct) * 10) / 10;
  if (diff === 0) {
    return (
      <span style={{ fontSize: size - 1, color: "#94a3b8", fontWeight: 600 }} title="No change">
        ±0
      </span>
    );
  }
  const up = diff > 0;
  const color = up ? "#10b981" : "#ef4444";
  return (
    <span
      title={`Was ${prevPct}%`}
      style={{ display: "inline-flex", alignItems: "center", gap: 1, color, fontSize: size, fontWeight: 700 }}
    >
      <svg width={size} height={size} viewBox="0 0 12 12" style={{ display: "inline-block" }}>
        {up
          ? <path d="M6 2 L10 8 L2 8 Z" fill={color} />
          : <path d="M6 10 L10 4 L2 4 Z" fill={color} />}
      </svg>
      {Math.abs(diff)}%
    </span>
  );
}

export function CoverageOverview() {
  const [selectedFeature, setSelectedFeature] = useState(null);
  const [showZeroOnly, setShowZeroOnly] = useState(false);
  const [trendFeature, setTrendFeature] = useState(null);

  const { data: summary } = useQuery({
    queryKey: ["test-coverage", "summary"],
    queryFn: getTestCoverageSummary,
    staleTime: 2 * 60 * 1000,
  });

  const { data: allModules = [] } = useQuery({
    queryKey: ["test-coverage", "modules"],
    queryFn: () => getTestCoverageModules(null),
    staleTime: 2 * 60 * 1000,
  });

  const { data: byProduct = [] } = useQuery({
    queryKey: ["test-coverage", "by-product"],
    queryFn: getTestCoverageByProduct,
    staleTime: 2 * 60 * 1000,
  });

  const { data: trendData = [] } = useQuery({
    queryKey: ["test-coverage", "trends", trendFeature],
    queryFn: () => getTestCoverageTrends(trendFeature),
    staleTime: 2 * 60 * 1000,
  });

  const features = useMemo(() => {
    const map = {};
    allModules.forEach((d) => {
      if (!map[d.feature]) map[d.feature] = { covered: 0, total: 0, modules: [] };
      map[d.feature].covered += d.covered;
      map[d.feature].total += d.total;
      map[d.feature].modules.push(d);
    });
    // Index by-product deltas by feature name for O(1) lookup
    const productByName = {};
    byProduct.forEach((p) => { productByName[p.feature] = p; });
    return Object.entries(map).map(([name, v]) => ({
      name,
      covered: v.covered,
      total: v.total,
      pct: pct(v.covered, v.total),
      prev_pct: productByName[name]?.prev_pct ?? null,
      modules: v.modules,
    }));
  }, [allModules, byProduct]);

  const totalCovered = summary?.total_covered ?? 0;
  const totalTests   = summary?.total_cases ?? 0;
  const overallPct   = summary?.pct ?? 0;
  const zeroModules  = allModules.filter((d) => d.covered === 0);
  const fullyDone    = summary?.modules_done ?? 0;
  const productCount = summary?.product_count ?? 0;

  const activeFeature  = selectedFeature ? features.find((f) => f.name === selectedFeature) : null;
  const displayModules = activeFeature
    ? (showZeroOnly ? activeFeature.modules.filter((m) => m.covered === 0) : activeFeature.modules)
    : (showZeroOnly ? zeroModules : null);

  const featureNames = features.map((f) => f.name);

  const overallPrevPct = summary?.prev_pct ?? null;
  const kpis = [
    { label: "Overall Coverage",  value: overallPct + "%", sub: totalCovered.toLocaleString() + " / " + totalTests.toLocaleString() + " tests", color: statusColor(overallPct), prev_pct: overallPrevPct, pct: overallPct },
    { label: "Features Tracked",  value: productCount,  sub: "product areas",  color: "#6366f1" },
    { label: "Fully Covered",     value: fullyDone,     sub: "at 100%",         color: "#10b981" },
    { label: "Modules at 0%",     value: zeroModules.length, sub: "need attention", color: "#ef4444" },
  ];

  return (
    <div style={{ fontFamily: "'Inter',sans-serif" }}>

      {/* KPI Cards */}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:14, marginBottom:24 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ background:"#fff", borderRadius:14, padding:"18px 20px",
            boxShadow:"0 1px 4px rgba(0,0,0,0.07)", borderTop:"4px solid " + k.color }}>
            <div style={{ fontSize:11, fontWeight:600, color:"#94a3b8", textTransform:"uppercase", letterSpacing:1 }}>{k.label}</div>
            <div style={{ display:"flex", alignItems:"baseline", gap:8, margin:"6px 0 2px" }}>
              <div style={{ fontSize:32, fontWeight:800, color:k.color }}>{k.value}</div>
              {k.prev_pct != null && <DeltaArrow pct={k.pct} prevPct={k.prev_pct} size={13} />}
            </div>
            <div style={{ fontSize:12, color:"#64748b" }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Weekly Trend Chart */}
      <Card style={{ marginBottom: 24 }}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Weekly coverage progress</CardTitle>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setTrendFeature(null)}
                style={{
                  fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer", fontWeight:600,
                  background: trendFeature === null ? "#6366f1" : "#f1f5f9",
                  color: trendFeature === null ? "#fff" : "#475569",
                  border:"none",
                }}
              >All</button>
              {featureNames.map((name) => {
                const col = FEATURE_COLORS[name] || { bg:"#64748b", light:"#f1f5f9" };
                const active = trendFeature === name;
                return (
                  <button key={name}
                    onClick={() => setTrendFeature(active ? null : name)}
                    style={{
                      fontSize:11, padding:"3px 10px", borderRadius:20, cursor:"pointer", fontWeight:600,
                      background: active ? col.bg : "#f1f5f9",
                      color: active ? "#fff" : "#475569",
                      border:"none",
                    }}
                  >{name}</button>
                );
              })}
            </div>
          </div>
        </CardHeader>
        <CardBody pad="lg">
          <TestCoverageWeeklyChart data={trendData} />
        </CardBody>
      </Card>

      {/* Feature Cards */}
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:14, fontWeight:700, color:"#0f172a", marginBottom:12 }}>Coverage by Feature</div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:12 }}>
          {features.map((f) => {
            const col = FEATURE_COLORS[f.name] || { bg:"#64748b", light:"#f1f5f9" };
            const active = selectedFeature === f.name;
            const done0  = f.modules.filter((m) => pct(m.covered, m.total) === 100).length;
            const zero0  = f.modules.filter((m) => m.covered === 0).length;
            return (
              <div key={f.name}
                onClick={() => setSelectedFeature(active ? null : f.name)}
                style={{ background: active ? col.light : "#fff",
                  border:"2px solid " + (active ? col.bg : "#e2e8f0"),
                  borderRadius:14, padding:"16px 18px", cursor:"pointer",
                  boxShadow: active ? ("0 0 0 3px " + col.bg + "30") : "0 1px 4px rgba(0,0,0,0.06)",
                  transition:"all 0.2s" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                  <div style={{ flex:1, paddingRight:8 }}>
                    <div style={{ fontSize:13, fontWeight:700, color:"#0f172a", display:"flex", alignItems:"center", gap:6 }}>
                      <span>{f.name}</span>
                      <DeltaArrow pct={f.pct} prevPct={f.prev_pct} size={11} />
                    </div>
                    <div style={{ fontSize:11, color:"#64748b", marginTop:2 }}>
                      {f.modules.length} modules · {f.covered}/{f.total} tests
                    </div>
                  </div>
                  <RadialGauge value={f.pct} size={58} color={statusColor(f.pct)} />
                </div>
                <div style={{ marginTop:10 }}>
                  <MiniBar value={f.pct} color={statusColor(f.pct)} />
                </div>
                <div style={{ marginTop:8, display:"flex", gap:6, flexWrap:"wrap" }}>
                  <span style={{ fontSize:10, background:"#dcfce7", color:"#16a34a", borderRadius:20, padding:"2px 8px", fontWeight:600 }}>
                    {done0} done
                  </span>
                  <span style={{ fontSize:10, background:"#fee2e2", color:"#dc2626", borderRadius:20, padding:"2px 8px", fontWeight:600 }}>
                    {zero0} at 0%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Module Drill-down */}
      {(activeFeature || showZeroOnly) && displayModules && (
        <div style={{ background:"#fff", borderRadius:14, padding:"20px 22px",
          boxShadow:"0 1px 4px rgba(0,0,0,0.07)", marginBottom:20 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:"#0f172a" }}>
                {activeFeature ? activeFeature.name + " — Module Breakdown" : "All Modules at 0% Coverage"}
              </div>
              <div style={{ fontSize:12, color:"#64748b" }}>{displayModules.length} modules</div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={() => setShowZeroOnly(!showZeroOnly)}
                style={{ fontSize:12, padding:"6px 14px", borderRadius:8,
                  background: showZeroOnly ? "#ef4444" : "#f1f5f9",
                  color: showZeroOnly ? "#fff" : "#475569",
                  border:"none", cursor:"pointer", fontWeight:600 }}>
                {showZeroOnly ? "0% Only (on)" : "Show 0% Only"}
              </button>
              {activeFeature && (
                <button onClick={() => setSelectedFeature(null)}
                  style={{ fontSize:12, padding:"6px 14px", borderRadius:8,
                    background:"#f1f5f9", color:"#475569", border:"none", cursor:"pointer" }}>
                  Close
                </button>
              )}
            </div>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:8 }}>
            {displayModules.map((m, i) => {
              const p = pct(m.covered, m.total);
              const c = statusColor(p);
              return (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px",
                  background:"#f8fafc", borderRadius:10, borderLeft:"4px solid " + c }}>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:"#0f172a",
                      whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                      <span style={{ color:"#64748b", fontWeight:500 }}>{m.feature}</span>
                      <span style={{ color:"#cbd5e1", margin:"0 6px" }}>—</span>
                      {m.module}
                    </div>
                    <div style={{ marginTop:4 }}>
                      <MiniBar value={p} color={c} />
                    </div>
                  </div>
                  <div style={{ textAlign:"right", minWidth:56 }}>
                    <div style={{ display:"flex", justifyContent:"flex-end", alignItems:"baseline", gap:4 }}>
                      <span style={{ fontSize:13, fontWeight:800, color:c }}>{p}%</span>
                      <DeltaArrow pct={p} prevPct={m.prev_pct} size={10} />
                    </div>
                    <div style={{ fontSize:10, color:"#94a3b8" }}>{m.covered}/{m.total}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Zero Coverage Banner */}
      {!showZeroOnly && !activeFeature && zeroModules.length > 0 && (
        <div style={{ background:"linear-gradient(135deg,#ef4444,#f97316)", borderRadius:14,
          padding:"18px 22px", color:"#fff", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontWeight:700, fontSize:15 }}>
              {zeroModules.length} modules have 0% coverage
            </div>
            <div style={{ fontSize:12, opacity:0.85, marginTop:4 }}>
              {zeroModules.reduce((s, m) => s + m.total, 0).toLocaleString()} test cases need to be written
            </div>
          </div>
          <button onClick={() => setShowZeroOnly(true)}
            style={{ background:"#fff", color:"#ef4444", fontWeight:700, fontSize:12,
              padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer" }}>
            View All
          </button>
        </div>
      )}
    </div>
  );
}
