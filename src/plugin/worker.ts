import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { getCard, setCard, worktreeName } from "../orca.js";
import { decide, type Last } from "./sync.js";

type Tracked = Record<string, { companyId: string; worktreeId?: string }>;
const INDEX = { scopeKind: "instance", stateKey: "tracked" } as const;

const plugin = definePlugin({
  async setup(ctx) {
    const config = async (companyId: string) => {
      const c = await ctx.config.get(companyId).catch(() => ({} as Record<string, unknown>));
      return {
        bin: typeof c.orcaBin === "string" && c.orcaBin ? c.orcaBin : "/usr/local/bin/orca",
        requireReview: c.requireReview !== false,
        reviewerUserId: typeof c.reviewerUserId === "string" && c.reviewerUserId ? c.reviewerUserId : null,
      };
    };

    // ponytail: one global queue serializes every sync; per-issue queues if the tracked set gets large.
    let queue: Promise<unknown> = Promise.resolve();
    const serial = <T>(fn: () => Promise<T>) => (queue = queue.then(fn, fn)) as Promise<T>;

    // agentActor: true/false from an event's actor; undefined from the poll, which has no actor.
    const sync = (issueId: string, companyId: string, agentActor?: boolean) => serial(async () => {
      const issue = await ctx.issues.get(issueId, companyId);
      const index = ((await ctx.state.get(INDEX)) as Tracked | null) ?? {};
      if (!issue) {
        delete index[issueId];
        return ctx.state.set(INDEX, index);
      }
      const { bin, requireReview, reviewerUserId } = await config(companyId);
      const prevId = index[issueId]?.worktreeId;
      // ponytail: first match is by name, which isn't unique across companies; the resolved id is pinned after that.
      const card =
        (prevId && (await getCard(bin, `id:${prevId}`))) ||
        (issue.identifier ? await getCard(bin, `name:${worktreeName(issue.identifier, "")}`) : null);
      if (!card) {
        if (prevId) { delete index[issueId]; await ctx.state.set(INDEX, index); }
        return; // Not run through Orca (yet).
      }
      if (prevId !== card.id) {
        index[issueId] = { companyId, worktreeId: card.id };
        await ctx.state.set(INDEX, index);
      }

      const key = { scopeKind: "issue", scopeId: issueId, stateKey: "orca-sync" } as const;
      const last = (await ctx.state.get(key)) as Last | null;
      // ponytail: the poll guesses "agent closed it" from the assignee; a board user closing an agent-owned
      // issue while events are down gets routed to review too. Use a last-writer field if Paperclip exposes one.
      agentActor ??= Boolean(issue.assigneeAgentId);
      const r = decide(last, issue.status, card.workspaceStatus ?? "todo", { cardComment: card.comment, agentActor, requireReview });
      // Store first, so the issue.updated echo of our own writes sees no diff.
      await ctx.state.set(key, r.last);

      for (const a of r.actions) {
        ctx.logger.info(`orca-sync ${issue.identifier}: ${JSON.stringify(a)}`);
        if (a.kind === "setIssue") await ctx.issues.update(issueId, { status: a.status as never }, companyId);
        else if (a.kind === "setCard") await setCard(bin, card.id, a.comment, a.status);
        else if (a.kind === "submitForReview") {
          // Assigning the human is Paperclip's native "waiting on review"; left with the agent, Paperclip re-wakes it.
          const reviewer = reviewerUserId ?? issue.createdByUserId;
          if (issue.assigneeAgentId) await ctx.state.set({ ...key, stateKey: "orca-agent" }, issue.assigneeAgentId);
          await ctx.issues.update(issueId, {
            status: "in_review",
            ...(reviewer ? { assigneeAgentId: null, assigneeUserId: reviewer } : {}),
          } as never, companyId);
        } else {
          await ctx.issues.createComment(issueId, `Changes requested in Orca review:\n\n${a.note}`, companyId);
          const agentId = ((await ctx.state.get({ ...key, stateKey: "orca-agent" })) as string | null) ?? issue.assigneeAgentId;
          await ctx.issues.update(issueId, { status: "todo", assigneeAgentId: agentId, assigneeUserId: null } as never, companyId);
          // Plugin reassignments don't auto-wake like board ones do, so wake explicitly.
          await ctx.issues.requestWakeup(issueId, companyId, { reason: "orca_changes_requested", idempotencyKey: `orca-changes-${issueId}-${Date.now()}` });
        }
      }
    });

    ctx.events.on("issue.updated", async (e) => {
      if (e.entityId && e.actorType !== "plugin") await sync(e.entityId, e.companyId, e.actorType === "agent");
    });

    ctx.jobs.register("orca-sync", async () => {
      const index = ((await ctx.state.get(INDEX)) as Tracked | null) ?? {};
      for (const [issueId, { companyId }] of Object.entries(index)) {
        await sync(issueId, companyId).catch((err) => ctx.logger.warn(`orca-sync ${issueId} failed: ${err}`));
      }
    });
  },

  async onHealth() {
    return { status: "ok", message: "Orca sync ready" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
