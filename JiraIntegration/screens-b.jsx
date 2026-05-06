/* global React, UI, I, LUMBER_DATA */
// =============================================================
// Screens 03–04: Configure Sync, Live Sync Run
// =============================================================
const { useState, useEffect, useRef } = React;

// ---------------- Screen 03 — Configure Sync ----------------
function ScreenConfigure({ go, dryRun, setDryRun }) {
  const [activeEntity, setActiveEntity] = useState('Epics');
  const [entities, setEntities] = useState({
    Epics:        { enabled: true,  fields: 9,  freq: 'Every sync', dir: 'pull' },
    Stories:      { enabled: true,  fields: 14, freq: 'Every sync', dir: 'pull' },
    Bugs:         { enabled: true,  fields: 13, freq: 'Every sync', dir: 'pull' },
    Tasks:        { enabled: true,  fields: 12, freq: 'Every sync', dir: 'pull' },
    'Sub-Stories':{ enabled: true,  fields: 10, freq: 'Every sync', dir: 'pull' },
    Comments:     { enabled: true,  fields: 6,  freq: 'Hourly',     dir: 'pull' },
    Worklogs:     { enabled: true,  fields: 7,  freq: 'Hourly',     dir: 'pull' },
    Attachments:  { enabled: false, fields: 5,  freq: 'Disabled',   dir: 'disabled' },
  });

  const fieldsByEntity = {
    Epics: [
      { jira: 'key',           lumber: 'epic_key',       pk: true },
      { jira: 'summary',       lumber: 'title' },
      { jira: 'status.name',   lumber: 'status',         note: 'Values mapped' },
      { jira: 'priority.name', lumber: 'priority' },
      { jira: 'assignee',      lumber: 'owner_id',       note: 'User-resolved' },
      { jira: 'labels',        lumber: 'labels' },
      { jira: 'customfield_epicColor', lumber: 'color' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'updated',       lumber: 'updated_at' },
    ],
    Stories: [
      { jira: 'key',           lumber: 'ticket_key',     pk: true },
      { jira: 'summary',       lumber: 'title' },
      { jira: 'description',   lumber: 'description' },
      { jira: 'status.name',   lumber: 'status',         note: 'Values mapped' },
      { jira: 'priority.name', lumber: 'priority' },
      { jira: 'assignee',      lumber: 'assignee_id',    note: 'User-resolved' },
      { jira: 'reporter',      lumber: 'reporter_id',    note: 'User-resolved' },
      { jira: 'sprint',        lumber: 'sprint_id' },
      { jira: 'storyPoints',   lumber: 'estimate' },
      { jira: 'epicLink',      lumber: 'epic_key' },
      { jira: 'labels',        lumber: 'labels' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'updated',       lumber: 'updated_at' },
      { jira: 'parent',        lumber: 'parent_key',     note: 'Optional' },
    ],
    Bugs: [
      { jira: 'key',           lumber: 'ticket_key',     pk: true },
      { jira: 'summary',       lumber: 'title' },
      { jira: 'description',   lumber: 'description' },
      { jira: 'status.name',   lumber: 'status',         note: 'Values mapped' },
      { jira: 'priority.name', lumber: 'priority' },
      { jira: 'severity',      lumber: 'severity' },
      { jira: 'assignee',      lumber: 'assignee_id',    note: 'User-resolved' },
      { jira: 'reporter',      lumber: 'reporter_id',    note: 'User-resolved' },
      { jira: 'environment',   lumber: 'environment' },
      { jira: 'affectsVersion',lumber: 'affects_version' },
      { jira: 'fixVersion',    lumber: 'fix_version' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'resolved',      lumber: 'resolved_at' },
    ],
    Tasks: [
      { jira: 'key',           lumber: 'ticket_key',     pk: true },
      { jira: 'summary',       lumber: 'title' },
      { jira: 'description',   lumber: 'description' },
      { jira: 'status.name',   lumber: 'status',         note: 'Values mapped' },
      { jira: 'priority.name', lumber: 'priority' },
      { jira: 'assignee',      lumber: 'assignee_id',    note: 'User-resolved' },
      { jira: 'reporter',      lumber: 'reporter_id',    note: 'User-resolved' },
      { jira: 'sprint',        lumber: 'sprint_id' },
      { jira: 'estimate',      lumber: 'estimate' },
      { jira: 'duedate',       lumber: 'due_at' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'updated',       lumber: 'updated_at' },
    ],
    'Sub-Stories': [
      { jira: 'key',           lumber: 'ticket_key',     pk: true },
      { jira: 'parent',        lumber: 'parent_key',     note: 'Required' },
      { jira: 'summary',       lumber: 'title' },
      { jira: 'status.name',   lumber: 'status',         note: 'Values mapped' },
      { jira: 'priority.name', lumber: 'priority' },
      { jira: 'assignee',      lumber: 'assignee_id',    note: 'User-resolved' },
      { jira: 'reporter',      lumber: 'reporter_id',    note: 'User-resolved' },
      { jira: 'storyPoints',   lumber: 'estimate' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'updated',       lumber: 'updated_at' },
    ],
    Comments: [
      { jira: 'id',            lumber: 'comment_id',     pk: true },
      { jira: 'issueId',       lumber: 'ticket_id' },
      { jira: 'author',        lumber: 'user_id',        note: 'User-resolved' },
      { jira: 'body',          lumber: 'body' },
      { jira: 'created',       lumber: 'created_at' },
      { jira: 'updated',       lumber: 'updated_at' },
    ],
    Worklogs: [
      { jira: 'id',                lumber: 'worklog_id', pk: true },
      { jira: 'author',            lumber: 'user_id',    note: 'User-resolved' },
      { jira: 'issueId',           lumber: 'ticket_id' },
      { jira: 'started',           lumber: 'started_at' },
      { jira: 'timeSpentSeconds',  lumber: 'duration_s' },
      { jira: 'comment',           lumber: 'note' },
      { jira: 'updated',           lumber: 'updated_at' },
    ],
    Attachments: [
      { jira: 'id',          lumber: 'attachment_id', pk: true },
      { jira: 'issueId',     lumber: 'ticket_id' },
      { jira: 'filename',    lumber: 'filename' },
      { jira: 'mimeType',    lumber: 'mime_type' },
      { jira: 'size',        lumber: 'size_bytes' },
    ],
  };

  const fields = fieldsByEntity[activeEntity] || [];

  return (
    <div className="content wide" data-screen-label="03 Configure Sync">
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <UI.JiraLogo size="lg"/>
          <div>
            <h1 className="page-title">Configure sync</h1>
            <p className="page-sub" style={{ marginBottom: 0 }}>Choose what to pull from Jira and how each entity maps into Lumber.</p>
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn ghost" onClick={() => go('home')}>Cancel</button>
          <button className="btn primary" onClick={() => go('home')}>Save changes</button>
        </div>
      </div>

      {/* Schedule banner */}
      <div className="card" style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto', alignItems: 'center', gap: 14, padding: 16, marginBottom: 18 }}>
        <div className="row" style={{ gap: 10 }}>
          <span style={{ color: 'var(--ink-3)' }}>{I.calendar}</span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13 }}>Scheduled sync</div>
            <div className="muted" style={{ fontSize: 12.5 }}>Runs nightly at 2:00 AM PT · Always opens for admin review before committing changes</div>
          </div>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <span style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>Dry run</span>
          <UI.Toggle on={dryRun} onChange={setDryRun}/>
          <span className="muted" style={{ fontSize: 11.5 }}>preview only — no commits</span>
        </div>
        <button className="btn">Edit schedule</button>
        <button className="btn primary" onClick={() => go('sync-run')}>{I.zap} Run now</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 18 }}>
        {/* Entities list */}
        <div className="card">
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Entities
          </div>
          {Object.entries(entities).map(([name, e]) => (
            <button key={name}
              className="row"
              onClick={() => setActiveEntity(name)}
              style={{
                width: '100%', textAlign: 'left', padding: '12px 16px', gap: 10, alignItems: 'center',
                border: 'none', borderBottom: '1px solid var(--border-soft)',
                background: activeEntity === name ? 'var(--bg-sunken)' : 'transparent',
                font: 'inherit', color: 'inherit', cursor: 'pointer',
              }}>
              <UI.Toggle on={e.enabled} onChange={(v) => setEntities({ ...entities, [name]: { ...e, enabled: v, dir: v ? 'pull' : 'disabled' } })}/>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 500, fontSize: 13 }}>{name}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 1 }}>{e.fields} fields · {e.freq}</div>
              </div>
              {e.dir === 'pull' && <div className="dir-row"><span>Jira</span><span className="dir-arrow">→</span><span>Lumber</span></div>}
              {e.dir === 'disabled' && <span className="muted" style={{ fontSize: 11 }}>Disabled</span>}
            </button>
          ))}
        </div>

        {/* Entity detail */}
        <div className="card">
          <div className="card-header" style={{ alignItems: 'flex-start', flexDirection: 'column', gap: 12 }}>
            <div className="row" style={{ width: '100%', gap: 10 }}>
              <UI.TypeBadge type={activeEntity === 'Issues' ? 'Story' : null}/>
              <div>
                <div className="card-title">{activeEntity}</div>
                <div className="card-sub">Jira ↔ Lumber · Read-only from Jira</div>
              </div>
              <div className="spacer"/>
              <span className="pill ok"><span className="dot"/>Enabled</span>
            </div>

            {/* Direction picker (informational, fixed for Jira pull-only POC) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, width: '100%' }}>
              <DirOption picked title="Jira → Lumber" sub="Jira is source of truth"/>
              <DirOption disabled title="Lumber → Jira" sub="Not supported in v1"/>
              <DirOption disabled title="Two-way" sub="Coming soon"/>
            </div>
          </div>

          <div style={{ padding: 16 }}>
            <div className="row" style={{ marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>Field mapping</div>
              <div className="muted" style={{ fontSize: 12, marginLeft: 8 }}>Auto-detected · {fields.length} fields</div>
              <div className="spacer"/>
              <button className="btn sm">+ Add field</button>
            </div>

            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: '40%' }}>Jira field</th>
                    <th style={{ width: '40%' }}>Lumber field</th>
                    <th>Options</th>
                  </tr>
                </thead>
                <tbody>
                  {fields.map(f => (
                    <tr key={f.jira}>
                      <td className="mono">
                        {f.jira}
                        {f.pk && <span className="tag" style={{ marginLeft: 6, background: 'var(--accent-soft)', color: 'var(--accent-ink)', borderColor: 'transparent' }}>PK</span>}
                      </td>
                      <td className="mono">{f.lumber}</td>
                      <td>{f.note ? <span className="tag">{f.note}</span> : <span className="muted">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="card sunken" style={{ marginTop: 14, padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--info)' }}>{I.info}</span>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                Lumber auto-detects Jira fields by inspecting issue schemas. You can rename, hide, or remap any field — changes apply on the next run.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function DirOption({ picked, disabled, title, sub }) {
  return (
    <div className="card" style={{
      padding: 10, border: '1px solid ' + (picked ? 'var(--accent)' : 'var(--border)'),
      background: picked ? 'var(--accent-soft)' : (disabled ? 'var(--bg-sunken)' : 'var(--bg-elev)'),
      opacity: disabled ? 0.55 : 1,
    }}>
      <div className="row" style={{ gap: 6 }}>
        {picked && <span style={{ color: 'var(--accent-ink)' }}>{I.check}</span>}
        <div style={{ fontSize: 12.5, fontWeight: 600, color: picked ? 'var(--accent-ink)' : 'var(--ink-2)' }}>{title}</div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ---------------- Screen 04 — Live Sync Run ----------------
function ScreenSyncRun({ go, dryRun }) {
  const D = window.LUMBER_DATA;
  const total = 1284;
  const targets = [
    { name: 'Epics',        total: 42,  speed: 0.30 },
    { name: 'Stories',      total: 318, speed: 2.10 },
    { name: 'Bugs',         total: 156, speed: 1.10 },
    { name: 'Tasks',        total: 224, speed: 1.50 },
    { name: 'Sub-Stories',  total: 287, speed: 1.90 },
    { name: 'Comments',     total: 185, speed: 1.30 },
    { name: 'Worklogs',     total: 72,  speed: 0.50 },
    { name: 'Attachments',  total: 0,   speed: 0,    disabled: true },
  ];
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setTick(x => x + 1), 60);
    return () => clearInterval(t);
  }, [paused]);

  // progress per entity, sequenced (disabled entities don't run)
  let acc = 0;
  const progress = targets.map(t => {
    if (t.disabled) return { ...t, done: 0 };
    const startAt = acc; acc += t.total;
    const elapsed = Math.max(0, tick * t.speed - startAt * 0.4);
    const done = Math.min(t.total, Math.floor(elapsed));
    return { ...t, done };
  });
  const totalDone = progress.reduce((s, p) => s + p.done, 0);
  const overallPct = Math.min(100, Math.round((totalDone / total) * 100));
  const isComplete = totalDone >= total;

  // counts (synthetic but deterministic)
  const created = Math.min(20,  Math.floor(totalDone * 0.029));
  const updated = Math.min(66,  Math.floor(totalDone * 0.094));
  const skipped = Math.max(0, totalDone - created - updated - Math.min(34, Math.floor(totalDone * 0.05)));
  const review  = Math.min(34,  Math.floor(totalDone * 0.05));

  // ETA: assume ~2:14 total, 60ms/tick → 2240 ticks
  const ticksToFinish = 2240;
  const remainingTicks = Math.max(0, ticksToFinish - tick);
  const etaSec = Math.round(remainingTicks * 0.06);

  return (
    <div className="content wide" data-screen-label="04 Sync Run">
      <div className="page-head">
        <div className="row" style={{ gap: 12 }}>
          <UI.JiraLogo size="lg"/>
          <div>
            <div className="row" style={{ gap: 8 }}>
              <h1 className="page-title" style={{ marginBottom: 0 }}>{isComplete ? 'Synced Jira' : 'Syncing Jira'}</h1>
              <span className={'pill ' + (isComplete ? 'ok' : 'info') + (isComplete ? '' : ' live')}>
                <span className="dot"/>{isComplete ? 'Complete' : (paused ? 'Paused' : 'Syncing')}
              </span>
              {dryRun && <span className="pill accent"><span className="dot"/>Dry run</span>}
            </div>
            <p className="page-sub" style={{ marginBottom: 0 }}>
              Started 2:04 AM · Run #20260506-02 · Triggered manually by Mia Garcia
            </p>
          </div>
        </div>
        <div className="page-head-actions">
          <button className="btn" onClick={() => setPaused(!paused)} disabled={isComplete}>
            {paused ? <>{I.play} Resume</> : <>{I.pause} Pause</>}
          </button>
          <button className="btn danger">Cancel run</button>
        </div>
      </div>

      {dryRun && (
        <div className="card" style={{ background: 'var(--accent-soft)', borderColor: 'transparent', padding: 12, marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ color: 'var(--accent-ink)' }}>{I.beaker}</span>
          <div style={{ fontSize: 13, color: 'var(--accent-ink)' }}>
            <b>Dry run mode.</b> Lumber is fetching everything from Jira and computing the diff, but <b>nothing will be written</b> until you turn dry run off and re-run.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 18, marginBottom: 18 }}>
        <div className="card card-pad-lg">
          <div className="row" style={{ marginBottom: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Overall progress</div>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4, fontVariantNumeric: 'tabular-nums' }}>
                {totalDone.toLocaleString()} / ~{total.toLocaleString()} <span className="muted" style={{ fontSize: 16, fontWeight: 500 }}>records</span>
              </div>
            </div>
            <div className="spacer"/>
            <div style={{ textAlign: 'right' }}>
              <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>ETA</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>{isComplete ? '—' : `~${etaSec}s`}</div>
            </div>
          </div>
          <div className="progress-track" style={{ height: 10 }}>
            <div className={'progress-fill ' + (isComplete ? 'ok' : 'shimmer')} style={{ width: overallPct + '%' }}/>
          </div>
          <div className="row muted" style={{ marginTop: 8, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>
            <span>{overallPct}%</span>
            <div className="spacer"/>
            <span>{paused ? 'Paused' : (isComplete ? 'Done' : 'Streaming via Jira REST · /rest/api/3')}</span>
          </div>
        </div>

        <div className="card card-pad-lg">
          <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }}>Outcome so far</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <Mini count={created} label="Created"   sub="new in Lumber"     tone="ok"/>
            <Mini count={updated} label="Updated"   sub="changed records"   tone="info"/>
            <Mini count={skipped} label="Unchanged" sub="already in sync"   tone=""/>
            <Mini count={review}  label="Review"    sub="conflicts + map"   tone="warn"/>
          </div>
        </div>
      </div>

      {/* Per-entity progress */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">Entity progress</div>
          <div className="muted" style={{ fontSize: 12, marginLeft: 6 }}>{progress.filter(p => !p.disabled && p.done >= p.total).length} of {progress.filter(p => !p.disabled).length} complete</div>
        </div>
        <div>
          {progress.map(p => {
            const pct = p.disabled ? 0 : Math.round((p.done / p.total) * 100);
            const state = p.disabled ? 'disabled' : p.done >= p.total ? 'done' : p.done > 0 ? 'running' : 'queued';
            return (
              <div key={p.name} style={{
                display: 'grid', gridTemplateColumns: '180px 80px 1fr 200px 90px',
                alignItems: 'center', gap: 14, padding: '14px 20px',
                borderBottom: '1px solid var(--border-soft)',
              }}>
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{p.name}</span>
                </div>
                <div className="mono" style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--ink-2)' }}>
                  {p.done} / {p.total}
                </div>
                <div className="progress-track">
                  <div className={'progress-fill ' + (state === 'done' ? 'ok' : 'shimmer')} style={{ width: pct + '%' }}/>
                </div>
                <div className="row" style={{ gap: 6, fontSize: 11.5, color: 'var(--ink-3)' }}>
                  {state === 'done' && <>
                    <span className="tag" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', borderColor: 'transparent' }}>+{Math.floor(p.total * 0.04)} new</span>
                    <span className="tag">~{Math.floor(p.total * 0.12)} chg</span>
                  </>}
                  {state === 'running' && <span className="pill info live"><span className="dot"/>running</span>}
                  {state === 'queued' && <span className="muted">queued</span>}
                  {state === 'disabled' && <span className="muted">disabled in config</span>}
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right' }}>
                  {state === 'done' ? `${(p.total / 50).toFixed(1)}s` : state === 'running' ? 'Running' : '—'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* CTA banner */}
      <div className="card sunken" style={{ marginTop: 18, padding: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span style={{ color: 'var(--warn)' }}>{I.alertTri}</span>
        <div style={{ fontSize: 13 }}>
          <b>{review || 34}</b> records need your review before they commit. You'll land on the review screen once the sync completes.
        </div>
        <div className="spacer"/>
        <button className="btn" onClick={() => go('review')} disabled={!isComplete}>
          Go to review {isComplete ? <>{I.arrow}</> : <span className="muted" style={{ fontSize: 11, marginLeft: 4 }}>(when ready)</span>}
        </button>
      </div>
    </div>
  );
}

function Mini({ count, label, sub, tone }) {
  return (
    <div>
      <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
        <div style={{ fontSize: 22, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{count}</div>
        <div className={'pill ' + (tone || '')} style={{ padding: '0 6px' }}>{label}</div>
      </div>
      <div className="muted" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

window.SCREENS_B = { ScreenConfigure, ScreenSyncRun };
