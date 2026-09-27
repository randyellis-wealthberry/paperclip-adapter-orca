---
title: orca_local troubleshooting
summary: Diagnosis paths for the Paperclip ⇄ Orca adapter — ordered by likely fix
---

# Troubleshooting `orca_local`

## Run fails immediately: `orca_local: config.repo is required`
Set adapter config `repo`; valid forms `id:<repoId>`, `name:<name>`,
`path:/abs/repo` (find one via `orca repo list --json`).

## Every heartbeat fails with the same session error, then self-clears
A resumed session id went stale (CLI upgrade, cleaned session store, Orca
machine move). The adapter detects the unknown-session failure, returns
`clearSession`, and the **next** heartbeat starts fresh automatically — only one
failed run should occur. Repeated failures mean a different error is being
mismasked: check `stderr.log` in the run dir.

## `Orca runtime not reachable` (testEnvironment)
1. Is the Orca desktop app running? Open it.
2. Run `orca status --json` in your shell — `result.runtime.reachable` should be `true`.
3. Wrong binary? Point `orcaBin` config at the real CLI path. On Linux, plain
   `orca` may be the GNOME screen reader; use the Orca runtime binary only.

## `Orca repo <sel> not found`
Run `orca repo show --repo name:<your-name> --json`. If missing:
`orca repo add --path /abs/repo --json`, then re-test. Worktree creation needs
`--no-parent` writes into Orca's worktree storage — check write permissions there.

## Card shows `— failed (exit N)`; stderr looks empty
- Read the card's terminal log file `~/.paperclip/orca-runs/<runId>/stderr.log`.
- Very common cause: the CLI isn't logged in/authenticated in that worktree
  (Claude: `~/.claude`; Codex: `~/.codex`, incl. `auth.json`). Log in once
  interactively in any Orca terminal of that worktree.
- Model id typo shows as CLI auth/route errors with `--model`.

## Run streams forever / `— timed out`
- `timeoutSec` is `0` (no adapter timeout) by default — Paperclip kill policy
  still applies. Set an explicit `timeoutSec`.
- Miss-behaving CLI hangs: cancel via Paperclip (results in `— cancelled`), or
  close the Orca manually. Check no zombie CLI holds the exit pipe
  (`ps aux | grep claude|codex`); use Orca's `terminal close --worktree … --all`.

## Session didn't resume
- Adapter runs with different `agent` now (claude ⇄ codex flips create fresh
  sessions by design).
- The CLI failed to persist a session in the previous run (check earlier run's
  stdout tail). Fix root cause, then `run again`; resume returns once a run
  completes normally.
- You may be hitting the *worktree-name collision* after sanitization: two tasks
  whose sanitized keys are equal share a worktree — rarer than you'd think, and
  visible from `orca worktree list`.

## Terminal shows nothing but the worktree exists
Orca windows own terminal visibility, not the adapter. `orca terminal list
--worktree id:<id> --json` and check the PTY process attached; a closed terminal
with a stale handle is tolerated by finalize (card still updates). If this
happens every run, update Orca — terminal handle semantics have hardened in
recent builds.

## Card doesn't update even though the run succeeded
Cosmetic by design: card/comment failures never fail Paperclip runs. Check with
`orca worktree set --worktree name:<name> --comment "manual" --json` to find why
(full error printed to Paperclip run log stderr under `setCard` conversation).

## Usage/cost missing in the run record
Will be blank if the CLI crashed before printing a final turn (or when Codex
doesn't emit cost). Confirm stdout ends with parseable JSON (claude `type: result`
line / codex token-count line); otherwise check parse output — upstream parsers
log warnings into stderr excerpt when they can't read a line.

## Still stuck?
Attach to the run dir (`~/.paperclip/orca-runs/<runId>/`) — `stdout.log`,
`stderr.log`, `exit`, `prompt.md` (no secrets) — and open an issue on this repo,
include non-secret excerpts.
