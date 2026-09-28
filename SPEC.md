# SPEC — `orca_local` implementation contract (as built)

Status: v0.1 — describes the code that exists in `src/` today. Behavioral truth
lives here; prose in ARCHITECTURE.md, plans in ROADMAP.md.

## 1. Module surface

`createServerAdapter()` (src/index.ts) returns a `ServerAdapterModule` with:

| Export | Value |
|---|---|
| `type` | `"orca_local"` |
| `label` | `"Orca (Claude/Codex in an Orca worktree)"` |
| `agentConfigurationDoc` | usage doc incl. the no-push rule |
| `execute(ctx)` | run heartbeat in Orca worktree (§3) |
| `testEnvironment(ctx)` | diagnostics (§5) |
| `sessionCodec` | passthrough record codec; display id = `sessionId` |
| `supportsLocalAgentJwt` | `true` |

Also exported for tests/reuse: `worktreeName`, `buildRunScript`, `buildArgv`.

## 2. Configuration contract

| Key | Type | Default | Validation |
|---|---|---|---|
| `repo` | string | — | **required**; missing ⇒ run fails with exit 1 before any Orca call |
| `agent` | string | `"claude"` | `"codex"` selects Codex argv/parse path; any other value behaves as claude |
| `model` | string | — | appended `--model <m>` to both CLIs |
| `promptTemplate` | string | `DEFAULT_PAPERCLIP_AGENT_PROMPT_TEMPLATE` | rendered with agent/run/context data |
| `orcaBin` | string | `/usr/local/bin/orca` | path to orca executable |
| `timeoutSec` | number | `0` | `0` = no adapter timeout |
| `env` | object | — | stringified and merged over buildPaperclipEnv output |

## 3. `execute` behavior

1. Resolve task identity: `ident` = Paperclip issue `identifier`
   (`context.paperclipIssue.identifier`, else from the wake payload) falling
   back to `taskId = context.taskId || context.issueId || null`. Card title =
   `"<identifier> · <title>"` (or `taskId`, or `agent.name`).
2. `resumeId` = stored `sessionParams.sessionId` **only when stored `agent`
   matches the current `agent` config** (agent switch ⇒ fresh session).
3. `ensureWorktree`: prefer the exact worktree from the previous run
   (`worktree show --worktree id:<prevWorktreeId>`, since names are not unique
   across repos), else `worktree show --worktree name:<name>`; on miss,
   `worktree create --repo <repo> --name <name> --no-parent --comment
   "Paperclip: <title>"`. Name = `pc-` + sanitized(ident, else
   `agent-<agentId>`), truncated to 40 chars, `[^a-zA-Z0-9-]` stripped.
4. Card update (`worktree set --workspace-status in-progress`); cosmetic —
   failures swallowed.
5. Run dir `~/.paperclip/orca-runs/<runId>` (0700):
   - `env` (0600): `buildPaperclipEnv(agent)` + `PAPERCLIP_RUN_ID`,
     `PAPERCLIP_WORKSPACE_CWD` and `PAPERCLIP_WORKSPACE_WORKTREE_PATH` (set to
     the worktree path so host-side workspace attribution sees the Orca
     checkout as the run's execution workspace), `PAPERCLIP_TASK_ID`,
     `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`, config `env`
     overrides, and `PAPERCLIP_API_KEY` when `ctx.authToken` present. Values
     `shq`-quoted.
   - `prompt.md`: `renderPaperclipWakePrompt` + task markdown, plus the rendered
     `promptTemplate` only on a **fresh** session (resume + wake ⇒ omitted).
   - `run.sh` (0700, §4.1).
6. `orca terminal create --worktree id:<wt> --title "paperclip <runId8>" --command
   "bash <run.sh>; exit"`. stdout of the pump is prefixed
   `[orca] worktree <path>, terminal <handle>`.
7. Poll loop every 500 ms until `exit` file exists:
   abort (`ctx.signal.aborted`) or `timeoutMs` ⇒ `orca terminal close` + mark
   timedOut/cancelled. After loop: final pump; `rm env`.
8. Read `exit` (empty ⇒ `null` exitCode), `stderr.log` (last 2000 chars when
   failing), parse stdout with the agent-appropriate upstream parser.
9. Stale-session recovery: when the run **failed while resuming** and the
   upstream detectors (`isClaudeUnknownSessionError` /
   `isCodexUnknownSessionError`) recognize an unknown-session failure, the
   result carries `clearSession: true` and no `sessionParams` — Paperclip
   drops the dead session id so the next heartbeat starts fresh instead of
   failing every future run.
10. Final card: comment
    `Paperclip: <title> — run finished|cancelled|timed out|failed (exit N)`;
    status `in-review` on success, otherwise unchanged.
11. Return `AdapterExecutionResult` with exitCode, timedOut, errorMessage, usage /
    costUsd / model / summary (per parser), `sessionParams = { agent, sessionId,
    worktreeId, cwd }`, `usageBasis: "per_run"`.

### 4.1 run.sh shape

```sh
set -a
. '<dir>/env'
set +a
<argv> < '<dir>/prompt.md' 2> >(tee '<dir>/stderr.log' >&2) | tee '<dir>/stdout.log'
echo "${PIPESTATUS[0]}" > '<dir>/exit'
```

TODO fmt

| Signal | Claude (`stream-json`) | Codex (`exec --json`) |
|---|---|---|
| `usage` | ✓ | ✓ |
| `costUsd` | ✓ | when present |
| `model` | ✓ | ✓ |
| `summary` | ✓ | ✓ |
| `sessionId` | ✓ | → argv `resume <id>` next heartbeat |

### 4.3 Stale-session policy

| Situation | Result |
|---|---|
| run ok | store parsed or prev session id (`sessionId ?? resumeId`) |
| run failed while resuming, unknown-session error detected upstream | `clearSession: true`, no `sessionParams` — next heartbeat starts fresh |
| run failed otherwise | keep previous session id |

No `listSkills` / `syncSkills` / `detectModel` yet (roadmap §R2/R3).

## 5. `testEnvironment` diagnostics

| Code | Level | Condition |
|---|---|---|
| `orca_unreachable` | error | `orca status` fails or `runtime.reachable` falsy |
| `orca_ready` | info | app version surfaced |
| `repo_missing` | error | no `config.repo` |
| `repo_not_found` | error | `orca repo show --repo <repo>` fails |

Status = `fail` iff any `error`-level check.

## 6. Orca CLI wrapper contract (src/orca.ts)

- `orca(bin, args)`: appends `--json`, parses envelope, throws on `ok: false`
  (non-zero exit still yields stdout JSON envelope — handled).
- `ensureWorktree(bin, repo, name, comment, prevId?)` → `{ id, path }`; prefers
  exact prior id, falls back to name lookup, else creates. Throws on failure
  (fatal — no worktree means no run).
- `setCard(bin, worktreeId, comment, status?)` — swallows errors.
- `createTerminal(bin, worktreeId, title, command)` → handle; throws if no handle.
- `closeTerminal(bin, handle)` — swallows errors.

## 7. Security properties & residual risk

Properties (see ARCHITECTURE §5): 0600 env / 0700 dirs, JWT never in argv or
scrollback, env file removed after run, `execFile` for orca calls, `shq` for shell
strings, cosmetic card failures isolated.

Residual risks (documented, accepted at v0.1):

- R-SEC-1 — the run script runs with the user's full local privileges (CLI
  `--dangerously-*` flags are required for unattended headless operation).
  Mitigation path: Orca worktree-level sandboxing / Paperclip execution policy.
- R-SEC-2 — prompt file is readable by same-user processes; acceptable for
  single-operator desktops, revisit for shared hosts.
- R-SEC-3 — a stale terminal left running across adapter upgrade could keep old
  script contents; exit-file protocol means the adapter may wait on a dead run —
  see troubleshooting doc.

## 8. Test contract (node:test)

- `buildRunScript` — env sourcing, tee split, exit capture work under real bash;
  secret not present in the script text.
- `buildArgv` — resume argv shape for both agents.
- `worktreeName` — sanitization/agent fallback determinism.
- `setupStatus` — Orca down/not ready/ready, agent filtering, no throws.
- Release — package / Orca manifest / Orca panel versions match.

## 9. Compatibility

- Paperclip host: external adapter plugin contract 1.0.0 (`paperclip.adapterUiParser`).
- Engines: Node ≥ 24 (upstream adapter-utils requirement).
- Orca: any build exposing `worktree`/`terminal`/`repo`/`status` with `--json`
  envelopes, incl. the legacy pre-`--agent` create path used here intentionally
  (two-step worktree + terminal create keeps the run script single-purpose).

## 10. Setup surfaces

- **Installer** (`src/cli.ts`, bin `paperclip-adapter-orca`): checks `orca status`,
  registers the target repo (`orca repo add`, reused if present), installs the adapter
  and plugin via Paperclip's `/api/adapters/install` and `/api/plugins/install`, saves
  `{requireReview:true}` plugin config per company, then opens
  `/<prefix>/agents/new?adapterType=orca_local`. Env: `PAPERCLIP_URL`, `ORCA_BIN`.
  Exit 1 when Orca or Paperclip is unreachable. Idempotent.
- **Paperclip dashboard widget** (`orca.sync` slot `orca-setup`, `src/plugin/ui`):
  data key `setup` returns `{orca:{ok,error?}, repos, agents}` (orca_local agents
  only). Shows a checklist until every orca_local agent has a repo, then a one-line
  "Orca connected" summary. Creating the agent stays a host navigation: the
  plugin SDK has no agent-create capability, and the widget does not call
  Paperclip's REST API directly.
- **Adapter config schema** (`getConfigSchema`): `repo` (combobox, options
  `path:<abs>` from `orca repo list`, empty with a hint if Orca is down) and
  `agent` (claude | codex). Paperclip renders these on the agent's
  Configuration tab; its new-agent wizard does not, so new agents start without
  a repo and `execute` fails with a message pointing to that tab.
- **Orca plugin** (`orca-plugin.json`, `orca-plugin/`): command
  `paperclip.connect` and sidebar panel `paperclip-setup` both type
  `npx -y paperclip-adapter-orca@<plugin version>` into the focused worktree's
  first terminal **without Enter**. The panel is sandboxed (no network, no
  links, no storage). The package, Orca manifest, and panel versions must match
  (enforced by `src/release.test.ts`). Orca installs by git URL pinned to a tag.
