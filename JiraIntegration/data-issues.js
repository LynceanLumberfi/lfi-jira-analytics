// Realistic Jira-shaped dataset for Overview / AI & Quality / Tickets / Cost
// 80 issues across 6 teams and 18 assignees, two sprints.
(function () {
  const TEAMS = ['Platform', 'Mobile', 'Data', 'Frontend', 'SRE', 'Growth'];
  const PEOPLE = [
    { name: 'Mia Garcia',   team: 'Platform' },
    { name: 'Tom Reilly',   team: 'Platform' },
    { name: 'Devon Park',   team: 'Mobile'   },
    { name: 'Asha Iyer',    team: 'Data'     },
    { name: 'Ray Sullivan', team: 'SRE'      },
    { name: 'Nina Cole',    team: 'Frontend' },
    { name: 'Jamal Brooks', team: 'Frontend' },
    { name: 'Maria Zheng',  team: 'Growth'   },
    { name: 'Kai Tanaka',   team: 'Mobile'   },
    { name: 'Priya Shah',   team: 'Data'     },
    { name: 'Owen Bates',   team: 'SRE'      },
    { name: 'Lila Romero',  team: 'Frontend' },
    { name: 'Ben Okafor',   team: 'Platform' },
    { name: 'Sofia Klein',  team: 'Growth'   },
    { name: 'Eli Hart',     team: 'Mobile'   },
    { name: 'Yara Hassan',  team: 'Data'     },
    { name: 'Cory Webb',    team: 'Platform' },
    { name: 'Ivy Chen',     team: 'Frontend' },
  ];
  const TYPES = ['Story', 'Task', 'Bug', 'Sub-task'];
  const SKILLS = ['React', 'Node', 'Postgres', 'Snowflake', 'Kafka', 'Swift', 'Kotlin', 'Terraform', 'Python', 'GraphQL', null, null, null];
  const PRIORITIES = ['Low', 'Medium', 'High', 'Highest'];
  const SUMMARIES = [
    'Wire OAuth callback retry on 5xx',
    'Push-token refresh on app resume',
    'Fix Snowflake mirror lag on weekday spike',
    'Composer: insert-image placeholder reflow',
    'Sentry alert: payload size > 2MB',
    'Add per-org rate limit headers',
    'Webhook delivery v2 — replay endpoint',
    'Cohort filter regression on Safari',
    'iOS 17 keyboard avoidance bug',
    'Schema migration for org_settings.ai_signals',
    'Onboarding: progress bar stalls at step 3',
    'PagerDuty: silence weekend low-sev alerts',
    'Reduce cold start in lambda-router',
    'Empty-state copy for first-sync',
    'Stale token warning on Jira reconnect',
    'Audit log: paginate beyond 10k rows',
    'Rename "Adapter" to "Connector" in UI',
    'Background job: stuck in pending > 1h',
    'A/B test: pricing page hero variant',
    'Sub-task linking lost on bulk import',
    'Confidence score not surfacing on conflicts',
    'Role guard regression on /admin/integrations',
    'Crash report: NPE in DiffViewModel',
    'Map Jira "Epic Link" to Lumber project',
    'Sync history: filter by run id',
    'Failed records: explain text for E_AUTH_EXPIRED',
    'Tweak panel: persist between reloads',
    'Conflict resolver: keep-mine UX clarity',
  ];
  const ISSUE_PREFIX = { Platform: 'PLAT', Mobile: 'MOB', Data: 'DATA', Frontend: 'FE', SRE: 'OPS', Growth: 'GRW' };

  // Deterministic pseudo-random
  let _seed = 7;
  const rnd = () => { _seed = (_seed * 9301 + 49297) % 233280; return _seed / 233280; };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
  const range = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));

  const issues = [];
  for (let i = 0; i < 80; i++) {
    const person = pick(PEOPLE);
    const type = i % 7 === 0 ? 'Bug' : i % 5 === 0 ? 'Sub-task' : i % 3 === 0 ? 'Task' : 'Story';
    const sprint = i < 38 ? 'Sprint 11' : 'Sprint 12';
    const sp = type === 'Bug' ? range(1, 5) : type === 'Sub-task' ? range(1, 3) : range(2, 13);
    const est = +(sp * (1.2 + rnd() * 0.8)).toFixed(1);
    const spent = +(est * (0.6 + rnd() * 1.0)).toFixed(1);
    const ai = +(rnd() * 4 + (type === 'Bug' ? 0.5 : 1)).toFixed(2);
    const quality = +(Math.min(5, ai * 0.6 + rnd() * 2 + 0.4)).toFixed(2);
    const skill = pick(SKILLS);
    const prefix = ISSUE_PREFIX[person.team];
    issues.push({
      issue_key: `${prefix}-${1000 + i}`,
      summary: SUMMARIES[i % SUMMARIES.length],
      issue_type: type,
      assignee: person.name,
      team: person.team,
      sprint,
      story_points: sp,
      estimate_hours: est,
      time_spent_hours: spent,
      ai_score: ai,
      quality_score: quality,
      skill_name: skill,
      has_description: rnd() > 0.18,
      priority: pick(PRIORITIES),
      status: pick(['To Do', 'In Progress', 'In Review', 'Done', 'Done']),
      ai_reason: ai < 2
        ? 'AI session referenced but limited evidence of meaningful suggestions accepted; mostly boilerplate.'
        : ai < 3.5
          ? 'AI assistance used to scaffold tests and documentation; moderate acceptance of inline suggestions.'
          : 'Clear AI-led implementation: design exploration, test generation, and refactor proposals all accepted.',
      quality_reason: quality < 2.5
        ? 'No description, missing acceptance criteria, and the linked spec is stale. Ticket reopened twice.'
        : quality < 4
          ? 'Description present and AC clear; minor missing context on rollback strategy.'
          : 'Excellent: description, AC, screenshots, links to design and spec, and rollout note included.',
    });
  }

  // Aggregate helpers
  function byKey(arr, key) {
    const map = new Map();
    arr.forEach(it => {
      const k = it[key] || '—';
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(it);
    });
    return Array.from(map.entries()).map(([k, items]) => {
      const skillCount = items.filter(x => x.skill_name).length;
      const overBudget = items.filter(x => x.time_spent_hours > x.estimate_hours).length;
      const avg = (k2) => {
        const v = items.map(x => x[k2]).filter(x => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
      };
      return {
        [key]: k,
        count: items.length,
        avgQ:    avg('quality_score'),
        avgAI:   avg('ai_score'),
        sp:      items.reduce((a, b) => a + (b.story_points || 0), 0),
        estAvg:  avg('estimate_hours'),
        spentAvg:avg('time_spent_hours'),
        skillPct: items.length ? (skillCount / items.length) * 100 : 0,
        noDesc:  items.filter(x => !x.has_description).length,
        overBudget,
        items,
      };
    });
  }

  // Cost / token telemetry (Sprint IQ-style; placeholder)
  const cost = {
    totalCost: 4.82,
    calls: 312,
    totalInput: 482000,
    totalOutput: 96400,
    cacheCreate: 38000,
    cacheRead:  214500,
    steps: {
      ingest:    { status: 'done',    calls: 84, cost: 0.61, in: 96000,  out: 18400, cIn: 8000,  cR: 41000 },
      classify:  { status: 'done',    calls: 88, cost: 1.42, in: 142000, out: 31000, cIn: 11000, cR: 62000 },
      score:     { status: 'done',    calls: 90, cost: 1.91, in: 188000, out: 36000, cIn: 14000, cR: 79000 },
      summarize: { status: 'done',    calls: 50, cost: 0.88, in:  56000, out: 11000, cIn:  5000, cR: 32500 },
      audit:     { status: 'skipped', calls:  0, cost: 0.00, in:      0, out:     0, cIn:     0, cR:     0 },
    },
  };

  window.LUMBER_ISSUES = {
    issues,
    teams: TEAMS,
    people: PEOPLE.map(p => p.name).sort(),
    byTeam: byKey(issues, 'team').sort((a, b) => b.count - a.count),
    byAssignee: byKey(issues, 'assignee').sort((a, b) => b.count - a.count),
    cost,
  };
})();
