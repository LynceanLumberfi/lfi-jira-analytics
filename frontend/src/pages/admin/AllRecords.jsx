import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { getIssues, getSprints, getTeams } from "../../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/ui/Card";
import { Pill } from "../../components/ui/Pill";
import { Table, TBody, TD, TH, THead, TR } from "../../components/ui/Table";
import { Avatar } from "../../components/ui/Avatar";
import { ScoreBar } from "../../components/charts/ScoreBar";
import { IssueDrawer } from "../../components/ui/IssueDrawer";
import { Button } from "../../components/ui/Button";

const PAGE_SIZE = 200;

function SortTH({ col, sortCol, sortDir, onSort, className = "", children }) {
  const active = sortCol === col;
  return (
    <TH
      className={`cursor-pointer select-none whitespace-nowrap ${className}`}
      onClick={() => onSort(col)}
    >
      {children}{" "}
      <span className="font-normal opacity-50">
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </TH>
  );
}

function TeamMultiSelect({ teams = [], selectedIds, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  function toggle(id) {
    onChange(
      selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]
    );
  }

  const label =
    selectedIds.length === 0
      ? "All teams"
      : selectedIds.length === 1
        ? teams.find((t) => t.id === selectedIds[0])?.name ?? "1 team"
        : `${selectedIds.length} teams`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded border border-border bg-bg-sunken px-2.5 py-1.5 text-[13px] text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-accent"
      >
        {label}
        {selectedIds.length > 0 && (
          <span
            className="flex h-4 w-4 items-center justify-center rounded-full bg-accent/15 text-[10px] font-semibold text-accent"
            onClick={(e) => { e.stopPropagation(); onChange([]); }}
          >
            <X size={9} />
          </span>
        )}
        <ChevronDown size={13} className="text-ink-3" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-20 mt-1 w-52 overflow-auto rounded-lg border border-border bg-bg-elev py-1 shadow-lg" style={{ maxHeight: 260 }}>
            {teams.map((t) => (
              <label
                key={t.id}
                className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-[13px] text-ink hover:bg-bg-sunken"
              >
                <input
                  type="checkbox"
                  checked={selectedIds.includes(t.id)}
                  onChange={() => toggle(t.id)}
                  className="accent-accent"
                />
                {t.name || `Team #${t.id}`}
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export function AllRecords() {
  const [page, setPage] = useState(0);
  const [sprintId, setSprintId] = useState(null);
  const [teamIds, setTeamIds] = useState([]);
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [colFilters, setColFilters] = useState({
    key: "",
    type: "",
    summary: "",
    assignee: "",
    sp: "",
    quality: "",
  });
  const [selectedKey, setSelectedKey] = useState(null);

  const { data: sprints } = useQuery({
    queryKey: ["sprints"],
    queryFn: () => getSprints(),
    staleTime: 5 * 60 * 1000,
  });

  const { data: teams } = useQuery({
    queryKey: ["teams"],
    queryFn: getTeams,
    staleTime: 5 * 60 * 1000,
  });

  const { data: issues, isLoading } = useQuery({
    queryKey: ["issues", "all", { page, limit: PAGE_SIZE, sprint_id: sprintId, team_ids: teamIds }],
    queryFn: () =>
      getIssues({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        sort: "updated_at",
        order: "desc",
        ...(sprintId != null ? { sprint_id: sprintId } : {}),
        ...(teamIds.length > 0 ? { team_ids: teamIds } : {}),
      }),
    keepPreviousData: true,
  });

  function onTeamChange(ids) {
    setTeamIds(ids);
    setPage(0);
  }

  function onSortClick(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  const allItems = issues?.items ?? [];
  const uniqueTypes = [...new Set(allItems.map((it) => it.issue_type).filter(Boolean))].sort();
  const uniqueAssignees = [...new Set(allItems.map((it) => it.assignee_name).filter(Boolean))].sort();

  let displayedIssues = allItems;
  if (colFilters.key)
    displayedIssues = displayedIssues.filter((it) =>
      it.jira_key?.toLowerCase().includes(colFilters.key.toLowerCase())
    );
  if (colFilters.type)
    displayedIssues = displayedIssues.filter((it) => it.issue_type === colFilters.type);
  if (colFilters.summary)
    displayedIssues = displayedIssues.filter((it) =>
      it.summary?.toLowerCase().includes(colFilters.summary.toLowerCase())
    );
  if (colFilters.assignee)
    displayedIssues = displayedIssues.filter((it) => it.assignee_name === colFilters.assignee);
  if (colFilters.sp !== "")
    displayedIssues = displayedIssues.filter(
      (it) => (it.story_points ?? 0) >= Number(colFilters.sp)
    );
  if (colFilters.quality !== "")
    displayedIssues = displayedIssues.filter(
      (it) => it.quality_score != null && it.quality_score >= Number(colFilters.quality)
    );

  if (sortCol) {
    displayedIssues = [...displayedIssues].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }

  const totalPages = issues ? Math.ceil(issues.total / PAGE_SIZE) : 0;

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>All Tickets</CardTitle>
          <div className="flex items-center gap-3">
            <TeamMultiSelect
              teams={teams ?? []}
              selectedIds={teamIds}
              onChange={onTeamChange}
            />
            {sprints?.length > 0 && (
              <select
                value={sprintId ?? ""}
                onChange={(e) => {
                  setSprintId(e.target.value ? Number(e.target.value) : null);
                  setPage(0);
                }}
                className="rounded border border-border bg-bg-sunken px-2.5 py-1.5 text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">All sprints</option>
                {sprints.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name ?? "Unnamed"} ({s.jira_sprint_id})
                  </option>
                ))}
              </select>
            )}
            <span className="text-[12.5px] text-ink-3">
              Showing {displayedIssues.length} of {issues?.total ?? 0}
            </span>
          </div>
        </CardHeader>
        <CardBody pad="sm">
          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-4 text-[13px] text-ink-3">
              <Loader2 size={14} className="animate-spin" /> Loading…
            </div>
          ) : !allItems.length ? (
            <div className="rounded border border-dashed border-border bg-bg-sunken py-8 text-center text-[13px] text-ink-3">
              No promoted tickets yet.
            </div>
          ) : (
            <>
              <Table className="rounded-none border-0">
                <THead>
                  <TR>
                    <SortTH col="jira_key" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Key</SortTH>
                    <SortTH col="issue_type" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Type</SortTH>
                    <SortTH col="summary" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Summary</SortTH>
                    <SortTH col="assignee_name" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Assignee</SortTH>
                    <SortTH col="story_points" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick} className="text-right">SP</SortTH>
                    <SortTH col="quality_score" sortCol={sortCol} sortDir={sortDir} onSort={onSortClick}>Quality</SortTH>
                    <TH>Skill</TH>
                    <TH>AI</TH>
                    <TH>Status</TH>
                  </TR>
                  <TR>
                    <TH className="py-1">
                      <input
                        className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                        placeholder="Filter…"
                        value={colFilters.key}
                        onChange={(e) => setColFilters((f) => ({ ...f, key: e.target.value }))}
                      />
                    </TH>
                    <TH className="py-1">
                      <select
                        className="w-full rounded border border-border bg-bg px-1 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink"
                        value={colFilters.type}
                        onChange={(e) => setColFilters((f) => ({ ...f, type: e.target.value }))}
                      >
                        <option value="">All</option>
                        {uniqueTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </TH>
                    <TH className="py-1">
                      <input
                        className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                        placeholder="Filter…"
                        value={colFilters.summary}
                        onChange={(e) => setColFilters((f) => ({ ...f, summary: e.target.value }))}
                      />
                    </TH>
                    <TH className="py-1">
                      <select
                        className="w-full rounded border border-border bg-bg px-1 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink"
                        value={colFilters.assignee}
                        onChange={(e) => setColFilters((f) => ({ ...f, assignee: e.target.value }))}
                      >
                        <option value="">All</option>
                        {uniqueAssignees.map((a) => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </TH>
                    <TH className="py-1">
                      <input
                        type="number"
                        min="0"
                        className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                        placeholder="≥"
                        value={colFilters.sp}
                        onChange={(e) => setColFilters((f) => ({ ...f, sp: e.target.value }))}
                      />
                    </TH>
                    <TH className="py-1">
                      <input
                        type="number"
                        min="0"
                        max="5"
                        step="0.1"
                        className="w-full rounded border border-border bg-bg px-1.5 py-0.5 text-[11px] font-normal normal-case tracking-normal text-ink placeholder:text-ink-4"
                        placeholder="≥"
                        value={colFilters.quality}
                        onChange={(e) => setColFilters((f) => ({ ...f, quality: e.target.value }))}
                      />
                    </TH>
                    <TH /><TH /><TH />
                  </TR>
                </THead>
                <TBody>
                  {displayedIssues.length === 0 ? (
                    <TR>
                      <TD colSpan={9} className="py-6 text-center text-[13px] text-ink-4">
                        No tickets match the current filters.
                      </TD>
                    </TR>
                  ) : displayedIssues.map((it) => (
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
                      <TD className="max-w-[360px]">
                        <span className="line-clamp-1 text-[13px] text-ink-2">{it.summary}</span>
                      </TD>
                      <TD>
                        <span className="inline-flex items-center gap-2">
                          {it.assignee_name ? (
                            <>
                              <Avatar name={it.assignee_name} size={22} />
                              <span className="text-[12.5px] text-ink-2">{it.assignee_name}</span>
                            </>
                          ) : (
                            <span className="text-ink-4">—</span>
                          )}
                        </span>
                      </TD>
                      <TD className="text-right font-mono text-[12px]">
                        {it.story_points ?? "—"}
                      </TD>
                      <TD>
                        {it.quality_score != null ? (
                          <ScoreBar value={it.quality_score} width={48} showValue />
                        ) : it.ai_scoring_status != null ? (
                          <Pill tone={it.ai_scoring_status === "failed" ? "err" : "warn"}>
                            {it.ai_scoring_status}
                          </Pill>
                        ) : (
                          <span className="text-[12px] text-ink-4">—</span>
                        )}
                      </TD>
                      <TD>
                        {it.quality_score == null ? (
                          <span className="text-[12px] text-ink-4">NS</span>
                        ) : it.skill_usage_detected ? (
                          <span className="text-[12px] text-ink-2">{it.skill_name || "yes"}</span>
                        ) : (
                          <span className="text-[12px] text-ink-4">—</span>
                        )}
                      </TD>
                      <TD>
                        {it.ai_plan_detected ? (
                          <Pill tone="ok">plan</Pill>
                        ) : it.quality_score != null ? (
                          <Pill tone="default">no</Pill>
                        ) : (
                          <span className="text-[12px] text-ink-4">—</span>
                        )}
                      </TD>
                      <TD>
                        <Pill tone={it.is_done ? "ok" : "default"}>{it.status || "—"}</Pill>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>

              {totalPages > 1 && (
                <div className="flex items-center justify-between border-t border-border px-4 py-2.5 text-[12.5px] text-ink-3">
                  <span>
                    Page {page + 1} of {totalPages} · {issues.total.toLocaleString()} total
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPage((p) => p - 1)}
                      disabled={page === 0}
                    >
                      <ChevronLeft size={14} />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setPage((p) => p + 1)}
                      disabled={page >= totalPages - 1}
                    >
                      <ChevronRight size={14} />
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardBody>
      </Card>

      <IssueDrawer issueKey={selectedKey} onClose={() => setSelectedKey(null)} />
    </div>
  );
}
