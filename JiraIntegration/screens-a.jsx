/* global React, UI, I, LUMBER_DATA */
// =============================================================
// Screens 01–04: Home, Connect, Configure, Sync Run
// =============================================================
const { useState, useEffect, useRef, useMemo } = React;

// ---------------- Screen 01 — Integrations Home ----------------
function ScreenHome({ go, demoState }) {
  const D = window.LUMBER_DATA;
  const stats = {
    healthy:    { active: 2, pending: 34, synced: '48.2k', failed: 3, syncedDelta: '+12% vs prev month', failedSub: 'requires attention' },
    'first-sync': { active: 0, pending: 0, synced: '0',    failed: 0, syncedDelta: 'No runs yet',          failedSub: 'no errors' },
    empty:      { active: 0, pending: 0, synced: '0',     failed: 0, syncedDelta: 'No runs yet',          failedSub: 'no errors' },
    'has-errors':{ active: 2, pending: 34, synced: '48.2k', failed: 11, syncedDelta: '+12% vs prev month', failedSub: 'requires attention' },
    'conflict-heavy':{ active: 2, pending: 142, synced: '48.2k', failed: 3, syncedDelta: '+12% vs prev month', failedSub: 'requires attention' },
  }[demoState] || { active: 2, pending: 34, synced: '48.2k', failed: 3, syncedDelta: '+12% vs prev month', failedSub: 'requires attention' };

  const isEmpty = demoState === 'empty';
  const isFirst = demoState === 'first-sync';

  return (
    <div className="content" data-screen-label="01 Integrations Home">
      <div className="page-head">
        <div>
          <h1 className="page-title">Integrations</h1>
          <p className="page-sub">Connect Lumber to your engineering and project tools. Pull tickets, projects, and people into Lumber.</p>
        </div>
        <div className="page-head-actions">
          <button className="btn">{I.download} Download integration log</button>
          <button className="btn">Global settings</button>
        </div>
      </div>

      <div className="stats">
        <Stat label="Active integrations" value={stats.active} sub={`of 8 available`}/>
        <Stat label="Pending review"      value={stats.pending} sub={isEmpty || isFirst ? 'no records' : 'records waiting'} tone={stats.pending ? 'warn' : ''}/>
        <Stat label="Records synced (30d)"value={stats.synced}  sub={stats.syncedDelta} tone="ok"/>
        <Stat label="Failed records (7d)" value={stats.failed}  sub={stats.failedSub} tone={stats.failed ? 'err' : ''}/>
      </div>

      {/* Connected */}
      <SectionLabel count={isEmpty || isFirst ? 0 : 1}>Connected</SectionLabel>
      {isEmpty || isFirst ? (
        <div className="card card-pad-lg" style={{ marginBottom: 24, textAlign: 'center', padding: '48px 20px' }}>
          <div style={{ display: 'inline-grid', placeItems: 'center', width: 56, height: 56, borderRadius: 14,
                        background: 'var(--bg-sunken)', color: 'var(--ink-3)', marginBottom: 14 }}>
            {I.plug}
          </div>
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>No integrations connected yet</div>
          <div className="muted" style={{ marginBottom: 20 }}>Connect Jira to import projects, issues, and worklogs into Lumber.</div>
          <button className="btn accent" onClick={() => go('connect')}>{I.zap} Connect Jira</button>
        </div>
      ) : (
        <div className="col" style={{ gap: 12, marginBottom: 24 }}>
          <ConnectedCard
            kind="jira" name="Jira" sub="Atlassian Cloud · 6 projects"
            entities={5}
            records={isFirst ? 0 : 12408}
            health={stats.failed > 5 ? 'err' : stats.pending > 50 ? 'warn' : 'ok'}
            healthLabel={stats.failed > 5 ? 'Issues' : stats.pending > 50 ? 'Review' : 'Healthy'}
            lastSync="Today at 2:04 AM"
            nextSync="Tonight at 2:00 AM"
            statusMsg={stats.pending ? `${stats.pending} records need review` : 'All records up to date'}
            onConfigure={() => go('configure')}
            onSync={() => go('sync-run')}
            onReview={() => go('review')}
            primaryAction={stats.pending ? 'review' : 'sync'}
          />
        </div>
      )}

      {/* Available */}
      <SectionLabel count={isEmpty || isFirst ? 7 : 6}>Available</SectionLabel>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {(isEmpty || isFirst) && <AvailableCard kind="jira" name="Jira" sub="Atlassian · Cloud REST API" onConnect={() => go('connect')} primary/>}
        <AvailableCard kind="acu" name="Acumatica"    sub="Acumatica · Cloud ERP"/>
        <AvailableCard kind="qb"  name="QuickBooks"   sub="QuickBooks Online"/>
        <AvailableCard kind="sage" name="Sage 300"    sub="Sage 300 CRE"/>
        <AvailableCard kind="ns"  name="NetSuite"     sub="Oracle NetSuite · SuiteCloud"/>
        <AvailableCard kind="wd"  name="Workday"      sub="Workday HCM · REST API"/>
        <AvailableCard kind="pc"  name="Procore"      sub="Procore · Construction Mgmt"/>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className={'stat-sub ' + (tone || '')}>{sub}</div>
    </div>
  );
}

function SectionLabel({ children, count }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '8px 0 14px' }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{children}</div>
      <div className="muted" style={{ fontSize: 12 }}>{count}</div>
    </div>
  );
}

function ConnectedCard({ kind, name, sub, entities, records, health, healthLabel, lastSync, nextSync, statusMsg, onConfigure, onSync, onReview, primaryAction }) {
  return (
    <div className="card" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1.2fr auto', alignItems: 'center', gap: 18, padding: 18 }}>
      <div className="row" style={{ gap: 12 }}>
        <UI.ConnectorMark kind={kind} size="lg"/>
        <div>
          <div className="row" style={{ gap: 8 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>{name}</div>
            <span className={'pill ' + health}><span className="dot"/>{healthLabel}</span>
          </div>
          <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{entities} entities · {records.toLocaleString()} records synced</div>
        </div>
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Last sync</div>
        <div style={{ fontSize: 13, marginTop: 2 }}>{lastSync}</div>
      </div>
      <div>
        <div className="muted" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Next scheduled</div>
        <div style={{ fontSize: 13, marginTop: 2 }}>{nextSync}</div>
      </div>
      <div style={{ fontSize: 13, color: health === 'warn' ? 'var(--warn)' : health === 'err' ? 'var(--err)' : 'var(--ink-2)' }}>{statusMsg}</div>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn" onClick={onConfigure}>Configure</button>
        {primaryAction === 'review'
          ? <button className="btn accent" onClick={onReview}>Review Sync</button>
          : <button className="btn primary" onClick={onSync}>{I.zap} Sync Now</button>}
      </div>
    </div>
  );
}

function AvailableCard({ kind, name, sub, onConnect, primary }) {
  return (
    <div className="card card-pad" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
        <UI.ConnectorMark kind={kind}/>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{name}</div>
          <div className="muted" style={{ fontSize: 12 }}>{sub}</div>
        </div>
      </div>
      <button className={'btn ' + (primary ? 'accent' : '')} onClick={onConnect} style={{ alignSelf: 'flex-start' }}>
        {primary && I.zap} Connect
      </button>
    </div>
  );
}

// ---------------- Screen 02 — Connect Jira ----------------
function ScreenConnect({ go }) {
  const [step, setStep] = useState(2); // user is on step 2 (auth) per the original flow
  const [tested, setTested] = useState(false);
  const [testing, setTesting] = useState(false);
  const [domain, setDomain] = useState('lumberfi.atlassian.net');
  const [email, setEmail] = useState('mia.garcia@lumber.co');
  const [token, setToken] = useState('ATATT3xFfGF0••••••••••••••••••••••••');
  const [scope, setScope] = useState('all'); // all | selected

  function runTest() {
    setTesting(true); setTested(false);
    setTimeout(() => { setTesting(false); setTested(true); }, 1100);
  }

  return (
    <div className="content" data-screen-label="02 Connect Jira">
      <div className="row" style={{ marginBottom: 14 }}>
        <UI.JiraLogo size="lg"/>
        <div style={{ marginLeft: 12 }}>
          <h1 className="page-title" style={{ marginBottom: 0 }}>Connect Jira</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>Authenticate with Atlassian Cloud and choose what to pull into Lumber.</p>
        </div>
      </div>

      <div className="stepper">
        <Step n={1} label="Choose tool" state="done"/>
        <Stepdiv done/>
        <Step n={2} label="Authenticate" state="current"/>
        <Stepdiv/>
        <Step n={3} label="Select projects" state="upcoming"/>
        <Stepdiv/>
        <Step n={4} label="Configure sync" state="upcoming"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 20 }}>
        <div className="card card-pad-lg">
          <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>Atlassian credentials</div>
          <div className="muted" style={{ fontSize: 13, marginBottom: 20 }}>
            Lumber authenticates with an <b>API token</b> scoped to the user below. Tokens are encrypted at rest and never leave Lumber.
          </div>

          <div className="col" style={{ gap: 16 }}>
            <Field label="Workspace domain" req hint="e.g. yourcompany.atlassian.net">
              <input className="input mono" value={domain} onChange={e => setDomain(e.target.value)}/>
            </Field>
            <Field label="Atlassian account email" req hint="The user the API token belongs to">
              <input className="input" value={email} onChange={e => setEmail(e.target.value)}/>
            </Field>
            <Field label="API token" req hint={<span>Create one at <span className="hover-link">id.atlassian.com → Security → API tokens</span></span>}>
              <input className="input mono" value={token} onChange={e => setToken(e.target.value)} type="password"/>
            </Field>
            <Field label="Project scope" hint="You can change this later in Configure.">
              <div className="col" style={{ gap: 8 }}>
                <RadioRow checked={scope === 'all'} onChange={() => setScope('all')}
                          title="All accessible projects" sub="Lumber will pull every Jira project this user can read."/>
                <RadioRow checked={scope === 'selected'} onChange={() => setScope('selected')}
                          title="Selected projects only" sub="Pick projects on the next step."/>
              </div>
            </Field>

            <div className="card sunken" style={{ padding: 12, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ color: 'var(--ink-3)', marginTop: 2 }}>{I.shield}</span>
              <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>
                Your credentials are encrypted at rest. Lumber only reads records the API token user can already see in Jira.{' '}
                <span className="hover-link">Setup guide</span>
              </div>
            </div>
          </div>

          <div className="row" style={{ marginTop: 24, gap: 8 }}>
            <button className="btn" onClick={() => go('home')}>Back</button>
            <div className="spacer"/>
            <button className="btn" onClick={runTest} disabled={testing}>
              {testing ? <><span className="skel" style={{ width: 12, height: 12, borderRadius: '50%' }}/> Testing…</> : <>{I.beaker} Test connection</>}
            </button>
            {tested && <span className="pill ok"><span className="dot"/>Connected as Mia G.</span>}
            <button className="btn primary" onClick={() => go('configure')}>Authenticate & continue {I.arrow}</button>
          </div>
        </div>

        <div className="col" style={{ gap: 14 }}>
          <div className="card card-pad">
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>What gets synced</div>
            <div className="col" style={{ gap: 6 }}>
              {[
                { l: 'Projects',   s: 'Jira projects (key, name, lead)' },
                { l: 'Issues',     s: 'Epics, Stories, Tasks, Sub-tasks, Bugs' },
                { l: 'Users',      s: 'Assignees & reporters' },
                { l: 'Sprints',    s: 'Active and recent sprints' },
                { l: 'Worklogs',   s: 'Time tracking per issue' },
                { l: 'Statuses',   s: 'Workflow states' },
              ].map(it => (
                <div key={it.l} className="row" style={{ alignItems: 'flex-start', gap: 8 }}>
                  <span style={{ color: 'var(--ok)', marginTop: 1 }}>{I.check}</span>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{it.l}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{it.s}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card card-pad">
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>Required Jira permissions</div>
            <div style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              The Atlassian account must have <b>Browse Projects</b> on every project you want to sync. Read-only — Lumber never writes to Jira.
            </div>
          </div>

          <div className="card card-pad" style={{ background: 'var(--accent-soft)', borderColor: 'transparent' }}>
            <div className="row" style={{ gap: 8, marginBottom: 4 }}>
              <span style={{ color: 'var(--accent-ink)' }}>{I.sparkles}</span>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--accent-ink)' }}>Dry-run available</div>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--accent-ink)' }}>
              After authenticating, you can preview what Lumber would import without committing — toggle <b>Dry run</b> on the Configure step.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ n, label, state }) {
  return (
    <div className={'step ' + state}>
      <div className="step-num">{state === 'done' ? '✓' : n}</div>
      <div className="step-label">{label}</div>
    </div>
  );
}
function Stepdiv({ done }) { return <div className="step-divider" style={done ? { background: 'var(--ok)' } : {}}/>; }

function Field({ label, req, hint, children }) {
  return (
    <div className="field">
      <div className="field-label">{label}{req && <span className="req"> *</span>}</div>
      {children}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function RadioRow({ checked, onChange, title, sub }) {
  return (
    <button onClick={onChange} className="card sunken" style={{
      display: 'flex', gap: 10, padding: 12, alignItems: 'flex-start', textAlign: 'left',
      border: '1px solid ' + (checked ? 'var(--accent)' : 'var(--border-soft)'),
      background: checked ? 'var(--accent-soft)' : 'var(--bg-sunken)',
      cursor: 'pointer', font: 'inherit', color: 'inherit', width: '100%',
    }}>
      <div style={{
        width: 16, height: 16, borderRadius: '50%', flexShrink: 0,
        border: '2px solid ' + (checked ? 'var(--accent)' : 'var(--ink-4)'),
        background: checked ? 'var(--accent)' : 'transparent',
        boxShadow: checked ? 'inset 0 0 0 3px white' : 'none',
        marginTop: 2,
      }}/>
      <div>
        <div style={{ fontWeight: 500, fontSize: 13 }}>{title}</div>
        <div className="muted" style={{ fontSize: 12, marginTop: 1 }}>{sub}</div>
      </div>
    </button>
  );
}

window.SCREENS_A = { ScreenHome, ScreenConnect };
