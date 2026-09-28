---
title: orca_local configuration
summary: Full adapter configuration, worktree and session semantics for the Paperclip ⇄ Orca adapter
---

# Configuring an `orca_local` agent

## Minimal setup

On the agent's **Configuration** tab, pick an **Orca repo** (the list comes from
`orca repo list` on the Paperclip host) and an **Agent CLI**. That saves:

```json
{
  "repo": "name:my-repo",
  "agent": "claude"
}
```

Add heartbeat policy as usual in Paperclip (schedule / wakeOnAssignment / wakeOnOnDemand).

## Full reference

| Key | Default | Description |
|---|---|---|
| `repo` | *(required)* | Orca repo selector: `id:<repoId>`, `name:<name>` or `path:/abs/repo`. Creating a worktree fails fast if the repo selector doesn't resolve. |
| `agent` | `claude` | Which headless CLI runs the heartbeat: `claude` (= Claude Code) or `codex` (= OpenAI Codex). |
| `model` | *(CLI default)* | Passed through as `--model <model>` to the CLI. |
| `promptTemplate` | built-in wake prompt | Rendered per agent/run data. Applied only to fresh sessions; a resumed heartbeat receives only the wake prompt + task markdown. |
| `orcaBin` | `/usr/local/bin/orca` | Path to the Orca CLI. On Linux, watch out for the GNOME **screen reader** binary named `orca` — point this at the Orca runtime CLI explicitly. |
| `timeoutSec` | `0` | Adapter-side watchdog. `0` disables. On timeout the Orca terminal is closed and the run marked `timed out`. |
| `env` | — | Map of extra environment variables injected into the CLI process (also a place for API keys if you don't use login auth). |

## Worktree model

Each Paperclip task id maps to one Orca worktree `pc-<sanitized ident>` (issue
identifier when present, else the task id; `pc-agent-<agentId>` when the
heartbeat isn't tied to a specific task). The resolved worktree's Orca id is
pinned into the session record, so later runs address the exact prior worktree
even if names collide across repos. Consequences:

- Same issue, repeated heartbeats ⇒ the same checkout with prior artifacts.
- Two agents, two different tasks (even in the same repo) ⇒ sibling worktrees.
- Identity sanitization strips non `[a-zA-Z0-9-]`; collisions after stripping are
  known and accepted (documented gotcha in AGENTS.md).
- The adapter never pushes; merging is left to git/PR review flows outside heartbeats.

Card comments follow the pattern `Paperclip: <task title>` with a run-state suffix:
`— running`, `— run finished`, `— cancelled`, `— timed out`, `— failed (exit N)`.
Status flips to `in-review` on success. (Terminal statuses like todo/completed
mapping is a roadmap item.)

## Environment variables injected per run

The adapter merges Paperclip's standard env (`buildPaperclipEnv`), then:

| Var | Meaning |
|---|---|
| `PAPERCLIP_RUN_ID` | this heartbeat run |
| `PAPERCLIP_WORKSPACE_CWD` / `PAPERCLIP_WORKSPACE_WORKTREE_PATH` | execution workspace = the Orca worktree path; lets Paperclip-side workspace attribution pick it up |
| `PAPERCLIP_TASK_ID` | task/issue id, when present |
| `PAPERCLIP_WAKE_REASON` | e.g. `issue_assigned`, `issue_comment_mentioned` |
| `PAPERCLIP_WAKE_COMMENT_ID` | comment id, when the wake came from a comment |
| `PAPERCLIP_API_KEY` | short-lived agent JWT (only when `authToken` supplied) |
| *(config `env` overrides)* | your custom values |

## Session resume rules

The stored session (`sessionParams`) is reused on the next heartbeat **iff**

1. the persisted `agent` matches the current `config.agent`, and
2. a `sessionId` was captured by the parser.

Switching `claude` ⇄ `codex` starts a fresh session deliberately (session id
formats are provider-specific and not cross-translatable). If a **resumed** run
fails and the CLI reports an unknown session id, the adapter clears the session
so the next heartbeat starts fresh automatically (self-healing; see SPEC §4.3).
Sessions can also be reset manually in Paperclip (agent config page).

## Unattended operation

- Claude runs with `--print --output-format stream-json --verbose
  --dangerously-skip-permissions`.
- Codex runs with `exec --json --dangerously-bypass-approvals-and-sandbox`.

These are required for unattended headless operation; give thought to
least-privilege repo choice (sandboxed branches, service credentials) because the
session enjoys your local user's permissions inside the worktree. The no-push
rule is instruction-based, not enforcement — see SPEC §7 for residual risk and
ROADMAP R6 for sandbox directions.
