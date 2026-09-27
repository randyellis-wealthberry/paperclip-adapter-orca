import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildArgv, buildRunScript, worktreeName } from "./index.js";

test("run script sources secrets from file, tees output, records exit code", () => {
  const dir = mkdtempSync(join(tmpdir(), "orca-run-"));
  writeFileSync(join(dir, "env"), "SECRET='it'\\''s hidden'\n");
  writeFileSync(join(dir, "prompt.md"), "hello");
  const script = buildRunScript(dir, ["bash", "-c", 'cat; echo " $SECRET"; echo oops >&2; exit 3']);
  assert.ok(!script.includes("hidden"));
  execFileSync("bash", ["-c", script]);
  assert.equal(readFileSync(join(dir, "stdout.log"), "utf8"), "hello it's hidden\n");
  assert.equal(readFileSync(join(dir, "stderr.log"), "utf8"), "oops\n");
  assert.equal(readFileSync(join(dir, "exit"), "utf8").trim(), "3");
});

test("argv resumes the right CLI", () => {
  assert.deepEqual(buildArgv("codex", "", "t1").slice(-3), ["resume", "t1", "-"]);
  assert.deepEqual(buildArgv("claude", "", "s1").slice(-2), ["--resume", "s1"]);
});

test("worktree name is stable per task", () => {
  assert.equal(worktreeName("abc-123/x", "a"), "pc-abc-123x");
  assert.equal(worktreeName(null, "a1"), "pc-agent-a1");
});
