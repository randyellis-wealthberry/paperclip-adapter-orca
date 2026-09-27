# AGENTS.md

Guidance for humans and AI agents doing work in this repository.

## 1. Purpose

`supergum` is the source of the `paperclip-adapter-orca` npm package: a Paperclip
adapter plugin (`orca_local`) that executes agent heartbeats as headless
Claude/Codex sessions inside Orca-managed worktrees with visible terminals.

## 2. Read this first

1. `README.md` — what the package is, install path
2. `ARCHITECTURE.md` — the Paperclip ⇄ Orca bridge model and run lifecycle
3. `SPEC.md` — normative behavior contract; keep it aligned with the code
4. `ROADMAP.md` — planned work and release gates
5. Reference-only contract docs live in `.ref/paperclip/docs/adapters/`
   (external-adapters, adapter-ui-parser, creating-an-adapter). `.ref/` is a
   pinned copy of the Paperclip source for grounding — **never** import from it,
   and don't touch it beyond reading.

## 3. Repo map

```
src/index.ts       adapter surface: type/label, execute, testEnvironment,
                   sessionCodec, worktreeName / buildRunScript / buildArgv
src/orca.ts        Orca CLI wrapper (execFile + --json envelope handling)
src/index.test.ts  node:test unit suite (no live Orca required)
dist/              tsc output — the published artifact (not hand-edited)
package.json       published name, engines, paperclip.adapterUiParser
.ref/              reference copy of Paperclip + docs (gitignored)
docs/              configuration + troubleshooting user docs
```

## 4. Engineering rules

1. **Adapter contract purity.** Speak only the `ServerAdapterModule` contract
   from `@paperclipai/adapter-utils`. Never import Paperclip server internals.
   Never write to host state beyond the documented result shape.
2. **One task, one worktree, deterministic name.** Any failure to resolve the
   worktree name per task breaks session continuity — take it seriously.
3. **Secrets never in scrollback or argv.** New secrets ride the 0600 `env`
   file only. If the run-script shape changes, re-run the scrollback-leak test.
4. **Cosmetic Orca failures stay cosmetic.** Card/status/comment updates must
   never fail a run; lifecycle failures (worktree, terminal create) must fail
   fast with a readable message.
5. **Parse upstream, don't fork.** Usage/session parsing comes from the
   `@paperclipai/adapter-claude-local` / `-codex-local` packages; prefer bumping
   their version over reimplementing parsers.
6. **Pin deps deliberately.** This package's supply-chain surface is three
   peer adapter packages — do not add runtime dependencies without a SPEC note.
7. **Contract sync.** Behavior change ⇒ update SPEC.md, `agentConfigurationDoc`,
   docs/configuration.md, and troubleshooting rows in the same change.
8. **Node ≥ 24 only.** Uses recent stdlib APIs; keep module resolution Node16.

## 5. Verification

```sh
pnpm build    # tsc
pnpm test     # tsc && node --test dist/*.test.js
```

Manual smoke (needs Orca running locally):

```sh
orca status --json
# install this checkout as a local adapter:
curl -X POST http://localhost:3102/api/adapters -d '{"localPath": "<abs>"}'
# then: create agent with adapter orca_local, config.repo name:<some-orca-repo>,
#       heartbeat enabled; Invoke manually and watch the Orca terminal.
```

Report anything not run and why. Browser suites don't exist here.

## 6. Commit / PR expectations

- Small, focused commits; messages imperatival ("fix poll race", "add auth check").
- Before hand-off: `pnpm build && pnpm test` green; `git status` clean of stray
  artifacts; no `.ref/` changes staged.
- If an AI model co-authored a change, name provider + model in the PR body.

## 7. Gotchas

- Orca terminal handles go stale after Orca restarts — the adapter tolerates a
  missing terminal at finalize; don't code terminal-restart recovery casually
  (see ROADMAP R0).
- `orca` on Linux outside Orca terminals resolves to a screen-reader binary —
  `orcaBin` config and PATH hygiene matter; always verify `orca status` before
  blaming the adapter.
- Worktree names collide after sanitization (e.g. `a/b` and `a b`). Known,
  accepted; raise before changing the scheme (sessions would orphan).
