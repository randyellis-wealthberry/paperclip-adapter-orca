// Orca plugin worker. Plugins can't run processes, so the command types the installer into a terminal.
export default function activate({ commands, host }) {
  commands.register("paperclip.connect", async () => {
    const ctx = await host.call("workspace.readContext");
    const terminalId = ctx?.terminals?.[0]?.id;
    if (!terminalId) {
      await host.call("notifications.show", { title: "Paperclip", body: "Open a terminal in this worktree, then run the command again." });
      return;
    }
    await host.call("terminal.sendText", { terminalId, text: "npx -y paperclip-adapter-orca@latest", enter: true });
  });
}
