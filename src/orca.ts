import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Calls `orca <args> --json` and returns `result`, throwing on `ok: false`. */
export async function orca(bin: string, args: string[]): Promise<any> {
  // Paperclip's PATH often differs from your shell's, so a configured absolute path wins, then PATH.
  const exe = existsSync(bin) ? bin : "orca";
  const { stdout } = await run(exe, [...args, "--json"], { maxBuffer: 16 * 1024 * 1024 }).catch((err) => {
    if (err.code === "ENOENT") {
      throw new Error(`orca CLI not found (tried ${bin} and PATH). Install Orca, or set orcaBin to the output of \`which orca\`.`);
    }
    // orca exits non-zero on errors but still prints a JSON envelope on stdout.
    if (err.stdout) return { stdout: err.stdout as string };
    throw err;
  });
  const out = JSON.parse(stdout);
  if (out.ok === false) throw new Error(`orca ${args[0]} ${args[1] ?? ""}: ${JSON.stringify(out.error ?? out)}`);
  return out.result;
}

export type Worktree = { id: string; path: string };

/** Finds the Orca worktree named `name`, or creates it from `repo`. */
export async function ensureWorktree(bin: string, repo: string, name: string, comment: string, prevId?: string): Promise<Worktree> {
  // Prefer the exact worktree a previous run used; names are not unique across repos.
  const existing =
    (prevId && (await orca(bin, ["worktree", "show", "--worktree", `id:${prevId}`]).catch(() => null))) ||
    (await orca(bin, ["worktree", "show", "--worktree", `name:${name}`]).catch(() => null));
  const wt = existing?.worktree ?? existing;
  if (wt?.id && wt?.path) return { id: wt.id, path: wt.path };
  const created = await orca(bin, [
    "worktree", "create", "--repo", repo, "--name", name, "--no-parent", "--comment", comment,
  ]);
  return { id: created.worktree.id, path: created.worktree.path };
}

export type Card = Worktree & { workspaceStatus?: string; comment?: string };

/** Reads a worktree's card by selector (e.g. `id:<id>` or `name:<name>`), or null if it doesn't exist. */
export async function getCard(bin: string, selector: string): Promise<Card | null> {
  const res = await orca(bin, ["worktree", "show", "--worktree", selector]).catch(() => null);
  return res?.worktree ?? null;
}

export async function setCard(bin: string, worktreeId: string, comment?: string, status?: string) {
  const args = ["worktree", "set", "--worktree", `id:${worktreeId}`];
  if (comment) args.push("--comment", comment);
  if (status) args.push("--workspace-status", status);
  // Card updates are cosmetic; never fail a run over them.
  await orca(bin, args).catch(() => {});
}

export async function createTerminal(bin: string, worktreeId: string, title: string, command: string): Promise<string> {
  const res = await orca(bin, ["terminal", "create", "--worktree", `id:${worktreeId}`, "--title", title, "--command", command]);
  const handle = res?.terminal?.handle ?? res?.handle;
  if (!handle) throw new Error(`orca terminal create returned no handle: ${JSON.stringify(res)}`);
  return handle;
}

export async function closeTerminal(bin: string, handle: string) {
  await orca(bin, ["terminal", "close", "--terminal", handle]).catch(() => {});
}

/** Worktree name per task, so every heartbeat on the same issue lands in the same checkout. */
export function worktreeName(taskId: string | null, agentId: string) {
  const key = (taskId ?? `agent-${agentId}`).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 40);
  return `pc-${key}`;
}
