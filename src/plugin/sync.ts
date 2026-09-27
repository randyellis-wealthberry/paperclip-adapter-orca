/** Pure Paperclip-issue <-> Orca-card status sync decisions. No I/O here. */

export type CardStatus = "todo" | "in-progress" | "in-review" | "completed";
export type Last = { pc: string; orca: string };
export type Action =
  | { kind: "setIssue"; status: string }
  | { kind: "submitForReview" } // in_review, assigned to the human reviewer
  | { kind: "setCard"; status: CardStatus; comment?: string }
  | { kind: "requestChanges"; note: string }; // comment, then back to todo and the agent (which wakes it)

const PC_TO_CARD: Record<string, CardStatus> = {
  backlog: "todo",
  todo: "todo",
  in_progress: "in-progress",
  blocked: "in-progress",
  in_review: "in-review",
  done: "completed",
  cancelled: "completed",
};

export const REVIEW_COMMENT = "Paperclip: awaiting your review. Move to Completed to close, or back to In progress with a comment to request changes.";

/**
 * Decides what to do given the last synced pair and the current state of both sides.
 * Returns the actions plus the new `last` to store. The caller stores `last` BEFORE
 * applying actions, so echo events from our own writes produce no diff.
 */
export function decide(
  last: Last | null,
  pc: string,
  orca: string,
  opts: { cardComment?: string; agentActor?: boolean; requireReview?: boolean } = {},
): { actions: Action[]; last: Last } {
  // First sighting: pc-* cards are created by the adapter, so Paperclip's status is the truth to push.
  last ??= { pc: "", orca };

  const orcaChanged = orca !== last.orca;
  const pcChanged = pc !== last.pc;

  // Review gate: an agent closing the issue doesn't close it; a human reviews in Orca first.
  if (pcChanged && !orcaChanged && pc === "done" && opts.agentActor && opts.requireReview !== false && orca !== "completed") {
    return {
      actions: [{ kind: "submitForReview" }, { kind: "setCard", status: "in-review", comment: REVIEW_COMMENT }],
      last: { pc: "in_review", orca: "in-review" },
    };
  }

  // Both moved: the human in Orca is the most deliberate signal, so Orca wins.
  if (orcaChanged) {
    const reviewed = last.orca === "in-review" || last.orca === "completed";
    if (orca === "completed" && pc !== "done" && pc !== "cancelled") {
      const actions: Action[] = [{ kind: "setIssue", status: "done" }];
      if (opts.cardComment?.startsWith("Paperclip:")) actions.push({ kind: "setCard", status: "completed", comment: "Paperclip: approved and closed" });
      return { actions, last: { pc: "done", orca } };
    }
    if (orca === "in-review" && pc !== "in_review") return { actions: [{ kind: "submitForReview" }], last: { pc: "in_review", orca } };
    if ((orca === "in-progress" || orca === "todo") && reviewed) {
      const c = opts.cardComment?.trim() ?? "";
      const note = c && !c.startsWith("Paperclip:") ? c : "Changes requested in Orca.";
      return {
        actions: [{ kind: "requestChanges", note }],
        last: { pc: "todo", orca },
      };
    }
    return { actions: [], last: { pc, orca } };
  }

  if (pcChanged) {
    const card = PC_TO_CARD[pc];
    if (card && card !== orca) return { actions: [{ kind: "setCard", status: card }], last: { pc, orca: card } };
  }
  return { actions: [], last: { pc, orca } };
}
