# paperclip-adapter-orca

This package contains two pieces: the `orca_local` adapter and the `orca.sync` plugin.

## Adapter

Paperclip adapter (`orca_local`). It runs each Paperclip issue as a headless Claude Code or Codex session inside its own Orca worktree (`pc-<ISSUE>`), in a visible Orca terminal. Output streams into the Paperclip run log, the session resumes on later heartbeats, and the Orca workspace card shows the run's status.

### Install

    pnpm install && pnpm build
    curl -XPOST localhost:3100/api/adapters/install -H 'content-type: application/json' \
      -d '{"packageName":"'"$PWD"'","isLocalPath":true}'

Agent config: `{"repo": "path:/abs/repo", "agent": "claude" | "codex", "model"?, "timeoutSec"?, "orcaBin"?, "env"?}`.

Run files and logs go to `~/.paperclip/orca-runs/<runId>/`. The env file holding the run JWT is deleted when the run ends.

## Sync plugin (`orca.sync`)

The plugin syncs status both ways between Paperclip issues and the Orca cards of `pc-*` worktrees, and adds a review step in Orca.

| You do | What happens |
|---|---|
| The agent marks the issue done | The issue goes to `in_review` and is assigned to you. The card moves to In review. |
| Move the card to Completed | The issue is closed (`done`). |
| Move the card back to In progress with a comment | Your comment is posted on the issue. The issue goes back to the agent as `todo`, and the agent is woken to rework it in the same worktree and session. |
| Move the card to In review by hand | The issue goes to `in_review` and is assigned to you. |
| Change the status in Paperclip | The card follows. |

Paperclip events trigger the sync immediately, and a job also checks every minute for changes made in Orca.

### Install

    curl -XPOST localhost:3100/api/plugins/install -H 'content-type: application/json' \
      -d '{"packageName":"'"$PWD"'","isLocalPath":true}'
    # Required: save a config for each company, or the minute job can't read that company's issues.
    curl -XPOST localhost:3100/api/plugins/<pluginId>/config -H 'content-type: application/json' \
      -d '{"companyId":"<companyId>","configJson":{"requireReview":true}}'

Config options: `orcaBin`, `requireReview` (default true), `reviewerUserId` (defaults to the issue's creator).

## Test

    pnpm test
