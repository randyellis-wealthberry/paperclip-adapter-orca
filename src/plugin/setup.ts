// First-time setup checklist shown by the dashboard widget.
export type SetupStatus = {
  orca: { ok: boolean; error?: string };
  repos: { name: string; path: string }[];
  agents: { id: string; name: string; repo: string | null }[];
};

/** `orca` is `(args) => result` for the orca CLI; `agents` lists the company's agents. */
export async function setupStatus(
  orca: (args: string[]) => Promise<any>,
  agents: () => Promise<{ id: string; name: string; adapterType?: string | null; adapterConfig?: Record<string, unknown> | null }[]>,
): Promise<SetupStatus> {
  let status: SetupStatus["orca"];
  let repos: SetupStatus["repos"] = [];
  try {
    const s = await orca(["status"]);
    status = s.runtime?.state === "ready" ? { ok: true } : { ok: false, error: `Orca runtime is ${s.runtime?.state ?? "not running"}` };
    if (status.ok) {
      repos = ((await orca(["repo", "list"])).repos ?? []).map((r: any) => ({ name: r.displayName ?? r.name, path: r.path }));
    }
  } catch (err) {
    status = { ok: false, error: (err as Error).message };
  }
  const orcaAgents = (await agents().catch(() => []))
    .filter((a) => a.adapterType === "orca_local")
    .map(({ id, name, adapterConfig }) => ({ id, name, repo: typeof adapterConfig?.repo === "string" && adapterConfig.repo ? adapterConfig.repo : null }));
  return { orca: status, repos, agents: orcaAgents };
}
