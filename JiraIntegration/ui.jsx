/* global React */
// =============================================================
// Shared icons + small components
// =============================================================
const { useState, useEffect, useRef, useMemo, useCallback, createElement: h } = React;

// ---------- Icons (lucide-style strokes; 24-box) ----------
const Icon = ({ d, size = 16, stroke = 'currentColor', fill = 'none', sw = 1.75, style }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
       strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={style} className="ico">
    {d}
  </svg>
);

const I = {
  search:    <Icon d={<><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></>}/>,
  settings:  <Icon d={<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>}/>,
  plug:      <Icon d={<><path d="M12 22v-5"/><path d="M9 7V2"/><path d="M15 7V2"/><path d="M6 13V8.5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2V13a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4Z"/></>}/>,
  users:     <Icon d={<><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>}/>,
  clock:     <Icon d={<><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></>}/>,
  cash:      <Icon d={<><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/></>}/>,
  briefcase: <Icon d={<><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></>}/>,
  bell:      <Icon d={<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></>}/>,
  receipt:   <Icon d={<><path d="M4 2v20l3-2 3 2 3-2 3 2 3-2 3 2V2l-3 2-3-2-3 2-3-2-3 2L4 2z"/><path d="M8 9h8"/><path d="M8 13h6"/></>}/>,
  history:   <Icon d={<><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><polyline points="3 3 3 8 8 8"/><polyline points="12 7 12 12 15 14"/></>}/>,
  zap:       <Icon d={<><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></>}/>,
  check:     <Icon d={<><polyline points="20 6 9 17 4 12"/></>}/>,
  x:         <Icon d={<><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></>}/>,
  alert:     <Icon d={<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>}/>,
  alertTri:  <Icon d={<><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></>}/>,
  info:      <Icon d={<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>}/>,
  arrow:     <Icon d={<><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></>}/>,
  arrowL:    <Icon d={<><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></>}/>,
  arrowDown: <Icon d={<><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></>}/>,
  chevR:     <Icon d={<><polyline points="9 18 15 12 9 6"/></>}/>,
  chevL:     <Icon d={<><polyline points="15 18 9 12 15 6"/></>}/>,
  chevD:     <Icon d={<><polyline points="6 9 12 15 18 9"/></>}/>,
  pause:     <Icon d={<><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></>}/>,
  play:      <Icon d={<><polygon points="5 3 19 12 5 21 5 3"/></>}/>,
  refresh:   <Icon d={<><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></>}/>,
  download:  <Icon d={<><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></>}/>,
  filter:    <Icon d={<><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></>}/>,
  link:      <Icon d={<><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></>}/>,
  unlink:    <Icon d={<><path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71"/><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71"/><line x1="8" y1="2" x2="8" y2="5"/><line x1="2" y1="8" x2="5" y2="8"/><line x1="16" y1="19" x2="16" y2="22"/><line x1="19" y1="16" x2="22" y2="16"/></>}/>,
  more:      <Icon d={<><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></>}/>,
  copy:      <Icon d={<><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></>}/>,
  external:  <Icon d={<><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></>}/>,
  shield:    <Icon d={<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>}/>,
  key:       <Icon d={<><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4"/></>}/>,
  beaker:    <Icon d={<><path d="M4.5 3h15"/><path d="M6 3v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V3"/><path d="M6 14h12"/></>}/>,
  sparkles:  <Icon d={<><path d="M12 3l1.9 5.8a2 2 0 0 0 1.3 1.3L21 12l-5.8 1.9a2 2 0 0 0-1.3 1.3L12 21l-1.9-5.8a2 2 0 0 0-1.3-1.3L3 12l5.8-1.9a2 2 0 0 0 1.3-1.3z"/></>}/>,
  loader:    <Icon d={<><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/></>}/>,
  diff:      <Icon d={<><path d="M12 3v18"/><path d="M5 8l7-5 7 5"/><path d="M5 16l7 5 7-5"/></>}/>,
  network:   <Icon d={<><rect x="9" y="2" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="16" y="16" width="6" height="6" rx="1"/><path d="M5 16v-3a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3"/><path d="M12 8v3"/></>}/>,
  spark:     <Icon d={<><path d="M3 12h3l3-9 6 18 3-9h3"/></>}/>,
  pencil:    <Icon d={<><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></>}/>,
  trash:     <Icon d={<><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></>}/>,
  eye:       <Icon d={<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>}/>,
  calendar:  <Icon d={<><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></>}/>,
  home:      <Icon d={<><path d="M3 12 12 3l9 9"/><path d="M5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10"/></>}/>,
  gauge:     <Icon d={<><path d="M12 14l4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></>}/>,
  chart:     <Icon d={<><line x1="3" y1="20" x2="21" y2="20"/><rect x="6" y="10" width="3" height="8"/><rect x="11" y="6" width="3" height="12"/><rect x="16" y="13" width="3" height="5"/></>}/>,
  sun:       <Icon d={<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>}/>,
};

window.I = I;

// ---------- Sidebar (collapsible, top-level + nested Settings) ----------
function Sidebar({ section, screen, go, badges = {}, collapsed, onToggle }) {
  const [openSettings, setOpenSettings] = React.useState(section === 'settings');
  const [openTeam, setOpenTeam] = React.useState(() => {
    const m = (screen || '').match(/^team-([^-]+)/);
    return m ? m[1] : 'all';
  });
  React.useEffect(() => { if (section === 'settings') setOpenSettings(true); }, [section]);
  React.useEffect(() => {
    const m = (screen || '').match(/^team-([^-]+)/);
    if (m) setOpenTeam(m[1]);
  }, [screen]);

  const teams = [
    { key: 'all',      label: 'All Teams'           },
    { key: 'fields',   label: 'Fields & Backoffice' },
    { key: 'hr',       label: 'HR & People Ops'     },
    { key: 'builder',  label: 'BuilderFax'          },
  ];
  const teamPages = [
    { key: '',              label: 'Hub' },
    { key: '-productivity', label: 'Resource productivity' },
    { key: '-ai',           label: 'AI adaptability' },
    { key: '-quality',      label: 'AI & Quality' },
    { key: '-tickets',      label: 'Tickets' },
  ];
  const settingsKids = [
    { key: 'integrations',  label: 'Integrations',  route: 'integrations-home', badge: badges.integrations },
    { key: 'cost',          label: 'Cost & Tokens', route: 'settings-cost' },
  ];

  // The current top-level route (so a sub-screen of Overview still highlights "Overview")
  const topActive =
    section === 'workspace' ? null :
    section === 'settings' ? null :
    screen;

  return (
    <aside className={'sidebar' + (collapsed ? ' collapsed' : '')}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">L</div>
        {!collapsed && <>
          <div className="sidebar-brand-name">Lumber</div>
          <div className="sidebar-brand-env">prod</div>
        </>}
        <button className="sidebar-collapse" onClick={onToggle} title={collapsed ? 'Expand' : 'Collapse'} aria-label="Toggle sidebar">
          {collapsed ? I.chevR : I.chevL}
        </button>
      </div>

      {!collapsed && (
        <div className="sidebar-search">
          {I.search}
          <span>Search…</span>
          <kbd>⌘K</kbd>
        </div>
      )}

      <nav className="sidebar-nav">
        {!collapsed && <div className="sidebar-section-label">Workspace</div>}
        {teams.map(t => {
          const isOpen = openTeam === t.key;
          const isActive = section === 'workspace' && (screen || '').startsWith('team-' + t.key);
          return (
            <React.Fragment key={t.key}>
              <button
                title={collapsed ? t.label : undefined}
                className={'sidebar-item' + (isActive ? ' active' : '')}
                onClick={() => {
                  if (collapsed) { go('team-' + t.key); }
                  else {
                    if (isOpen) setOpenTeam('');
                    else { setOpenTeam(t.key); go('team-' + t.key); }
                  }
                }}>
                <span className="sidebar-item-icon">{I.users}</span>
                {!collapsed && <>
                  <span>{t.label}</span>
                  <span style={{ marginLeft: 'auto', display: 'inline-flex', transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: 'var(--ink-3)' }}>{I.chevR}</span>
                </>}
              </button>
              {!collapsed && isOpen && (
                <div className="sidebar-subnav">
                  {teamPages.map(p => {
                    const route = 'team-' + t.key + p.key;
                    return (
                      <button key={route}
                              className={'sidebar-subitem' + (screen === route ? ' active' : '')}
                              onClick={() => go(route)}>
                        <span>{p.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}

        {!collapsed && <div className="sidebar-section-label">Admin</div>}
        <button
          title={collapsed ? 'Settings' : undefined}
          className={'sidebar-item' + (section === 'settings' ? ' active' : '')}
          onClick={() => { if (collapsed) { go('integrations-home'); } else { setOpenSettings(o => !o); } }}>
          <span className="sidebar-item-icon">{I.settings}</span>
          {!collapsed && <>
            <span>Settings</span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', transform: openSettings ? 'rotate(90deg)' : 'none', transition: 'transform 120ms', color: 'var(--ink-3)' }}>{I.chevR}</span>
          </>}
        </button>
        {!collapsed && openSettings && (
          <div className="sidebar-subnav">
            {settingsKids.map(it => (
              <button key={it.key}
                      className={'sidebar-subitem' + (
                        (it.key === 'integrations' && section === 'settings' && screen.startsWith('integrations'))
                        || screen === it.route ? ' active' : '')}
                      onClick={() => go(it.route)}>
                <span>{it.label}</span>
                {it.badge ? <span className="sidebar-item-badge">{it.badge}</span> : null}
              </button>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-user">
        <div className="avatar">MG</div>
        {!collapsed && <div>
          <div className="sidebar-user-name">Mia Garcia</div>
          <div className="sidebar-user-role">Admin · Lumber</div>
        </div>}
      </div>
    </aside>
  );
}

// ---------- Topbar ----------
function Topbar({ crumbs, actions }) {
  return (
    <div className="topbar">
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="sep">/</span>}
            {c.onClick
              ? <button onClick={c.onClick} className={i === crumbs.length - 1 ? 'current' : ''}>{c.label}</button>
              : <span className={i === crumbs.length - 1 ? 'current' : ''}>{c.label}</span>}
          </React.Fragment>
        ))}
      </div>
      {actions && <div className="topbar-actions">{actions}</div>}
    </div>
  );
}

// ---------- Pill / status / type chips ----------
function StatusPill({ status }) {
  const c = window.LUMBER_DATA.STATUS_COLOR[status] || { bg: 'var(--bg-sunken)', ink: 'var(--ink-2)' };
  return <span className="pill" style={{ background: c.bg, color: c.ink, borderColor: 'transparent' }}>{status}</span>;
}

function TypeBadge({ type }) {
  const t = window.LUMBER_DATA.TICKET_TYPE[type];
  if (!t) return null;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-2)' }}>
      <span style={{
        width: 14, height: 14, borderRadius: 3, background: t.color, color: 'white',
        display: 'grid', placeItems: 'center', fontSize: 9, fontWeight: 700,
      }}>{t.icon}</span>
      {type}
    </span>
  );
}

function PriorityChip({ priority }) {
  const c = window.LUMBER_DATA.PRIORITY_COLOR[priority];
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, color: 'var(--ink-2)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: c }}/>
      {priority}
    </span>
  );
}

function ConfBar({ value }) {
  const cls = value >= 90 ? 'high' : value >= 70 ? 'med' : 'low';
  return (
    <span className="conf-bar">
      <span className="conf-track"><span className={'conf-fill ' + cls} style={{ width: value + '%' }}/></span>
      <span className="conf-text">{value}%</span>
    </span>
  );
}

function Toggle({ on, onChange }) {
  return <button className={'toggle' + (on ? ' on' : '')} onClick={() => onChange(!on)} aria-pressed={on}/>;
}

// ---------- Logos ----------
function JiraLogo({ size = 'md' }) {
  return <div className={'logo-tile jira' + (size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : '')}>Jr</div>;
}
function LumberLogo({ size = 'md' }) {
  return <div className={'logo-tile lumber' + (size === 'lg' ? ' lg' : size === 'sm' ? ' sm' : '')}>L</div>;
}

// Connector tile factory
function ConnectorMark({ kind, size = 'md' }) {
  const map = {
    jira: 'Jr', acu: 'Ac', qb: 'Qb', sage: 'S3', ns: 'NS', wd: 'Wd', vp: 'Vp', fn: 'Fn', pc: 'Pc',
  };
  return <div className={`logo-tile ${kind} ${size === 'lg' ? 'lg' : size === 'sm' ? 'sm' : ''}`}>{map[kind]}</div>;
}

// ---------- Avatar from initials ----------
function Avatar({ name, size = 'md' }) {
  const init = name.split(' ').map(s => s[0]).slice(0,2).join('');
  const cls = size === 'sm' ? 'avatar sm' : size === 'lg' ? 'avatar lg' : 'avatar';
  // deterministic hue from name
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return <div className={cls} style={{ background: `oklch(0.62 0.12 ${h})` }}>{init}</div>;
}

// ---------- Code block ----------
function Code({ children }) {
  return <pre className="code-block">{children}</pre>;
}

window.UI = {
  Sidebar, Topbar, StatusPill, TypeBadge, PriorityChip, ConfBar, Toggle,
  JiraLogo, LumberLogo, ConnectorMark, Avatar, Code,
};
