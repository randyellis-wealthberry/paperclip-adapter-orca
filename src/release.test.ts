import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The Orca plugin pins the installer to its own version, including in the static panel.
test("package, Orca manifest, and Orca panel versions match", () => {
  const { version } = JSON.parse(readFileSync("package.json", "utf8"));
  assert.equal(JSON.parse(readFileSync("orca-plugin.json", "utf8")).version, version);
  assert.ok(readFileSync("orca-plugin/panel.html", "utf8").includes(`const VERSION = "${version}"`));
});
