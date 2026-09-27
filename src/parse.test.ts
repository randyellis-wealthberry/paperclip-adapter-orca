import { test } from "node:test";
import assert from "node:assert/strict";
import { isUnknownSessionError, parseClaudeStreamJson, parseCodexJsonl } from "./parse.js";

const lines = (...xs: object[]) => xs.map((x) => JSON.stringify(x)).join("\n") + "\n";

test("claude: session, model, per-model usage, cost, summary", () => {
  const out = lines(
    { type: "system", subtype: "init", session_id: "s1", model: "m" },
    { type: "assistant", session_id: "s1", message: { content: [{ type: "text", text: "hi" }] } },
    { type: "result", session_id: "s1", result: "done", total_cost_usd: 0.5, usage: { input_tokens: 1, output_tokens: 1 },
      modelUsage: { m: { inputTokens: 10, cacheCreationInputTokens: 5, outputTokens: 3, cacheReadInputTokens: 7 } } },
  );
  const r = parseClaudeStreamJson(out + "not json\n");
  assert.equal(r.sessionId, "s1");
  assert.equal(r.model, "m");
  assert.equal(r.costUsd, 0.5);
  assert.deepEqual(r.usage, { inputTokens: 15, outputTokens: 3, cachedInputTokens: 7 });
  assert.equal(r.summary, "done");
});

test("claude: no result event falls back to assistant text", () => {
  const r = parseClaudeStreamJson(lines({ type: "assistant", session_id: "s2", message: { content: [{ type: "text", text: "partial" }] } }));
  assert.deepEqual([r.sessionId, r.usage, r.summary], ["s2", null, "partial"]);
});

test("codex: thread id, last agent message, usage", () => {
  const r = parseCodexJsonl(lines(
    { type: "thread.started", thread_id: "t1" },
    { type: "item.completed", item: { type: "agent_message", text: "ok" } },
    { type: "turn.completed", usage: { input_tokens: 4, cached_input_tokens: 2, output_tokens: 1 } },
  ));
  assert.deepEqual(r, { sessionId: "t1", summary: "ok", usage: { inputTokens: 4, cachedInputTokens: 2, outputTokens: 1 } });
});

test("unknown-session detection per CLI", () => {
  const claude = parseClaudeStreamJson(lines({ type: "result", result: "No conversation found with session ID: x" }));
  assert.ok(isUnknownSessionError("claude", claude, "", ""));
  assert.ok(isUnknownSessionError("claude", parseClaudeStreamJson(""), "", "Error: --resume requires a valid session"));
  assert.ok(isUnknownSessionError("codex", parseCodexJsonl(""), "", "no rollout found for thread id t9"));
  assert.ok(!isUnknownSessionError("claude", claude.resultJson ? parseClaudeStreamJson("") : claude, "", "rate limited"));
});
