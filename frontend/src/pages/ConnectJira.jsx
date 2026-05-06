import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  EyeOff,
  Loader2,
  Plug,
  Save,
  XCircle,
} from "lucide-react";
import {
  getJiraIntegration,
  saveJiraIntegration,
  testJiraConnection,
} from "../lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Pill } from "../components/ui/Pill";
import { JiraLogo } from "../components/ui/Logos";

const FIELD_DEFAULTS = {
  field_sprint: "customfield_10020",
  field_story_points: "customfield_10016",
  field_team: "customfield_10001",
  field_reported_by_customer: "customfield_10100",
  field_customer: "customfield_10101",
  field_prod_release_date: "customfield_10102",
  field_epic_link: "customfield_10014",
};

function blank() {
  return {
    name: "Jira",
    base_url: "",
    email: "",
    api_token: "",
    project_key: "",
    ...FIELD_DEFAULTS,
  };
}

export function ConnectJira() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState(blank());
  const [showToken, setShowToken] = useState(false);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [saveResult, setSaveResult] = useState(null); // null | "ok" | "err"

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["integrations", "jira"],
    queryFn: getJiraIntegration,
  });

  // Pre-fill form when config loads
  useEffect(() => {
    if (!cfg) return;
    setForm({
      name: cfg.name || "Jira",
      base_url: cfg.base_url || "",
      email: cfg.email || "",
      // For DB configs we get the full token; for env we get null — leave blank so
      // the user must enter a token explicitly when migrating from env to DB.
      api_token: cfg.api_token || "",
      project_key: cfg.project_key || "",
      field_sprint: cfg.field_sprint || FIELD_DEFAULTS.field_sprint,
      field_story_points: cfg.field_story_points || FIELD_DEFAULTS.field_story_points,
      field_team: cfg.field_team || FIELD_DEFAULTS.field_team,
      field_reported_by_customer: cfg.field_reported_by_customer || FIELD_DEFAULTS.field_reported_by_customer,
      field_customer: cfg.field_customer || FIELD_DEFAULTS.field_customer,
      field_prod_release_date: cfg.field_prod_release_date || FIELD_DEFAULTS.field_prod_release_date,
      field_epic_link: cfg.field_epic_link || FIELD_DEFAULTS.field_epic_link,
    });
  }, [cfg]);

  const testMutation = useMutation({
    mutationFn: () =>
      testJiraConnection({
        base_url: form.base_url,
        email: form.email,
        api_token: form.api_token,
      }),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      saveJiraIntegration({
        ...form,
        project_key: form.project_key || null,
      }),
    onSuccess: () => {
      setSaveResult("ok");
      qc.invalidateQueries({ queryKey: ["integrations", "jira"] });
      setTimeout(() => setSaveResult(null), 4000);
    },
    onError: () => setSaveResult("err"),
  });

  function set(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setSaveResult(null);
  }

  const canTest = form.base_url && form.email && form.api_token;
  const canSave = canTest;
  const source = cfg?.source ?? "none";  // "db" | "env" | "none"
  const isEnv = source === "env";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => navigate("/integrations")} className="mb-2 -ml-1">
            <ArrowLeft size={13} /> Integrations
          </Button>
          <h1 className="text-[24px] font-semibold leading-tight text-ink">
            Configure Jira
          </h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Connection settings for Atlassian Jira Cloud. Saved to database.
          </p>
        </div>
        {!isLoading && (
          <Pill tone={source === "db" ? "ok" : source === "env" ? "warn" : "err"}>
            {source === "db" && <><Database size={11} /> Saved in DB</>}
            {source === "env" && "Env-driven"}
            {source === "none" && "Not configured"}
          </Pill>
        )}
      </header>

      {source === "none" && (
        <div className="flex items-start gap-2 rounded border border-accent/30 bg-accent-soft p-3 text-[12.5px] text-accent">
          <span>
            No Jira configuration found. Fill in the form below and click{" "}
            <strong>Save configuration</strong> — no <code className="font-mono">.env</code> changes needed.
          </span>
        </div>
      )}
      {source === "env" && (
        <div className="flex items-start gap-2 rounded border border-warn/30 bg-warn-soft p-3 text-[12.5px] text-warn">
          <span>
            Config is currently read from <code className="font-mono">.env</code>.
            Enter credentials below and save to migrate to database storage.
          </span>
        </div>
      )}

      <div className="grid grid-cols-[1.6fr_1fr] gap-6">
        <div className="flex flex-col gap-4">
          {/* Connection details */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-3">
                <JiraLogo size={28} />
                <CardTitle>Connection</CardTitle>
              </div>
            </CardHeader>
            <CardBody pad="lg">
              <div className="flex flex-col gap-4">
                <div>
                  <Label htmlFor="name">Integration name</Label>
                  <Input
                    id="name"
                    value={form.name}
                    onChange={(e) => set("name", e.target.value)}
                    placeholder="e.g. Lumberfi Jira"
                  />
                </div>
                <div>
                  <Label htmlFor="base_url">Workspace URL</Label>
                  <Input
                    id="base_url"
                    mono
                    value={form.base_url}
                    onChange={(e) => set("base_url", e.target.value)}
                    placeholder="https://yourcompany.atlassian.net"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="email">Atlassian account email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      placeholder="admin@yourcompany.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="api_token">
                      API token
                      {isEnv && cfg?.api_token_masked && (
                        <span className="ml-1 font-mono text-ink-4 normal-case tracking-normal">
                          (current: {cfg.api_token_masked})
                        </span>
                      )}
                    </Label>
                    <div className="relative">
                      <Input
                        id="api_token"
                        mono
                        type={showToken ? "text" : "password"}
                        value={form.api_token}
                        onChange={(e) => set("api_token", e.target.value)}
                        placeholder={isEnv ? "Enter token to save to DB" : ""}
                        className="pr-9"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken((v) => !v)}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink"
                      >
                        {showToken ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  <Label htmlFor="project_key">Project key (optional)</Label>
                  <Input
                    id="project_key"
                    mono
                    value={form.project_key}
                    onChange={(e) => set("project_key", e.target.value)}
                    placeholder="e.g. LFI — leave blank to sync all accessible projects"
                  />
                </div>
              </div>
            </CardBody>
          </Card>

          {/* Custom field mappings */}
          <Card>
            <button
              className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setFieldsOpen((v) => !v)}
            >
              <span className="text-[13px] font-semibold text-ink">Custom field mappings</span>
              {fieldsOpen ? <ChevronDown size={15} className="text-ink-3" /> : <ChevronRight size={15} className="text-ink-3" />}
            </button>
            {fieldsOpen && (
              <CardBody pad="lg" className="border-t border-border">
                <p className="mb-4 text-[12.5px] text-ink-3">
                  Jira custom field IDs used when extracting data. Change only if your Jira
                  instance uses non-standard field IDs.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { key: "field_sprint", label: "Sprint" },
                    { key: "field_story_points", label: "Story Points" },
                    { key: "field_team", label: "Team" },
                    { key: "field_reported_by_customer", label: "Reported by Customer" },
                    { key: "field_customer", label: "Customer" },
                    { key: "field_prod_release_date", label: "Prod Release Date" },
                    { key: "field_epic_link", label: "Epic Link" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <Label htmlFor={key}>{label}</Label>
                      <Input
                        id={key}
                        mono
                        value={form[key]}
                        onChange={(e) => set(key, e.target.value)}
                        placeholder={FIELD_DEFAULTS[key]}
                      />
                    </div>
                  ))}
                </div>
              </CardBody>
            )}
          </Card>

          {/* Test result */}
          {testMutation.data && (
            <div
              className={`flex items-start gap-2 rounded border p-3 text-[12.5px] ${
                testMutation.data.ok
                  ? "border-ok/30 bg-ok-soft text-ok"
                  : "border-err/30 bg-err-soft text-err"
              }`}
            >
              {testMutation.data.ok ? (
                <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              ) : (
                <XCircle size={15} className="mt-0.5 shrink-0" />
              )}
              <span>
                {testMutation.data.ok
                  ? `Connected as ${
                      testMutation.data.account?.displayName ||
                      testMutation.data.account?.emailAddress ||
                      "unknown"
                    }`
                  : testMutation.data.error}
              </span>
            </div>
          )}

          {/* Save result */}
          {saveResult === "ok" && (
            <div className="flex items-center gap-2 rounded border border-ok/30 bg-ok-soft p-3 text-[12.5px] text-ok">
              <CheckCircle2 size={15} className="shrink-0" />
              Configuration saved to database.
            </div>
          )}
          {saveResult === "err" && (
            <div className="flex items-center gap-2 rounded border border-err/30 bg-err-soft p-3 text-[12.5px] text-err">
              <XCircle size={15} className="shrink-0" />
              {saveMutation.error?.message || "Save failed."}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-between">
            <Button
              variant="default"
              onClick={() => testMutation.mutate()}
              disabled={!canTest || testMutation.isPending}
            >
              {testMutation.isPending ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Plug size={14} />
              )}
              Test connection
            </Button>
            <div className="flex items-center gap-2">
              <Button variant="ghost" onClick={() => navigate("/integrations")}>
                Cancel
              </Button>
              <Button
                variant="accent"
                onClick={() => saveMutation.mutate()}
                disabled={!canSave || saveMutation.isPending}
              >
                {saveMutation.isPending ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Save size={14} />
                )}
                Save configuration
              </Button>
            </div>
          </div>
        </div>

        {/* Side panel */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardBody>
              <CardTitle>What gets synced</CardTitle>
              <ul className="mt-3 flex flex-col gap-2 text-[13px] text-ink-2">
                {["Projects", "Issues", "Users", "Sprints", "Worklogs", "Comments", "Attachments", "Changelogs"].map((it) => (
                  <li key={it} className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-ok" />
                    {it}
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <CardTitle>Multiple instances</CardTitle>
              <p className="mt-2 text-[12.5px] text-ink-3">
                Each saved configuration is stored as a row in the{" "}
                <code className="font-mono text-[11.5px]">integrations</code> table.
                The most recently saved active config is used for syncs.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}
