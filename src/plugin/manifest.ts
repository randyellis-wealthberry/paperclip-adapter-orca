import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "orca.sync",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Orca Sync",
  description: "Two-way sync between Paperclip issues and Orca workspace cards, with review in Orca before issues close.",
  author: "supergum",
  categories: ["automation"],
  capabilities: [
    "issues.read",
    "issues.update",
    "issues.wakeup",
    "issue.comments.create",
    "events.subscribe",
    "jobs.schedule",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: { worker: "./dist/plugin/worker.js" },
  instanceConfigSchema: {
    type: "object",
    properties: {
      orcaBin: { type: "string", default: "/usr/local/bin/orca", description: "Path to the orca CLI" },
      requireReview: { type: "boolean", default: true, description: "Agent-closed issues wait for approval in Orca" },
      reviewerUserId: { type: "string", description: "Board user who reviews in Orca (default: the issue's creator)" },
    },
  },
  jobs: [{ jobKey: "orca-sync", displayName: "Sync Orca cards", description: "Pulls Orca card status changes into Paperclip", schedule: "* * * * *" }],
};

export default manifest;
