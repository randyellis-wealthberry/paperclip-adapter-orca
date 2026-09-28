// Paperclip UI run-log parser (contract 1.0.0). Served to the browser and eval'd: zero imports allowed.
// Input: `[orca] …` adapter lines, then raw `claude` stream-json or `codex exec --json` lines.
type Entry =
  | { kind: "assistant" | "thinking" | "system" | "stdout"; ts: string; text: string }
  | { kind: "tool_call"; ts: string; name: string; input: unknown; toolUseId?: string }
  | { kind: "tool_result"; ts: string; toolUseId: string; content: string; isError: boolean };

type Obj = Record<string, any>;
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

function claude(e: Obj, ts: string): Entry[] {
  if (e.type === "system") return e.subtype === "init" ? [{ kind: "system", ts, text: `session ${str(e.session_id)} (${str(e.model)})` }] : [];
  if (e.type === "result") return [{ kind: "system", ts, text: `result: ${str(e.subtype)}` }];
  const blocks: Obj[] = Array.isArray(e.message?.content) ? e.message.content : [];
  return blocks.flatMap((b): Entry[] => {
    if (b.type === "text" && b.text) return [{ kind: "assistant", ts, text: b.text }];
    if (b.type === "thinking" && b.thinking) return [{ kind: "thinking", ts, text: b.thinking }];
    if (b.type === "tool_use") return [{ kind: "tool_call", ts, name: str(b.name), input: b.input, toolUseId: str(b.id) }];
    if (b.type === "tool_result") {
      const content = Array.isArray(b.content) ? b.content.map((c: Obj) => str(c.text ?? c)).join("\n") : str(b.content);
      return [{ kind: "tool_result", ts, toolUseId: str(b.tool_use_id), content, isError: !!b.is_error }];
    }
    return [];
  });
}

function codex(e: Obj, ts: string): Entry[] {
  if (e.type === "thread.started") return [{ kind: "system", ts, text: `thread ${str(e.thread_id)}` }];
  if (e.type !== "item.completed" && e.type !== "item.started") return [];
  const it: Obj = e.item ?? {};
  const id = str(it.id);
  if (it.type === "agent_message") return e.type === "item.completed" ? [{ kind: "assistant", ts, text: str(it.text) }] : [];
  if (it.type === "reasoning") return e.type === "item.completed" ? [{ kind: "thinking", ts, text: str(it.text) }] : [];
  if (it.type === "command_execution") {
    if (e.type === "item.started") return [{ kind: "tool_call", ts, name: "shell", input: { command: it.command }, toolUseId: id }];
    return [{ kind: "tool_result", ts, toolUseId: id, content: str(it.aggregated_output), isError: typeof it.exit_code === "number" && it.exit_code !== 0 }];
  }
  return [];
}

export function parseStdoutLine(line: string, ts: string): Entry[] {
  const t = line.trim();
  if (!t) return [];
  if (t.startsWith("[orca]")) return [{ kind: "system", ts, text: t }];
  let e: unknown;
  try { e = JSON.parse(t); } catch { return [{ kind: "stdout", ts, text: t }]; }
  if (!e || typeof e !== "object" || typeof (e as Obj).type !== "string") return [{ kind: "stdout", ts, text: t }];
  return (e as Obj).type.includes(".") ? codex(e as Obj, ts) : claude(e as Obj, ts);
}
