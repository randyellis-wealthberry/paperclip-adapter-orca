// Dashboard widget: first-time setup checklist for running Paperclip agents in Orca.
import { useState } from "react";
import {
  copyTextToClipboard,
  useHostNavigation,
  usePluginData,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import type { SetupStatus } from "../setup.js";

const row = { display: "flex", gap: 8, alignItems: "baseline", margin: "6px 0" } as const;
const muted = { opacity: 0.7, fontSize: 13 } as const;

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <div style={row}>
      <span aria-hidden>{done ? "✅" : "⬜️"}</span>
      <div>
        <strong>{title}</strong>
        {!done && children && <div style={muted}>{children}</div>}
      </div>
    </div>
  );
}

export function OrcaSetupWidget({ context }: PluginWidgetProps) {
  const { data, loading, error, refresh } = usePluginData<SetupStatus>("setup", { companyId: context.companyId });
  const nav = useHostNavigation();
  const [repo, setRepo] = useState("");
  const [copied, setCopied] = useState(false);

  if (loading && !data) return <section aria-label="Orca setup">Checking Orca…</section>;
  if (error || !data) return <section aria-label="Orca setup">Couldn't check Orca setup: {error?.message ?? "no data"}</section>;

  const picked = repo || data.repos[0]?.name || "";
  const config = JSON.stringify({ repo: `name:${picked}`, agent: "claude" });

  if (data.agents.length) {
    return (
      <section aria-label="Orca setup">
        <strong>Orca connected</strong>
        <div style={muted}>
          {data.agents.map((a) => a.name).join(", ")} run{data.agents.length === 1 ? "s" : ""} in Orca worktrees. Assign an issue to see it
          appear in Orca.
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Orca setup">
      <strong>Set up Orca agents</strong>
      <Step done title="Adapter and sync plugin installed" />
      <Step done={data.orca.ok} title="Orca running">
        {data.orca.error}. Open Orca, then <button onClick={refresh}>check again</button>.
      </Step>
      <Step done={data.repos.length > 0} title="Repo registered in Orca">
        Run <code>npx paperclip-adapter-orca</code> in your repo, or add it in Orca. <button onClick={refresh}>Check again</button>
      </Step>
      <Step done={false} title="Create an Orca agent">
        {data.repos.length > 0 && (
          <>
            <div style={row}>
              <label>
                Repo{" "}
                <select value={picked} onChange={(e) => setRepo(e.target.value)}>
                  {data.repos.map((r) => (
                    <option key={r.path} value={r.name}>{r.name}</option>
                  ))}
                </select>
              </label>
            </div>
            <div style={row}>
              <code>{config}</code>
              <button onClick={() => copyTextToClipboard(config).then(() => setCopied(true))}>{copied ? "Copied" : "Copy config"}</button>
            </div>
          </>
        )}
        <button onClick={() => nav.navigate("/agents/new?adapterType=orca_local&name=Orca+agent")}>New Orca agent</button>{" "}
        Paste the config, turn on the heartbeat, and save.
      </Step>
    </section>
  );
}
