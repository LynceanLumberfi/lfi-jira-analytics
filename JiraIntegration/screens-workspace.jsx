/* global React, UI, I */
// =============================================================
// Workspace pages — Sprint Intelligence-style:
//  - sticky FilterBar (Teams + Assignees multi-select + search)
//  - sub-tabs row under page header (Overview / AI & Quality / Tickets / Cost)
//  - score bars, KPI cards, chart helpers reuse from screens-overview.jsx
//  - slide-over ticket detail
// =============================================================
const { useState, useMemo, useRef, useEffect } = React;

// ---------- Score color (red→green over 0..5) ----------
function scoreColor(s) {
  const n = Math.max(0, Math.min(5, s || 0));
  // 0 → err, 2.5 → warn, 5 → ok
  if (n < 1) return 'var(--err)';
  if (n < 2) return 'oklch(0.62 0.18 35)';
  if (n < 3) return 'var(--warn)';
  if (n < 4) return 'oklch(0.65 0.16 110)';
  return 'var(--ok)';
}
function ScoreBar({ score }) {
  const pct = (Math.max(0, Math.min(5, score || 0)) / 5) * 100;
  const c = scoreColor(score || 0);
  return (
    <div className="row" style={{ gap: 8, minWidth: 0 }}>
      <div className="progress-track" style={{ width: 64, flexShrink: 0 }}>
        <div className="progress-fill" style={{ width: pct + '%', background: c }}/>
      </div>
      <span className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, color: c, fontWeight: 600, minWidth: 28 }}>
        {(typeof score === 'number' ? score : 0).toFixed(1)}
      </span>
    </div>
  );
}

// ---------- Multi-select dropdown ----------
function MultiSelect({ label, options, selected, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const all = selected.length === 0;
  const display = all ? `All ${label}` : selected.length === 1 ? selected[0] : `${selected.length} ${label}`;
  const toggle = v => selected.includes(v) ? onChange(selected.filter(x => x !== v)) : onChange([...selected, v]);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setOpen(o => !o)}
        className="btn"
        style={{ minWidth: 150, justifyContent: 'space-between', borderColor: open ? 'var(--accent)' : undefined }}>
        <span style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis' }}>{display}</span>
        {!all && (
          <span onClick={e => { e.stopPropagation(); onChange([]); }}
            style={{ marginLeft: 6, color: 'var(--ink-3)', cursor: 'pointer' }}
            title="Clear">×</span>
        )}
        <span style={{ color: 'var(--ink-3)', marginLeft: 4, fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="card" style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0,
          minWidth: 220, maxHeight: 280, overflow: 'auto', zIndex: 50,
          padding: 4, boxShadow: 'var(--shadow-lg)',
        }}>
          <button className="sidebar-subitem" onClick={() => onChange([])}
            style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}>
            <span style={{
              width: 14, height: 14, borderRadius: 3, flexShrink: 0,
              border: '1px solid var(--border)',
              background: all ? 'var(--accent)' : 'transparent',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontSize: 10,
            }}>{all ? '✓' : ''}</span>
            All {label}
          </button>
          <div style={{ height: 1, background: 'var(--border-soft)', margin: '4px 0' }}/>
          {options.map(opt => {
            const checked = selected.includes(opt);
            return (
              <button key={opt} className="sidebar-subitem" onClick={() => toggle(opt)}
                style={{ width: '100%', justifyContent: 'flex-start', gap: 8 }}>
                <span style={{
                  width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                  border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                  background: checked ? 'var(--accent)' : 'transparent',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  color: 'white', fontSize: 10,
                }}>{checked ? '✓' : ''}</span>
                {opt}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Filter bar ----------
function FilterBar({ teams, people, f, setF, total, filteredCount, showTeam }) {
  const active = (showTeam && f.teams.length) || f.people.length || (f.sprints && f.sprints.length) || f.search.trim();
  const SPRINTS = ['Sprint 14', 'Sprint 13', 'Sprint 12', 'Sprint 11', 'Sprint 10'];
  const sprints = f.sprints || [];
  return (
    <div style={{
      position: 'sticky', top: 0, zIndex: 5,
      background: 'var(--bg-glass)', backdropFilter: 'blur(8px)',
      borderBottom: '1px solid var(--border-soft)',
      margin: '-24px -32px 20px', padding: '12px 32px',
      display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10,
    }}>
      <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>Filters</span>
      {showTeam && <MultiSelect label="Team" options={teams} selected={f.teams} onChange={v => setF({ ...f, teams: v })}/>}
      <MultiSelect label="Sprint" options={SPRINTS} selected={sprints} onChange={v => setF({ ...f, sprints: v })}/>
      <MultiSelect label="Resources" options={people} selected={f.people} onChange={v => setF({ ...f, people: v })}/>
      <input className="input" placeholder="Search key, summary, or assignee…"
        value={f.search} onChange={e => setF({ ...f, search: e.target.value })}
        style={{ width: 220, padding: '6px 10px', fontSize: 13 }}/>
      {active ? (
        <button className="btn ghost sm" onClick={() => setF({ teams: [], people: [], sprints: [], search: '' })} style={{ color: 'var(--err)' }}>Clear all</button>
      ) : null}
      <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-3)' }}>
        Showing <b style={{ color: 'var(--ink)' }}>{filteredCount}</b> of {total}
      </div>
    </div>
  );
}

// Persistent filter state hook
function useFilters() {
  const [f, setF] = useState({ teams: [], people: [], sprints: [], search: '' });
  return [f, setF];
}
function applyFilters(issues, f) {
  const q = f.search.trim().toLowerCase();
  const sprints = f.sprints || [];
  return issues.filter(i =>
    (f.teams.length === 0 || f.teams.includes(i.team)) &&
    (f.people.length === 0 || f.people.includes(i.assignee)) &&
    (sprints.length === 0 || !i.sprint || sprints.includes(i.sprint)) &&
    (q === '' || i.issue_key.toLowerCase().includes(q) || (i.summary || '').toLowerCase().includes(q) || (i.assignee || '').toLowerCase().includes(q))
  );
}

// ---------- Sub-tabs ----------
const SUBTABS = [
  { key: 'overview',     label: 'Overview' },
  { key: 'productivity', label: 'Productivity' },
  { key: 'quality',      label: 'AI & Quality' },
  { key: 'ai',           label: 'AI Adaptability' },
  { key: 'tickets',      label: 'Tickets' },
  { key: 'cost',         label: 'Cost & Tokens' },
];
function SubTabs({ active, go, team }) {
  if (!team) return null;
  return (
    <div className="row" style={{ gap: 4, marginBottom: 18, borderBottom: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
      {[
        { key: 'overview',     label: 'Hub',                  suffix: '' },
        { key: 'productivity', label: 'Resource productivity',suffix: '-productivity' },
        { key: 'ai',           label: 'AI adaptability',      suffix: '-ai' },
        { key: 'quality',      label: 'AI & Quality',         suffix: '-quality' },
        { key: 'tickets',      label: 'Tickets',              suffix: '-tickets' },
      ].map(t => {
        const a = active === t.key;
        return (
          <button key={t.key} onClick={() => go('team-' + team.key + t.suffix)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              padding: '8px 12px', fontSize: 13, fontWeight: a ? 600 : 400,
              color: a ? 'var(--ink)' : 'var(--ink-3)',
              borderBottom: a ? '2px solid var(--accent)' : '2px solid transparent',
              marginBottom: -1,
            }}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------- Score distribution mini-chart ----------
function ScoreDist({ items, key: scoreKey, title, avg }) {
  const dist = [0, 0, 0, 0, 0, 0];
  items.forEach(it => { const s = Math.max(0, Math.min(5, Math.round(it[scoreKey] ?? 0))); dist[s]++; });
  const max = Math.max(...dist) || 1;
  return (
    <div className="card">
      <div className="card-header">
        <div className="card-title">{title}</div>
        <div className="card-sub">Avg <b style={{ color: scoreColor(avg) }}>{avg.toFixed(2)}</b> · {items.length} issues</div>
      </div>
      <div style={{ padding: '8px 20px 20px', display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 12, alignItems: 'end', height: 200 }}>
        {dist.map((n, i) => (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)', fontWeight: 500 }}>{n}</div>
            <div style={{
              width: '70%', height: (n / max) * 150,
              background: scoreColor(i),
              borderRadius: '6px 6px 0 0',
              transition: 'height 0.4s ease',
            }}/>
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--ink-3)' }}>{i}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// AI & Quality page
// ============================================================
function PageQuality({ go, team }) {
  const D = window.LUMBER_ISSUES;
  const [f, setF] = useFilters();
  const [view, setView] = useState('All'); // All | By Team | By Resource
  const teamScoped = useMemo(() => team ? D.issues.filter(i => team.jiraTeams.includes(i.team)) : D.issues, [team, D.issues]);
  const filtered = useMemo(() => applyFilters(teamScoped, f), [f, teamScoped]);
  const avgQ = filtered.length ? filtered.reduce((a, b) => a + b.quality_score, 0) / filtered.length : 0;
  const avgAI = filtered.length ? filtered.reduce((a, b) => a + b.ai_score, 0) / filtered.length : 0;
  const skillPct = filtered.length ? (filtered.filter(i => i.skill_name).length / filtered.length) * 100 : 0;
  const noDescPct = filtered.length ? (filtered.filter(i => !i.has_description).length / filtered.length) * 100 : 0;

  const teamAgg = useMemo(() => aggregate(filtered, 'team'), [filtered]);
  const personAgg = useMemo(() => aggregate(filtered, 'assignee'), [filtered]);

  return (
    <div className="content wide" data-screen-label="Overview / AI & Quality">
      <FilterBar teams={team ? team.jiraTeams : D.teams} people={D.people} f={f} setF={setF} total={teamScoped.length} filteredCount={filtered.length} showTeam={team && team.key === 'all'}/>

      <div className="page-head">
        <div>
          <h1 className="page-title">{team ? team.label + ' · ' : ''}AI &amp; Quality</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Score analysis across teams and individuals — quality of tickets and how AI-assisted the work was.
          </p>
        </div>
      </div>

      <SubTabs active="quality" go={go} team={team}/>

      <div className="stats">
        <Kpi label="Avg quality" value={avgQ.toFixed(2)} sub="0–5 scale" tone={avgQ >= 3.5 ? 'ok' : avgQ >= 2.5 ? 'warn' : 'err'}/>
        <Kpi label="Avg AI score" value={avgAI.toFixed(2)} sub="0–5 scale" tone={avgAI >= 3.5 ? 'ok' : avgAI >= 2.5 ? 'warn' : 'err'}/>
        <Kpi label="Skill adopted" value={skillPct.toFixed(0) + '%'} sub={`${filtered.filter(i => i.skill_name).length} issues`} tone="info"/>
        <Kpi label="No description" value={noDescPct.toFixed(0) + '%'} sub={`${filtered.filter(i => !i.has_description).length} issues`} tone={noDescPct > 20 ? 'err' : ''}/>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 14 }}>
        {['All', 'By Team', 'By Resource'].map(v => (
          <button key={v} onClick={() => setView(v)}
            className={'btn' + (view === v ? ' primary' : '')} style={{ padding: '6px 12px' }}>{v}</button>
        ))}
      </div>

      {view === 'All' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <ScoreDist items={filtered} key={undefined} {...{ key: 'quality_score', title: 'Quality score distribution', avg: avgQ }}/>
          <ScoreDist items={filtered} {...{ key: 'ai_score', title: 'AI score distribution', avg: avgAI }}/>
        </div>
      )}
      {view === 'By Team' && <AggTable rows={teamAgg} colKey="team" colLabel="Team"/>}
      {view === 'By Resource' && <AggTable rows={personAgg} colKey="assignee" colLabel="Assignee"/>}
    </div>
  );
}

function aggregate(items, key) {
  const map = new Map();
  items.forEach(it => {
    const k = it[key] || '—';
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  return Array.from(map.entries()).map(([k, arr]) => {
    const avg = (kk) => { const v = arr.map(x => x[kk]).filter(x => x != null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; };
    return {
      [key]: k,
      count: arr.length,
      avgQ:  avg('quality_score'),
      avgAI: avg('ai_score'),
      sp:    arr.reduce((a, b) => a + (b.story_points || 0), 0),
      estAvg:   avg('estimate_hours'),
      spentAvg: avg('time_spent_hours'),
      skillPct: arr.length ? (arr.filter(x => x.skill_name).length / arr.length) * 100 : 0,
      noDesc: arr.filter(x => !x.has_description).length,
      overBudget: arr.filter(x => x.time_spent_hours > x.estimate_hours).length,
    };
  }).sort((a, b) => b.count - a.count);
}

function AggTable({ rows, colKey, colLabel }) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>{colLabel}</th>
            <th style={{ width: 80 }}>Issues</th>
            <th style={{ width: 160 }}>Avg quality</th>
            <th style={{ width: 160 }}>Avg AI</th>
            <th style={{ width: 100 }}>Skill %</th>
            <th style={{ width: 90 }}>No desc</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r[colKey]}>
              <td style={{ fontWeight: 500 }}>{r[colKey]}</td>
              <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.count}</td>
              <td><ScoreBar score={r.avgQ}/></td>
              <td><ScoreBar score={r.avgAI}/></td>
              <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.skillPct.toFixed(0)}%</td>
              <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{r.noDesc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Kpi({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={'stat-sub ' + (tone || '')}>{sub}</div>
    </div>
  );
}

// ============================================================
// Tickets page (with slide-over detail)
// ============================================================
const TYPE_TONE = { Story: 'ok', Task: 'info', Bug: 'err', 'Sub-task': '' };

function PageTickets({ go, team }) {
  const D = window.LUMBER_ISSUES;
  const [f, setF] = useFilters();
  const [sortCol, setSortCol] = useState('issue_key');
  const [sortDir, setSortDir] = useState('asc');
  const [open, setOpen] = useState(null);

  const teamScoped = useMemo(() => team ? D.issues.filter(i => team.jiraTeams.includes(i.team)) : D.issues, [team, D.issues]);
  const filtered = useMemo(() => applyFilters(teamScoped, f), [f, teamScoped]);
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number') return sortDir === 'asc' ? av - bv : bv - av;
      return sortDir === 'asc' ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const toggleSort = c => {
    if (sortCol === c) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(c); setSortDir('desc'); }
  };
  const sortInd = c => sortCol !== c ? '↕' : sortDir === 'asc' ? '↑' : '↓';

  return (
    <div className="content wide" data-screen-label="Overview / Tickets">
      <FilterBar teams={team ? team.jiraTeams : D.teams} people={D.people} f={f} setF={setF} total={teamScoped.length} filteredCount={filtered.length} showTeam={team && team.key === 'all'}/>

      <div className="page-head">
        <div>
          <h1 className="page-title">{team ? team.label + ' · ' : ''}Tickets</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            Every synced issue with its quality and AI scores. Click any row for full detail.
          </p>
        </div>
      </div>

      <SubTabs active="tickets" go={go} team={team}/>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              {[
                { k: 'issue_key', l: 'Key', w: 90 },
                { k: 'assignee',  l: 'Assignee', w: 150 },
                { k: 'team',      l: 'Team', w: 110 },
                { k: 'issue_type',l: 'Type', w: 90 },
                { k: 'quality_score', l: 'Quality', w: 130 },
                { k: 'ai_score',  l: 'AI', w: 130 },
                { k: 'story_points', l: 'SP', w: 60 },
                { k: 'summary',   l: 'Summary' },
                { k: 'skill_name',l: 'Skill', w: 110 },
              ].map(c => (
                <th key={c.k} style={{ width: c.w, cursor: 'pointer' }} onClick={() => toggleSort(c.k)}>
                  {c.l} <span style={{ opacity: 0.5, fontSize: 10 }}>{sortInd(c.k)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map(i => (
              <tr key={i.issue_key} style={{ cursor: 'pointer' }} onClick={() => setOpen(i)}>
                <td><span className="mono" style={{ fontSize: 12, color: 'var(--accent-ink)', fontWeight: 500 }}>{i.issue_key}</span></td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <UI.Avatar name={i.assignee} size="sm"/>
                    <span style={{ fontSize: 13 }}>{i.assignee}</span>
                  </div>
                </td>
                <td className="muted" style={{ fontSize: 12 }}>{i.team}</td>
                <td><UI.TypeBadge type={i.issue_type}/></td>
                <td><ScoreBar score={i.quality_score}/></td>
                <td><ScoreBar score={i.ai_score}/></td>
                <td className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{i.story_points}</td>
                <td style={{ fontSize: 13, color: 'var(--ink-2)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.summary}</td>
                <td>{i.skill_name ? <span className="tag">{i.skill_name}</span> : <span className="muted" style={{ fontSize: 12 }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 200 && (
          <div style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--ink-3)' }}>
            Showing first 200 of {sorted.length} matches
          </div>
        )}
      </div>

      {open && <TicketSlideOver issue={open} onClose={() => setOpen(null)}/>}
    </div>
  );
}

function TicketSlideOver({ issue, onClose }) {
  return (
    <>
      <div onClick={onClose} style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 60,
        animation: 'fadeIn 0.2s ease',
      }}/>
      <aside style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(560px, 100vw)',
        background: 'var(--bg-elev)', borderLeft: '1px solid var(--border)',
        zIndex: 61, display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 32px rgba(0,0,0,0.18)',
        animation: 'slideInR 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
      }}>
        <div style={{ padding: '18px 22px', borderBottom: '1px solid var(--border-soft)' }}>
          <div className="row">
            <span className="mono" style={{ fontSize: 12, color: 'var(--accent-ink)', fontWeight: 500 }}>{issue.issue_key}</span>
            <div className="spacer"/>
            <button className="btn ghost sm" onClick={onClose}>{I.x}</button>
          </div>
          <h2 style={{ fontSize: 17, fontWeight: 600, marginTop: 8, lineHeight: 1.35 }}>{issue.summary}</h2>
          <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            <UI.TypeBadge type={issue.issue_type}/>
            <span className="pill"><UI.Avatar name={issue.assignee} size="sm"/>{issue.assignee}</span>
            <span className="tag">{issue.team}</span>
            <span className="tag">{issue.sprint}</span>
            <span className="tag">{issue.priority}</span>
            <span className="pill">{issue.status}</span>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          <Section label="Quality score" badge={<span className="pill" style={{ background: scoreColor(issue.quality_score) + '22', color: scoreColor(issue.quality_score), borderColor: 'transparent' }}>{issue.quality_score.toFixed(2)} / 5</span>}>
            <ScoreBar score={issue.quality_score}/>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 10 }}>{issue.quality_reason}</p>
          </Section>

          <Section label="AI score" badge={<span className="pill" style={{ background: scoreColor(issue.ai_score) + '22', color: scoreColor(issue.ai_score), borderColor: 'transparent' }}>{issue.ai_score.toFixed(2)} / 5</span>}>
            <ScoreBar score={issue.ai_score}/>
            <p style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.5, marginTop: 10 }}>{issue.ai_reason}</p>
          </Section>

          <Section label="Effort">
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Pair k="Story points" v={issue.story_points}/>
              <Pair k="Estimate" v={issue.estimate_hours + ' h'}/>
              <Pair k="Spent" v={issue.time_spent_hours + ' h'} tone={issue.time_spent_hours > issue.estimate_hours ? 'err' : ''}/>
            </div>
          </Section>

          <Section label="All fields">
            <div className="card sunken" style={{ padding: 0, overflow: 'hidden' }}>
              <table className="tbl" style={{ fontSize: 12 }}>
                <tbody>
                  {Object.entries(issue).filter(([k]) => !['ai_reason', 'quality_reason'].includes(k)).map(([k, v]) => (
                    <tr key={k}>
                      <td style={{ width: '38%', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent-ink)', verticalAlign: 'top' }}>{k}</td>
                      <td style={{ color: 'var(--ink-2)', verticalAlign: 'top' }}>
                        {v == null ? <span className="muted">null</span>
                          : typeof v === 'boolean' ? <span className={'pill ' + (v ? 'ok' : 'err')}>{String(v)}</span>
                          : String(v)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </aside>
      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInR { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>
    </>
  );
}

function Section({ label, badge, children }) {
  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500 }}>{label}</span>
        <div className="spacer"/>
        {badge}
      </div>
      {children}
    </div>
  );
}
function Pair({ k, v, tone }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 11 }}>{k}</div>
      <div className={'mono ' + (tone || '')} style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontVariantNumeric: 'tabular-nums', color: tone === 'err' ? 'var(--err)' : 'var(--ink)' }}>{v}</div>
    </div>
  );
}

// ============================================================
// Cost & Tokens page (placeholder hi-fi)
// ============================================================
function PageCost({ go }) {
  const D = window.LUMBER_ISSUES;
  const c = D.cost;
  const totalTokens = c.totalInput + c.totalOutput + c.cacheCreate + c.cacheRead;
  const cacheHit = c.totalInput + c.cacheRead > 0 ? (c.cacheRead / (c.totalInput + c.cacheRead)) * 100 : 0;
  const fmtUsd = n => '$' + (n || 0).toFixed(n >= 100 ? 2 : 4);
  const fmtShort = n => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(n);
  const breakdown = [
    { name: 'Input',        v: c.totalInput,  color: 'oklch(0.55 0.13 235)' },
    { name: 'Output',       v: c.totalOutput, color: 'oklch(0.55 0.13 145)' },
    { name: 'Cache create', v: c.cacheCreate, color: 'oklch(0.65 0.16 75)'  },
    { name: 'Cache read',   v: c.cacheRead,   color: 'oklch(0.55 0.18 290)' },
  ];
  const max = Math.max(...breakdown.map(b => b.v));

  return (
    <div className="content wide" data-screen-label="Overview / Cost">
      <div className="page-head">
        <div>
          <h1 className="page-title">Cost &amp; tokens</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>
            What it costs Lumber to score and summarise the synced Jira workspace each run.
          </p>
        </div>
      </div>

      <div className="stats">
        <Kpi label="Total cost"     value={fmtUsd(c.totalCost)} sub={c.calls + ' API calls'} tone="info"/>
        <Kpi label="Total tokens"   value={fmtShort(totalTokens)} sub="across all steps" tone=""/>
        <Kpi label="Cache hit rate" value={cacheHit.toFixed(1) + '%'} sub="read / (input + read)" tone="ok"/>
        <Kpi label="Cost / 1K tok"  value={fmtUsd((c.totalCost / totalTokens) * 1000)} sub="effective rate" tone=""/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">Token breakdown</div>
            <div className="card-sub">Across all pipeline calls</div>
          </div>
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
            {breakdown.map(b => (
              <div key={b.name}>
                <div className="row" style={{ marginBottom: 4, fontSize: 12 }}>
                  <span style={{ fontWeight: 500 }}>{b.name}</span>
                  <div className="spacer"/>
                  <span className="mono" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtShort(b.v)}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: ((b.v / max) * 100) + '%', background: b.color }}/>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">Pipeline step costs</div>
            <div className="card-sub">Per stage of the scoring pipeline</div>
          </div>
          <div>
            {Object.entries(c.steps).map(([name, s]) => (
              <div key={name} style={{
                display: 'grid', gridTemplateColumns: '1fr 90px 90px 90px',
                gap: 12, alignItems: 'center', padding: '12px 20px',
                borderBottom: '1px solid var(--border-soft)',
              }}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>{name}</span>
                    <span className={'pill ' + (s.status === 'done' ? 'ok' : s.status === 'skipped' ? 'warn' : 'err')}>{s.status}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{s.calls} calls</div>
                </div>
                <div className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 13, fontWeight: 600 }}>{fmtUsd(s.cost)}</div>
                <div className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--ink-2)' }}>{fmtShort(s.in)} in</div>
                <div className="mono" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 12, color: 'var(--ink-2)' }}>{fmtShort(s.out)} out</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.SCREENS_WS = { PageQuality, PageTickets, PageCost, FilterBar, applyFilters, useFilters, SubTabs };
