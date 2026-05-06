/* global React, UI, I, LUMBER_DATA */
// Screens 08 History, 09 Failed, plus Architecture diagram
const { useState, useMemo } = React;

// ---------------- Screen 08 — Sync History ----------------
function ScreenHistory({ go }) {
  const D = window.LUMBER_DATA;
  const rows = D.SYNC_HISTORY;
  const [selected, setSelected] = useState(null);

  return (
    <div className="content wide" data-screen-label="08 Sync History">
      <div className="page-head">
        <div>
          <h1 className="page-title">Sync history</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>All past sync runs. Click a run to inspect records and audit field-level changes.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn">{I.download} Export CSV</button>
          <button className="btn">{I.filter} Filters</button>
          <button className="btn primary" onClick={() => go('sync-run')}>{I.zap} Run sync now</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 18 }}>
        <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Started</th>
                <th>Trigger</th>
                <th>Duration</th>
                <th>Records</th>
                <th>Breakdown</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} onClick={() => setSelected(r.id)} style={{ cursor: 'pointer', background: selected === r.id ? 'var(--bg-hover)' : 'transparent' }}>
                  <td className="mono">#{r.id}</td>
                  <td style={{ fontSize: 12.5 }}>{r.started}</td>
                  <td>
                    <div style={{ fontSize: 12.5 }}>{r.trigger.kind}</div>
                    {r.trigger.who && <div className="muted" style={{ fontSize: 11.5 }}>{r.trigger.who}</div>}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{r.duration}</td>
                  <td className="mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{r.records}</td>
                  <td>
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {r.breakdown.add && <span className="tag" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'transparent' }}>+{r.breakdown.add}</span>}
                      {r.breakdown.upd && <span className="tag" style={{ background: 'var(--info-soft)', color: 'var(--info)', borderColor: 'transparent' }}>~{r.breakdown.upd}</span>}
                      {r.breakdown.skip && <span className="tag">·{r.breakdown.skip}</span>}
                      {r.breakdown.warn && <span className="tag" style={{ background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'transparent' }}>⚠{r.breakdown.warn}</span>}
                      {r.breakdown.fail && <span className="tag" style={{ background: 'var(--err-soft)', color: 'var(--err)', borderColor: 'transparent' }}>✕{r.breakdown.fail}</span>}
                    </div>
                  </td>
                  <td>
                    {r.status === 'healthy' && <span className="pill ok"><span className="dot"/>Healthy</span>}
                    {r.status === 'review' && <span className="pill warn"><span className="dot"/>Review</span>}
                    {r.status === 'failed' && <span className="pill err"><span className="dot"/>Failed</span>}
                  </td>
                  <td><button className="btn ghost sm">View</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Audit timeline panel */}
        <div className="card" style={{ height: 'fit-content', position: 'sticky', top: 80 }}>
          <div className="card-header">
            <span style={{ color: 'var(--ink-3)' }}>{I.history}</span>
            <div>
              <div className="card-title">Audit timeline</div>
              <div className="card-sub">Run #{selected || '20260506-02'} · live activity feed</div>
            </div>
          </div>
          <div style={{ padding: '8px 0' }}>
            {D.AUDIT_LOG.map((e, i) => (
              <div key={e.id} className="row" style={{ alignItems: 'flex-start', gap: 12, padding: '10px 18px', position: 'relative' }}>
                <div style={{ position: 'relative', width: 16, flexShrink: 0, alignSelf: 'stretch' }}>
                  <div style={{
                    position: 'absolute', top: 4, left: 6, width: 4, height: 4, borderRadius: '50%',
                    background:
                      e.tone === 'ok' ? 'var(--ok)' :
                      e.tone === 'warn' ? 'var(--warn)' :
                      e.tone === 'err' ? 'var(--err)' :
                      e.tone === 'info' ? 'var(--info)' : 'var(--ink-4)',
                    boxShadow: '0 0 0 3px var(--bg-elev), 0 0 0 4px ' + (
                      e.tone === 'ok' ? 'var(--ok-soft)' :
                      e.tone === 'warn' ? 'var(--warn-soft)' :
                      e.tone === 'err' ? 'var(--err-soft)' :
                      e.tone === 'info' ? 'var(--info-soft)' : 'var(--bg-sunken)'
                    ),
                  }}/>
                  {i < D.AUDIT_LOG.length - 1 && <div style={{ position: 'absolute', top: 12, bottom: -10, left: 7.5, width: 1, background: 'var(--border)' }}/>}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{e.msg}</span>
                  </div>
                  {e.detail && <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{e.detail}</div>}
                  <div className="row" style={{ gap: 6, marginTop: 4 }}>
                    <span className="tag">{e.kind}</span>
                    <span className="muted" style={{ fontSize: 11 }}>{e.actor}</span>
                    <span className="muted" style={{ fontSize: 11 }}>· {e.t}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------- Screen 09 — Failed Records ----------------
function ScreenFailed({ go }) {
  const D = window.LUMBER_DATA;
  const [open, setOpen] = useState(D.FAILED_RECORDS[0].id);
  const counts = D.FAILED_RECORDS.reduce((acc, r) => { acc[r.code] = (acc[r.code] || 0) + 1; return acc; }, {});

  return (
    <div className="content wide" data-screen-label="09 Failed Records">
      <div className="page-head">
        <div>
          <div className="row" style={{ gap: 8 }}>
            <h1 className="page-title" style={{ marginBottom: 0 }}>Failed records</h1>
            <span className="pill err"><span className="dot"/>{D.FAILED_RECORDS.length} errors</span>
          </div>
          <p className="page-sub" style={{ marginBottom: 0 }}>Records that could not sync. Fix the root cause, then retry — Lumber won't auto-retry without confirmation.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn">Dismiss all</button>
          <button className="btn primary">{I.refresh} Retry all</button>
        </div>
      </div>

      <div className="row" style={{ gap: 10, marginBottom: 18, flexWrap: 'wrap' }}>
        {Object.entries(counts).map(([code, n]) => (
          <div key={code} className="card" style={{ padding: '10px 14px' }}>
            <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{code.replace('_', ' ').toLowerCase()}</div>
            <div style={{ fontSize: 20, fontWeight: 600, marginTop: 2 }}>{n}</div>
          </div>
        ))}
      </div>

      <div className="col" style={{ gap: 10 }}>
        {D.FAILED_RECORDS.map(r => {
          const isOpen = open === r.id;
          return (
            <div key={r.id} className="card">
              <button onClick={() => setOpen(isOpen ? null : r.id)} className="row" style={{
                width: '100%', padding: 16, gap: 14, alignItems: 'center',
                border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', textAlign: 'left',
              }}>
                <div style={{
                  width: 36, height: 36, borderRadius: 9, flexShrink: 0,
                  background: 'var(--err-soft)', color: 'var(--err)',
                  display: 'grid', placeItems: 'center',
                }}>{I.alertTri}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="tag">{r.entity}</span>
                    <span className="dir-row"><span style={{ fontSize: 11 }}>{r.direction}</span></span>
                  </div>
                  <div style={{ fontWeight: 500, fontSize: 14, marginTop: 4 }}>{r.title}</div>
                  <div className="muted" style={{ fontSize: 12.5, marginTop: 1 }}>{r.detail}</div>
                </div>
                <div className="col" style={{ alignItems: 'flex-end', gap: 4 }}>
                  <span className="tag" style={{ background: 'var(--err-soft)', color: 'var(--err)', borderColor: 'transparent' }}>{r.code}</span>
                  <span className="muted" style={{ fontSize: 11 }}>{r.when} · {r.retries}× retried</span>
                </div>
                <span style={{ color: 'var(--ink-3)', transition: 'transform 0.15s', transform: isOpen ? 'rotate(180deg)' : 'rotate(0)' }}>{I.chevD}</span>
              </button>
              {isOpen && (
                <div style={{ borderTop: '1px solid var(--border)', padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>What happened</div>
                    <div style={{ fontSize: 13.5, color: 'var(--ink-2)', marginBottom: 14 }}>{r.explain}</div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>How to resolve</div>
                    <ul style={{ paddingLeft: 18, margin: 0, fontSize: 13, color: 'var(--ink-2)' }}>
                      {r.fix.map((f, i) => <li key={i} style={{ marginBottom: 4 }}>{f}</li>)}
                    </ul>
                    <div className="row" style={{ marginTop: 16, gap: 8 }}>
                      <button className="btn primary">{I.refresh} Retry</button>
                      <button className="btn">Re-map</button>
                      <button className="btn ghost">Dismiss</button>
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Raw response</div>
                    <UI.Code>{r.raw}</UI.Code>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------- Architecture Diagram (overlay) ----------------
function ArchitectureView({ onClose }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(20, 15, 10, 0.55)', backdropFilter: 'blur(4px)',
      zIndex: 100, display: 'grid', placeItems: 'center', padding: 24,
    }} onClick={onClose}>
      <div className="card" style={{ width: 'min(1100px, 100%)', maxHeight: '92vh', overflow: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="card-header">
          <span style={{ color: 'var(--accent)' }}>{I.network}</span>
          <div>
            <div className="card-title">System architecture</div>
            <div className="card-sub">Jira → Lumber pull-only · API-key auth · server-driven streaming</div>
          </div>
          <div className="spacer"/>
          <button className="btn ghost" onClick={onClose}>{I.x}</button>
        </div>
        <div style={{ padding: 24 }}>
          <ArchSvg/>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginTop: 24 }}>
            <ArchTile title="Atlassian Cloud (Jira)" lines={[
              'REST /rest/api/3/*',
              'Read-only with API token',
              'Per-user accountId',
              'Rate-limited 10 req/s',
            ]}/>
            <ArchTile title="Lumber Sync Service" lines={[
              'Node + BullMQ workers',
              'Reads Jira, writes Lumber DB',
              'Field mappers per entity',
              'Audit log + retries',
            ]}/>
            <ArchTile title="Lumber Web App" lines={[
              'React + Tailwind UI',
              'SSE for live progress',
              'POST /sync/run, /sync/commit',
              'Reads run state from Postgres',
            ]}/>
          </div>
          <div className="card sunken" style={{ padding: 14, marginTop: 16, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Why this design</div>
            <div className="muted">
              The sync service is decoupled from the web app so we can scale workers independently and replay any run from the audit log. SSE gives realistic streaming progress without WebSocket plumbing. API-key auth keeps the POC scope tight; OAuth 3LO can drop in behind the same internal interface in v2.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ArchSvg() {
  return (
    <svg viewBox="0 0 900 280" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 Z" fill="var(--ink-3)"/>
        </marker>
      </defs>
      {/* Boxes */}
      <ArchBox x={20}  y={80}  w={180} h={120} title="Jira Cloud" sub="Atlassian REST API" color="var(--jira)"/>
      <ArchBox x={360} y={20}  w={180} h={70}  title="Sync Service" sub="Workers · Postgres" color="var(--ink)"/>
      <ArchBox x={360} y={110} w={180} h={70}  title="Audit Log" sub="Append-only events" color="var(--ink-2)"/>
      <ArchBox x={360} y={200} w={180} h={70}  title="Job Queue" sub="BullMQ + Redis" color="var(--ink-2)"/>
      <ArchBox x={700} y={80}  w={180} h={120} title="Lumber Web" sub="React UI · SSE" color="var(--accent)"/>

      {/* Lines */}
      <g stroke="var(--ink-3)" strokeWidth="1.5" fill="none">
        <path d="M200 130 C 280 130, 280 55, 360 55" markerEnd="url(#arr)"/>
        <path d="M540 55 C 620 55, 620 130, 700 130" markerEnd="url(#arr)"/>
        <path d="M540 145 C 620 145, 620 145, 700 145" markerEnd="url(#arr)"/>
        <path d="M450 90 V 110" markerEnd="url(#arr)"/>
        <path d="M450 180 V 200" markerEnd="url(#arr)"/>
      </g>

      <text x="270" y="48" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">GET /search</text>
      <text x="615" y="48" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">SSE /events</text>
      <text x="615" y="138" fontSize="10" fill="var(--ink-3)" fontFamily="var(--font-mono)">POST /commit</text>
    </svg>
  );
}

function ArchBox({ x, y, w, h, title, sub, color }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx="10" fill="var(--bg-sunken)" stroke="var(--border)"/>
      <rect x={x} y={y} width="4" height={h} fill={color}/>
      <text x={x + 16} y={y + 28} fontSize="13" fontWeight="600" fill="var(--ink)">{title}</text>
      <text x={x + 16} y={y + 46} fontSize="11" fill="var(--ink-3)">{sub}</text>
    </g>
  );
}

function ArchTile({ title, lines }) {
  return (
    <div className="card sunken" style={{ padding: 14 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12, color: 'var(--ink-2)' }}>
        {lines.map(l => <li key={l} style={{ marginBottom: 2 }}>{l}</li>)}
      </ul>
    </div>
  );
}

window.SCREENS_D = { ScreenHistory, ScreenFailed, ArchitectureView };
