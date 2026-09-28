#!/usr/bin/env node
// One-command setup: `npx paperclip-adapter-orca [repo path]` (PAPERCLIP_URL overrides localhost:3100).
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { orca } from "./orca.js";

const PKG = "paperclip-adapter-orca";
const base = (process.env.PAPERCLIP_URL ?? "http://localhost:3100").replace(/\/$/, "") + "/api";

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function step(label: string, fn: () => Promise<string | void>) {
  try {
    console.log(`✔ ${label}${(await fn()) ?? ""}`);
    return true;
  } catch (err) {
    console.log(`✘ ${label}: ${(err as Error).message}`);
    return false;
  }
}

const orcaBin = process.env.ORCA_BIN ?? "orca";
const repoPath = resolve(process.argv[2] ?? ".");
let repoName = "<orca repo name>";

const orcaOk = await step("Orca runtime ready", async () => {
  const s = await orca(orcaBin, ["status"]);
  if (s.runtime?.state !== "ready") throw new Error(`runtime is ${s.runtime?.state}. Open Orca and retry`);
});
if (orcaOk) {
  await step(`Orca repo ${repoPath}`, async () => {
    const repos: any[] = (await orca(orcaBin, ["repo", "list"])).repos ?? [];
    const found = repos.find((r) => r.path === repoPath) ?? (await orca(orcaBin, ["repo", "add", "--path", repoPath])).repo;
    repoName = found?.displayName ?? found?.name ?? repoName;
    return ` (${repoName})`;
  });
}

const pcOk = await step(`Paperclip at ${base}`, () => api("GET", "/companies").then(() => {}));
if (pcOk) {
  await step("Adapter orca_local installed", () => api("POST", "/adapters/install", { packageName: PKG }).then(() => {}));
  await step("Sync plugin orca.sync installed", async () => {
    const plugins: any[] = await api("GET", "/plugins");
    const plugin = plugins.find((p) => p.packageName === PKG) ?? (await api("POST", "/plugins/install", { packageName: PKG }));
    // The minute job can only read companies that have a saved config.
    const companies: any[] = await api("GET", "/companies");
    for (const c of companies) {
      await api("POST", `/plugins/${plugin.id}/config`, { companyId: c.id, configJson: { requireReview: true } });
    }
    return ` (configured for ${companies.length} compan${companies.length === 1 ? "y" : "ies"})`;
  });
}

console.log(`
Next: create an agent with adapter "orca_local", then on its Configuration tab
pick Orca repo "${repoName}", turn on the heartbeat, and assign it an issue.`);
if (pcOk) {
  // Opens Paperclip's new-agent page with the adapter preselected.
  const [company] = await api("GET", "/companies").catch(() => []);
  const q = new URLSearchParams({ adapterType: "orca_local", name: "Orca agent" });
  const url = `${base.replace(/\/api$/, "")}/${company?.issuePrefix ? company.issuePrefix + "/" : ""}agents/new?${q}`;
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(opener, [url], { stdio: "ignore", detached: true }).on("error", () => {}).unref();
  console.log(`Opening ${url}`);
} else {
  console.log("Start Paperclip with `npx paperclipai run`, then run this again.");
}
process.exitCode = orcaOk && pcOk ? 0 : 1;
