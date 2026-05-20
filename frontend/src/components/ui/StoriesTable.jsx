import { useState, useMemo } from "react";
import { ChevronsUpDown, ChevronUp, ChevronDown, Search, X } from "lucide-react";
import { cn } from "../../lib/cn";
import { Loader2 } from "lucide-react";
import { Table, TBody, TD, TH, THead, TR } from "./Table";
import { Pill } from "./Pill";
import { ScoreBar } from "../charts/ScoreBar";
import { IssueDrawer } from "./IssueDrawer";

// ---------- sort indicator ----------

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <ChevronsUpDown size={11} className="ml-1 inline text-ink-4" />;
  return sortDir === "asc"
    ? <ChevronUp size={11} className="ml-1 inline text-accent" />
    : <ChevronDown size={11} className="ml-1 inline text-accent" />;
}

function SortTH({ col, sortCol, sortDir, onSort, className, children }) {
  return (
    <TH
      className={cn("cursor-pointer select-none hover:text-ink", className)}
      onClick={() => onSort(col)}
    >
      {children}
      <SortIcon col={col} sortCol={sortCol} sortDir={sortDir} />
    </TH>
  );
}

// ---------- filter bar ----------

function FilterBar({
  filterQ, onQ,
  filterSkill, onSkill,
  filterTeam, onTeam, teams,
  filterAssignee, onAssignee, assignees,
  onClear, hasFilters,
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
      {/* search */}
      <div className="relative min-w-[200px] flex-1">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-4" />
        <input
          type="text"
          placeholder="Search key or summary…"
          value={filterQ}
          onChange={(e) => onQ(e.target.value)}
          className="h-8 w-full rounded border border-border bg-bg-sunken pl-8 pr-3 text-[12.5px] text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
      </div>

      {/* skill */}
      <select
        value={filterSkill}
        onChange={(e) => onSkill(e.target.value)}
        className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
      >
        <option value="all">All Skill</option>
        <option value="skill">With Skill</option>
        <option value="no_skill">Without Skill</option>
      </select>

      {/* team (overview only) */}
      {teams.length > 0 && (
        <select
          value={filterTeam}
          onChange={(e) => onTeam(e.target.value)}
          className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All Teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      )}

      {/* assignee */}
      {assignees.length > 0 && (
        <select
          value={filterAssignee}
          onChange={(e) => onAssignee(e.target.value)}
          className="h-8 rounded border border-border bg-bg-sunken px-2.5 text-[12.5px] text-ink focus:border-accent focus:outline-none"
        >
          <option value="">All Assignees</option>
          {assignees.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      )}

      {/* clear */}
      {hasFilters && (
        <button
          onClick={onClear}
          className="flex h-8 items-center gap-1 rounded border border-border px-2.5 text-[12px] text-ink-3 hover:bg-bg-sunken"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>
  );
}

// ---------- main component ----------

export function StoriesTable({ items = [], isLoading = false, showTeamFilter = false }) {
  const [sortCol, setSortCol] = useState("jira_key");
  const [sortDir, setSortDir] = useState("asc");
  const [filterQ, setFilterQ] = useState("");
  const [filterSkill, setFilterSkill] = useState("all");
  const [filterTeam, setFilterTeam] = useState("");
  const [filterAssignee, setFilterAssignee] = useState("");
  const [selectedKey, setSelectedKey] = useState(null);

  const teams = useMemo(() => {
    if (!showTeamFilter) return [];
    const seen = new Set();
    return items
      .map((it) => it.team_name)
      .filter((n) => n && !seen.has(n) && seen.add(n))
      .sort();
  }, [items, showTeamFilter]);

  const assignees = useMemo(() => {
    const seen = new Set();
    return items
      .map((it) => it.assignee_name)
      .filter((n) => n && !seen.has(n) && seen.add(n))
      .sort();
  }, [items]);

  const hasFilters =
    filterQ !== "" || filterSkill !== "all" || filterTeam !== "" || filterAssignee !== "";

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
  }

  function clearFilters() {
    setFilterQ("");
    setFilterSkill("all");
    setFilterTeam("");
    setFilterAssignee("");
  }

  const rows = useMemo(() => {
    let list = items;

    if (filterQ) {
      const q = filterQ.toLowerCase();
      list = list.filter(
        (it) => it.jira_key.toLowerCase().includes(q) || (it.summary || "").toLowerCase().includes(q)
      );
    }
    if (filterSkill === "skill") list = list.filter((it) => it.skill_usage_detected);
    if (filterSkill === "no_skill") list = list.filter((it) => !it.skill_usage_detected);
    if (filterTeam) list = list.filter((it) => it.team_name === filterTeam);
    if (filterAssignee) list = list.filter((it) => it.assignee_name === filterAssignee);

    return [...list].sort((a, b) => {
      let av, bv;
      switch (sortCol) {
        case "jira_key":      av = a.jira_key;            bv = b.jira_key;            break;
        case "assignee":      av = a.assignee_name || ""; bv = b.assignee_name || ""; break;
        case "story_points":  av = a.story_points  ?? -1; bv = b.story_points  ?? -1; break;
        case "quality_score": av = a.quality_score ?? -1; bv = b.quality_score ?? -1; break;
        case "skill":         av = a.skill_usage_detected ? 1 : 0; bv = b.skill_usage_detected ? 1 : 0; break;
        default:              av = a.jira_key;            bv = b.jira_key;
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [items, filterQ, filterSkill, filterTeam, filterAssignee, sortCol, sortDir]);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-4 text-[13px] text-ink-3">
        <Loader2 size={13} className="animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <>
      <FilterBar
        filterQ={filterQ} onQ={setFilterQ}
        filterSkill={filterSkill} onSkill={setFilterSkill}
        filterTeam={filterTeam} onTeam={setFilterTeam}
        teams={teams}
        filterAssignee={filterAssignee} onAssignee={setFilterAssignee}
        assignees={assignees}
        onClear={clearFilters}
        hasFilters={hasFilters}
      />

      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-[13px] text-ink-4">
          {hasFilters ? "No stories match the current filters." : "No stories found."}
        </div>
      ) : (
        <Table>
          <THead>
            <TR>
              <SortTH col="jira_key" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Key</SortTH>
              <TH>Summary</TH>
              {showTeamFilter && <TH>Team</TH>}
              <SortTH col="assignee" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Assignee</SortTH>
              <SortTH col="story_points" sortCol={sortCol} sortDir={sortDir} onSort={handleSort} className="text-right">SP</SortTH>
              <SortTH col="quality_score" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Score</SortTH>
              <SortTH col="skill" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Skill</SortTH>
            </TR>
          </THead>
          <TBody>
            {rows.map((it) => (
              <TR key={it.issue_id}>
                <TD>
                  <button
                    className="font-mono text-[12px] font-semibold text-accent hover:underline"
                    onClick={() => setSelectedKey(it.jira_key)}
                  >
                    {it.jira_key}
                  </button>
                </TD>
                <TD className="max-w-[340px]">
                  <span className="line-clamp-1 text-[13px] text-ink-2">{it.summary}</span>
                </TD>
                {showTeamFilter && (
                  <TD><span className="text-[12.5px] text-ink-3">{it.team_name || "—"}</span></TD>
                )}
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
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <IssueDrawer issueKey={selectedKey} onClose={() => setSelectedKey(null)} />
    </>
  );
}
