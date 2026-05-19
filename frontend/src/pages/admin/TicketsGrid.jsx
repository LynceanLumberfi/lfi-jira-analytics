import { useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Loader2, Search, X } from "lucide-react";
import { getIssues, getSprints, getTeams } from "../../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import { Pill } from "../../components/ui/Pill";
import { ScoreBar } from "../../components/charts/ScoreBar";
import { IssueDrawer } from "../../components/ui/IssueDrawer";

const PAGE_SIZE = 50;

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ChevronsUpDown size={11} className="ml-1 inline text-ink-4" />;
  return sortDir === "asc"
    ? <ChevronUp size={11} className="ml-1 inline text-accent" />
    : <ChevronDown size={11} className="ml-1 inline text-accent" />;
}

function SortTH({ col, sortCol, sortDir, onSort, className, children }) {
  return (
    <TH
      className={`cursor-pointer select-none hover:text-ink ${className || ""}`}
      onClick={() => onSort(col)}
    >
      {children}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </TH>
  );
}

function sprintTone(state) {
  if (state === "active") return "accent";
  if (state === "closed") return "ok";
  if (state === "future") return "info";
  return "default";
}

function statusTone(isDone, status) {
  if (isDone) return "ok";
  const s = (status || "").toLowerCase();
  if (s === "in progress" || s === "in review") return "accent";
  if (s.includes("block")) return "err";
  return "default";
}

export function TicketsGrid() {
  const [q, setQ] = useState("");
  const [team, setTeam] = useState("");
  const [sprintId, setSprintId] = useState("");
  const [issueType, setIssueType] = useState("");
  const [status, setStatus] = useState("");
  const [scoreStatus, setScoreStatus] = useState("");
  const [staged, setStaged] = useState("");
  const [sortCol, setSortCol] = useState("updated_at");
  const [sortDir, setSortDir] = useState("desc");
  const [offset, setOffset] = useState(0);
  const [selectedKey, setSelectedKey] = useState(null);

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const { data: sprints } = useQuery({
    queryKey: ["sprints", "all"],
    queryFn: () => getSprints(),
    staleTime: 5 * 60 * 1000,
  });

  const filters = {
    limit: PAGE_SIZE,
    offset,
    sort: sortCol,
    order: sortDir,
    ...(q ? { q } : {}),
    ...(team ? { team_ids: [Number(team)] } : {}),
    ...(sprintId ? { sprint_ids: [Number(sprintId)] } : {}),
    ...(issueType ? { issue_type: issueType } : {}),
    ...(status ? { status } : {}),
    ...(scoreStatus ? { score_status: scoreStatus } : {}),
    ...(staged ? { staged: staged === "yes" } : {}),
  };

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-tickets", filters],
    queryFn: () => getIssues(filters),
    placeholderData: keepPreviousData,
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + items.length, total);
  const hasPrev = offset > 0;
  const hasNext = offset + PAGE_SIZE < total;

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
    setOffset(0);
  }

  function onFilterChange(fn) {
    fn();
    setOffset(0);
  }

  const hasFilters = q || team || sprintId || issueType || status || scoreStatus || staged;

  function clearFilters() {
    setQ("");
    setTeam("");
    setSprintId("");
    setIssueType("");
    setStatus("");
    setScoreStatus("");
    setStaged("");
    setOffset(0);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-[18px] font-semibold text-ink">Tickets</h2>
          <p className="mt-1 text-[13px] text-ink-3">
            All promoted tickets across teams, sprints, and types.
          </p>
        </div>
        <div className="text-[12.5px] text-ink-3">
          {isFetching && !isLoading && <Loader2 size={12} className="mr-1.5 inline animate-spin" />}
          {total > 0 ? (
            <>Showing <span className="font-medium text-ink-2">{showingFrom.toLocaleString()}–{showingTo.toLocaleString()}</span> of <span className="font-medium text-ink-2">{total.toLocaleString()}</span></>
          ) : isLoading ? "Loading…" : "No tickets"}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Ticket list</CardTitle>
        </CardHeader>
        <CardBody pad="none">
          {/* filter bar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div className="relative min-w-[200px] flex-1">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
              <input
                type="text"
                placeholder="Search key or summary…"
                value={q}
                onChange={(e) => onFilterChange(() => setQ(e.target.value))}
                className="h-8 w-full rounded border border-border bg-bg-sunken pl-8 pr-3 text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
              />
            </div>
            <select
              value={team}
              onChange={(e) => onFilterChange(() => setTeam(e.target.value))}
              className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            >
              <option value="">All teams</option>
              {(teams || []).map((t) => (
                <option key={t.id} value={t.id}>{t.name || `Team #${t.id}`}</option>
              ))}
            </select>
            <select
              value={sprintId}
              onChange={(e) => onFilterChange(() => setSprintId(e.target.value))}
              className="h-8 max-w-[200px] rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            >
              <option value="">All sprints</option>
              {(sprints || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name || "Unnamed"}</option>
              ))}
            </select>
            <select
              value={issueType}
              onChange={(e) => onFilterChange(() => setIssueType(e.target.value))}
              className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            >
              <option value="">All types</option>
              <option value="Story">Story</option>
              <option value="Bug">Bug</option>
              <option value="Task">Task</option>
              <option value="Sub-task">Sub-task</option>
              <option value="Epic">Epic</option>
            </select>
            <input
              type="text"
              placeholder="Status (exact)…"
              value={status}
              onChange={(e) => onFilterChange(() => setStatus(e.target.value))}
              className="h-8 w-[140px] rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
            />
            <select
              value={scoreStatus}
              onChange={(e) => onFilterChange(() => setScoreStatus(e.target.value))}
              className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            >
              <option value="">All scoring</option>
              <option value="pending">Pending</option>
              <option value="scored">Scored</option>
              <option value="unscored">Unscored</option>
              <option value="attention">Need attention</option>
            </select>
            <select
              value={staged}
              onChange={(e) => onFilterChange(() => setStaged(e.target.value))}
              className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
            >
              <option value="">All staging</option>
              <option value="yes">Staged</option>
              <option value="no">Not staged</option>
            </select>
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="flex h-8 items-center gap-1 rounded border border-border px-2.5 text-[12px] text-ink-3 hover:bg-bg-sunken"
              >
                <X size={11} /> Clear
              </button>
            )}
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-ink-3">
              <Loader2 size={13} className="animate-spin" /> Loading tickets…
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-[13px] text-ink-4">
              {hasFilters ? "No tickets match the current filters." : "No tickets found."}
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <SortTH col="jira_key" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Key</SortTH>
                  <SortTH col="issue_type" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Type</SortTH>
                  <TH>Summary</TH>
                  <TH>Team</TH>
                  <SortTH col="sprint_name" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Sprint</SortTH>
                  <TH>Assignee</TH>
                  <SortTH col="story_points" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right">SP</SortTH>
                  <SortTH col="quality_score" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Score</SortTH>
                  <TH>Skill</TH>
                  <SortTH col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Status</SortTH>
                </TR>
              </THead>
              <TBody>
                {items.map((it) => (
                  <TR key={it.issue_id}>
                    <TD>
                      <button
                        className="font-mono text-[12px] font-semibold text-accent hover:underline"
                        onClick={() => setSelectedKey(it.jira_key)}
                      >
                        {it.jira_key}
                      </button>
                    </TD>
                    <TD>
                      <Pill tone="default">{it.issue_type || "—"}</Pill>
                    </TD>
                    <TD className="max-w-[320px]">
                      <span className="line-clamp-1 text-[13px] text-ink-2">{it.summary}</span>
                    </TD>
                    <TD>
                      <span className="text-[12.5px] text-ink-3">{it.team_name || "—"}</span>
                    </TD>
                    <TD>
                      {it.sprint_name ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-[12.5px] text-ink-2">{it.sprint_name}</span>
                          {it.sprint_state && (
                            <Pill tone={sprintTone(it.sprint_state)}>{it.sprint_state}</Pill>
                          )}
                        </span>
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </TD>
                    <TD>
                      <span className="text-[12.5px] text-ink-2">
                        {it.assignee_name || <span className="text-ink-4">—</span>}
                      </span>
                    </TD>
                    <TD className="text-right font-mono text-[12px]">{it.story_points ?? "—"}</TD>
                    <TD>
                      {it.quality_score != null ? (
                        <ScoreBar value={it.quality_score} width={48} showValue />
                      ) : (
                        <span className="text-[12px] text-ink-4">—</span>
                      )}
                    </TD>
                    <TD>
                      {it.skill_usage_detected ? (
                        <Pill tone="ok">{it.skill_name || "yes"}</Pill>
                      ) : it.quality_score != null ? (
                        <span className="text-[12px] text-ink-4">—</span>
                      ) : (
                        <span className="text-[12px] text-ink-4">NS</span>
                      )}
                    </TD>
                    <TD>
                      <Pill tone={statusTone(it.is_done, it.status)}>{it.status || "—"}</Pill>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}

          {/* pagination */}
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-[12.5px] text-ink-3">
            <div>
              Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={!hasPrev}
                className="flex h-7 items-center gap-1 rounded border border-border px-2.5 text-[12px] text-ink-2 hover:bg-bg-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronLeft size={12} /> Prev
              </button>
              <button
                onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={!hasNext}
                className="flex h-7 items-center gap-1 rounded border border-border px-2.5 text-[12px] text-ink-2 hover:bg-bg-sunken disabled:cursor-not-allowed disabled:opacity-50"
              >
                Next <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      <IssueDrawer issueKey={selectedKey} onClose={() => setSelectedKey(null)} />
    </div>
  );
}
