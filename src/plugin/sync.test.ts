import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "./sync.js";

const kinds = (r: ReturnType<typeof decide>) => r.actions.map((a) => [a.kind, "status" in a ? a.status : "note" in a ? a.note : ""].join(":"));

test("first sighting pushes Paperclip status onto the card, and still gates agent closes", () => {
  assert.deepEqual(kinds(decide(null, "in_progress", "todo")), ["setCard:in-progress"]);
  assert.deepEqual(kinds(decide(null, "done", "todo", { agentActor: true })), ["submitForReview:", "setCard:in-review"]);
});

test("agent closing is gated into review", () => {
  const r = decide({ pc: "in_progress", orca: "in-progress" }, "done", "in-progress", { agentActor: true });
  assert.deepEqual(kinds(r), ["submitForReview:", "setCard:in-review"]);
  assert.deepEqual(r.last, { pc: "in_review", orca: "in-review" });
});

test("gate can be turned off, and humans closing in Paperclip go straight through", () => {
  assert.deepEqual(kinds(decide({ pc: "in_progress", orca: "in-progress" }, "done", "in-progress", { agentActor: true, requireReview: false })), ["setCard:completed"]);
  assert.deepEqual(kinds(decide({ pc: "in_progress", orca: "in-progress" }, "done", "in-progress")), ["setCard:completed"]);
});

test("approving in Orca closes the issue", () => {
  assert.deepEqual(kinds(decide({ pc: "in_review", orca: "in-review" }, "in_review", "completed")), ["setIssue:done"]);
});

test("moving a reviewed card back requests changes with the card comment", () => {
  const r = decide({ pc: "in_review", orca: "in-review" }, "in_review", "in-progress", { cardComment: "use tabs" });
  assert.deepEqual(kinds(r), ["requestChanges:use tabs"]);
  const auto = decide({ pc: "in_review", orca: "in-review" }, "in_review", "in-progress", { cardComment: "Paperclip: ORC-1 · x — running" });
  assert.deepEqual(kinds(auto), ["requestChanges:Changes requested in Orca."]);
});

test("run start moving the card to in-progress is not a change request", () => {
  assert.deepEqual(kinds(decide({ pc: "todo", orca: "todo" }, "in_progress", "in-progress")), []);
});

test("both changed: Orca wins", () => {
  assert.deepEqual(kinds(decide({ pc: "in_review", orca: "in-review" }, "in_progress", "completed")), ["setIssue:done"]);
});

test("no change, no actions; echoes of our own writes are no-ops", () => {
  assert.deepEqual(kinds(decide({ pc: "in_review", orca: "in-review" }, "in_review", "in-review")), []);
});

test("moving a card to review in Orca hands the issue to the reviewer", () => {
  assert.deepEqual(kinds(decide({ pc: "todo", orca: "in-progress" }, "todo", "in-review")), ["submitForReview:"]);
});
