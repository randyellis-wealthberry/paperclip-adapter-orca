import { test } from "node:test";
import assert from "node:assert/strict";

// orca-plugin/ is outside rootDir; load it from the compiled test's location.
const { onWorktreeCreated }: any = await import(new URL("../orca-plugin/index.mjs", import.meta.url).href);

function fakeHost() {
  const store = new Map<string, unknown>();
  const shown: string[] = [];
  const call = async (method: string, p: any) => {
    if (method === "storage.get") return { value: store.get(p.key) ?? null };
    if (method === "storage.set") return store.set(p.key, p.value) && { ok: true };
    if (method === "notifications.show") return shown.push(p.title) && { delivered: true };
    throw new Error(method);
  };
  return { call, shown };
}

test("first Paperclip worktree notifies once; other worktrees stay quiet", async () => {
  const host = fakeHost();
  await onWorktreeCreated({ branch: "feature/login" }, host);
  assert.deepEqual(host.shown, []);
  await onWorktreeCreated({ branch: "randy/pc-ACME-12" }, host);
  await onWorktreeCreated({ branch: "pc-ACME-13" }, host);
  assert.deepEqual(host.shown, ["Paperclip connected"]);
});
