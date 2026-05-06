import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ArrowLeft, Loader2 } from "lucide-react";
import { getSyncGroupIssues } from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Pill } from "../components/ui/Pill";
import { Button } from "../components/ui/Button";
import { Table, TBody, TD, TH, THead, TR } from "../components/ui/Table";

const CHANGE_TYPE_LABEL = { new: "Created", updated: "Updated" };
const CHANGE_TYPE_TONE = { new: "ok", updated: "info" };

const ISSUE_TYPE_COLORS = {
  Story: "text-accent",
  Bug: "text-err",
  Task: "text-info",
  Epic: "text-warn",
};

function StatCard({ label, value, tone = "default", sub }) {
  const valueTone =
    tone === "ok" ? "text-ok"
    : tone === "info" ? "text-info"
    : tone === "warn" ? "text-warn"
    : tone === "err" ? "text-err"
    : "text-ink";
  return (
    <Card>
      <CardBody>
        <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          {label}
        </p>
        <p className={`mt-2 text-[28px] font-semibold leading-tight ${valueTone}`}>
          {value}
        </p>
        {sub && <p className="mt-1 text-[12px] text-ink-3">{sub}</p>}
      </CardBody>
    </Card>
  );
}

export function SyncGroupDetail() {
  const { syncGroupId } = useParams();
  const navigate = useNavigate();
  const id = Number(syncGroupId);

  const { data, isLoading, error } = useQuery({
    queryKey: ["syncGroupIssues", id],
    queryFn: () => getSyncGroupIssues(id),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-ink-3">
        <Loader2 size={16} className="animate-spin" /> Loading sync #{id}…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="rounded border border-err/30 bg-err-soft p-4 text-err">
        Could not load sync #{id}: {error?.message || "not found"}
      </div>
    );
  }

  const total = data.created + data.updated + data.skipped + data.pending + data.failed;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/integrations/history")} className="mb-2 -ml-1">
            <ArrowLeft size={13} /> Sync history
          </Button>
          <h1 className="text-[24px] font-semibold leading-tight text-ink">
            Sync #{id}
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            {total.toLocaleString()} issues processed
            {data.items.length > 0 && (
              <> · {data.items.length.toLocaleString()} promoted to Lumber</>
            )}
          </p>
        </div>
      </header>

      {/* Stat cards */}
      <section className="grid grid-cols-5 gap-4">
        <StatCard
          label="Created"
          value={data.created}
          tone="ok"
          sub="new in Lumber"
        />
        <StatCard
          label="Updated"
          value={data.updated}
          tone="info"
          sub="changed records"
        />
        <StatCard
          label="Skipped"
          value={data.skipped}
          sub="manually skipped"
        />
        <StatCard
          label="Pending review"
          value={data.pending}
          tone={data.pending > 0 ? "warn" : "default"}
          sub="awaiting approval"
        />
        <StatCard
          label="Failed"
          value={data.failed}
          tone={data.failed > 0 ? "err" : "default"}
          sub="promote errors"
        />
      </section>

      {/* Issues table */}
      <Card>
        <CardHeader>
          <CardTitle>Promoted issues</CardTitle>
          <span className="text-[12.5px] text-ink-3">
            {data.items.length.toLocaleString()} issues created or updated in Lumber
          </span>
        </CardHeader>
        {data.items.length === 0 ? (
          <CardBody>
            <p className="text-[13px] text-ink-3">
              No issues have been promoted for this sync yet.
            </p>
          </CardBody>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Jira Key</TH>
                <TH>Change</TH>
                <TH>Summary</TH>
                <TH>Type</TH>
                <TH>Status</TH>
                <TH>Team</TH>
                <TH>Promoted</TH>
              </TR>
            </THead>
            <TBody>
              {data.items.map((item) => (
                <TR key={item.jira_key}>
                  <TD>
                    <span className="font-mono text-[12px] font-semibold text-ink">
                      {item.jira_key}
                    </span>
                  </TD>
                  <TD>
                    <Pill tone={CHANGE_TYPE_TONE[item.change_type] || "default"}>
                      {CHANGE_TYPE_LABEL[item.change_type] || item.change_type}
                    </Pill>
                  </TD>
                  <TD className="max-w-[300px]">
                    <span className="line-clamp-2 text-[12.5px] text-ink-2">
                      {item.summary || "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className={`text-[12.5px] font-medium ${ISSUE_TYPE_COLORS[item.issue_type] || "text-ink-3"}`}>
                      {item.issue_type || "—"}
                    </span>
                  </TD>
                  <TD>
                    <span className="text-[12.5px] text-ink-2">{item.status || "—"}</span>
                  </TD>
                  <TD>
                    <span className="text-[12.5px] text-ink-3">{item.team_name || "—"}</span>
                  </TD>
                  <TD>
                    <span className="font-mono text-[11.5px] text-ink-3">
                      {item.promoted_at
                        ? format(new Date(item.promoted_at), "MMM d, HH:mm")
                        : "—"}
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
