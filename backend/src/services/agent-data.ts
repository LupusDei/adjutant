import { execBd, stripBeadPrefix, type BeadsIssue } from "./bd-client.js";
import {
  listAllBeadsDirs,
  resolveBeadsDirFromId,
} from "./workspace/index.js";
import {
  extractBeadPrefix,
  addressToIdentity,
  parseAgentBeadId,
  parseAgentFields,
} from "./message-utils.js";
import { getTopology } from "./topology/index.js";
import { listTmuxSessions } from "./tmux.js";

export interface AgentRuntimeInfo {
  id: string;
  name: string;
  role: string;
  project: string | null;
  address: string;
  sessionName: string | null;
  running: boolean;
  state?: string;
  hookBead?: string;
  hookBeadTitle?: string;
  branch?: string;
  /** ISO timestamp of last activity (from session registry) */
  lastActivity?: string;
  /** Worktree path if agent works in a git worktree */
  worktreePath?: string;
}

export interface AgentSnapshot {
  agents: AgentRuntimeInfo[];
}


async function fetchAgents(cwd: string, beadsDir: string): Promise<BeadsIssue[]> {
  // Single call with --all, filter client-side for relevant statuses
  const result = await execBd<BeadsIssue[]>(
    ["list", "--type=agent", "--all", "--json"],
    { cwd, beadsDir }
  );

  if (!result.success || !result.data) {
    return [];
  }

  // Filter for active agents (open) and tombstone
  const relevantStatuses = new Set(["open", "tombstone"]);
  return result.data.filter((issue) =>
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    relevantStatuses.has(issue.status?.toLowerCase() ?? "")
  );
}

/**
 * Fetches bead titles for a list of bead IDs.
 * Routes each bead to the correct beads database based on its prefix.
 * Returns a map of beadId -> title.
 */
async function fetchBeadTitles(
  beadIds: string[]
): Promise<Map<string, string>> {
  const titles = new Map<string, string>();
  if (beadIds.length === 0) return titles;

  // Group beads by prefix to batch requests to the same database
  const beadsByPrefix = new Map<string, string[]>();
  for (const id of beadIds) {
    const prefix = extractBeadPrefix(id) ?? "hq";
    const group = beadsByPrefix.get(prefix) ?? [];
    group.push(id);
    beadsByPrefix.set(prefix, group);
  }

  // Fetch from each database in parallel
  const fetchPromises: Promise<void>[] = [];

  for (const [, ids] of beadsByPrefix) {
    // Use the first ID to resolve the beads directory for this group
    const firstId = ids[0];
    if (!firstId) continue;

    const dirInfo = await resolveBeadsDirFromId(firstId);
    if (!dirInfo) continue;

    const { workDir, beadsDir } = dirInfo;

    // Batch fetch all beads in this group with a single bd show call
    const shortIds = ids.map(stripBeadPrefix);
    const groupPromise = (async () => {
      const result = await execBd<BeadsIssue[]>(
        ["show", ...shortIds, "-q", "--json"],
        { cwd: workDir, beadsDir }
      );
      if (result.success && result.data) {
        for (const bead of result.data) {
          titles.set(bead.id, bead.title);
        }
      }
    })();

    fetchPromises.push(groupPromise);
  }

  await Promise.all(fetchPromises);
  return titles;
}

export async function collectAgentSnapshot(
  extraIdentities: string[] = []
): Promise<AgentSnapshot> {
  const topology = getTopology();
  const sessions = await listTmuxSessions();
  const foundIssues: { issue: BeadsIssue; sourceProject: string | null }[] = [];
  const beadsDirs = await listAllBeadsDirs();

  for (const dirInfo of beadsDirs) {
    const agents = await fetchAgents(dirInfo.workDir, dirInfo.path);
    foundIssues.push(...agents.map((issue) => ({ issue, sourceProject: dirInfo.project })));
  }

  if (foundIssues.length === 0) {
    // If no agents found at all, we'll rely on tmux synthesis later
  }

  const identities = new Set(extraIdentities.map(addressToIdentity));
  const baseAgents: AgentRuntimeInfo[] = [];

  for (const { issue, sourceProject } of foundIssues) {
    const parsed = parseAgentBeadId(issue.id, sourceProject);
    const fields = parseAgentFields(issue.description);
    const role = topology.normalizeRole(fields.roleType ?? parsed?.role ?? "");
    if (!role) continue;

    const project = fields.project ?? parsed?.project ?? null;
    const name =
      parsed?.name ??
      (topology.isInfrastructure(role)
        ? role
        : issue.title || role);
    const address = topology.buildAddress(role, project, name);
    if (!address) continue;

    const identity = addressToIdentity(address);
    // Skip if we've already seen this agent (dedup across beads directories)
    if (identities.has(identity)) continue;
    identities.add(identity);

    const sessionInfo = topology.getSessionInfo(role, project, name);
    const sessionName = sessionInfo?.name ?? null;
    const running = sessionName ? sessions.has(sessionName) : false;
    const state = issue.agent_state ?? fields.agentState;
    const hookBead = issue.hook_bead ?? fields.hookBead;

    const agentEntry: AgentRuntimeInfo = {
      id: issue.id,
      name,
      role,
      project,
      address,
      sessionName,
      running,
    };
    if (state) agentEntry.state = state;
    if (hookBead) agentEntry.hookBead = hookBead;
    baseAgents.push(agentEntry);
  }

  // Synthesize agents from running tmux sessions if not found in beads
  for (const sessionName of sessions) {
    let role: string | null = null;
    let name: string | null = null;

    if (sessionName.startsWith("agent-")) {
      role = "agent";
      name = sessionName.slice("agent-".length);
    }

    if (role && name) {
      const address = topology.buildAddress(role, null, name);
      if (address) {
        const identity = addressToIdentity(address);
        if (!identities.has(identity)) {
          identities.add(identity);
          baseAgents.push({
            id: address,
            name,
            role,
            project: null,
            address,
            sessionName,
            running: true,
            state: "running",
          });
        }
      }
    }
  }

  // Collect all hook bead IDs and fetch their titles
  const hookBeadIds = baseAgents
    .filter((a) => a.hookBead)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    .map((a) => a.hookBead!);
  const uniqueHookBeadIds = [...new Set(hookBeadIds)];

  // Fetch hook bead titles, routing each to the correct beads database by prefix
  const hookBeadTitles = await fetchBeadTitles(uniqueHookBeadIds);

  const agents: AgentRuntimeInfo[] = baseAgents.map((agent) => {
    const result: AgentRuntimeInfo = { ...agent };

    // Add hook bead title for current task display
    if (agent.hookBead) {
      const title = hookBeadTitles.get(agent.hookBead);
      if (title) result.hookBeadTitle = title;
    }

    return result;
  });

  return { agents };
}
