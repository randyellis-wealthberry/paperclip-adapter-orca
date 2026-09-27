// Output parsers for `claude --output-format stream-json` and `codex exec --json`.
// Trimmed from Paperclip's claude-local and codex-local adapters (MIT, github.com/paperclipai/paperclip).
import type { UsageSummary } from "@paperclipai/adapter-utils";
import { asNumber, asString, parseJson, parseObject } from "@paperclipai/adapter-utils/server-utils";

export type ParsedRun = {
  sessionId: string | null;
  model?: string;
  costUsd?: number | null;
  usage: UsageSummary | null;
  summary: string;
  resultJson?: Record<string, unknown> | null;
};

const events = (stdout: string) =>
  stdout.split(/\r?\n/).map((l) => (l.trim() ? parseJson(l.trim()) : null)).filter((e): e is Record<string, unknown> => !!e);

/** Sums the per-model ledger; the top-level `usage` undercounts when subagents ran. */
function claudeModelUsageTotals(modelUsage: unknown): UsageSummary | null {
  const entries = Object.values(parseObject(modelUsage)).map(parseObject).filter((e) => Object.keys(e).length);
  if (!entries.length) return null;
  return entries.reduce<UsageSummary>(
    (t, e) => ({
      inputTokens: t.inputTokens + asNumber(e.inputTokens, 0) + asNumber(e.cacheCreationInputTokens, 0),
      outputTokens: t.outputTokens + asNumber(e.outputTokens, 0),
      cachedInputTokens: (t.cachedInputTokens ?? 0) + asNumber(e.cacheReadInputTokens, 0),
    }),
    { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 },
  );
}

export function parseClaudeStreamJson(stdout: string): ParsedRun {
  let sessionId: string | null = null;
  let model = "";
  let result: Record<string, unknown> | null = null;
  const texts: string[] = [];
  for (const e of events(stdout)) {
    const type = asString(e.type, "");
    if (type === "system" || type === "assistant" || type === "result") sessionId = asString(e.session_id, "") || sessionId;
    if (type === "system" && asString(e.subtype, "") === "init") model = asString(e.model, model);
    if (type === "assistant") {
      const content = parseObject(e.message).content;
      for (const b of Array.isArray(content) ? content : []) {
        const block = parseObject(b);
        if (asString(block.type, "") === "text" && asString(block.text, "")) texts.push(asString(block.text, ""));
      }
    }
    if (type === "result") result = e;
  }
  if (!result) return { sessionId, model, costUsd: null, usage: null, summary: texts.join("\n\n").trim(), resultJson: null };
  const u = parseObject(result.usage);
  const cost = result.total_cost_usd;
  return {
    sessionId,
    model,
    costUsd: typeof cost === "number" && Number.isFinite(cost) ? cost : null,
    usage: claudeModelUsageTotals(result.modelUsage) ?? {
      inputTokens: asNumber(u.input_tokens, 0),
      cachedInputTokens: asNumber(u.cache_read_input_tokens, 0),
      outputTokens: asNumber(u.output_tokens, 0),
    },
    summary: asString(result.result, texts.join("\n\n")).trim(),
    resultJson: result,
  };
}

export function parseCodexJsonl(stdout: string): ParsedRun {
  let sessionId: string | null = null;
  let summary = "";
  const usage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  for (const e of events(stdout)) {
    const type = asString(e.type, "");
    if (type === "thread.started") sessionId = asString(e.thread_id, "") || sessionId;
    if (type === "item.completed") {
      const item = parseObject(e.item);
      if (asString(item.type, "") === "agent_message" && asString(item.text, "")) summary = asString(item.text, "");
    }
    if (type === "turn.completed") {
      const u = parseObject(e.usage);
      usage.inputTokens = asNumber(u.input_tokens, usage.inputTokens);
      usage.cachedInputTokens = asNumber(u.cached_input_tokens, usage.cachedInputTokens);
      usage.outputTokens = asNumber(u.output_tokens, usage.outputTokens);
    }
  }
  return { sessionId, usage, summary: summary.trim() };
}

const CLAUDE_UNKNOWN_SESSION =
  /no conversation found with session id|unknown session|session .* not found|not a valid UUID|--resume requires a valid session|is not a UUID|does not match any session title/i;
const CODEX_UNKNOWN_SESSION =
  /unknown (session|thread)|session .* not found|thread .* not found|conversation .* not found|missing rollout path for thread|state db missing rollout path|state db returned stale rollout path|no rollout found for thread id/i;

/** True when a resume failed because the CLI no longer knows the saved session. */
export function isUnknownSessionError(agent: string, run: ParsedRun, stdout: string, stderr: string): boolean {
  if (agent === "codex") return CODEX_UNKNOWN_SESSION.test(`${stdout}\n${stderr}`);
  const r = run.resultJson ?? {};
  const errors = (Array.isArray(r.errors) ? r.errors : []).map((x) =>
    typeof x === "string" ? x : asString(parseObject(x).message, "") || asString(parseObject(x).error, "") || JSON.stringify(x),
  );
  return [asString(r.result, ""), ...errors, stderr].some((m) => CLAUDE_UNKNOWN_SESSION.test(m));
}
