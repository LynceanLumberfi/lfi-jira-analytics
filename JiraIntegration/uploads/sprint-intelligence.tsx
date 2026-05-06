import React, { useState, useMemo, useCallback, useRef } from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from "recharts";

const LUMBER_LOGO_URL = "https://cdn.jsdelivr.net/gh/LynceanLumberfi/lfi-public-images@main/Lfi-Green-Logo.png";

const SCORE_COLORS = { 0: "#ef4444", 1: "#ef4444", 2: "#f97316", 3: "#eab308", 4: "#84cc16", 5: "#22c55e" };
const scoreColor = (s) => SCORE_COLORS[Math.max(0, Math.min(5, Math.round(s)))] || "#64748b";
const TYPE_COLORS = { Story: "#22c55e", Bug: "#ef4444", Task: "#3b82f6" };
const typeColor = (t) => TYPE_COLORS[t] || "#8b5cf6";

const calcAvg = (arr, key) => {
  const vals = arr.map((i) => i[key]).filter((v) => v != null && !isNaN(v));
  if (!vals.length) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
};
const calcPct = (arr, pred) => (!arr.length ? 0 : (arr.filter(pred).length / arr.length) * 100);
const makeScoreDist = (arr, key) => {
  const dist = [0, 0, 0, 0, 0, 0];
  arr.forEach((i) => { const s = Math.max(0, Math.min(5, Math.round(i[key] ?? 0))); dist[s]++; });
  return dist.map((count, score) => ({ score, count, label: `${score}` }));
};
const safeFixed = (val, dec = 1) => ((val == null || isNaN(val)) ? "—" : Number(val).toFixed(dec));
const fmtUsd = (n) => `$${(n || 0).toFixed((n || 0) >= 100 ? 2 : 4)}`;
const fmtNum = (n) => (n || 0).toLocaleString();
const fmtNumShort = (n) => {
  if (!n) return "0";
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(n);
};

const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl p-5 ${className}`} style={{ background: "#0f172a", border: "1px solid #1e293b" }}>{children}</div>
);

const KPI = ({ label, value, sub, accent = "#22c55e", icon }) => (
  <Card className="relative overflow-hidden">
    <div className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl" style={{ background: accent }} />
    <div className="flex items-start justify-between">
      <div>
        <div className="text-xs uppercase tracking-wider text-slate-400">{label}</div>
        <div className="mt-2 text-3xl font-bold text-white">{value}</div>
        {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
      </div>
      {icon && <div className="flex h-10 w-10 items-center justify-center rounded-xl text-lg" style={{ background: `${accent}22`, color: accent }}>{icon}</div>}
    </div>
  </Card>
);

const Badge = ({ children, color = "#22c55e" }) => (
  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium" style={{ background: `${color}22`, color, border: `1px solid ${color}55` }}>{children}</span>
);

const ScoreBar = ({ score }) => {
  const pct = (Math.max(0, Math.min(5, score || 0)) / 5) * 100;
  const c = scoreColor(score || 0);
  const display = typeof score === "number" ? score.toFixed(1) : "0.0";
  return (
    <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
      <div className="h-2 w-12 flex-shrink-0 overflow-hidden rounded-full" style={{ background: "#1e293b" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c }} />
      </div>
      <span className="text-xs font-semibold w-8 flex-shrink-0" style={{ color: c }}>{display}</span>
    </div>
  );
};

const SectionHeader = ({ title, subtitle, icon }) => (
  <div className="mb-6 flex items-center gap-3">
    <div className="flex h-10 w-10 items-center justify-center rounded-xl text-xl" style={{ background: "linear-gradient(135deg, #064e3b, #047857)", color: "#d1fae5" }}>{icon}</div>
    <div>
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {subtitle && <p className="text-sm text-slate-400">{subtitle}</p>}
    </div>
  </div>
);

const DarkTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs" style={{ background: "#0f172a", border: "1px solid #334155", color: "#e2e8f0" }}>
      {label != null && <div className="mb-1 font-semibold text-white">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-slate-400">{p.name}:</span>
          <span className="font-semibold text-white">{typeof p.value === "number" ? p.value.toLocaleString() : p.value}</span>
        </div>
      ))}
    </div>
  );
};

const LumberLogo = ({ size = 32 }) => {
  const [ok, setOk] = useState(true);
  if (!ok) return (
    <div style={{ width: size, height: size, borderRadius: size * 0.25, background: "linear-gradient(135deg, #064e3b, #047857)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: size * 0.35, fontWeight: 800, color: "white", letterSpacing: "-1px" }}>LFI</div>
  );
  return <img src={LUMBER_LOGO_URL} alt="LumberFi" width={size} height={size} onError={() => setOk(false)} style={{ objectFit: "contain", display: "block", flexShrink: 0 }} />;
};

/* ── Sortable Table Hook ── */
const useSortableTable = (data, defaultCol, defaultDir = "asc") => {
  const [col, setCol] = useState(defaultCol);
  const [dir, setDir] = useState(defaultDir);
  const toggle = (c) => { if (col === c) setDir(d => d === "asc" ? "desc" : "asc"); else { setCol(c); setDir("asc"); } };
  const sorted = useMemo(() => [...data].sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av == null) return 1; if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
    return dir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
  }), [data, col, dir]);
  const Th = ({ k, label }) => (
    <th onClick={() => toggle(k)} className="cursor-pointer pb-3 pr-4 hover:text-emerald-400 select-none whitespace-nowrap">
      {label} <span className="opacity-50 text-xs">{col !== k ? "↕" : dir === "asc" ? "↑" : "↓"}</span>
    </th>
  );
  return { sorted, col, dir, Th };
};

const TeamSummaryTable = ({ data }) => {
  const { sorted, Th } = useSortableTable(data, "count", "desc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
          <Th k="team" label="Team" /><Th k="count" label="Issues" /><Th k="avgQ" label="Avg Quality" /><Th k="avgAI" label="Avg AI" /><Th k="skillPct" label="Skill %" /><Th k="noDesc" label="No Desc" />
        </tr></thead>
        <tbody>{sorted.map(t => (
          <tr key={t.team} className="border-t" style={{ borderColor: "#1e293b" }}>
            <td className="py-3 pr-4 font-medium text-white">{t.team}</td>
            <td className="py-3 pr-4 text-slate-300">{t.count}</td>
            <td className="py-3 pr-4"><ScoreBar score={t.avgQ} /></td>
            <td className="py-3 pr-4"><ScoreBar score={t.avgAI} /></td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(t.skillPct, 0)}%</td>
            <td className="py-3 text-slate-300">{t.noDesc}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

const ResourceSummaryTable = ({ data }) => {
  const { sorted, Th } = useSortableTable(data, "avgQ", "desc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
          <Th k="assignee" label="Assignee" /><Th k="count" label="Issues" /><Th k="avgQ" label="Avg Quality" /><Th k="avgAI" label="Avg AI" /><Th k="skillPct" label="Skill %" /><Th k="noDesc" label="No Desc" />
        </tr></thead>
        <tbody>{sorted.map(r => (
          <tr key={r.assignee} className="border-t" style={{ borderColor: "#1e293b" }}>
            <td className="py-3 pr-4 font-medium text-white">{r.assignee}</td>
            <td className="py-3 pr-4 text-slate-300">{r.count}</td>
            <td className="py-3 pr-4"><ScoreBar score={r.avgQ} /></td>
            <td className="py-3 pr-4"><ScoreBar score={r.avgAI} /></td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(r.skillPct, 0)}%</td>
            <td className="py-3 text-slate-300">{r.noDesc}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

const TeamProductivityTable = ({ data }) => {
  const { sorted, Th } = useSortableTable(data, "count", "desc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
          <Th k="team" label="Team" /><Th k="count" label="Issues" /><Th k="sp" label="Story Points" /><Th k="estAvg" label="Avg Est" /><Th k="spentAvg" label="Avg Spent" /><Th k="overBudget" label="Over Budget" />
        </tr></thead>
        <tbody>{sorted.map(t => (
          <tr key={t.team} className="border-t" style={{ borderColor: "#1e293b" }}>
            <td className="py-3 pr-4 font-medium text-white">{t.team}</td>
            <td className="py-3 pr-4 text-slate-300">{t.count}</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(t.sp, 1)}</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(t.estAvg, 1)}h</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(t.spentAvg, 1)}h</td>
            <td className="py-3">{t.overBudget > 0 ? <Badge color="#ef4444">{t.overBudget}</Badge> : <Badge color="#22c55e">0</Badge>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

const ResourceProductivityTable = ({ data }) => {
  const { sorted, Th } = useSortableTable(data, "count", "desc");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs uppercase tracking-wider text-slate-500">
          <Th k="assignee" label="Assignee" /><Th k="count" label="Issues" /><Th k="sp" label="Story Points" /><Th k="estAvg" label="Avg Est" /><Th k="spentAvg" label="Avg Spent" /><Th k="overBudget" label="Over Budget" />
        </tr></thead>
        <tbody>{sorted.map(r => (
          <tr key={r.assignee} className="border-t" style={{ borderColor: "#1e293b" }}>
            <td className="py-3 pr-4 font-medium text-white">{r.assignee}</td>
            <td className="py-3 pr-4 text-slate-300">{r.count}</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(r.sp, 1)}</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(r.estAvg, 1)}h</td>
            <td className="py-3 pr-4 text-slate-300">{safeFixed(r.spentAvg, 1)}h</td>
            <td className="py-3">{r.overBudget > 0 ? <Badge color="#ef4444">{r.overBudget}</Badge> : <Badge color="#22c55e">0</Badge>}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
};

const TabBtns = ({ options, view, setView }) => (
  <div className="flex items-center gap-2">
    {options.map((v) => (
      <button key={v} onClick={() => setView(v)}
        className="rounded-xl px-4 py-2 text-sm font-medium transition-all"
        style={{ background: view === v ? "linear-gradient(135deg, #065f46, #047857)" : "#0f172a", color: view === v ? "#ecfdf5" : "#94a3b8", border: `1px solid ${view === v ? "#10b981" : "#1e293b"}` }}>
        {v}
      </button>
    ))}
  </div>
);

/* ── Overview ── */
const Overview = ({ filtered, data }) => {
  const avgQ = calcAvg(filtered, "quality_score");
  const avgAI = calcAvg(filtered, "ai_score");
  const qDist = useMemo(() => makeScoreDist(filtered, "quality_score"), [filtered]);
  const aiDist = useMemo(() => makeScoreDist(filtered, "ai_score"), [filtered]);
  const steps = data?.pipeline?.steps || {};
  const sprints = Array.from(new Set(filtered.map(i => i.sprint).filter(Boolean))).sort();
  const teamsList = Array.from(new Set(filtered.map(i => i.team).filter(Boolean))).sort();

  return (
    <div>
      <SectionHeader title="Overview" subtitle={`Sprint snapshot · ${filtered.length} issues`} icon="⚡" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">🏃 Sprints</h3>
            <Badge color="#3b82f6">{sprints.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {sprints.map(s => (
              <span key={s} className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-200" style={{ background: "#1e293b", border: "1px solid #334155" }}>{s}</span>
            ))}
            {sprints.length === 0 && <span className="text-xs text-slate-500">No sprint data found</span>}
          </div>
        </Card>
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">👥 Teams</h3>
            <Badge color="#22c55e">{teamsList.length}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {teamsList.map(t => (
              <span key={t} className="rounded-lg px-3 py-1.5 text-xs font-medium" style={{ background: `${typeColor(t)}18`, border: `1px solid ${typeColor(t)}44`, color: typeColor(t) }}>{t}</span>
            ))}
            {teamsList.length === 0 && <span className="text-xs text-slate-500">No team data found</span>}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <KPI label="Total Resources" value={new Set(filtered.map(i => i.assignee).filter(Boolean)).size} sub={`across ${teamsList.length} teams`} accent="#3b82f6" icon="👥" />
        <KPI label="Story Points" value={filtered.reduce((a, b) => a + (b.story_points || 0), 0).toFixed(0)} accent="#22c55e" icon="🎯" />
        <KPI label="Time Spent" value={`${filtered.reduce((a, b) => a + (b.time_spent_hours || 0), 0).toFixed(1)}h`} sub={`est ${filtered.reduce((a, b) => a + (b.estimate_hours || 0), 0).toFixed(1)}h`} accent="#f59e0b" icon="⏱️" />
        <KPI label="Avg Quality" value={avgQ.toFixed(2)} sub="0–5 scale" accent={scoreColor(avgQ)} icon="✨" />
        <KPI label="Avg AI Score" value={avgAI.toFixed(2)} sub="0–5 scale" accent={scoreColor(avgAI)} icon="🤖" />
        <KPI label="Skill Adoption" value={`${calcPct(filtered, i => !!i.skill_name).toFixed(0)}%`} sub={`${filtered.filter(i => i.skill_name).length} of ${filtered.length}`} accent="#8b5cf6" icon="🎓" />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Quality Score Distribution</h3>
            <Badge color="#22c55e">Avg {avgQ.toFixed(2)}</Badge>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={qDist} margin={{ left: 10, bottom: 20 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: "Score", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: "Issues", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 11 }} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>{qDist.map((e, i) => <Cell key={i} fill={scoreColor(e.score)} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">AI Score Distribution</h3>
            <Badge color="#3b82f6">Avg {avgAI.toFixed(2)}</Badge>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={aiDist} margin={{ left: 10, bottom: 20 }}>
              <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: "Score", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }} />
              <YAxis stroke="#64748b" tick={{ fontSize: 12 }} label={{ value: "Issues", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 11 }} />
              <Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]}>{aiDist.map((e, i) => <Cell key={i} fill={scoreColor(e.score)} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="mt-6">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-white">Pipeline State</h3>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {Object.entries(steps).map(([name, info]) => (
              <div key={name} className="rounded-xl p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium capitalize text-white">{name}</span>
                  <Badge color={info?.status === "done" ? "#22c55e" : info?.status === "skipped" ? "#f59e0b" : "#ef4444"}>{info?.status || "—"}</Badge>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
            <div className="text-xs uppercase tracking-wider text-slate-500">CSV Source</div>
            <div className="mt-1 truncate font-mono text-xs text-emerald-400">{data?.csv_path || "—"}</div>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-xl p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
              <div className="text-xs text-slate-500">Run</div>
              <div className="text-sm font-semibold text-white">{data?.run_name || "—"}</div>
            </div>
            <div className="rounded-xl p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
              <div className="text-xs text-slate-500">Generated</div>
              <div className="text-sm font-semibold text-white">{data?.generated_at ? new Date(data.generated_at).toLocaleString() : "—"}</div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
};

/* ── Quality (AI & Quality tab) ── */
const Quality = ({ filtered, byTeam, byAssignee, view, setView }) => {
  const avgQ = calcAvg(filtered, "quality_score");
  const avgAI = calcAvg(filtered, "ai_score");
  const qDist = useMemo(() => makeScoreDist(filtered, "quality_score"), [filtered]);
  const aiDist = useMemo(() => makeScoreDist(filtered, "ai_score"), [filtered]);

  return (
    <div>
      <SectionHeader title="AI & Quality" subtitle="Score analysis across teams and individuals" icon="🎯" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPI label="Avg Quality" value={avgQ.toFixed(2)} accent={scoreColor(avgQ)} icon="✨" />
        <KPI label="Avg AI Score" value={avgAI.toFixed(2)} accent={scoreColor(avgAI)} icon="🤖" />
        <KPI label="Skill Adopted" value={`${calcPct(filtered, i => !!i.skill_name).toFixed(0)}%`} sub={`${filtered.filter(i => i.skill_name).length} issues`} accent="#8b5cf6" icon="🎓" />
        <KPI label="No Description" value={`${calcPct(filtered, i => !i.has_description).toFixed(0)}%`} sub={`${filtered.filter(i => !i.has_description).length} issues`} accent="#ef4444" icon="⚠️" />
      </div>
      <div className="mt-6"><TabBtns options={["All", "By Team", "By Resource"]} view={view} setView={setView} /></div>
      <div className="mt-6">
        {view === "All" && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-4 text-sm font-semibold text-white">Quality Score Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={qDist} margin={{ left: 10, bottom: 20 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" label={{ value: "Score", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }} />
                  <YAxis stroke="#64748b" label={{ value: "Issues", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>{qDist.map((e, i) => <Cell key={i} fill={scoreColor(e.score)} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
            <Card>
              <h3 className="mb-4 text-sm font-semibold text-white">AI Score Distribution</h3>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={aiDist} margin={{ left: 10, bottom: 20 }}>
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" stroke="#64748b" label={{ value: "Score", position: "insideBottom", offset: -10, fill: "#64748b", fontSize: 11 }} />
                  <YAxis stroke="#64748b" label={{ value: "Issues", angle: -90, position: "insideLeft", offset: 10, fill: "#64748b", fontSize: 11 }} />
                  <Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]}>{aiDist.map((e, i) => <Cell key={i} fill={scoreColor(e.score)} />)}</Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>
        )}
        {view === "By Team" && (
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Team Summary</h3>
            <TeamSummaryTable data={byTeam} />
          </Card>
        )}
        {view === "By Resource" && (
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Resource Summary</h3>
            <ResourceSummaryTable data={byAssignee} />
          </Card>
        )}
      </div>
    </div>
  );
};

/* ── Productivity ── */
const Productivity = ({ filtered, byTeam, byAssignee, view, setView }) => {
  const totalSp = filtered.reduce((a, b) => a + (b.story_points || 0), 0);
  const withHours = filtered.filter(i => i.estimate_hours != null && i.time_spent_hours != null);
  const avgEst = calcAvg(withHours, "estimate_hours");
  const avgSpent = calcAvg(withHours, "time_spent_hours");
  const overBudget = withHours.filter(i => i.time_spent_hours > i.estimate_hours).length;
  const evaSample = useMemo(() => withHours.slice(0, 18).map(i => ({ key: i.issue_key, est: i.estimate_hours, actual: i.time_spent_hours, over: i.time_spent_hours > i.estimate_hours })), [withHours]);

  return (
    <div>
      <SectionHeader title="Productivity" subtitle="Story points, estimates, and delivery velocity" icon="📈" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPI label="Total Story Points" value={totalSp.toFixed(1)} accent="#22c55e" icon="🎯" />
        <KPI label="Avg Estimate" value={`${avgEst.toFixed(1)}h`} accent="#3b82f6" icon="⏱️" />
        <KPI label="Avg Time Spent" value={`${avgSpent.toFixed(1)}h`} accent="#8b5cf6" icon="⏰" />
        <KPI label="Over Budget" value={overBudget} sub={`of ${withHours.length} tracked`} accent="#ef4444" icon="🚨" />
      </div>
      <div className="mt-6"><TabBtns options={["All", "By Team", "By Resource"]} view={view} setView={setView} /></div>
      {view === "All" && (
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Avg Time Spent by Team</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={byTeam}><CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="team" stroke="#64748b" tick={{ fontSize: 11 }} angle={-15} textAnchor="end" height={60} /><YAxis stroke="#64748b" tickFormatter={v => `${v}h`} /><Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} /><Bar dataKey="spentAvg" name="Avg Time Spent" fill="#8b5cf6" radius={[6, 6, 0, 0]} /></BarChart>
            </ResponsiveContainer>
          </Card>
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Estimate vs Actual (sample 18)</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={evaSample}><CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} /><XAxis dataKey="key" stroke="#64748b" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={60} /><YAxis stroke="#64748b" /><Tooltip content={<DarkTooltip />} cursor={{ fill: "#1e293b33" }} /><Legend wrapperStyle={{ color: "#94a3b8" }} /><Bar dataKey="est" name="Estimate" fill="#3b82f6" radius={[4, 4, 0, 0]} /><Bar dataKey="actual" name="Actual" radius={[4, 4, 0, 0]}>{evaSample.map((e, i) => <Cell key={i} fill={e.over ? "#ef4444" : "#22c55e"} />)}</Bar></BarChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}
      {view === "By Team" && (
        <div className="mt-6">
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Team Productivity</h3>
            <TeamProductivityTable data={byTeam} />
          </Card>
        </div>
      )}
      {view === "By Resource" && (
        <div className="mt-6">
          <Card>
            <h3 className="mb-4 text-sm font-semibold text-white">Resource Productivity</h3>
            <ResourceProductivityTable data={byAssignee} />
          </Card>
        </div>
      )}
    </div>
  );
};

/* ── Tickets ── */
const Tickets = ({ sorted, search, setSearch, sortCol, setSortCol, sortDir, setSortDir }) => {
  const toggleSort = (col) => { if (sortCol === col) setSortDir(sortDir === "asc" ? "desc" : "asc"); else { setSortCol(col); setSortDir("desc"); } };
  const si = (col) => sortCol !== col ? "↕" : sortDir === "asc" ? "↑" : "↓";
  const [noteFor, setNoteFor] = useState(null);

  return (
    <div>
      <SectionHeader title="Tickets" subtitle={`${sorted.length} issues`} icon="🎫" />
      <Card className="mb-4">
        <input type="text" placeholder="🔍 Search by key, summary, or assignee…" value={search} onChange={e => setSearch(e.target.value)}
          className="w-full rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-500 outline-none"
          style={{ background: "#020617", border: "1px solid #1e293b" }} />
      </Card>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-slate-500">
                {[{ k: "issue_key", l: "Key" }, { k: "assignee", l: "Assignee" }, { k: "quality_score", l: "Quality" }, { k: "ai_score", l: "AI Score" }, { k: "story_points", l: "SP" }].map(c => (
                  <th key={c.k} onClick={() => toggleSort(c.k)} className="cursor-pointer pb-3 pr-3 hover:text-emerald-400">{c.l} <span className="opacity-60">{si(c.k)}</span></th>
                ))}
                <th className="pb-3 pr-3">Type</th><th className="pb-3 pr-3">Summary</th><th className="pb-3">Skill</th>
              </tr>
            </thead>
            <tbody>
              {sorted.slice(0, 200).map(i => (
                <tr key={i.issue_key} className="border-t hover:bg-slate-800/30" style={{ borderColor: "#1e293b" }}>
                  <td className="py-3 pr-3">
                    <button
                      onClick={() => setNoteFor(i)}
                      className="font-mono text-xs text-emerald-400 hover:text-emerald-300 hover:underline cursor-pointer"
                      style={{ background: "none", border: "none", padding: 0 }}
                      title="View AI score note"
                    >
                      {i.issue_key}
                    </button>
                  </td>
                  <td className="py-3 pr-3 text-slate-300">{i.assignee || "—"}</td>
                  <td className="py-3 pr-3"><ScoreBar score={i.quality_score} /></td>
                  <td className="py-3 pr-3"><ScoreBar score={i.ai_score} /></td>
                  <td className="py-3 pr-3 text-slate-300">{i.story_points ?? "—"}</td>
                  <td className="py-3 pr-3"><Badge color={typeColor(i.issue_type)}>{i.issue_type}</Badge></td>
                  <td className="py-3 pr-3 max-w-xs truncate text-slate-400">{i.summary}</td>
                  <td className="py-3">{i.skill_name ? <Badge color="#8b5cf6">{i.skill_name}</Badge> : <span className="text-xs text-slate-600">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {sorted.length > 200 && <div className="mt-3 text-center text-xs text-slate-500">Showing first 200 of {sorted.length} matches</div>}
        </div>
      </Card>

      {noteFor && (
        <div
          onClick={() => setNoteFor(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 16 }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="rounded-2xl"
            style={{ background: "#0f172a", border: "1px solid #1e293b", maxWidth: 600, width: "100%", maxHeight: "80vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.5)" }}
          >
            <div className="flex items-start justify-between border-b p-5" style={{ borderColor: "#1e293b" }}>
              <div>
                <span className="font-mono text-xs text-emerald-400">{noteFor.issue_key}</span>
                <h3 className="mt-1 text-base font-semibold text-white">{noteFor.summary}</h3>
              </div>
              <button onClick={() => setNoteFor(null)} className="rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-800 hover:text-white">✕</button>
            </div>
            <div className="p-5 space-y-4">
              {noteFor.quality_reason && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge color={scoreColor(noteFor.quality_score)}>Quality: {noteFor.quality_score?.toFixed(1) ?? "—"}</Badge>
                    <span className="text-xs uppercase tracking-wider text-slate-500">Reason</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 rounded-lg p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
                    {noteFor.quality_reason}
                  </div>
                </div>
              )}
              {noteFor.ai_reason && (
                <div>
                  <div className="mb-2 flex items-center gap-2">
                    <Badge color={scoreColor(noteFor.ai_score)}>AI: {noteFor.ai_score?.toFixed(1) ?? "—"}</Badge>
                    <span className="text-xs uppercase tracking-wider text-slate-500">Reason</span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-200 rounded-lg p-3" style={{ background: "#020617", border: "1px solid #1e293b" }}>
                    {noteFor.ai_reason}
                  </div>
                </div>
              )}

              <div>
                <div className="mb-2 text-xs uppercase tracking-wider text-slate-500">All Fields</div>
                <div className="rounded-lg overflow-hidden" style={{ background: "#020617", border: "1px solid #1e293b" }}>
                  <table className="w-full text-sm">
                    <tbody>
                      {Object.entries(noteFor).filter(([k]) => k !== "ai_reason" && k !== "quality_reason").map(([k, v], idx) => (
                        <tr key={k} style={{ borderTop: idx === 0 ? "none" : "1px solid #1e293b" }}>
                          <td className="px-3 py-2 align-top font-mono text-xs text-emerald-400 whitespace-nowrap" style={{ width: "30%" }}>{k}</td>
                          <td className="px-3 py-2 align-top text-xs text-slate-300 whitespace-pre-wrap break-words">
                            {v == null ? <span className="text-slate-600 italic">null</span>
                              : typeof v === "boolean" ? <Badge color={v ? "#22c55e" : "#ef4444"}>{String(v)}</Badge>
                              : typeof v === "object" ? <span className="font-mono">{JSON.stringify(v, null, 2)}</span>
                              : String(v)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Cost ── */
const Cost = ({ data, totalCost, totalInput, totalOutput, cacheCreate, cacheRead, calls, totalTokens }) => {
  const cacheHitRate = totalInput + cacheRead > 0 ? (cacheRead / (totalInput + cacheRead)) * 100 : 0;
  const costPer1k = totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;
  const tokenBreakdown = [{ name: "Input", value: totalInput, color: "#3b82f6" }, { name: "Output", value: totalOutput, color: "#22c55e" }, { name: "Cache Create", value: cacheCreate, color: "#f59e0b" }, { name: "Cache Read", value: cacheRead, color: "#8b5cf6" }];
  const maxTok = Math.max(totalInput, totalOutput, cacheCreate, cacheRead, 1);
  const Bar = ({ label, value, color }) => (
    <div><div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-400">{label}</span><span className="font-semibold text-white">{fmtNum(value)}</span></div><div className="h-2 overflow-hidden rounded-full" style={{ background: "#020617" }}><div className="h-full rounded-full" style={{ width: `${(value / maxTok) * 100}%`, background: color }} /></div></div>
  );
  const steps = data?.pipeline?.steps || {};
  const tokenUsage = data?.pipeline?.token_usage || {};
  const stepsWithUsage = Object.keys(steps).filter(k => tokenUsage[k]);
  return (
    <div>
      <SectionHeader title="Cost & Tokens" subtitle="Pipeline spend and token economics" icon="💰" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPI label="Total Cost" value={fmtUsd(totalCost)} sub={`${calls} API calls`} accent="#8b5cf6" icon="💵" />
        <KPI label="Total Tokens" value={fmtNumShort(totalTokens)} accent="#3b82f6" icon="🔢" />
        <KPI label="Cache Hit Rate" value={`${cacheHitRate.toFixed(1)}%`} sub="cache read / (input + cache read)" accent="#22c55e" icon="⚡" />
        <KPI label="Cost per 1K" value={fmtUsd(costPer1k)} sub="tokens" accent="#f59e0b" icon="📐" />
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-white">Token Breakdown</h3>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart><Pie data={tokenBreakdown} dataKey="value" nameKey="name" innerRadius={60} outerRadius={100} paddingAngle={3}>{tokenBreakdown.map((e, i) => <Cell key={i} fill={e.color} stroke="#0f172a" strokeWidth={2} />)}</Pie><Tooltip content={<DarkTooltip />} /></PieChart>
          </ResponsiveContainer>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {tokenBreakdown.map(e => (<div key={e.name} className="flex items-center gap-2 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} /><span className="text-slate-400">{e.name}</span><span className="ml-auto font-semibold text-white">{fmtNumShort(e.value)}</span></div>))}
          </div>
        </Card>
        <Card>
          <h3 className="mb-4 text-sm font-semibold text-white">Token Detail</h3>
          <div className="space-y-4">
            <Bar label="Input Tokens" value={totalInput} color="#3b82f6" />
            <Bar label="Output Tokens" value={totalOutput} color="#22c55e" />
            <Bar label="Cache Created" value={cacheCreate} color="#f59e0b" />
            <Bar label="Cache Read" value={cacheRead} color="#8b5cf6" />
          </div>
        </Card>
      </div>
      {stepsWithUsage.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-3 text-sm font-semibold text-white">Pipeline Step Costs</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {stepsWithUsage.map(k => {
              const u = tokenUsage[k] || {};
              return (
                <Card key={k} className="relative overflow-hidden">
                  <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-20 blur-2xl" style={{ background: "#8b5cf6" }} />
                  <div className="flex items-start justify-between">
                    <div><div className="text-xs uppercase tracking-wider text-slate-500">{k}</div><div className="mt-1 text-2xl font-bold text-white">{fmtUsd(u.total_cost_usd)}</div><div className="text-xs text-slate-500">{u.calls || 0} calls</div></div>
                    <Badge color={steps[k]?.status === "done" ? "#22c55e" : steps[k]?.status === "skipped" ? "#f59e0b" : "#ef4444"}>{steps[k]?.status || "—"}</Badge>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                    <div><div className="text-slate-500">Input</div><div className="font-semibold text-white">{fmtNumShort(u.input_tokens)}</div></div>
                    <div><div className="text-slate-500">Output</div><div className="font-semibold text-white">{fmtNumShort(u.output_tokens)}</div></div>
                    <div><div className="text-slate-500">Cache+</div><div className="font-semibold text-white">{fmtNumShort(u.cache_creation_input_tokens)}</div></div>
                    <div><div className="text-slate-500">Cache⟳</div><div className="font-semibold text-white">{fmtNumShort(u.cache_read_input_tokens)}</div></div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

/* ── Landing ── */
const Landing = ({ onLoad, error }) => {
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const handleFile = (file) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = (e) => { try { onLoad(JSON.parse(e.target.result)); } catch { onLoad(null, "Invalid JSON file"); } };
    r.readAsText(file);
  };
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-8" style={{ background: "#020617" }}>
      <div className="absolute inset-0 pointer-events-none opacity-40" style={{ background: "radial-gradient(circle at 20% 30%, #064e3b 0%, transparent 50%), radial-gradient(circle at 80% 70%, #1e3a8a 0%, transparent 50%)" }} />
      <div className="relative w-full max-w-2xl">
        <div className="mb-8 text-center">
          <div className="mb-4 inline-flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl" style={{ background: "linear-gradient(135deg, #064e3b, #047857)" }}>
            <LumberLogo size={56} />
          </div>
          <h1 className="mb-3 text-5xl font-bold" style={{ background: "linear-gradient(135deg, #22c55e, #3b82f6, #8b5cf6)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
            Sprint Intelligence
          </h1>
          <p className="text-lg text-slate-400">AI-powered analytics for your delivery pipeline</p>
        </div>
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files[0]); }}
          onClick={() => fileRef.current?.click()}
          className="cursor-pointer rounded-2xl p-12 text-center transition-all"
          style={{ background: dragging ? "#064e3b33" : "#0f172a", border: `2px dashed ${dragging ? "#10b981" : "#1e293b"}` }}
        >
          <div className="mb-4 text-5xl">📂</div>
          <div className="mb-2 text-lg font-semibold text-white">Drop your JSON report here</div>
          <div className="mb-4 text-sm text-slate-500">or click to browse</div>
          <button className="rounded-xl px-6 py-2.5 text-sm font-semibold text-white" style={{ background: "linear-gradient(135deg, #065f46, #047857)" }}>Choose File</button>
          <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={e => handleFile(e.target.files[0])} />
        </div>
        {error && <div className="mt-4 rounded-xl p-3 text-sm text-red-300" style={{ background: "#ef444422", border: "1px solid #ef444455" }}>⚠️ {error}</div>}
        <div className="mt-6 text-center text-xs text-slate-600">Expected shape: <span className="font-mono">{"{ issues: [...], pipeline: {...} }"}</span></div>
      </div>
    </div>
  );
};

/* ── Sidebar ── */
const Sidebar = ({ page, setPage, collapsed, setCollapsed, onReset }) => {
  const items = [{ k: "overview", l: "Overview", i: "⚡" }, { k: "quality", l: "AI & Quality", i: "🎯" }, { k: "productivity", l: "Productivity", i: "📈" }, { k: "tickets", l: "Tickets", i: "🎫" }, { k: "cost", l: "Cost & Tokens", i: "💰" }];
  return (
    <aside style={{ width: collapsed ? 72 : 240, minHeight: "100vh", background: "linear-gradient(180deg, #064e3b 0%, #065f46 50%, #047857 100%)", transition: "width 0.3s cubic-bezier(0.4, 0, 0.2, 1)", overflow: "visible", display: "flex", flexDirection: "column", flexShrink: 0, position: "relative" }}>
      <div style={{ padding: "12px 16px", display: "flex", alignItems: "center", gap: 8, position: "relative" }}>
        <div style={{ flexShrink: 0 }}><LumberLogo size={32} /></div>
        <span className="font-bold text-white whitespace-nowrap" style={{ opacity: collapsed ? 0 : 1, maxWidth: collapsed ? 0 : 120, transition: "opacity 0.2s ease, max-width 0.3s ease", overflow: "hidden" }}>Sprint IQ</span>
        <button onClick={() => setCollapsed(!collapsed)}
          style={{ position: "absolute", right: -14, top: "50%", transform: "translateY(-50%)", width: 28, height: 28, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, background: "#047857", border: "2px solid #064e3b", borderRadius: "50%", cursor: "pointer", color: "#d1fae5", zIndex: 20, boxShadow: "0 2px 8px rgba(0,0,0,0.4)" }}>
          {collapsed ? "›" : "‹"}
        </button>
      </div>
      <nav className="mt-4 flex-1 space-y-1 px-2">
        {items.map(it => {
          const active = page === it.k;
          return (
            <button key={it.k} onClick={() => setPage(it.k)} title={collapsed ? it.l : ""}
              className="flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium"
              style={{ background: active ? "rgba(255,255,255,0.15)" : "transparent", color: active ? "#ffffff" : "#d1fae5", gap: 12, transition: "background 0.2s ease" }}>
              <span className="text-lg" style={{ flexShrink: 0 }}>{it.i}</span>
              <span className="whitespace-nowrap overflow-hidden" style={{ opacity: collapsed ? 0 : 1, transition: "opacity 0.15s ease", flex: 1, textAlign: "left" }}>{it.l}</span>
              {active && <span className="h-2 w-2 rounded-full bg-white" style={{ flexShrink: 0, opacity: collapsed ? 0 : 1, transition: "opacity 0.15s ease" }} />}
            </button>
          );
        })}
      </nav>
      <div className="p-2">
        <button onClick={onReset} title={collapsed ? "Upload New File" : ""}
          className="flex w-full items-center rounded-xl px-3 py-2.5 text-sm font-medium text-emerald-50 hover:bg-emerald-900/40"
          style={{ border: "1px solid rgba(255,255,255,0.2)", gap: 12, transition: "background 0.2s ease" }}>
          <span className="text-lg" style={{ flexShrink: 0 }}>📤</span>
          <span className="whitespace-nowrap overflow-hidden" style={{ opacity: collapsed ? 0 : 1, transition: "opacity 0.15s ease" }}>Upload New File</span>
        </button>
      </div>
    </aside>
  );
};

/* ── Multi-Select ── */
const MultiSelect = ({ label, options, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  React.useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const allSelected = selected.length === 0;
  const toggle = val => selected.includes(val) ? onChange(selected.filter(v => v !== val)) : onChange([...selected, val]);
  const displayLabel = allSelected ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}`;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-white transition-all" style={{ background: "#0f172a", border: `1px solid ${open ? "#10b981" : "#1e293b"}`, minWidth: 140 }}>
        <span className="flex-1 truncate text-left">{displayLabel}</span>
        {!allSelected && <span onClick={e => { e.stopPropagation(); onChange([]); }} className="ml-1 rounded-full px-1 text-xs text-emerald-400 hover:text-red-400">✕</span>}
        <span className="text-slate-500 text-xs">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-60 w-56 overflow-y-auto rounded-xl py-1 shadow-2xl" style={{ background: "#0f172a", border: "1px solid #1e293b" }}>
          <div onClick={() => onChange([])} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-emerald-900/30">
            <span className="flex h-4 w-4 items-center justify-center rounded text-xs" style={{ background: allSelected ? "#10b981" : "#1e293b", border: "1px solid #334155" }}>{allSelected && "✓"}</span>
            <span className="text-slate-300">All {label}</span>
          </div>
          <div className="my-1" style={{ borderTop: "1px solid #1e293b" }} />
          {options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <div key={opt} onClick={() => toggle(opt)} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-emerald-900/30">
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-xs" style={{ background: checked ? "#10b981" : "transparent", border: `1px solid ${checked ? "#10b981" : "#334155"}` }}>{checked && <span className="text-white">✓</span>}</span>
                <span className={checked ? "text-white" : "text-slate-400"}>{opt}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ── FilterBar ── */
const FilterBar = ({ teams, assignees, teamFilter, setTeamFilter, assigneeFilter, setAssigneeFilter, search, setSearch, filtered, total }) => {
  const active = teamFilter.length > 0 || assigneeFilter.length > 0 || search.trim() !== "";
  return (
    <div className="sticky top-0 z-10 -mx-8 mb-6 flex flex-wrap items-center gap-3 border-b px-8 py-3 backdrop-blur" style={{ background: "rgba(2, 6, 23, 0.85)", borderColor: "#1e293b" }}>
      <div className="text-xs font-medium uppercase tracking-wider text-slate-500">Filters:</div>
      <MultiSelect label="Teams" options={teams} selected={teamFilter} onChange={setTeamFilter} />
      <MultiSelect label="Assignees" options={assignees} selected={assigneeFilter} onChange={setAssigneeFilter} />
      <input type="text" placeholder="🔍 Search…" value={search} onChange={e => setSearch(e.target.value)}
        className="rounded-lg px-3 py-1.5 text-sm text-white placeholder-slate-500 outline-none"
        style={{ background: "#0f172a", border: "1px solid #1e293b", width: 180 }} />
      {active && <button onClick={() => { setTeamFilter([]); setAssigneeFilter([]); setSearch(""); }} className="rounded-lg px-3 py-1.5 text-xs font-medium text-red-300 hover:bg-red-500/10" style={{ border: "1px solid #ef444455" }}>✕ Clear all</button>}
      <div className="ml-auto text-xs text-slate-500">Showing <span className="font-semibold text-white">{filtered}</span> of <span className="text-slate-400">{total}</span></div>
    </div>
  );
};

/* ── App ── */
export default function App() {
  const [data, setData] = useState(null);
  const [landingError, setLandingError] = useState("");
  const [page, setPage] = useState("overview");
  const [collapsed, setCollapsed] = useState(false);
  const [teamFilter, setTeamFilter] = useState([]);
  const [assigneeFilter, setAssigneeFilter] = useState([]);
  const [search, setSearch] = useState("");
  const [qualityView, setQualityView] = useState("All");
  const [productivityView, setProductivityView] = useState("All");
  const [sortCol, setSortCol] = useState("issue_key");
  const [sortDir, setSortDir] = useState("asc");

  const handleLoad = useCallback((parsed, err) => {
    if (err) { setLandingError(err); return; }
    if (!parsed || !Array.isArray(parsed.issues)) { setLandingError("Invalid report — 'issues' array not found"); return; }
    setLandingError(""); setData(parsed);
  }, []);

  const issues = data?.issues || [];
  const teams = useMemo(() => Array.from(new Set(issues.map(i => i.team).filter(Boolean))).sort(), [issues]);
  const assignees = useMemo(() => Array.from(new Set(issues.map(i => i.assignee).filter(Boolean))).sort(), [issues]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return issues.filter(i => {
      if (teamFilter.length > 0 && !teamFilter.includes(i.team)) return false;
      if (assigneeFilter.length > 0 && !assigneeFilter.includes(i.assignee)) return false;
      if (s && !`${i.issue_key || ""} ${i.summary || ""} ${i.assignee || ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [issues, teamFilter, assigneeFilter, search]);

  const byTeam = useMemo(() => {
    const m = {};
    filtered.forEach(i => { const t = i.team || "Unassigned"; if (!m[t]) m[t] = { team: t, items: [] }; m[t].items.push(i); });
    return Object.values(m).map(({ team, items }) => {
      const wh = items.filter(i => i.estimate_hours != null && i.time_spent_hours != null);
      return {
        team,
        count: items.length || 0,
        avgQ: calcAvg(items, "quality_score") || 0,
        avgAI: calcAvg(items, "ai_score") || 0,
        sp: items.reduce((a, b) => a + (b.story_points || 0), 0) || 0,
        skillPct: calcPct(items, i => !!i.skill_name) || 0,
        noDesc: items.filter(i => !i.has_description).length || 0,
        spentAvg: calcAvg(wh, "time_spent_hours") || 0,
        estAvg: calcAvg(wh, "estimate_hours") || 0,
        overBudget: wh.filter(i => i.time_spent_hours > i.estimate_hours).length || 0,
      };
    }).sort((a, b) => b.count - a.count);
  }, [filtered]);

  const byAssignee = useMemo(() => {
    const m = {};
    filtered.forEach(i => { const a = i.assignee || "Unassigned"; if (!m[a]) m[a] = { assignee: a, team: i.team || "—", items: [] }; m[a].items.push(i); });
    return Object.values(m).map(({ assignee, team, items }) => {
      const wh = items.filter(i => i.estimate_hours != null && i.time_spent_hours != null);
      return {
        assignee, team,
        count: items.length,
        avgQ: calcAvg(items, "quality_score") || 0,
        avgAI: calcAvg(items, "ai_score") || 0,
        sp: items.reduce((a, b) => a + (b.story_points || 0), 0) || 0,
        skillPct: calcPct(items, i => !!i.skill_name) || 0,
        noDesc: items.filter(i => !i.has_description).length || 0,
        estAvg: calcAvg(wh, "estimate_hours") || 0,
        spentAvg: calcAvg(wh, "time_spent_hours") || 0,
        overBudget: wh.filter(i => i.time_spent_hours > i.estimate_hours).length || 0,
      };
    }).sort((a, b) => b.avgQ - a.avgQ);
  }, [filtered]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return sortDir === "asc" ? av - bv : bv - av;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const totalUsage = data?.pipeline?.token_usage?.total || {};
  const totalCost = totalUsage.total_cost_usd || 0;
  const totalInput = totalUsage.input_tokens || 0;
  const totalOutput = totalUsage.output_tokens || 0;
  const cacheCreate = totalUsage.cache_creation_input_tokens || 0;
  const cacheRead = totalUsage.cache_read_input_tokens || 0;
  const calls = totalUsage.calls || 0;
  const totalTokens = totalInput + totalOutput + cacheCreate + cacheRead;

  if (!data) return <Landing onLoad={handleLoad} error={landingError} />;

  return (
    <div className="flex min-h-screen" style={{ background: "#020617" }}>
      <Sidebar page={page} setPage={setPage} collapsed={collapsed} setCollapsed={setCollapsed} onReset={() => { setData(null); setTeamFilter([]); setAssigneeFilter([]); setSearch(""); }} />
      <main className="flex-1 overflow-x-auto">
        <div className="p-8">
          {page !== "cost" && <FilterBar teams={teams} assignees={assignees} teamFilter={teamFilter} setTeamFilter={setTeamFilter} assigneeFilter={assigneeFilter} setAssigneeFilter={setAssigneeFilter} search={search} setSearch={setSearch} filtered={filtered.length} total={issues.length} />}
          {page === "overview" && <Overview filtered={filtered} data={data} />}
          {page === "quality" && <Quality filtered={filtered} byTeam={byTeam} byAssignee={byAssignee} view={qualityView} setView={setQualityView} />}
          {page === "productivity" && <Productivity filtered={filtered} byTeam={byTeam} byAssignee={byAssignee} view={productivityView} setView={setProductivityView} />}
          {page === "tickets" && <Tickets sorted={sorted} search={search} setSearch={setSearch} sortCol={sortCol} setSortCol={setSortCol} sortDir={sortDir} setSortDir={setSortDir} />}
          {page === "cost" && <Cost data={data} totalCost={totalCost} totalInput={totalInput} totalOutput={totalOutput} cacheCreate={cacheCreate} cacheRead={cacheRead} calls={calls} totalTokens={totalTokens} />}
        </div>
      </main>
    </div>
  );
}
