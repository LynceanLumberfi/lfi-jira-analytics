/* global React, UI, I */
// =============================================================
// Overview hub: Resource Productivity, Sprint Quality, AI Adaptability
// =============================================================
const { useState, useMemo } = React;

// ---------- Sparkline ----------
function Spark({ data, color = 'var(--accent)', height = 32, fill = true }) {
  const w = 100, h = height;
  const max = Math.max(...data), min = Math.min(...data);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / (max - min || 1)) * (h - 4) - 2;
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = path + ` L ${w},${h} L 0,${h} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height, display: 'block' }}>
      {fill && <path d={area} fill={color} opacity="0.12"/>}
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

// ---------- Bar chart (horizontal stacked) ----------
function StackBar({ segs, height = 10 }) {
  const total = segs.reduce((s, x) => s + x.v, 0) || 1;
  return (
    <div style={{ display: 'flex', height, borderRadius: 999, overflow: 'hidden', background: 'var(--bg-sunken)' }}>
      {segs.map((s, i) => (
        <div key={i} title={`${s.label}: ${s.v}`} style={{ width: `${(s.v / total) * 100}%`, background: s.color }}/>
      ))}
    </div>
  );
}

// ============================================================
// OverviewHome — landing page that ties the three pillars together
// ============================================================
function OverviewHome({ go, team }) {
  return (
    <div className="content wide" data-screen-label={team ? team.label : "Overview"}>
      <div className="page-head">
        <div>
          <h1 className="page-title">{team && team.key === 'all' ? 'All Teams overview' : team ? team.label : 'Overview'}</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Engineering health across your synced Jira workspace — pulled live from Lumber's integration layer.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn">{I.calendar} Last 30 days</button>
          <button className="btn">{I.download} Export</button>
        </div>
      </div>

      {/* Hero KPIs */}
      <div className="stats" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <BigKpi label="Avg story points / dev / sprint" value="14.2" delta="+1.8" deltaTone="ok" sub="vs last sprint"
          spark={[10, 11, 12, 11.5, 13, 12.4, 14.2]} sparkColor="var(--ok)"/>
        <BigKpi label="Sprint completion rate" value="87%" delta="+4 pts" deltaTone="ok" sub="committed → done"
          spark={[78, 80, 79, 82, 84, 83, 87]} sparkColor="var(--info)"/>
        <BigKpi label="Bug → feature ratio" value="0.31" delta="−0.05" deltaTone="ok" sub="lower is better"
          spark={[0.4, 0.42, 0.39, 0.38, 0.36, 0.34, 0.31]} sparkColor="var(--warn)"/>
        <BigKpi label="AI-assisted PRs" value="68%" delta="+11 pts" deltaTone="ok" sub="of merged PRs touched AI"
          spark={[42, 48, 51, 55, 60, 64, 68]} sparkColor="var(--accent)"/>
      </div>

      {/* Pillars */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
        <PillarCard
          title="Resource Productivity"
          tag="People"
          desc="Output per engineer, velocity, focus time. Spot under-loaded and burnt-out devs."
          stats={[
            { k: 'Active devs',   v: '24' },
            { k: 'Velocity (S-12)', v: '341 pts' },
            { k: 'Focus time avg',  v: '4.2 hrs/day' },
          ]}
          go={() => go('overview-productivity')}/>
        <PillarCard
          title="Sprint Quality"
          tag="Delivery"
          desc="Bugs vs stories vs tasks, regression rate, sprint slippage. What shipped, and how clean."
          stats={[
            { k: 'Stories shipped', v: '47' },
            { k: 'Bugs (S-12)',     v: '11' },
            { k: 'Slipped tickets', v: '6' },
          ]}
          go={() => go('overview-quality')}/>
        <PillarCard
          title="AI Adaptability"
          tag="Tooling"
          desc="How fast your team is adopting AI in their flow — and where it's actually saving time."
          stats={[
            { k: 'Active AI users', v: '21 / 24' },
            { k: 'PRs w/ AI',       v: '68%' },
            { k: 'Hours saved (est)', v: '~96 / wk' },
          ]}
          go={() => go('overview-ai')}/>
      </div>

      <div className="card sunken" style={{ marginTop: 18, padding: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <span style={{ color: 'var(--info)' }}>{I.info}</span>
        <div style={{ fontSize: 13 }}>
          All metrics compute from your synced Jira workspace. <span className="hover-link" onClick={() => go('integrations-home')}>Manage the integration →</span>
        </div>
      </div>
    </div>
  );
}

function BigKpi({ label, value, delta, deltaTone, sub, spark, sparkColor }) {
  return (
    <div className="stat" style={{ padding: 18 }}>
      <div className="stat-label">{label}</div>
      <div className="row" style={{ gap: 8, alignItems: 'baseline', marginTop: 6 }}>
        <div className="stat-value" style={{ marginTop: 0 }}>{value}</div>
        <span className={'pill ' + (deltaTone || '')} style={{ padding: '1px 7px', fontSize: 11 }}>{delta}</span>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>
      <div style={{ marginTop: 10 }}>
        <Spark data={spark} color={sparkColor} height={28}/>
      </div>
    </div>
  );
}

function PillarCard({ title, tag, desc, stats, go }) {
  return (
    <button onClick={go} className="card card-pad-lg" style={{
      textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
      display: 'flex', flexDirection: 'column', gap: 14, padding: 22,
    }}>
      <div className="row">
        <span className="pill accent">{tag}</span>
        <div className="spacer"/>
        <span style={{ color: 'var(--ink-3)' }}>{I.arrow}</span>
      </div>
      <div>
        <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</div>
        <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{desc}</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingTop: 8, borderTop: '1px solid var(--border-soft)' }}>
        {stats.map(s => (
          <div key={s.k}>
            <div className="muted" style={{ fontSize: 11 }}>{s.k}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 1 }}>{s.v}</div>
          </div>
        ))}
      </div>
    </button>
  );
}

// ============================================================
// Resource Productivity
// ============================================================
function OverviewProductivity({ go }) {
  const D = window.LUMBER_DATA;
  const devs = [
    { name: 'Mia Garcia',   role: 'Eng Mgr',     points: 18, prs: 14, focus: 5.2, util: 0.82, sprint: [10,12,14,15,16,17,18] },
    { name: 'Tom Reilly',   role: 'Backend',     points: 24, prs: 19, focus: 4.8, util: 0.94, sprint: [16,18,20,22,21,23,24] },
    { name: 'Devon Park',   role: 'Mobile',      points: 21, prs: 17, focus: 4.1, util: 0.88, sprint: [14,16,17,19,20,20,21] },
    { name: 'Asha Iyer',    role: 'Data',        points: 16, prs: 11, focus: 4.6, util: 0.71, sprint: [12,13,14,15,15,16,16] },
    { name: 'Ray Sullivan', role: 'SRE',         points: 13, prs: 9,  focus: 3.4, util: 0.62, sprint: [10,11,12,12,13,13,13] },
    { name: 'Nina Cole',    role: 'Design Lead', points: 11, prs: 7,  focus: 2.9, util: 0.55, sprint: [8,9,10,10,11,11,11] },
    { name: 'Jamal Brooks', role: 'Frontend',    points: 19, prs: 15, focus: 4.7, util: 0.85, sprint: [13,15,16,17,18,18,19] },
    { name: 'Maria Zheng',  role: 'PM',          points: 9,  prs: 4,  focus: 3.2, util: 0.48, sprint: [6,7,7,8,8,9,9] },
  ];
  const totalPts = devs.reduce((s, d) => s + d.points, 0);

  return (
    <div className="content wide" data-screen-label="Overview / Productivity">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => go('overview')} style={{ marginBottom: 6 }}>{I.chevL} Overview</button>
          <h1 className="page-title">Resource productivity</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Per-engineer output across the last sprint — story points, PRs merged, deep-focus hours, and utilization.
          </p>
        </div>
        <div className="page-head-actions">
          <button className="btn">{I.calendar} Sprint 12</button>
          <button className="btn">{I.filter} Team</button>
        </div>
      </div>

      <div className="stats">
        <Stat2 label="Total points (S-12)"   value={totalPts} sub="across 8 contributors" tone="ok"/>
        <Stat2 label="PRs merged"            value="96" sub="+22% vs S-11" tone="ok"/>
        <Stat2 label="Avg utilization"       value="73%" sub="ideal range 65–85%" tone=""/>
        <Stat2 label="Focus time / day"      value="4.2 hrs" sub="meeting-free blocks" tone=""/>
      </div>

      {/* Velocity area */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <div className="card-title">Team velocity — last 7 sprints</div>
          <div className="card-sub">Story points completed per sprint</div>
        </div>
        <div style={{ padding: '8px 20px 20px' }}>
          <VelocityChart data={[
            { s: 'S-6',  v: 248 },
            { s: 'S-7',  v: 271 },
            { s: 'S-8',  v: 263 },
            { s: 'S-9',  v: 295 },
            { s: 'S-10', v: 312 },
            { s: 'S-11', v: 288 },
            { s: 'S-12', v: 341 },
          ]}/>
        </div>
      </div>

      {/* Per-dev table */}
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>Engineer</th>
              <th style={{ width: 90 }}>Points</th>
              <th style={{ width: 80 }}>PRs</th>
              <th style={{ width: 110 }}>Focus / day</th>
              <th>Utilization</th>
              <th style={{ width: 160 }}>Trend (7 sprints)</th>
              <th style={{ width: 130 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {devs.map(d => {
              const status = d.util > 0.9 ? { t: 'Overloaded', tone: 'err' }
                            : d.util > 0.65 ? { t: 'On track', tone: 'ok' }
                            : { t: 'Under-utilized', tone: 'warn' };
              return (
                <tr key={d.name}>
                  <td>
                    <div className="row" style={{ gap: 10 }}>
                      <UI.Avatar name={d.name}/>
                      <div>
                        <div style={{ fontWeight: 500 }}>{d.name}</div>
                        <div className="muted" style={{ fontSize: 11.5 }}>{d.role}</div>
                      </div>
                    </div>
                  </td>
                  <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{d.points}</td>
                  <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{d.prs}</td>
                  <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{d.focus} hrs</td>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <div style={{ flex: 1, maxWidth: 140 }}>
                        <div className="progress-track">
                          <div className="progress-fill" style={{
                            width: (d.util * 100) + '%',
                            background: d.util > 0.9 ? 'var(--err)' : d.util > 0.65 ? 'var(--ok)' : 'var(--warn)',
                          }}/>
                        </div>
                      </div>
                      <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>{Math.round(d.util * 100)}%</span>
                    </div>
                  </td>
                  <td><div style={{ width: 140 }}><Spark data={d.sprint} color="var(--accent)" height={26}/></div></td>
                  <td><span className={'pill ' + status.tone}>{status.t}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat2({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={'stat-sub ' + (tone || '')}>{sub}</div>
    </div>
  );
}

function VelocityChart({ data }) {
  const max = Math.max(...data.map(d => d.v));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 14, alignItems: 'end', height: 180 }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1;
        const h = (d.v / max) * 150;
        return (
          <div key={d.s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: isLast ? 'var(--ink)' : 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{d.v}</div>
            <div style={{
              width: '70%', height: h, borderRadius: '6px 6px 0 0',
              background: isLast ? 'var(--accent)' : 'var(--ink-5)',
              transition: 'height 0.4s ease',
            }}/>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{d.s}</div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// Sprint Quality
// ============================================================
function OverviewQuality({ go }) {
  const sprints = [
    { s: 'S-6',  stories: 28, tasks: 19, bugs: 14, subs: 22, total: 83 },
    { s: 'S-7',  stories: 31, tasks: 22, bugs: 17, subs: 25, total: 95 },
    { s: 'S-8',  stories: 33, tasks: 18, bugs: 15, subs: 28, total: 94 },
    { s: 'S-9',  stories: 38, tasks: 21, bugs: 13, subs: 31, total: 103 },
    { s: 'S-10', stories: 42, tasks: 24, bugs: 16, subs: 33, total: 115 },
    { s: 'S-11', stories: 40, tasks: 22, bugs: 19, subs: 30, total: 111 },
    { s: 'S-12', stories: 47, tasks: 28, bugs: 11, subs: 37, total: 123 },
  ];
  const cur = sprints[sprints.length - 1];
  const total = cur.stories + cur.tasks + cur.bugs + cur.subs;

  const epics = [
    { name: 'ERP Integrations Framework', key: 'LUM-2046', planned: 21, done: 18, bugs: 2, status: 'on-track' },
    { name: 'Webhook delivery v2',         key: 'API-318',  planned: 21, done: 8,  bugs: 1, status: 'at-risk' },
    { name: 'Mobile push reliability',     key: 'MOB-400',  planned: 13, done: 13, bugs: 4, status: 'done' },
    { name: 'Snowflake mirror',            key: 'DATA-80',  planned: 18, done: 6,  bugs: 0, status: 'on-track' },
    { name: 'Auth hardening Q2',           key: 'OPS-20',   planned: 8,  done: 7,  bugs: 1, status: 'on-track' },
  ];

  return (
    <div className="content wide" data-screen-label="Overview / Quality">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => go('overview')} style={{ marginBottom: 6 }}>{I.chevL} Overview</button>
          <h1 className="page-title">Sprint quality</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Composition of what shipped in Sprint 12, and how that mix is trending.
          </p>
        </div>
        <div className="page-head-actions">
          <span className="pill"><span className="dot" style={{ background: 'var(--info)' }}/>Active: Sprint 12</span>
        </div>
      </div>

      <div className="stats">
        <Stat2 label="Total tickets shipped" value={cur.total} sub={`+${cur.total - sprints[5].total} vs S-11`} tone="ok"/>
        <Stat2 label="Stories"               value={cur.stories} sub="38% of mix" tone=""/>
        <Stat2 label="Bugs"                  value={cur.bugs}    sub="−42% vs S-11" tone="ok"/>
        <Stat2 label="Sprint completion"     value="87%"          sub="committed → done" tone="ok"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 16 }}>
        {/* Sprint mix chart */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Sprint composition — last 7 sprints</div>
            <div className="card-sub">Stacked breakdown of issue types per sprint</div>
          </div>
          <div style={{ padding: '8px 20px 20px' }}>
            <StackedSprints data={sprints}/>
            <div className="row" style={{ gap: 14, marginTop: 14, fontSize: 12, flexWrap: 'wrap' }}>
              <Legend color="oklch(0.55 0.13 145)" label="Stories"/>
              <Legend color="oklch(0.55 0.13 235)" label="Tasks"/>
              <Legend color="oklch(0.62 0.12 215)" label="Sub-tasks"/>
              <Legend color="oklch(0.58 0.17 27)" label="Bugs"/>
            </div>
          </div>
        </div>

        {/* Current sprint composition donut */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">Sprint 12 mix</div>
            <div className="card-sub">{total} tickets total</div>
          </div>
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' }}>
            <Donut segs={[
              { label: 'Stories',   v: cur.stories, color: 'oklch(0.55 0.13 145)' },
              { label: 'Tasks',     v: cur.tasks,   color: 'oklch(0.55 0.13 235)' },
              { label: 'Sub-tasks', v: cur.subs,    color: 'oklch(0.62 0.12 215)' },
              { label: 'Bugs',      v: cur.bugs,    color: 'oklch(0.58 0.17 27)' },
            ]}/>
            <div className="col" style={{ gap: 10 }}>
              {[
                { l: 'Stories', v: cur.stories, c: 'oklch(0.55 0.13 145)' },
                { l: 'Tasks',   v: cur.tasks,   c: 'oklch(0.55 0.13 235)' },
                { l: 'Sub-tasks', v: cur.subs, c: 'oklch(0.62 0.12 215)' },
                { l: 'Bugs',    v: cur.bugs,   c: 'oklch(0.58 0.17 27)' },
              ].map(r => (
                <div key={r.l} className="row" style={{ gap: 8, fontSize: 13 }}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: r.c }}/>
                  <span style={{ flex: 1 }}>{r.l}</span>
                  <span className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{r.v}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{Math.round((r.v / total) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Epic progress */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Active epics</div>
          <div className="card-sub">Progress against committed scope</div>
        </div>
        <div>
          {epics.map(e => {
            const pct = (e.done / e.planned) * 100;
            const tone = e.status === 'done' ? 'ok' : e.status === 'at-risk' ? 'warn' : 'info';
            const label = e.status === 'done' ? 'Done' : e.status === 'at-risk' ? 'At risk' : 'On track';
            return (
              <div key={e.key} style={{
                display: 'grid', gridTemplateColumns: '1fr 100px 1fr 110px 100px',
                alignItems: 'center', gap: 14, padding: '14px 20px',
                borderBottom: '1px solid var(--border-soft)',
              }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <UI.TypeBadge type="Epic"/>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{e.key}</span>
                  </div>
                  <div style={{ fontWeight: 500, marginTop: 2 }}>{e.name}</div>
                </div>
                <div className="mono" style={{ fontSize: 12, color: 'var(--ink-2)', fontVariantNumeric: 'tabular-nums' }}>
                  {e.done} / {e.planned} pts
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{
                    width: pct + '%',
                    background: tone === 'warn' ? 'var(--warn)' : tone === 'ok' ? 'var(--ok)' : 'var(--accent)',
                  }}/>
                </div>
                <div className="row" style={{ gap: 4 }}>
                  {e.bugs > 0 && <span className="tag" style={{ background: 'var(--err-soft)', color: 'var(--err)', borderColor: 'transparent' }}>{e.bugs} bug{e.bugs > 1 ? 's' : ''}</span>}
                </div>
                <span className={'pill ' + tone}>{label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StackedSprints({ data }) {
  const max = Math.max(...data.map(d => d.total));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 12, alignItems: 'end', height: 200 }}>
      {data.map((d, i) => {
        const isLast = i === data.length - 1;
        const segs = [
          { v: d.stories, c: 'oklch(0.55 0.13 145)' },
          { v: d.tasks,   c: 'oklch(0.55 0.13 235)' },
          { v: d.subs,    c: 'oklch(0.62 0.12 215)' },
          { v: d.bugs,    c: 'oklch(0.58 0.17 27)' },
        ];
        const totalH = (d.total / max) * 170;
        return (
          <div key={d.s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>{d.total}</div>
            <div style={{
              width: '70%', height: totalH, borderRadius: '6px 6px 0 0',
              display: 'flex', flexDirection: 'column-reverse', overflow: 'hidden',
              outline: isLast ? '2px solid var(--accent)' : 'none', outlineOffset: 2,
            }}>
              {segs.map((s, j) => (
                <div key={j} style={{ height: `${(s.v / d.total) * 100}%`, background: s.c }}/>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', fontFamily: 'var(--font-mono)' }}>{d.s}</div>
          </div>
        );
      })}
    </div>
  );
}

function Legend({ color, label }) {
  return <span className="row" style={{ gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: color }}/>{label}</span>;
}

function Donut({ segs }) {
  const total = segs.reduce((s, x) => s + x.v, 0);
  const r = 56, c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg viewBox="0 0 140 140" style={{ width: '100%', maxWidth: 160 }}>
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth="18"/>
      {segs.map((s, i) => {
        const len = (s.v / total) * c;
        const dash = `${len} ${c - len}`;
        const dashoffset = -offset;
        offset += len;
        return (
          <circle key={i} cx="70" cy="70" r={r} fill="none"
            stroke={s.color} strokeWidth="18"
            strokeDasharray={dash} strokeDashoffset={dashoffset}
            transform="rotate(-90 70 70)"/>
        );
      })}
      <text x="70" y="68" textAnchor="middle" fontSize="22" fontWeight="600" fill="var(--ink)">{total}</text>
      <text x="70" y="86" textAnchor="middle" fontSize="11" fill="var(--ink-3)">tickets</text>
    </svg>
  );
}

// ============================================================
// AI Adaptability
// ============================================================
function OverviewAI({ go }) {
  const adoption = [
    { w: 'W-1',  v: 32 },
    { w: 'W-2',  v: 38 },
    { w: 'W-3',  v: 44 },
    { w: 'W-4',  v: 49 },
    { w: 'W-5',  v: 53 },
    { w: 'W-6',  v: 58 },
    { w: 'W-7',  v: 61 },
    { w: 'W-8',  v: 64 },
    { w: 'W-9',  v: 67 },
    { w: 'W-10', v: 68 },
  ];
  const tools = [
    { name: 'Claude Code',    users: 18, prs: 142, savedHrs: 42, color: 'oklch(0.62 0.13 50)' },
    { name: 'Cursor',         users: 14, prs: 89,  savedHrs: 28, color: 'oklch(0.55 0.18 255)' },
    { name: 'GitHub Copilot', users: 16, prs: 76,  savedHrs: 18, color: 'oklch(0.55 0.13 145)' },
    { name: 'v0',             users: 6,  prs: 21,  savedHrs: 6,  color: 'oklch(0.50 0.05 245)' },
  ];
  const devs = [
    { name: 'Tom Reilly',   role: 'Backend',     score: 94, prs: 28, aiPrs: 26, accept: 0.78 },
    { name: 'Devon Park',   role: 'Mobile',      score: 91, prs: 24, aiPrs: 22, accept: 0.74 },
    { name: 'Jamal Brooks', role: 'Frontend',    score: 88, prs: 22, aiPrs: 19, accept: 0.71 },
    { name: 'Mia Garcia',   role: 'Eng Mgr',     score: 85, prs: 14, aiPrs: 11, accept: 0.69 },
    { name: 'Asha Iyer',    role: 'Data',        score: 76, prs: 18, aiPrs: 13, accept: 0.62 },
    { name: 'Ray Sullivan', role: 'SRE',         score: 71, prs: 14, aiPrs: 9,  accept: 0.58 },
    { name: 'Nina Cole',    role: 'Design',      score: 54, prs: 7,  aiPrs: 3,  accept: 0.41 },
    { name: 'Maria Zheng',  role: 'PM',          score: 38, prs: 4,  aiPrs: 1,  accept: 0.28 },
  ];

  return (
    <div className="content wide" data-screen-label="Overview / AI">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => go('overview')} style={{ marginBottom: 6 }}>{I.chevL} Overview</button>
          <h1 className="page-title">AI adaptability</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            How fast your team is folding AI into the development loop, and where it's actually moving the needle.
          </p>
        </div>
        <div className="page-head-actions">
          <span className="pill accent"><span className="dot"/>Q2 spotlight</span>
        </div>
      </div>

      <div className="stats">
        <Stat2 label="Active AI users"         value="21 / 24" sub="88% of engineers" tone="ok"/>
        <Stat2 label="PRs touching AI"         value="68%"     sub="+11 pts vs Q1"     tone="ok"/>
        <Stat2 label="Suggestion accept rate"  value="64%"     sub="of AI proposals merged" tone=""/>
        <Stat2 label="Hours saved (est)"       value="~96 / wk" sub="self-reported + telemetry" tone="ok"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Adoption curve</div>
            <div className="card-sub">% of merged PRs touching AI tooling, last 10 weeks</div>
          </div>
          <div style={{ padding: '8px 20px 20px' }}>
            <AdoptionChart data={adoption}/>
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Tool mix</div>
            <div className="card-sub">PRs by AI assistant</div>
          </div>
          <div style={{ padding: 20 }}>
            <div className="col" style={{ gap: 12 }}>
              {tools.map(t => {
                const max = Math.max(...tools.map(x => x.prs));
                return (
                  <div key={t.name}>
                    <div className="row" style={{ marginBottom: 4, fontSize: 13 }}>
                      <span style={{ fontWeight: 500 }}>{t.name}</span>
                      <div className="spacer"/>
                      <span className="muted" style={{ fontSize: 11.5 }}>{t.users} users · ~{t.savedHrs} hrs/wk</span>
                      <span className="mono" style={{ marginLeft: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{t.prs}</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: ((t.prs / max) * 100) + '%', background: t.color }}/>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Per-dev AI score */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Engineer AI adoption</div>
          <div className="card-sub">Composite score from PR mix, suggestion-accept rate, and tool active-time</div>
        </div>
        <div className="tbl-wrap" style={{ borderRadius: 0, border: 'none' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Engineer</th>
                <th style={{ width: 90 }}>PRs</th>
                <th style={{ width: 100 }}>AI PRs</th>
                <th style={{ width: 130 }}>Accept rate</th>
                <th>Adoption score</th>
                <th style={{ width: 130 }}>Tier</th>
              </tr>
            </thead>
            <tbody>
              {devs.map(d => {
                const tier = d.score >= 85 ? { t: 'Power user',  tone: 'ok' }
                            : d.score >= 65 ? { t: 'Adopting',    tone: 'info' }
                            : d.score >= 45 ? { t: 'Exploring',   tone: 'warn' }
                            : { t: 'Holdout', tone: 'err' };
                return (
                  <tr key={d.name}>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <UI.Avatar name={d.name}/>
                        <div>
                          <div style={{ fontWeight: 500 }}>{d.name}</div>
                          <div className="muted" style={{ fontSize: 11.5 }}>{d.role}</div>
                        </div>
                      </div>
                    </td>
                    <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{d.prs}</td>
                    <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{d.aiPrs}</td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div style={{ flex: 1, maxWidth: 80 }}>
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: (d.accept * 100) + '%', background: 'var(--accent)' }}/>
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{Math.round(d.accept * 100)}%</span>
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        <div style={{ flex: 1, maxWidth: 200 }}>
                          <div className="progress-track">
                            <div className="progress-fill" style={{
                              width: d.score + '%',
                              background: tier.tone === 'ok' ? 'var(--ok)' : tier.tone === 'info' ? 'var(--accent)' : tier.tone === 'warn' ? 'var(--warn)' : 'var(--err)',
                            }}/>
                          </div>
                        </div>
                        <span className="mono" style={{ fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{d.score}</span>
                      </div>
                    </td>
                    <td><span className={'pill ' + tier.tone}>{tier.t}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card sunken" style={{ marginTop: 16, padding: 14, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
        <span style={{ color: 'var(--accent-ink)', marginTop: 2 }}>{I.sparkles}</span>
        <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
          <b>How this is computed.</b> The adoption score blends three signals from the synced Jira workspace + git telemetry: percent of PRs that reference an AI session, accept rate of AI suggestions, and active-time in supported tools per coding hour. Tunable in Settings → Integrations → AI signals.
        </div>
      </div>
    </div>
  );
}

function AdoptionChart({ data }) {
  const w = 600, h = 180, pad = 30;
  const max = Math.max(...data.map(d => d.v));
  const pts = data.map((d, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - (d.v / max) * (h - pad * 2);
    return [x, y];
  });
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = path + ` L ${pts[pts.length - 1][0]},${h - pad} L ${pts[0][0]},${h - pad} Z`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 'auto' }}>
      {[0, 25, 50, 75].map(p => {
        const y = h - pad - (p / max) * (h - pad * 2);
        return <g key={p}>
          <line x1={pad} y1={y} x2={w - pad} y2={y} stroke="var(--border-soft)"/>
          <text x="6" y={y + 3} fontSize="10" fill="var(--ink-3)">{p}%</text>
        </g>;
      })}
      <path d={area} fill="var(--accent)" opacity="0.12"/>
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
      {pts.map((p, i) => (
        <g key={i}>
          <circle cx={p[0]} cy={p[1]} r={i === pts.length - 1 ? 5 : 3} fill="var(--accent)" stroke="var(--bg-elev)" strokeWidth="2"/>
          {i === pts.length - 1 && (
            <text x={p[0]} y={p[1] - 12} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--accent-ink)">{data[i].v}%</text>
          )}
        </g>
      ))}
      {data.map((d, i) => (
        <text key={i} x={pad + (i / (data.length - 1)) * (w - pad * 2)} y={h - 8} textAnchor="middle" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">{d.w}</text>
      ))}
    </svg>
  );
}

window.SCREENS_OV = { OverviewHome, OverviewProductivity, OverviewQuality, OverviewAI };
