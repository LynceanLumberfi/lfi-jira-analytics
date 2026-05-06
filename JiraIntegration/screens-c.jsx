/* global React, UI, I, LUMBER_DATA */
// Screens 05 Review, 06 Manual Mapping, 07 Conflict
const { useState, useMemo } = React;

// ---------------- Screen 05 — Sync Review ----------------
function ScreenReview({ go, demoState }) {
  const D = window.LUMBER_DATA;
  const [tab, setTab] = useState('All');
  const [selected, setSelected] = useState(new Set());

  const baseRows = D.JIRA_TICKETS;
  const rows = useMemo(() => {
    return baseRows.map((r, i) => {
      let action;
      if (r.action === 'create') action = 'create';
      else if (r.confidence == null) action = 'create';
      else if (r.confidence < 70) action = 'needs-mapping';
      else action = 'auto-match';
      return { ...r, action };
    });
  }, []);

  const heavy = demoState === 'conflict-heavy';
  const counts = {
    all: rows.length + (heavy ? 18 : 0),
    create: rows.filter(r => r.action === 'create').length + (heavy ? 8 : 0),
    update: rows.filter(r => r.action === 'auto-match').length,
    map:    rows.filter(r => r.action === 'needs-mapping').length + (heavy ? 10 : 0),
    skipped: heavy ? 3 : 1,
  };

  const tabFilter = {
    'All':           () => true,
    'Created':       (r) => r.action === 'create',
    'Updated':       (r) => r.action === 'auto-match',
    'Skipped':       () => false,
    'Needs Mapping': (r) => r.action === 'needs-mapping',
  };
  const visibleRows = rows.filter(tabFilter[tab] || (() => true));

  function toggle(k) {
    const s = new Set(selected);
    s.has(k) ? s.delete(k) : s.add(k);
    setSelected(s);
  }

  return (
    <div className="content wide" data-screen-label="05 Sync Review">
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <UI.JiraLogo size="lg"/>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>Review sync</h1>
              <span className="pill warn"><span className="dot"/>Review</span>
            </div>
            <p className="page-sub" style={{ marginBottom: 0 }}>
              Run #20260506-02 · Completed 2:06 AM · <b>{counts.create + counts.map}</b> records need your review before they commit to Lumber
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn ghost">Save & finish later</button>
          <button className="btn">Skip all remaining</button>
          <button className="btn accent">{I.check} Commit {selected.size || 7} records</button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="row" style={{ gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <ChipStat n={counts.all} label="All changes" tone=""/>
        <ChipStat n={counts.create} label="Created" tone="ok"/>
        <ChipStat n={counts.update} label="Updated" tone="info"/>
        <ChipStat n={counts.skipped} label="Skipped" tone=""/>
        <ChipStat n={counts.map} label="Needs mapping" tone="warn"/>
      </div>

      {/* Filter tabs */}
      <div className="row" style={{ gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 14 }}>
        {[
          { k: 'All',           n: counts.all },
          { k: 'Created',       n: counts.create },
          { k: 'Updated',       n: counts.update },
          { k: 'Skipped',       n: counts.skipped },
          { k: 'Needs Mapping', n: counts.map },
        ].map(({ k, n }) => (
          <button key={k} onClick={() => setTab(k)} style={{
            border: 'none', background: 'transparent', padding: '10px 14px', cursor: 'pointer',
            fontFamily: 'inherit', fontSize: 13, color: tab === k ? 'var(--ink)' : 'var(--ink-3)',
            fontWeight: tab === k ? 600 : 500,
            borderBottom: '2px solid ' + (tab === k ? 'var(--ink)' : 'transparent'),
            marginBottom: -1,
          }}>
            {k} <span className="muted" style={{ marginLeft: 4 }}>{n}</span>
          </button>
        ))}
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="row" style={{ gap: 8, fontSize: 13 }}>
          <span style={{ fontWeight: 500 }}>{tab} · {visibleRows.length} {visibleRows.length === 1 ? 'record' : 'records'}</span>
          <span className="muted">·</span>
          <span className="dir-row"><span>Jira</span><span className="dir-arrow">→</span><span>Lumber</span></span>
        </div>
        <div className="spacer"/>
        <div className="row" style={{ gap: 6 }}>
          <div className="row" style={{ background: 'var(--bg-elev)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '6px 10px', gap: 6, fontSize: 12.5, color: 'var(--ink-3)' }}>
            {I.search}<input style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--ink)', font: 'inherit', width: 180 }} placeholder="Search Jira or Lumber…"/>
          </div>
          <button className="btn">{I.filter} Filters</button>
        </div>
      </div>

      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 28 }}><input type="checkbox" onChange={e => setSelected(new Set(e.target.checked ? visibleRows.map(r => r.key) : []))}/></th>
              <th>Jira record</th>
              <th style={{ width: 130 }}>Action</th>
              <th>Lumber target</th>
              <th>Changes</th>
              <th style={{ width: 80 }}>Row actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--ink-3)', fontSize: 13 }}>
                No records in <b>{tab}</b>.
              </td></tr>
            )}
            {visibleRows.map(r => (
              <tr key={r.key}>
                <td><input type="checkbox" checked={selected.has(r.key)} onChange={() => toggle(r.key)}/></td>
                <td>
                  <div className="row" style={{ gap: 8 }}>
                    <UI.TypeBadge type={r.type}/>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink-2)' }}>{r.key}</span>
                  </div>
                  <div style={{ fontWeight: 500, marginTop: 2 }}>{r.title}</div>
                  <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{r.assignee} · {r.sprint} · {r.points} pts</div>
                </td>
                <td><ActionPill kind={r.action}/></td>
                <td>
                  {r.action === 'create' && <span className="muted" style={{ fontSize: 12 }}>Will create new ticket</span>}
                  {r.action === 'auto-match' && <div>
                    <div style={{ fontSize: 12.5 }}>Linked to <span className="mono">tkt_{r.key.toLowerCase().replace('-','_')}</span></div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>Auto-matched</div>
                  </div>}
                  {r.action === 'needs-mapping' && <button className="btn sm" onClick={() => go('manual-map')}>{I.link} Pick target</button>}
                </td>
                <td>
                  {r.action === 'auto-match' && r.confidence != null && <div className="row" style={{ gap: 8 }}>
                    <UI.ConfBar value={r.confidence}/>
                    <button className="hover-link" style={{ fontSize: 12, background: 'none', border: 'none', cursor: 'pointer' }}>View 3 changes →</button>
                  </div>}
                  {r.action === 'create' && <span className="muted" style={{ fontSize: 12 }}>14 fields to create</span>}
                  {r.action === 'needs-mapping' && <span className="muted" style={{ fontSize: 12 }}>No matching Lumber record</span>}
                </td>
                <td>
                  <button className="btn ghost sm">{I.more}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row muted" style={{ marginTop: 12, fontSize: 12.5 }}>
        Showing {visibleRows.length} of {counts.all} records · <span className="hover-link" style={{ marginLeft: 4 }}>View full changeset</span>
        <div className="spacer"/>
        <button className="btn sm">{I.chevL} Previous</button>
        <button className="btn sm" style={{ marginLeft: 6 }}>Next {I.chevR}</button>
      </div>
    </div>
  );
}

function ChipStat({ n, label, tone }) {
  return (
    <div className="card" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 8 }}>
      <span className={'pill ' + (tone || '')} style={{ minWidth: 26, justifyContent: 'center', padding: '1px 7px' }}>{n}</span>
      <span style={{ fontSize: 12.5, fontWeight: 500 }}>{label}</span>
    </div>
  );
}
function ActionPill({ kind }) {
  const map = {
    'auto-match':    { tone: 'ok',   label: 'Auto-match' },
    'create':        { tone: 'info', label: 'Create' },
    'needs-mapping': { tone: 'warn', label: 'Needs mapping' },
    'skip':          { tone: '',     label: 'Skip' },
  }[kind];
  return <span className={'pill ' + map.tone}>{map.label}</span>;
}

// ---------------- Screen 06 — Manual Mapping ----------------
function ScreenManualMap({ go }) {
  // Jira is source of truth → we have a Lumber record with no Jira parent.
  // User picks the Jira issue this Lumber record should belong under.
  const candidates = [
    { key: 'LUM-2049', title: 'OAuth callback drops state param', sub: 'Jira · LUM project · Bug · In Progress', match: 96, type: 'Bug' },
    { key: 'LUM-2051', title: 'OAuth state param missing on retry', sub: 'Jira · LUM project · Bug · To Do',     match: 88, type: 'Bug' },
    { key: 'API-318',  title: 'OAuth flow hardening',              sub: 'Jira · API project · Story · Active',   match: 71, type: 'Story' },
    { key: 'LUM-2046', title: 'ERP Integrations Framework',        sub: 'Jira · LUM project · Epic',             match: 64, type: 'Epic' },
  ];
  const [picked, setPicked] = useState('LUM-2049');

  return (
    <div className="content wide" data-screen-label="06 Manual Mapping">
      <div className="page-head">
        <div>
          <button className="btn ghost sm" onClick={() => go('review')} style={{ marginBottom: 6 }}>{I.chevL} Back to review</button>
          <h1 className="page-title">Map Lumber record to Jira</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>This Lumber record has no Jira parent. Jira is the source of truth — pick the Jira issue it should belong under.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn">Skip & keep unmapped</button>
          <button className="btn primary" onClick={() => go('review')}>{I.link} Link to {picked}</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 32px 1fr', gap: 18, alignItems: 'stretch' }}>
        {/* Lumber side — the unmapped record */}
        <div className="card">
          <div className="card-header">
            <UI.LumberLogo/>
            <div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Unmapped Lumber record</div>
              <div style={{ fontWeight: 600 }}>tkt_lum_2049_v1</div>
            </div>
            <div className="spacer"/>
            <span className="pill warn"><span className="dot"/>No Jira parent</span>
          </div>
          <div className="card-pad col" style={{ gap: 14 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 16 }}>OAuth callback — drop state</div>
              <div className="muted" style={{ fontSize: 12.5 }}>Lumber · LUM bucket · 4 mentions in last 7 days</div>
            </div>
            <KV>
              <Row k="Lumber ID"  v={<span className="mono">tkt_lum_2049_v1</span>}/>
              <Row k="Bucket"     v="LUM (Lumber Web App)"/>
              <Row k="Owner"      v={<span className="row" style={{ gap: 6 }}><UI.Avatar size="sm" name="Tom Reilly"/>Tom Reilly</span>}/>
              <Row k="Reported by" v="Ray Sullivan"/>
              <Row k="Status"     v={<UI.StatusPill status="In Progress"/>}/>
              <Row k="Priority"   v={<UI.PriorityChip priority="Critical"/>}/>
              <Row k="Mentions"   v="4 (PRs, threads)"/>
              <Row k="Created"    v="6 days ago"/>
              <Row k="Updated"    v="32 min ago"/>
            </KV>
          </div>
        </div>

        {/* Linker spine */}
        <div className="col" style={{ alignItems: 'center', justifyContent: 'center', gap: 6 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}>Link to Jira</div>
          <div style={{ width: 1, flex: 1, background: 'var(--accent)', minHeight: 60 }}/>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'var(--accent)', color: 'white', display: 'grid', placeItems: 'center' }}>{I.link}</div>
          <div style={{ width: 1, flex: 1, background: 'var(--accent)', minHeight: 60 }}/>
        </div>

        {/* Jira candidates — source of truth */}
        <div className="card">
          <div className="card-header" style={{ background: 'var(--jira-soft)' }}>
            <UI.JiraLogo/>
            <div>
              <div className="muted" style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Jira issues — source of truth</div>
              <div style={{ fontWeight: 600 }}>Suggested · {candidates.length} matches</div>
            </div>
            <div className="spacer"/>
            <div className="row" style={{ gap: 6 }}>
              <div className="row" style={{ background: 'var(--bg-elev)', borderRadius: 6, padding: '4px 8px', gap: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                {I.search}<input style={{ border: 'none', background: 'transparent', outline: 'none', font: 'inherit', width: 100 }} placeholder="Search Jira"/>
              </div>
              <button className="btn sm">All</button>
            </div>
          </div>
          <div className="col" style={{ gap: 8, padding: 12 }}>
            {candidates.map(c => (
              <button key={c.key} onClick={() => setPicked(c.key)} className="card sunken" style={{
                padding: 12, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit',
                border: '1px solid ' + (picked === c.key ? 'var(--accent)' : 'var(--border-soft)'),
                background: picked === c.key ? 'var(--accent-soft)' : 'var(--bg-sunken)',
                display: 'flex', flexDirection: 'column', gap: 4,
              }}>
                <div className="row" style={{ gap: 8 }}>
                  <UI.TypeBadge type={c.type}/>
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-2)' }}>{c.key}</span>
                  <div className="spacer"/>
                  <UI.ConfBar value={c.match}/>
                </div>
                <div style={{ fontWeight: 500, fontSize: 13.5 }}>{c.title}</div>
                <div className="muted" style={{ fontSize: 12 }}>{c.sub}</div>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Field comparison */}
      <div className="card" style={{ marginTop: 18 }}>
        <div className="card-header">
          <div className="card-title">Field comparison</div>
          <div className="card-sub">After linking, Jira fields overwrite the Lumber record (Jira is source of truth)</div>
          <div className="spacer"/>
          <span className="pill"><span className="dot" style={{ background: 'var(--ok)' }}/>Will use (Jira)</span>
          <span className="pill" style={{ marginLeft: 6 }}><span className="dot" style={{ background: 'var(--err)' }}/>Will be replaced (Lumber)</span>
        </div>
        <div className="diff-grid">
          <div>FIELD</div>
          <div style={{ background: 'var(--jira-soft)', color: 'var(--ink-2)' }}>JIRA ({picked})</div>
          <div style={{ color: 'var(--ink-2)' }}>LUMBER (tkt_lum_2049_v1)</div>
          {[
            ['Title', 'OAuth callback drops state param', 'OAuth callback — drop state', true],
            ['Type', 'Bug', 'Bug', false],
            ['Status', 'In Progress', 'In Progress', false],
            ['Assignee', 'Tom Reilly', 'Tom Reilly', false],
            ['Priority', 'Critical', 'High', true],
            ['Story points', '3', 'Not set', true],
            ['Sprint', 'Sprint 12 (active)', '—', true],
            ['Updated', '32 min ago', '4 days ago', true],
          ].map(([k, a, b, diff], i) => (
            <React.Fragment key={i}>
              <div>{k}</div>
              <div className={'diff-side ' + (diff ? 'win' : 'tie')}>{a}</div>
              <div className={'diff-side ' + (diff ? 'lose' : 'tie')}>{b}</div>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function KV({ children }) { return <div className="col" style={{ gap: 8 }}>{children}</div>; }
function Row({ k, v }) {
  return (
    <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
      <div className="muted" style={{ fontSize: 12, minWidth: 110, paddingTop: 1 }}>{k}</div>
      <div style={{ fontSize: 13, fontWeight: 500 }}>{v}</div>
    </div>
  );
}

// ---------------- Screen 07 — Conflict Resolution (removed) ----------------
// Jira is source of truth and Lumber cannot create issues, so there are no
// two-way conflicts to resolve. Screen intentionally removed.

window.SCREENS_C = { ScreenReview, ScreenManualMap };
