# ROADMAP

Where `orca_local` goes next, ranked by user impact. Code names in brackets are
the working titles for the phases.

**The thesis in one line:** Paperclip tells agents *what & why*, Orca shows
humans *where & how it's going*. Every roadmap item below tightens the coupling
of these two until "run my AI company" and "sit at my Orca board" are the same
activity — the parts neither product can offer alone.

---

## The killer functionality (thesis)

**K1 — The task-visible company.** Every Paperclip issue becomes a card on your
Orca board with a live status you can see at a glance, and every card is a
resumable session. You stop "checking the dashboard" — your desktop *is* the
dashboard. Nobody else has a control plane that renders its task queue as native
desktop workspace cards.

**K2 — Wake-to-terminal continuity.** Multi-heartbeat tasks behave like a single
colleague sitting at one terminal all day: same worktree, same session, same chat
scrollback — but with budgets, approvals and audit trail from the governance
plane. Other adapters get session resume; only this one gets *place* resume
(worktree + card + terminal history in Orca).

**K3 — Skill parity across the fleet.** Paperclip companies carry skill policies
(per-agent, per-company). Syncing them into each Orca worktree means your whole
agent workforce operating the exact same playbooks regardless of which
workstation runs Orca — a capability neither system has solo (Paperclip can't
place skills into Orca workspaces; Orca can't read a company policy).

**K4 — Heartbeat-triggered Orca automation.** Paperclip's heartbeat engine (and
event-driven wakes: assignment, mention, approval resolution) could drive Orca
automations, delivering "when the CEO assigns me a task, Orca preps my
worktree/terminal/browser context by the time I wake" — before the heartbeat
even starts. Turns cold-start latency into warm-start UX.

K1–K3 ship within the adapter contract today; K4 needs a small companion
integration.

---

## R0 — Hardening [Current sprint]

- [ ] **Poll-loop race fix**: treat an absent `exit` file after graceful close
  as cancel-not-hang; add an `fs.watch` fast path (removes the 500 ms
  worst-case per-poll latency).
- [ ] **Terminal lifecycle hygiene**: adopt `terminal wait --for exit` where the
  Orca build supports it instead of close-and-poll; verify stale-handle
  recovery (`terminal_handle_stale` path).
- [ ] **Readable worktree failures**: turn raw Orca envelope JSON errors into
  one-line diagnostics (bad `repo` selector, missing repo path, permission
  denial).
- [x] CI: Node 24 build + tests on push/PR (`ci.yml`). Still open: optional integration test with `orca-dev` behind env
  flag.

## R1 — Trust surface for the board operator

- [ ] `testEnvironment` gains rich checks: CLI presence (`claude --version`,
  `codex --version`), auth sanity (`.credentials.json` / ChatGPT login detect),
  worktree-write permissions, disk headroom.
- [ ] Card status mapping final polish: `in-review` on success, `blocked` on
  failures, `completed` after Paperclip confirms issue done (via periodic
  reconciliation heartbeat).
- [ ] Run-log stream gains lightweight stanza prefixing so the generic UI
  parser can collapse tool calls even without a custom ui-parser.

## R2 — The big three (killer features)

### R2.1 Orca skills sync (`listSkills`/`syncSkills`) [K3]

- **Design ready** — see [docs/plans/2026-09-27-skills-sync.md](docs/plans/2026-09-27-skills-sync.md)
  for the implementation contract, per-CLI injection design, open questions,
  and acceptance checklist. Summary:
- Paperclip already materializes the company skill library into
  `config.paperclipRuntimeSkills` on every heartbeat (host-side, proven in
  `heartbeat.ts` reference) — no host changes required.
- Adapter work: expose `listSkills`/`syncSkills` (mode `persistent`), symlink
  desired skills into the worktree (`<wt>/.claude/skills`,
  `<wt>/.codex-home/skills` with a worktree-scoped `CODEX_HOME`), digest
  fast-path in `sessionParams`.
- Acceptance: an agent enabled with skill set S in Paperclip gets exactly S
  visible in its next session regardless of which worktree it lands in; fresh
  worktrees reach parity without human copy work.

### R2.2 Session ⇄ run-log unification

- Post run, link the parsed Claude session-file and Codex rollout-resume
  metadata into `sessionParams` so the Paperclip UI can deep-link to a resume
  command (`orca` search already indexes agent sessions — surface
  `resumeCommand` in run detail).
- Adds cross-heartbeat "what did this employee actually read/say" for
  governance review.

### R2.3 Card/issue state machine mapping [K1 completion]

- Two-way: card → issue (a human dragging an Orca card to `completed` posts a
  Paperclip comment for the owning agent to confirm) requires Orca → Paperclip
  webhook; documented manual path first (`orca automation` calling the
  Paperclip API).

## R3 — Orca automations as heartbeat prewarmers [K4]

- Companion integration (an Orca automation rule, not adapter code): when a
  Paperclip wakeup is *scheduled* (visible in the Paperclip cron), run
  `worktree` fetch/rebase + `terminal create` (no send) ahead of the heartbeat
  so filesystem caches and the session runtime are warm.
- Long-shot, high-payoff: prewarm budgeting to cut run cold-start (~a few
  seconds of CLI spin-up + first tool call) close to zero.

## R4 — Multi-agent, multi-task placement

- One Orca worktree per **subtask-tree** rather than flat per task (mirrors
  Paperclip's hierarchy; children inherit parent worktree path as an
  inherited solution context).
- Optional: worktree churn — auto-`worktree rm --force` on issue done /
  cancelled (config gated `cleanup: always|ask|never`, default `never` so
  nothing is destroyed by default).

## R5 — UI parser [Shipped]

- Ship the self-contained `ui-parser` module (contract v1.0.0) so the Paperclip
  UI renders orca-specific lines (`[orca] worktree…` headers, terminal
  lifecycle notices) as `system` entries instead of assistant text —
  claude `stream-json` / codex `jsonl` payload lines stay out of the visible
  transcript until parsed.

## R6 — Deeper Paperclip primitives

- `detectModel()` from `~/.claude/settings.json` / Codex config.
- Orphan-process disposal: correlate run timeout / `ctx.signal` with terminal
  close and (config-gated, after a grace period) `worktree stop`, so no CLI
  process outlives its Paperclip run.
- Full-heartbeat feedback: while a heartbeat waits on approvals, the Orca
  terminal shows a banner/backchannel (interactive `terminal wait` +
  `terminal send` escalation, gated behind config `interactive: true`) so
  the run isn't a black box while paused.

---

## Non-goals

- Making Orca *replace* Paperclip boards (Orca stays a local runtime surface).
- Hosting Paperclip's control plane inside Orca. (The bridge stays at the
  adapter boundary.)
- PTY transcription of full TUI sessions for telemetry (privacy + stability).
- Git push/merge by the agent (Paperclip review gates own that).

## Release gates

Every roadmap item lands only with: typecheck + `pnpm test` green, SPEC.md
updated to match behavior, troubleshooting doc row (if new failure mode),
and version bump in `package.json`.
