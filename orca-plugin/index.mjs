// Orca plugin worker. Plugin API v0 has no process or network capability, so the command
// types the installer into a terminal, and setup is confirmed by watching Orca's own events.
import { readFileSync } from "node:fs";

// Pin the installer to this plugin's reviewed version instead of whatever npm serves as latest.
const { version } = JSON.parse(readFileSync(new URL("../orca-plugin.json", import.meta.url), "utf8"));

// The adapter names worktrees `pc-<ISSUE>`; Orca may prefix the branch (e.g. `user/pc-12`).
const PC_BRANCH = /(^|\/)pc-[^/]+$/;

/** The first Paperclip worktree proves the whole chain (installer, adapter, agent, heartbeat) works. */
export async function onWorktreeCreated({ branch }, host) {
  if (!PC_BRANCH.test(branch)) return;
  const { value } = await host.call("storage.get", { key: "connected" });
  if (value) return;
  await host.call("storage.set", { key: "connected", value: true });
  await host.call("notifications.show", {
    title: "Paperclip connected",
    body: `A Paperclip agent opened ${branch.split("/").pop()}. Its card and terminal show the run.`,
  });
}

export default function activate({ commands, events, host }) {
  events.on("worktree.created", (e) => onWorktreeCreated(e, host));
  commands.register("paperclip.connect", async () => {
    const ctx = await host.call("workspace.readContext");
    const terminalId = ctx?.terminals?.[0]?.id;
    if (!terminalId) {
      await host.call("notifications.show", { title: "Paperclip", body: "Open a terminal in this worktree, then run the command again." });
      return;
    }
    // No Enter: the terminal may be running an agent or REPL, so the user confirms it's a shell and presses Enter.
    await host.call("terminal.sendText", { terminalId, text: `npx -y paperclip-adapter-orca@${version}`, enter: false });
    await host.call("notifications.show", {
      title: "Paperclip",
      body: "Installer typed into your terminal. Press Enter; each step prints ✔ or ✘. You'll get a notification when the first agent runs here.",
    });
  });
}
