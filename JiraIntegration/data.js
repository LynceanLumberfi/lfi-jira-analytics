/* global React */
// =============================================================
// Lumber × Jira — mock data & helpers
// =============================================================

const JIRA_PROJECTS = [
  { key: 'LUM',  name: 'Lumber Web App',          lead: 'Mia Garcia',  type: 'software', issues: 482, lastUpdated: '2 min ago' },
  { key: 'API',  name: 'Lumber Public API',       lead: 'Tom Reilly',  type: 'software', issues: 217, lastUpdated: '14 min ago' },
  { key: 'MOB',  name: 'Mobile (iOS/Android)',    lead: 'Devon Park',  type: 'software', issues: 308, lastUpdated: '1 hr ago' },
  { key: 'DATA', name: 'Data Platform',           lead: 'Asha Iyer',   type: 'software', issues: 154, lastUpdated: '3 hr ago' },
  { key: 'OPS',  name: 'DevOps & Infra',          lead: 'Ray Sullivan',type: 'software', issues: 96,  lastUpdated: 'Today' },
  { key: 'DSGN', name: 'Design System',           lead: 'Nina Cole',   type: 'software', issues: 73,  lastUpdated: 'Yesterday' },
];

const JIRA_USERS = [
  { id: 'u-mg', name: 'Mia Garcia',     email: 'mia.garcia@lumber.co',     role: 'Eng Mgr',     avatar: 'MG' },
  { id: 'u-tr', name: 'Tom Reilly',     email: 'tom.reilly@lumber.co',     role: 'Backend Eng', avatar: 'TR' },
  { id: 'u-dp', name: 'Devon Park',     email: 'devon.park@lumber.co',     role: 'Mobile Eng',  avatar: 'DP' },
  { id: 'u-ai', name: 'Asha Iyer',      email: 'asha.iyer@lumber.co',      role: 'Data Eng',    avatar: 'AI' },
  { id: 'u-rs', name: 'Ray Sullivan',   email: 'ray.sullivan@lumber.co',   role: 'SRE',         avatar: 'RS' },
  { id: 'u-nc', name: 'Nina Cole',      email: 'nina.cole@lumber.co',      role: 'Design Lead', avatar: 'NC' },
  { id: 'u-jb', name: 'Jamal Brooks',   email: 'jamal.brooks@lumber.co',   role: 'Frontend',    avatar: 'JB' },
  { id: 'u-mz', name: 'Maria Zheng',    email: 'maria.zheng@lumber.co',    role: 'PM',          avatar: 'MZ' },
];

const JIRA_TICKETS = [
  { key: 'LUM-2046', type: 'Epic',    title: 'ERP Integrations Framework',           status: 'In Progress', priority: 'High',    assignee: 'Mia Garcia',  reporter: 'Maria Zheng', sprint: 'S-12', points: 21, updated: '2h ago', confidence: 96 },
  { key: 'LUM-2047', type: 'Story',   title: 'Connect wizard — API key auth',        status: 'In Review',   priority: 'High',    assignee: 'Tom Reilly',  reporter: 'Mia Garcia',  sprint: 'S-12', points: 8,  updated: '1h ago', confidence: 92 },
  { key: 'LUM-2048', type: 'Story',   title: 'Field mapping editor',                 status: 'To Do',       priority: 'Medium',  assignee: 'Jamal Brooks',reporter: 'Mia Garcia',  sprint: 'S-12', points: 5,  updated: '3h ago', confidence: 88 },
  { key: 'LUM-2049', type: 'Bug',     title: 'OAuth callback drops state param',     status: 'In Progress', priority: 'Critical',assignee: 'Tom Reilly',  reporter: 'Ray Sullivan',sprint: 'S-12', points: 3,  updated: '32m ago', confidence: 71 },
  { key: 'LUM-2050', type: 'Task',    title: 'Add audit log retention (90d)',        status: 'Done',        priority: 'Medium',  assignee: 'Asha Iyer',   reporter: 'Mia Garcia',  sprint: 'S-11', points: 3,  updated: '1d ago', confidence: 84 },
  { key: 'LUM-2051', type: 'Story',   title: 'Live sync progress streaming',         status: 'In Progress', priority: 'High',    assignee: 'Devon Park',  reporter: 'Mia Garcia',  sprint: 'S-12', points: 13, updated: '4h ago', confidence: null, action: 'create' },
  { key: 'LUM-2052', type: 'Sub-task',title: 'Stream progress via SSE',              status: 'To Do',       priority: 'High',    assignee: 'Devon Park',  reporter: 'Devon Park',  sprint: 'S-12', points: 5,  updated: '6h ago', confidence: null, action: 'create' },
  { key: 'API-318',  type: 'Epic',    title: 'Webhook delivery v2',                  status: 'To Do',       priority: 'Medium',  assignee: 'Tom Reilly',  reporter: 'Mia Garcia',  sprint: 'Backlog',points: 21, updated: '2d ago', confidence: null, action: 'create' },
  { key: 'API-319',  type: 'Story',   title: 'Retry with exponential backoff',       status: 'In Progress', priority: 'High',    assignee: 'Ray Sullivan',reporter: 'Tom Reilly',  sprint: 'S-12', points: 5,  updated: '1d ago', confidence: 78 },
  { key: 'MOB-411',  type: 'Bug',     title: 'iOS push token not refreshing',        status: 'In Review',   priority: 'High',    assignee: 'Devon Park',  reporter: 'Maria Zheng', sprint: 'S-12', points: 3,  updated: '5h ago', confidence: 64, conflict: true },
  { key: 'DATA-89',  type: 'Story',   title: 'Realtime sync events to Snowflake',    status: 'To Do',       priority: 'Medium',  assignee: 'Asha Iyer',   reporter: 'Mia Garcia',  sprint: 'S-13', points: 8,  updated: '3d ago', confidence: null, action: 'create' },
  { key: 'OPS-22',   type: 'Task',    title: 'Set up Jira polling cron',             status: 'Done',        priority: 'Low',     assignee: 'Ray Sullivan',reporter: 'Mia Garcia',  sprint: 'S-11', points: 2,  updated: '5d ago', confidence: 91 },
  { key: 'DSGN-14',  type: 'Story',   title: 'Lumber × Jira integration screens',    status: 'In Review',   priority: 'High',    assignee: 'Nina Cole',   reporter: 'Mia Garcia',  sprint: 'S-12', points: 8,  updated: '20m ago', confidence: 89 },
];

// Type→color
const TICKET_TYPE = {
  Epic:      { color: 'oklch(0.55 0.16 295)', icon: '◆' },
  Story:     { color: 'oklch(0.55 0.13 145)', icon: '▮' },
  Task:      { color: 'oklch(0.55 0.13 235)', icon: '✓' },
  'Sub-task':{ color: 'oklch(0.62 0.12 215)', icon: '↳' },
  Bug:       { color: 'oklch(0.58 0.17 27)',  icon: '●' },
};

const STATUS_COLOR = {
  'To Do':       { bg: 'var(--bg-sunken)',   ink: 'var(--ink-2)' },
  'In Progress': { bg: 'var(--info-soft)',   ink: 'var(--info)' },
  'In Review':   { bg: 'var(--warn-soft)',   ink: 'var(--warn)' },
  'Done':        { bg: 'var(--ok-soft)',     ink: 'var(--ok)' },
  'Blocked':     { bg: 'var(--err-soft)',    ink: 'var(--err)' },
};

const PRIORITY_COLOR = {
  Critical: 'var(--err)',
  High:     'var(--warn)',
  Medium:   'var(--info)',
  Low:      'var(--ink-4)',
};

const SYNC_HISTORY = [
  { id: '20260506-02', conn: 'jira', started: 'May 6, 2026 · 2:04 AM',  trigger: { kind: 'Manual', who: 'Mia Garcia' }, duration: '2m 14s', records: 695, breakdown: { add: 20, upd: 66, skip: 575, warn: 34 }, status: 'review' },
  { id: '20260505-01', conn: 'jira', started: 'May 5, 2026 · 2:00 AM',  trigger: { kind: 'Scheduled' }, duration: '1m 48s', records: 612, breakdown: { add: 8,  upd: 24, skip: 580 }, status: 'healthy' },
  { id: '20260504-01', conn: 'jira', started: 'May 4, 2026 · 2:00 AM',  trigger: { kind: 'Scheduled' }, duration: '1m 52s', records: 608, breakdown: { add: 4,  upd: 18, skip: 586 }, status: 'healthy' },
  { id: '20260503-03', conn: 'jira', started: 'May 3, 2026 · 4:17 PM',  trigger: { kind: 'Manual', who: 'Tom Reilly' }, duration: '32s',    records: 12,  breakdown: { upd: 12 }, status: 'healthy' },
  { id: '20260503-01', conn: 'jira', started: 'May 3, 2026 · 2:00 AM',  trigger: { kind: 'Scheduled' }, duration: '2m 04s', records: 602, breakdown: { add: 6, upd: 22, skip: 574, fail: 3 }, status: 'failed' },
  { id: '20260502-01', conn: 'jira', started: 'May 2, 2026 · 2:00 AM',  trigger: { kind: 'Scheduled' }, duration: '1m 44s', records: 596, breakdown: { add: 2, upd: 14, skip: 580 }, status: 'healthy' },
  { id: '20260501-01', conn: 'jira', started: 'May 1, 2026 · 2:00 AM',  trigger: { kind: 'Scheduled' }, duration: '1m 41s', records: 591, breakdown: { add: 1, upd: 11, skip: 579 }, status: 'healthy' },
];

const FAILED_RECORDS = [
  {
    id: 'f1',
    entity: 'Issues',
    direction: 'Jira → Lumber',
    title: 'LUM-2049 — OAuth callback drops state param',
    detail: 'Parent epic LUM-2046 not yet synced',
    code: 'DEPENDENCY',
    when: '2 min ago',
    retries: 3,
    explain: 'Lumber tried to import LUM-2049 but its parent epic LUM-2046 has not been synced into Lumber yet. Child issues require their parent to exist first.',
    fix: [
      'Run a Projects + Epics sync first',
      'Or enable "Auto-sync parent" in Configure → Issues',
      'Or skip and re-run after LUM-2046 commits'
    ],
    raw: 'HTTP 422 Unprocessable Entity\n{\n  "error": "ParentNotFound",\n  "message": "Parent issue LUM-2046 not in scope",\n  "entityType": "issue"\n}'
  },
  {
    id: 'f2',
    entity: 'Users',
    direction: 'Jira → Lumber',
    title: 'devon.park@lumber.co',
    detail: 'Email collides with existing Lumber user',
    code: 'CONFLICT_UNIQUE',
    when: '2 min ago',
    retries: 1,
    explain: 'A Lumber user with this email already exists but is linked to a different Jira accountId. Lumber will not overwrite without your confirmation.',
    fix: ['Open the existing Lumber user and link the Jira accountId manually', 'Or merge the two users from People → Settings'],
    raw: 'HTTP 409 Conflict\n{\n  "error": "EmailAlreadyExists",\n  "lumberUserId": "usr_4f2a...",\n  "jiraAccountId": "5b10a..."\n}'
  },
  {
    id: 'f3',
    entity: 'Issues',
    direction: 'Jira → Lumber',
    title: 'MOB-411 — iOS push token not refreshing',
    detail: 'Both systems edited the same fields',
    code: 'CONFLICT_FIELDS',
    when: '5 min ago',
    retries: 2,
    explain: '4 fields (status, assignee, priority, sprint) were modified in both Jira and Lumber since the last sync.',
    fix: ['Open Conflict Resolution and pick a winning version', 'Or change this entity to one-way sync to silence future conflicts'],
    raw: 'HTTP 200 OK (locally rejected)\n{\n  "error": "FieldConflict",\n  "fields": ["status","assignee","priority","sprint"]\n}'
  },
  {
    id: 'f4',
    entity: 'Issues',
    direction: 'Jira → Lumber',
    title: 'DATA-89 — Realtime sync events to Snowflake',
    detail: 'Required field "Story Points" is empty',
    code: 'VALIDATION',
    when: '12 min ago',
    retries: 1,
    explain: 'Lumber requires every Story to carry a story-point estimate. The Jira issue has none.',
    fix: ['Add story points in Jira and retry', 'Or relax the validation in Configure → Issues → Required fields'],
    raw: 'HTTP 422\n{\n  "error": "MissingField",\n  "field": "story_points"\n}'
  },
  {
    id: 'f5',
    entity: 'Worklogs',
    direction: 'Jira → Lumber',
    title: 'Maria Zheng · May 5 · 6h on LUM-2047',
    detail: 'Jira returned rate-limit (429)',
    code: 'RATE_LIMITED',
    when: '14 min ago',
    retries: 5,
    explain: 'Jira Cloud throttled our worklog batch. Lumber will not auto-retry rate-limited records without confirmation.',
    fix: ['Click Retry — backoff window is over', 'Or schedule the next sync to off-peak hours'],
    raw: 'HTTP 429 Too Many Requests\nRetry-After: 120'
  },
];

// Audit log
const AUDIT_LOG = [
  { id: 'a1',  t: '2:06:14 AM', actor: 'sync-agent',  kind: 'commit',     msg: 'Committed 7 records to Lumber', detail: '+3 created · ~4 updated', tone: 'ok' },
  { id: 'a2',  t: '2:05:58 AM', actor: 'Mia Garcia',  kind: 'review',     msg: 'Approved auto-matches', detail: '7 of 9 projects',          tone: 'info' },
  { id: 'a3',  t: '2:05:12 AM', actor: 'Mia Garcia',  kind: 'review',     msg: 'Manually mapped DATA-89 → Snowflake epic',          tone: 'info' },
  { id: 'a4',  t: '2:05:01 AM', actor: 'sync-agent',  kind: 'conflict',   msg: 'Detected 1 conflict on MOB-411',                    tone: 'warn' },
  { id: 'a5',  t: '2:04:48 AM', actor: 'sync-agent',  kind: 'fetch',      msg: 'Fetched 695 records from Jira',                     tone: 'info' },
  { id: 'a6',  t: '2:04:02 AM', actor: 'Mia Garcia',  kind: 'trigger',    msg: 'Triggered manual sync run #20260506-02',            tone: 'info' },
  { id: 'a7',  t: '2:00:00 AM', actor: 'scheduler',   kind: 'schedule',   msg: 'Skipped scheduled run — manual run in progress',    tone: 'muted' },
  { id: 'a8',  t: 'Yesterday',  actor: 'Tom Reilly',  kind: 'config',     msg: 'Changed sync direction on Worklogs to Jira→Lumber', tone: 'info' },
  { id: 'a9',  t: '2 days ago', actor: 'Mia Garcia',  kind: 'connect',    msg: 'Connected Jira workspace lumberfi.atlassian.net',   tone: 'ok' },
];

window.LUMBER_DATA = {
  JIRA_PROJECTS, JIRA_USERS, JIRA_TICKETS,
  TICKET_TYPE, STATUS_COLOR, PRIORITY_COLOR,
  SYNC_HISTORY, FAILED_RECORDS, AUDIT_LOG,
};
