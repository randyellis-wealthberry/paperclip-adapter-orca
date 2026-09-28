import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseStdoutLine as p } from "./ui-parser.js";

test("orca lines are system, junk is stdout", () => {
  assert.deepEqual(p("[orca] worktree /x, terminal t1", "T"), [{ kind: "system", ts: "T", text: "[orca] worktree /x, terminal t1" }]);
  assert.deepEqual(p("not json", "T"), [{ kind: "stdout", ts: "T", text: "not json" }]);
  assert.deepEqual(p("  ", "T"), []);
});

test("claude stream-json maps text, tool calls and results", () => {
  const msg = { type: "assistant", message: { content: [{ type: "text", text: "hi" }, { type: "tool_use", id: "u1", name: "Read", input: { path: "a" } }] } };
  assert.deepEqual(p(JSON.stringify(msg), "T"), [
    { kind: "assistant", ts: "T", text: "hi" },
    { kind: "tool_call", ts: "T", name: "Read", input: { path: "a" }, toolUseId: "u1" },
  ]);
  const res = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "u1", content: [{ type: "text", text: "ok" }], is_error: true }] } };
  assert.deepEqual(p(JSON.stringify(res), "T"), [{ kind: "tool_result", ts: "T", toolUseId: "u1", content: "ok", isError: true }]);
});

test("codex jsonl maps commands and messages", () => {
  const cmd = { id: "c1", type: "command_execution", command: "ls" };
  assert.deepEqual(p(JSON.stringify({ type: "item.started", item: cmd }), "T"), [{ kind: "tool_call", ts: "T", name: "shell", input: { command: "ls" }, toolUseId: "c1" }]);
  assert.deepEqual(p(JSON.stringify({ type: "item.completed", item: { ...cmd, aggregated_output: "x", exit_code: 1 } }), "T"), [
    { kind: "tool_result", ts: "T", toolUseId: "c1", content: "x", isError: true },
  ]);
  assert.deepEqual(p(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "done" } }), "T"), [{ kind: "assistant", ts: "T", text: "done" }]);
});

test("built parser has zero imports and is exported", () => {
  assert.doesNotMatch(readFileSync("dist/ui-parser.js", "utf8"), /^\s*import\s/m);
  assert.equal(JSON.parse(readFileSync("package.json", "utf8")).exports["./ui-parser"], "./dist/ui-parser.js");
});
