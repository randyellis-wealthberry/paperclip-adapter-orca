import { test } from "node:test";
import assert from "node:assert/strict";
import { setupStatus } from "./setup.js";

const agents = async () => [
  { id: "a1", name: "Orca agent", adapterType: "orca_local", adapterConfig: { repo: "name:web" } },
  { id: "a3", name: "New", adapterType: "orca_local", adapterConfig: {} },
  { id: "a2", name: "Other", adapterType: "claude_local" },
];

test("ready Orca lists repos and only orca_local agents", async () => {
  const orca = async (args: string[]) =>
    args[0] === "status" ? { runtime: { state: "ready" } } : { repos: [{ displayName: "web", path: "/r/web" }] };
  assert.deepEqual(await setupStatus(orca, agents), {
    orca: { ok: true },
    repos: [{ name: "web", path: "/r/web" }],
    agents: [{ id: "a1", name: "Orca agent", repo: "name:web" }, { id: "a3", name: "New", repo: null }],
  });
});

test("missing Orca CLI and failing agent list don't throw", async () => {
  const orca = async () => { throw new Error("orca CLI not found"); };
  const s = await setupStatus(orca, async () => { throw new Error("denied"); });
  assert.deepEqual(s, { orca: { ok: false, error: "orca CLI not found" }, repos: [], agents: [] });
});

test("Orca not ready skips repo list", async () => {
  const s = await setupStatus(async () => ({ runtime: { state: "starting" } }), async () => []);
  assert.deepEqual(s.orca, { ok: false, error: "Orca runtime is starting" });
  assert.deepEqual(s.repos, []);
});
