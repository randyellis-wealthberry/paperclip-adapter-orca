import { chmod, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  AdapterConfigSchema,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
  ServerAdapterModule,
} from "@paperclipai/adapter-utils";
import {
  DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE,
  buildPaperclipEnv,
  joinPromptSections,
  renderPaperclipWakePrompt,
  renderTemplate,
  selectPaperclipTaskMarkdown,
} from "@paperclipai/adapter-utils/server-utils";
import { isUnknownSessionError, parseClaudeStreamJson, parseCodexJsonl } from "./parse.js";
import { closeTerminal, createTerminal, ensureWorktree, getCard, orca, setCard, worktreeName } from "./orca.js";
export { worktreeName };

export const type = "orca_local";
export const label = "Orca (Claude/Codex in an Orca worktree)";

export const agentConfigurationDoc = `# orca_local
Runs each task as a headless Claude Code or Codex session in its own Orca worktree,
in a visible Orca terminal. The worktree is reused across heartbeats so sessions resume.

Config:
- repo (required): Orca repo selector, e.g. "id:<repoId>", "name:<name>" or "path:/abs/repo"
- agent: "claude" (default) | "codex"
- model: optional model id passed to the CLI
- promptTemplate: optional heartbeat prompt template
- orcaBin: path to the orca CLI (default /usr/local/bin/orca)
- timeoutSec: 0 = no timeout (default)
- env: extra env vars for the agent
Agents must not git push; the worktree is the durable state.`;

const str = (v: unknown, d = "") => (typeof v === "string" && v.trim() ? v.trim() : d);
const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const sessionCodec: AdapterSessionCodec = {
  deserialize: (raw) => (raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null),
  serialize: (p) => p,
  getDisplayId: (p) => str(p?.sessionId) || null,
};


/** The bash script typed into the Orca terminal. Secrets stay in the 0600 env file, never in scrollback. */
export function buildRunScript(dir: string, argv: string[]) {
  const cmd = argv.map(shq).join(" ");
  return [
    "set -a", `. ${shq(join(dir, "env"))}`, "set +a",
    `${cmd} < ${shq(join(dir, "prompt.md"))} 2> >(tee ${shq(join(dir, "stderr.log"))} >&2) | tee ${shq(join(dir, "stdout.log"))}`,
    `echo "\${PIPESTATUS[0]}" > ${shq(join(dir, "exit"))}`,
    "",
  ].join("\n");
}

export function buildArgv(agent: string, model: string, resumeId: string | null): string[] {
  if (agent === "codex") {
    const a = ["codex", "exec", "--json", "--dangerously-bypass-approvals-and-sandbox"];
    if (model) a.push("--model", model);
    return resumeId ? [...a, "resume", resumeId, "-"] : [...a, "-"];
  }
  const a = ["claude", "--print", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"];
  if (model) a.push("--model", model);
  if (resumeId) a.push("--resume", resumeId);
  return a;
}

async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, runtime, onLog } = ctx;
  const bin = str(config.orcaBin, "/usr/local/bin/orca");
  const repo = str(config.repo);
  const agentCli = str(config.agent, "claude");
  if (!repo) return { exitCode: 1, signal: null, timedOut: false, errorMessage: "orca_local: no Orca repo set. Pick one under the agent's Configuration → Orca repo." };

  const taskId = str(context.taskId) || str(context.issueId) || null;
  const issue = (context.paperclipIssue ?? (context.paperclipWake as any)?.issue ?? {}) as Record<string, unknown>;
  const ident = str(issue.identifier) || taskId;
  const title = [str(issue.identifier), str(issue.title)].filter(Boolean).join(" · ") || taskId || agent.name;
  const prev = sessionCodec.deserialize(runtime.sessionParams) ?? {};
  const resumeId = prev.agent === agentCli ? str(prev.sessionId) || null : null;

  const wt = await ensureWorktree(bin, repo, worktreeName(ident, agent.id), `Paperclip: ${title}`, str(prev.worktreeId) || undefined);
  // Only overwrite our own status lines; a human's review note on the card must survive until the sync reads it.
  const own = (c?: string) => !c || (c.startsWith("Paperclip:") && !c.includes("awaiting your review"));
  if (own((await getCard(bin, `id:${wt.id}`))?.comment)) await setCard(bin, wt.id, `Paperclip: ${title} — running`);

  // Run files live outside the worktree so they never end up in git.
  const dir = join(homedir(), ".paperclip", "orca-runs", runId);
  await mkdir(dir, { recursive: true, mode: 0o700 });

  const env: Record<string, string> = {
    ...buildPaperclipEnv(agent),
    PAPERCLIP_RUN_ID: runId,
    PAPERCLIP_WORKSPACE_CWD: wt.path,
    PAPERCLIP_WORKSPACE_WORKTREE_PATH: wt.path,
    ...(taskId ? { PAPERCLIP_TASK_ID: taskId } : {}),
    ...(str(context.wakeReason) ? { PAPERCLIP_WAKE_REASON: str(context.wakeReason) } : {}),
    ...(str(context.wakeCommentId) ? { PAPERCLIP_WAKE_COMMENT_ID: str(context.wakeCommentId) } : {}),
    ...Object.fromEntries(Object.entries((config.env as Record<string, unknown>) ?? {}).map(([k, v]) => [k, String(v)])),
    ...(ctx.authToken ? { PAPERCLIP_API_KEY: ctx.authToken } : {}),
  };
  await writeFile(join(dir, "env"), Object.entries(env).map(([k, v]) => `${k}=${shq(v)}`).join("\n") + "\n", { mode: 0o600 });

  const templateData = { agentId: agent.id, companyId: agent.companyId, runId, company: { id: agent.companyId }, agent, run: { id: runId }, context };
  const wake = renderPaperclipWakePrompt(context.paperclipWake, { resumedSession: Boolean(resumeId) });
  const prompt = joinPromptSections([
    wake,
    selectPaperclipTaskMarkdown(context, { resumedSession: Boolean(resumeId) }),
    resumeId && wake ? "" : renderTemplate(str(config.promptTemplate, DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE), templateData),
  ]);
  await writeFile(join(dir, "prompt.md"), prompt);
  await writeFile(join(dir, "run.sh"), buildRunScript(dir, buildArgv(agentCli, str(config.model), resumeId)));
  await chmod(join(dir, "run.sh"), 0o700);

  const handle = await createTerminal(bin, wt.id, `paperclip ${runId.slice(0, 8)}`, `bash ${shq(join(dir, "run.sh"))}; exit`);
  await onLog("stdout", `[orca] worktree ${wt.path}, terminal ${handle}\n`);

  // ponytail: headless CLI in a visible terminal, polled via files; an interactive TUI session would need orca's tui-idle wait.
  const timeoutMs = Number(config.timeoutSec ?? 0) * 1000;
  const started = Date.now();
  let offset = 0;
  let stdout = "";
  let timedOut = false;
  const pump = async () => {
    const f = await open(join(dir, "stdout.log"), "r").catch(() => null);
    if (!f) return;
    const { size } = await f.stat();
    if (size > offset) {
      const buf = Buffer.alloc(size - offset);
      await f.read(buf, 0, buf.length, offset);
      offset = size;
      const chunk = buf.toString("utf8");
      stdout += chunk;
      await onLog("stdout", chunk);
    }
    await f.close();
  };
  while (!existsSync(join(dir, "exit"))) {
    if (ctx.signal?.aborted || (timeoutMs && Date.now() - started > timeoutMs)) {
      timedOut = !ctx.signal?.aborted;
      await closeTerminal(bin, handle);
      break;
    }
    await pump();
    await sleep(500);
  }
  await pump();
  await rm(join(dir, "env"), { force: true }); // run JWT

  const exitRaw = await readFile(join(dir, "exit"), "utf8").catch(() => "");
  const exitCode = exitRaw.trim() === "" ? null : Number(exitRaw.trim());
  const stderr = await readFile(join(dir, "stderr.log"), "utf8").catch(() => "");
  const parsed = agentCli === "codex" ? parseCodexJsonl(stdout) : parseClaudeStreamJson(stdout);
  const cancelled = Boolean(ctx.signal?.aborted);
  const ok = exitCode === 0;
  // A stale session id would otherwise fail every future heartbeat; drop it so the next run starts fresh.
  const staleSession = !ok && Boolean(resumeId) && isUnknownSessionError(agentCli, parsed, stdout, stderr);

  // Card status is owned by the sync plugin (issue status <-> card); the adapter only writes the status line.
  if (own((await getCard(bin, `id:${wt.id}`))?.comment)) await setCard(
    bin, wt.id,
    `Paperclip: ${title} — ${ok ? "run finished" : cancelled ? "cancelled" : timedOut ? "timed out" : `failed (exit ${exitCode})`}`,
  );

  return {
    exitCode,
    signal: null,
    timedOut,
    errorMessage: ok ? undefined : cancelled ? "cancelled" : timedOut ? "timed out" : stderr.trim().slice(-2000) || `exit ${exitCode}`,
    usage: parsed.usage ?? undefined,
    usageBasis: "per_run",
    costUsd: parsed.costUsd ?? undefined,
    model: parsed.model || undefined,
    summary: parsed.summary,
    sessionId: parsed.sessionId,
    sessionDisplayId: parsed.sessionId,
    clearSession: staleSession || undefined,
    sessionParams: staleSession ? undefined : { agent: agentCli, sessionId: parsed.sessionId ?? resumeId, worktreeId: wt.id, cwd: wt.path },
  };
}

async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const checks: AdapterEnvironmentTestResult["checks"] = [];
  const bin = str(ctx.config.orcaBin, "/usr/local/bin/orca");
  const status = await orca(bin, ["status"]).catch((e) => ({ error: String(e) }));
  if ("error" in status || !status.runtime?.reachable) {
    checks.push({ level: "error", code: "orca_unreachable", message: `Orca runtime not reachable via ${bin}`, hint: "Start Orca or run `orca open`." });
  } else {
    checks.push({ level: "info", code: "orca_ready", message: `Orca ${status.runtime.appVersion} is running` });
  }
  const repo = str(ctx.config.repo);
  if (!repo) checks.push({ level: "error", code: "repo_missing", message: "config.repo is required", hint: "Pick one under Configuration → Orca repo, or set e.g. name:my-repo (see `orca repo list`)" });
  else if (!(await orca(bin, ["repo", "show", "--repo", repo]).catch(() => null)))
    checks.push({ level: "error", code: "repo_not_found", message: `Orca repo ${repo} not found` });
  return {
    adapterType: ctx.adapterType,
    status: checks.some((c) => c.level === "error") ? "fail" : "pass",
    checks,
    testedAt: new Date().toISOString(),
  };
}

/** New-agent form fields. Repo options come from the local Orca, so the form works without pasting config. */
export async function getConfigSchema(bin = "/usr/local/bin/orca"): Promise<AdapterConfigSchema> {
  const repos: any[] = await orca(bin, ["repo", "list"]).then((r) => r.repos ?? [], () => []);
  return {
    fields: [
      {
        key: "repo",
        label: "Orca repo",
        type: "combobox",
        required: true,
        options: repos.map((r) => ({ label: r.displayName ?? r.path, value: `path:${r.path}` })),
        hint: repos.length ? "Each issue gets its own worktree of this repo." : "No Orca repos found. Start Orca and add a repo, or type path:/abs/repo.",
      },
      {
        key: "agent",
        label: "Agent CLI",
        type: "select",
        default: "claude",
        options: [{ label: "Claude Code", value: "claude" }, { label: "Codex", value: "codex" }],
      },
    ],
  };
}

export function createServerAdapter(): ServerAdapterModule {
  return {
    type, execute, testEnvironment, sessionCodec, agentConfigurationDoc, supportsLocalAgentJwt: true,
    getConfigSchema: () => getConfigSchema(),
  };
}
