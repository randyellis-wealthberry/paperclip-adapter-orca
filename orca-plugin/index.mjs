// Orca plugin worker. Plugins can't run processes, so the command types the installer into a terminal.
import { readFileSync } from "node:fs";

// Pin the installer to this plugin's reviewed version instead of whatever npm serves as latest.
const { version } = JSON.parse(readFileSync(new URL("../orca-plugin.json", import.meta.url), "utf8"));

export default function activate({ commands, host }) {
  commands.register("paperclip.connect", async () => {
    const ctx = await host.call("workspace.readContext");
    const terminalId = ctx?.terminals?.[0]?.id;
    if (!terminalId) {
      await host.call("notifications.show", { title: "Paperclip", body: "Open a terminal in this worktree, then run the command again." });
      return;
    }
    // No Enter: the terminal may be running an agent or REPL, so the user confirms it's a shell and presses Enter.
    await host.call("terminal.sendText", { terminalId, text: `npx -y paperclip-adapter-orca@${version}`, enter: false });
    await host.call("notifications.show", { title: "Paperclip", body: "Installer command typed into your terminal. Press Enter to run it." });
  });
}
