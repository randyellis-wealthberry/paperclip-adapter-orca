# Architecture

## 1. The bridge model

Three systems, three personas:

```
┌────────────────────────────┐        ┌──────────────────────────────┐
│ Paperclip control plane    │        │ Orca desktop runtime         │
│ companies · agents · issue │        │ worktrees · terminals · cards│
│ heartbeats · budgets ·     │        │ skill sharing · session index│
│ approvals · run records    │        │ TUI agent sessions           │
└────────────────────────────┘        └──────────────────────────────┘
            │  adapter execute() contract        ▲
            │  (AdapterExecutionContext)         │  orca CLI subprocess
            ▼                                    │
┌──────────────────────────────────────────────────────────────────┐
│  supergum  ·  adapter type  orca_local                            │
│                                                                  │
│  execute(ctx)      → ensure worktree → write run files → spawn   │
│  poll loop         → tee'd logs → onLog → Paperclip run log      │
│  finalize          → parse usage/session → card update → result  │
│  testEnvironment() → orca status / repo reachability checks      │
└──────────────────────────────────────────────────────────────────┘
```

The adapter implements Paperclip's [external adapter plugin
contract](.ref/paperclip/docs/adapters/external-adapters.md) as a standalone npm
package. It is loaded by Paperclip's plugin system via `createServerAdapter()` and
is otherwise a normal library with zero host coupling.

Paperclip decides **what** runs and **whether it's allowed to**; Orca owns
**where** it runs (filesystem worktree, visible terminal, card UI); Claude/Codex
own **how**. The adapter only shuttles state between the planes.

## 2. Delegation of truth

| State | Owner | why |
|---|---|---|
| Issue ownership, run records, cost/usage | Paperclip | it is the audit + governance system |
| Task → worktree placement | adapter (derived from issue id) | deterministic mapping; updatable via stored worktree id |
| Worktree branch, session files, CLAUDE.md | Orca worktree | git + disk is the durable medium |
| Agent CLI session (Claude `--resume` / Codex `resume`) | CLI local session history | resumed via explicit session id paths |
| Card comment/status | Orca `worktree set` | cosmetic projection of run state |
| Run stdout/stderr | tee'd files under `~/.paperclip/orca-runs/` | polled + streamed into Paperclip's run log |

The **worktree name is derived from the issue identity** (`pc-<sanitized issue
identifier or taskId>`), so all heartbeats on one issue share one checkout. The
resolved worktree's Orca id is also pinned in `sessionParams` — names aren't
unique across repos, so later runs address the exact prior worktree by id first.
Two different issues in the same repo land in sibling worktrees — parallel agent
isolation for free. Because the run env carries
`PAPERCLIP_WORKSPACE_CWD` / `PAPERCLIP_WORKSPACE_WORKTREE_PATH`, Paperclip's
own workspace machinery attributes file changes to that checkout just like it
does for its managed workspaces.

## 3. Run lifecycle

```
heartbeat
  ├─ resolve identity: issue identifier / taskId → worktreeName()
  ├─ sessionCodec.deserialize(runtime.sessionParams)
  │     → resumeId if previous session used the same agent CLI
  ├─ ensureWorktree(name, prevId)   ← prefers the exact prior worktree id
  │     (existing? reuse : create --no-parent)
  ├─ setCard(wt, "Paperclip: <task> — running", in-progress)
  ├─ mkdir ~/.paperclip/orca-runs/<runId> (0700), write:
  │     env         (0600, shq-quoted secrets — never in scrollback;
  │                  also PAPERCLIP_WORKSPACE_CWD/_WORKTREE_PATH so Paperclip's
  │                  host workspace attribution sees the Orca checkout)
  │     prompt.md   (wake prompt + task markdown [+ template on fresh sessions])
  │     run.sh      (sources env, pipes prompt via stdin, tees logs, exits)
  ├─ terminal create --command "bash run.sh; exit"
  └─ poll loop (500 ms): tail stdout.log → onLog → Paperclip live run log
        exit file appears OR timeout OR ctx.signal.abort
          → closeTerminal (on timeout/cancel), rm env (the JWT lives here)
          → read exit / stderr.log
          → parseCodexJsonl | parseClaudeStreamJson
          → stale-session detection (see below)
          → setCard(final status, `in-review` on success)
          → return { exitCode, usage, costUsd, model, summary,
                     sessionId, sessionParams{ agent, sessionId, worktreeId, cwd } }
```

Failure classification: success / cancelled (signal.aborted) / timed out /
failed with exit code — surfaced both in the Paperclip run record and the card
comment (`failed (exit N)`).

**Stale-session self-healing**: when a *resumed* run fails because the CLI
rejects an unknown session id, the adapter clears the stored session
(`clearSession` / no `sessionParams`), so the next heartbeat starts a fresh
session in the same worktree instead of failing forever. Session continuity
never becomes a lock-in on a dead id.

## 4. Design decisions

Visual, not headless-redundant
: Headless CLIs (like Claude's `--print`) normally run with output invisible to a
human. Paperclip's other adapters run invisibly and surface progress only in a web
run log. Here the CLI runs in a **visible Orca terminal** at the same time:
you get the durable Paperclip audit trail and the physical "watch it work"
desktop.

File-polling, not PTY scraping
: The bash script tees stdout/stderr to files with pipestatus captured to an exit
file. The adapter polls files (500 ms) rather than reading the terminal scrollback.
This preserves exact JSONL for parsing, survives terminal restarts (stale handles)
and gives deterministic exit codes — things `terminal read` scraping does not.

Secret hygiene
: Secrets (including the per-run agent JWT) go in a 0600 env file sourced by the
run script, never on the terminal command line or in scrollback. The env file is
deleted at run end; run dirs are 0700.

No-push contract
: The agent works in a detached worktree owned by Orca; the instructions forbid
`git push`. Promotion of work (merge/PR) is a Paperclip/orca-human decision, not a
side effect of a heartbeat. This keeps Paperclip's approval gates meaningful: no
run can silently ship code to a shared branch.

Reuse of upstream parsers
: `parseClaudeStreamJson` / `parseCodexJsonl` come from the official
`@paperclipai/adapter-claude-local` / `-codex-local` packages, so orca_local
transcripts and usage accounting match those of the built-ins. Paperclip's
general "prefer the `acp` engine for richest feedback" advice applies to those
adapters; §4.2 of the Spec lists what this adapter inherits.

Orchestration symmetry
: Orca's full-handoff model ("give this to another worktree") and Paperclip's
org-chart delegation ("give this to another agent") are the same concept at
different layers. The adapter today maps 1:1 paperclip-task → orca-worktree;
deeper mapping (e.g. Paperclip subtask → child worktree) is roadmap.

## 5. Security posture summary

- run dirs: `~/.paperclip/orca-runs/<runId>` with mode `0700`; `env` is `0600`,
  contains the JWT & secrets, deleted on finalize.
- CLI argv carries no secrets; prompt arrives via stdin redirection from
  `prompt.md`, also 0700-dir protected.
- `orca CLI` invoked via `execFile` (no shell interpolation of repo/config
  values); shell metacharacter quoting (`shq`) for anything placed in shell.
- `setCard` failures never fail a run (cosmetic).
- Orca search index and terminal scrollback never see the env payload.

Residual risk and mitigations are listed in `SPEC.md` §7.
