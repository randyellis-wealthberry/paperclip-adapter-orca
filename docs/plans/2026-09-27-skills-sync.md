# Plan: Orca skills sync (R2.1 / killer feature K3)

Date: 2026-09-27 · Status: draft, ready to implement · Owner: supergum

## 0. Goal

Every Paperclip agent's skill policy — decided on the board, per agent, per
company — must be materialized into whatever Orca worktree that agent lands in,
so a heartbeat always runs with exactly the playbooks its company wants, in
isolation, without any human staging files. This closes K3 ("skill parity
across the fleet") and is the largest remaining capability gap between
`orca_local` and the built-in adapters.

## 1. What the reference implementation does (researched)

The built-ins ship this via `@paperclipai/adapter-utils/server-utils`:

- **Host side** (`.ref/paperclip/.../services/heartbeat.ts:~21331`): on every
  heartbeat the server resolves the agent's desired skills
  (`readPaperclipSkillSyncPreference(adapterConfig)` → `desiredSkillEntries`),
  materializes the company library into concrete runtime entries
  (`companySkills.listRuntimeSkillEntries(companyId, { versionSelections })`),
  merges connector skills, then passes the result **inside the adapter config**
  as `config.paperclipRuntimeSkills`. Session-resume of skills requires nothing
  extra from us: the resolved config already reaches `execute(ctx).config`.
- **Entry shape** (`normalizeConfiguredPaperclipRuntimeSkills`): each entry is
  `{ key, runtimeName, source, versionId, currentVersionId, sourceStatus:
  "available"|"missing", missingDetail }` — `source` is an absolute filesystem
  path to the skill directory (a `SKILL.md` dir).
- **Desired-set resolution**: `resolveLegacyPaperclipDesiredSkillNames(config,
  entries)`; always prepends the Paperclip operational skill
  (`paperclipai/paperclip/paperclip`) for non-runner adapters.
- **Codex-local implementation** (`codex-local/src/server/execute.ts`):
  symlinks each desired `source` → `$CODEX_HOME/skills/<runtimeName>`,
  repairing prior Paperclip-managed links (only ones that look Paperclip-managed
  are replaced/removed), prunes broken symlinks, skips missing sources (dangling
  link prevention), and never touches user-installed entries
  (`state: "external"` semantics).
- **Claude-local** (`claude-local/src/server/skills.ts`): snapshot-only
  (`mode: "ephemeral"`); skills are materialized into Paperclip's managed Claude
  prompt bundle by the host. `readInstalledSkillTargets(~/.claude/skills)`
  reports externals.
- **Contract surface** (`adapter-utils/dist/types.d.ts`):
  `listSkills(ctx)` / `syncSkills(ctx, desiredSkills)` returning
  `AdapterSkillSnapshot { supported, mode, desiredSkills, entries, warnings }`;
  presence of either method flips `supportsSkills` on the adapter registry
  (`adapters.ts:181`). Optional `requiresMaterializedRuntimeSkills` flag exists
  for adapters that scan a directory rather than read config — **we read
  config, so we do not set it.**

Key takeaway: **no new host capability is required.** `config.paperclipRuntimeSkills`
already flows into our `execute()`. The work is entirely in supergum: expose the
two snapshot methods + inject links into the Orca worktree at run time.

## 2. Design

### 2.1 Snapshot methods (PR-1)

Add to `createServerAdapter()`:

```ts
listSkills:  (ctx) => buildOrcaSkillSnapshot(ctx),                      // mode: "persistent"
syncSkills:  (ctx, _desired) => buildOrcaSkillSnapshot(ctx),            // idempotent; actual linking happens at execute time
```

`buildOrcaSkillSnapshot` mirrors `codex-local/skills.ts` using
`readPaperclipRuntimeSkillEntries(config, ourModuleDir)` +
`resolveLegacyPaperclipDesiredSkillNames(...)` +
`buildRuntimeMountedSkillSnapshot({ adapterType: "orca_local", mode:
"persistent", externalInstalled: readInstalledSkillTargets(worktreeSkillsDir) … })`.

`snap.mode = "persistent"` because our materialization lives in the worktree on
disk and survives beats (unlike the built-ins' ephemeral prompt-bundle).

### 2.2 Injection points per agent CLI (PR-2) — the differentiating bit

Two runtimes, two homes, one rule: *link into the worktree, never into the
shared host home* (that is what makes this beats-isolated and reverts cleanly
with `worktree rm`):

| Agent | Skills dir inside the worktree | Mechanism |
|---|---|---|
| Claude | `<wt>/.claude/skills/<runtimeName>` | symlink per skill dir (Claude Code discovers project-level `.claude/skills` from cwd) |
| Codex | `<wt>/.codex-home/skills/<runtimeName>` | **worktree-scoped `CODEX_HOME`**: run env sets `CODEX_HOME=<wt>/.codex-home`; the dir is provisioned by symlinking `auth.json` and `config.toml` back to the shared `~/.codex` (falling back to real copy if link fails), then linking skills. See §2.4. |

Run-script env gains `CLAUDE_CONFIG_DIR` **not** set (not needed — project-level
discovery only) and `CODEX_HOME` for codex runs. Both are cosmetic if missing.

Injection procedure (shared for both, modeled on
`ensureCodexSkillsInjected`):

1. `entries = readPaperclipRuntimeSkillEntries(config, moduleDir)`
   (config-override aware; explicit empty array = sync nothing).
2. `desired = resolveLegacyPaperclipDesiredSkillNames(config, entries)`.
3. Filter out `sourceStatus === "missing"` (dangling-link prevention) and log
   a stderr warning naming the key.
4. `mkdir -p <skillsHome>` (inside the already-0700-adjacent worktree).
5. For each desired entry: if target exists and is a symlink **whose resolved
   path is a Paperclip runtime skill path** (`isLikelyPaperclipRuntimeSkillPath`
   equivalent: parent chain ends in `/skills`, skill dir has `SKILL.md`),
   re-link to the current `source`; if it exists and is **not**
   Paperclip-managed (user-installed), leave untouched and report
   `state: "external"` in warnings.    Else create `symlink(source, target)`
   (`fs.symlink` with `dir` type on darwin/win via `symlink` default — target
   validation in step 5 below).
6. Prune broken Paperclip-managed links not in the desired set.
7. Failures here are **cosmetic** (roadmap rule 4): log via `onLog`, add
   snapshot `warnings`, never abort the run — an agent missing one skill still
   runs; the card shows a `— skills drift` suffix hint. Lifecycle failures
   (unwritable worktree) already fail the run earlier via ensureWorktree.

### 2.3 Session/store bedding

`sessionParams` gains `skillsApplied?: string` (a digest of desired key@version
list). On the next heartbeat, a digest match lets us skip re-linking (fast
path); a mismatch triggers the relink pass before `terminal create`.

### 2.4 Codex CODEX_HOME provisioning (the risky part — spike first)

Codex reads auth/config exclusively from `CODEX_HOME`; skills live in
`$CODEX_HOME/skills`. Options ranked:

- **A (chosen): worktree-scoped home.** `<wt>/.codex-home/` with:
  - `auth.json` → symlink to shared `~/.codex/auth.json`
    (copy if symlink fails or source missing);
  - `config.toml` → symlink to shared (codex-local's own precedent: managed
    homes symlink the shared credential);
  - `skills/` → Paperclip-managed links per §2.2.
  - `.gitignore` at worktree root entry `.codex-home/` (auto-created if absent;
    avoids committing bytes; **never** commit auth bytes).
- B: reuse shared `~/.codex/skills` like built-ins do — rejected: breaks
  per-worktree isolation that is this adapter's brand.
- C: full atomic staged copy per run (sandbox-style) — deferred; only if A
  trips on codex reading `CODEX_HOME` strictly (e.g. openAuth file locking).

Spike (PR-2a): manual test that `CODEX_HOME=<wt>/.codex-home codex exec --json`
authenticates via the symlinked `auth.json` on macOS + Linux. If not, fall to
option C behind `config.skillsStaging: "copy"`.

### 2.5 Security posture additions

- Skill dirs are Paperclip-managed content (markdown-only policy enforced by
  the Store for imported skills; scripts only via first-party catalog). We add
  no override: we link, never copy bytes, so the Store's trust classification
  remains authoritative.
- `CODEX_HOME` symlinked `auth.json` inherits existing shared-home file
  permissions; the worktree `.codex-home` dir is chmod 0700 at creation.
- `.gitignore` guard: only ever **append** the entry if missing; never rewrite
  a worktree `.gitignore` wholesale.

## 3. Open questions

1. Does Claude Code in `--print` mode discover project-level `.claude/skills`
   reliably with our cwd (worktree root, not run dir)? → verify in PR-2 smoke.
2. Version pins: `paperclipSkillSync.desiredSkillEntries[].versionId` — v1
   ignores pins (links to latest materialized `source`); document in
   agentConfigurationDoc. Follow-up: surface `currentVersionId` mismatch as
   `state: "stale"` in our listSkills instead of "installed".
3. Orca skill sharing (`orca skills get/share`) as an alternate transport —
   parked; filesystem links are simpler, universal, and survive Orca restarts.
4. Should `testEnvironment` verify link write-permission when `repo` resolves?
   (cheap probe: create/delete a temp dir in the expected worktree path). Yes —
   add in R1 rather than this PR.

## 4. Implementation checklist

- [ ] PR-1: snapshot methods + unit tests (pure functions, mirror existing
  test style): desired-name canonicalization, missing-source filtering,
  external-preservation.
- [ ] PR-2: worktree injection in `execute` (claude path), digest fast path,
  cosmetic-failure wiring, `skillsApplied` in sessionParams.
- [ ] PR-2a: codex `CODEX_HOME` spike (manual, macOS first; results noted
  here).
- [ ] PR-3: link into `.claude/skills` parity for codex fallback (option C)
  behind `skillsStaging: "copy"` config if A fails.
- [ ] PR-4: docs sync (required by AGENTS rule 7):
  SPEC.md §4.2.5 "skills", §5 testEnvironment note, agentConfigurationDoc
  bullet, docs/configuration.md section, ROADMAP R2.1 → done, troubleshooting
  rows ("skill not visible", "CODEX_HOME auth broken").

## 5. Acceptance

1. Agent with skill set S in Paperclip; fresh orca worktree ⇒ **exactly S**
   linked (runtimeNames identical) visible to the CLI; re-beat idempotent
   (no link churn — digest path proves zero fs writes).
2. Remove skill from S ⇒ next beat removes the link (or PruneBroken) without
   touching user-installed entries.
3. Skill with scripts (first-party) links fine; imported external markdown-only
   skills link fine; missing-source skill produces warning + absent link.
4. Codex run with worktree CODEX_HOME authenticates + runs a skill; auth
   symlink survives when shared home is rotated (vend refresh unchanged).
5. Card comment carries `— skills N linked` cosmetic suffix when N>0 (glimpse
   of K3 for the operator).
6. `orca worktree rm` leaves no skills residue anywhere outside the worktree
   except `~/.paperclip/orca-runs/<runId>` scratch (documented).

## 6. Non-goals (this plan)

- Orca-native skill sharing integration (see §3.3).
- Version-pin honor (§3.2).
- Instructions-bundle (`AGENTS.md`) sync — separate plan; note interaction:
  declaring `supportsInstructionsBundle: true` is a prerequisite flag we should
  also declare, grouped in the same release.
