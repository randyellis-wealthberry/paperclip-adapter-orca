# paperclip-adapter-orca

Paperclip adapter (`orca_local`). It runs each Paperclip issue as a headless Claude Code or Codex session inside its own Orca worktree (`pc-<ISSUE>`), in a visible Orca terminal. Output streams into the Paperclip run log, the session resumes on later heartbeats, and the Orca workspace card shows the run's status.

## Install

    pnpm install && pnpm build
    curl -XPOST localhost:3100/api/adapters/install -H 'content-type: application/json' \
      -d '{"packageName":"'"$PWD"'","isLocalPath":true}'

Agent config: `{"repo": "path:/abs/repo", "agent": "claude" | "codex", "model"?, "timeoutSec"?, "orcaBin"?, "env"?}`.

Run files and logs go to `~/.paperclip/orca-runs/<runId>/`. The env file holding the run JWT is deleted when the run ends.

## Test

    pnpm test
