# paperclip-adapter-orca

This package contains two pieces: the `orca_local` adapter and the `orca.sync` plugin.

## Setup

With [Orca](https://github.com/stablyai/orca/releases) and [Paperclip](https://github.com/paperclipai/paperclip) running (Node ≥ 24), run this from the repo your agents should work in:

    npx paperclip-adapter-orca

It registers the repo in Orca, installs the adapter and sync plugin into Paperclip, configures the plugin for every company, and opens Paperclip's new-agent page with `orca_local` selected. Pass a path to use a different repo, set `PAPERCLIP_URL` if Paperclip isn't on `localhost:3100`, and set `ORCA_BIN` if `orca` isn't on PATH. It's safe to run again.

**From inside Orca:** open Settings → Plugins → Install plugin → Git URL and enter `https://github.com/randyellis-wealthberry/paperclip-adapter-orca#v0.2.0` (Orca requires a pinned tag), then open the **Paperclip** tab in the right sidebar (or run **Paperclip: Connect this repo** from ⌘J) in a worktree with a terminal open. It types the installer command into that terminal; press Enter to run it.

Paperclip's dashboard also gets an **Orca setup** widget with the same checklist that links you to each step.

Then in Paperclip, finish creating the agent, open its **Configuration** tab, pick an **Orca repo** from the dropdown, turn on its heartbeat, and assign it an issue.

## Manual setup

### 1. Install Orca

1. Download Orca from [github.com/stablyai/orca/releases](https://github.com/stablyai/orca/releases) and launch it.
2. Check that the `orca` CLI is on your PATH and the runtime is up:

       orca status --json   # runtime.state should be "ready"

   On Linux, `orca` can resolve to the GNOME screen reader. If it does, set `orcaBin` in the agent config to the Orca CLI's full path.
3. Register the repo your agents will work in:

       orca repo add --path /abs/path/to/repo
       orca repo list        # note the name for the agent config

**Remote Orca (optional).** To run Orca on a server (e.g. Railway, see `deploy/orca-service/`), start it with `orca serve`, copy the `orca://pair?code=...` link from its logs, and pair your local Orca with it:

    orca environment add --name my-server --pairing-code 'orca://pair?code=...'
    orca status --environment my-server --json

The adapter drives the `orca` CLI on the Paperclip host, so it runs work on that machine's Orca.

### 2. Install in Paperclip

Install the adapter:

    curl -XPOST localhost:3100/api/adapters/install -H 'content-type: application/json' \
      -d '{"packageName":"paperclip-adapter-orca"}'

Or go to Paperclip's Settings → Adapters and install `paperclip-adapter-orca`.

Install the sync plugin (optional, see [below](#sync-plugin-orcasync)):

    paperclipai plugin install paperclip-adapter-orca

### 3. Create an agent

In Paperclip, create an agent with adapter **`orca_local`** and config:

    {"repo": "name:<orca repo name>", "agent": "claude"}

Turn on its heartbeat, assign it an issue, and invoke it. A `pc-<ISSUE>` worktree and a terminal appear in Orca. See [docs/configuration.md](docs/configuration.md) for all options and [docs/troubleshooting.md](docs/troubleshooting.md) if something fails.

## Adapter

Paperclip adapter (`orca_local`). It runs each Paperclip issue as a headless Claude Code or Codex session inside its own Orca worktree (`pc-<ISSUE>`), in a visible Orca terminal. Output streams into the Paperclip run log, the session resumes on later heartbeats, and the Orca workspace card shows the run's status.

### Install

    curl -XPOST localhost:3100/api/adapters/install -H 'content-type: application/json' \
      -d '{"packageName":"paperclip-adapter-orca"}'

Or go to Paperclip's Settings → Adapters and install `paperclip-adapter-orca`. To use a local checkout instead, run `pnpm install && pnpm build` and pass `{"packageName":"/abs/path","isLocalPath":true}`.

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

    paperclipai plugin install paperclip-adapter-orca
    # Required: save a config for each company, or the minute job can't read that company's issues.
    curl -XPOST localhost:3100/api/plugins/<pluginId>/config -H 'content-type: application/json' \
      -d '{"companyId":"<companyId>","configJson":{"requireReview":true}}'

After editing the plugin's code, restart Paperclip. Its in-place reload once stopped events from reaching the plugin; only the minute job kept syncing. While events are down, a person closing an agent-assigned issue in Paperclip is also sent to review.

Config options: `orcaBin` (used when it exists, otherwise `orca` from PATH), `requireReview` (default true), `reviewerUserId` (defaults to the issue's creator).

## Test

    pnpm test
