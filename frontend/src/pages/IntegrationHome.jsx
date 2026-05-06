import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ArrowRight, Settings as Cog } from "lucide-react";
import { getJiraIntegration, getLatestSyncState, getSyncHistory } from "../lib/api";
import { Card, CardBody, CardHeader, CardSubtitle, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Pill } from "../components/ui/Pill";
import { JiraLogo, ConnectorMark } from "../components/ui/Logos";

const AVAILABLE = [
  { letter: "A", name: "Acumatica", source: "ERP", color: "var(--info)" },
  { letter: "Q", name: "QuickBooks", source: "Finance", color: "var(--ok)" },
  { letter: "G", name: "GitHub", source: "Source control", color: "var(--ink-2)" },
  { letter: "S", name: "Slack", source: "Messaging", color: "var(--warn)" },
  { letter: "N", name: "Notion", source: "Docs", color: "var(--ink-2)" },
  { letter: "L", name: "Linear", source: "Issue tracking", color: "var(--accent)" },
];

export function IntegrationHome() {
  const navigate = useNavigate();

  const { data: latestSync } = useQuery({
    queryKey: ["syncState", "latest", "sync"],
    queryFn: () => getLatestSyncState("sync"),
    refetchInterval: (q) => q.state.data?.status === "running" ? 2000 : false,
  });
  const { data: history } = useQuery({
    queryKey: ["syncHistory", "sync", 1],
    queryFn: () => getSyncHistory({ kind: "sync", limit: 1 }),
  });
  const { data: jiraConfig } = useQuery({
    queryKey: ["integrations", "jira"],
    queryFn: getJiraIntegration,
  });

  const lastFinished = history?.find((r) => r.finished_at)?.finished_at;
  const running = latestSync?.status === "running";

  let health = { tone: "ok", text: "Healthy", live: false };
  if (running) health = { tone: "info", text: "Syncing", live: true };
  else if (latestSync?.status === "error") health = { tone: "err", text: "Last run failed", live: false };

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-[24px] font-semibold leading-tight text-ink">Integrations</h1>
        <p className="mt-1 text-[13px] text-ink-3">
          Connect external systems and keep Lumber in sync.
        </p>
      </header>

      {/* Connected */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Connected
        </h2>
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <JiraLogo size={32} />
              <div>
                <CardTitle>Jira</CardTitle>
                <CardSubtitle>
                  {jiraConfig?.base_url ?? "Atlassian Cloud"}
                  {jiraConfig?.project_key && (
                    <> · <span className="font-mono">{jiraConfig.project_key}</span></>
                  )}
                </CardSubtitle>
              </div>
            </div>
            <Pill tone={health.tone} live={health.live}>{health.text}</Pill>
          </CardHeader>
          <CardBody>
            <div className="grid grid-cols-2 gap-4">
              <Stat
                label="Last sync"
                value={lastFinished ? formatDistanceToNow(new Date(lastFinished), { addSuffix: true }) : "—"}
              />
              <Stat label="Issues last run" value={latestSync?.issues_synced ?? "—"} />
            </div>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => navigate("/integrations/connect")}>
                <Cog size={14} /> Configure
              </Button>
              <Button variant="default" onClick={() => navigate("/integrations/staging")}>
                <ArrowRight size={14} /> Sync Review
              </Button>
            </div>
          </CardBody>
        </Card>
      </section>

      {/* Available */}
      <section>
        <h2 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          Available
        </h2>
        <div className="grid grid-cols-3 gap-4">
          {AVAILABLE.map((it) => (
            <Card key={it.name}>
              <CardBody>
                <div className="flex items-center gap-3">
                  <ConnectorMark letter={it.letter} color={it.color} size={32} />
                  <div className="flex-1">
                    <p className="text-[14px] font-semibold text-ink">{it.name}</p>
                    <p className="text-[12px] text-ink-3">{it.source}</p>
                  </div>
                  <Button size="sm" disabled>Connect</Button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">{label}</p>
      <p className="mt-1 text-[18px] font-semibold text-ink">{value}</p>
    </div>
  );
}
