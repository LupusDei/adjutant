import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { join } from "path";
import { execBd, stripBeadPrefix, type BeadsIssue } from "./bd-client.js";
import {
  extractBeadPrefix,
  listAllBeadsDirs,
  resolveBeadsDirFromId,
  resolveTownRoot,
} from "./gastown-workspace.js";
import {
  addressToIdentity,
  parseAgentBeadId,
  parseAgentFields,
  sessionNameForAgent,
} from "./gastown-utils.js";
import { listTmuxSessions } from "./tmux.js";
import { buildMailIndex, listMailIssues, type MailIndexEntry } from "./mail-data.js";

export interface AgentRuntimeInfo {
  id: string;
  name: string;
  role: string;
  rig: string | null;
  address: string;
  sessionName: string | null;
  running: boolean;
  state?: string;
  hookBead?: string;
  hookBeadTitle?: string;
  unreadMail: number;
  firstSubject?: string;
  firstFrom?: string;
  branch?: string;
}

export interface AgentSnapshot {
  agents: AgentRuntimeInfo[];
  mailIndex: Map<string, MailIndexEntry>;
}

function normalizeRole(role: string): string {
  const lower = role.toLowerCase();
  if (lower === "coordinator") return "mayor";
  if (lower === "health-check") return "deacon";
  return lower;
}

function buildAgentAddress(role: string, rig: string | null, name: string | null): string | null {
  switch (role) {
    case "mayor":
    case "deacon":
      return `${role}/`;
    case "witness":
    case "refinery":
      return rig ? `${rig}/${role}` : null;
    case "crew":
      return rig && name ? `${rig}/crew/${name}` : null;
    case "polecat":
      return rig && name ? `${rig}/${name}` : null;
    default:
      return null;
  }
}

/**
 * Gets the current git branch for a polecat from their worktree.
 * Returns undefined if the worktree doesn't exist or git fails.
 */
function getPolecatBranch(rig: string, polecatName: string): string | undefined {
  try {
    const townRoot = resolveTownRoot();
    // Polecat worktrees are at: {townRoot}/{rig}/polecats/{name}/{rig}/
    const worktreePath = join(townRoot, rig, "polecats", polecatName, rig);

    if (!existsSync(worktreePath)) {
      return undefined;
    }

    const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    return branch || undefined;
  } catch {
    return undefined;
  }
}

async function fetchAgents(cwd: string, beadsDir: string): Promise<BeadsIssue[]> {
  const issues: BeadsIssue[] = [];

  // Fetch active agents (default status=open)
  const openResult = await execBd<BeadsIssue[]>(
    ["list", "--type=agent", "--json"],
    { cwd, beadsDir }
  );
  if (openResult.success && openResult.data) {
    issues.push(...openResult.data);
  }

  // Fetch tombstone agents (polecats often use this status)
  const tombstoneResult = await execBd<BeadsIssue[]>(
    ["list", "--type=agent", "--status=tombstone", "--json"],
    { cwd, beadsDir }
  );
  if (tombstoneResult.success && tombstoneResult.data) {
    issues.push(...tombstoneResult.data);
  }

  return issues;
}

/**
 * Fetches bead titles for a list of bead IDs.
 * Routes each bead to the correct beads database based on its prefix.
 * Returns a map of beadId -> title.
 */
async function fetchBeadTitles(
  beadIds: string[],
  townRoot: string
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

    const dirInfo = resolveBeadsDirFromId(firstId, townRoot);
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
  townRoot: string,
  extraIdentities: string[] = []
): Promise<AgentSnapshot> {
  const sessions = await listTmuxSessions();
  const foundIssues: { issue: BeadsIssue; sourceRig: string | null }[] = [];
  const beadsDirs = await listAllBeadsDirs();

  for (const dirInfo of beadsDirs) {
    const agents = await fetchAgents(dirInfo.workDir, dirInfo.path);
    foundIssues.push(...agents.map((issue) => ({ issue, sourceRig: dirInfo.rig })));
  }

  if (foundIssues.length === 0) {
    // If no agents found at all, we'll rely on tmux synthesis later
  }

  const identities = new Set(extraIdentities.map(addressToIdentity));
  const baseAgents: Omit<AgentRuntimeInfo, "unreadMail" | "firstSubject">[] = [];

  for (const { issue, sourceRig } of foundIssues) {
    const parsed = parseAgentBeadId(issue.id, sourceRig);
    const fields = parseAgentFields(issue.description);
    const role = normalizeRole(fields.roleType ?? parsed?.role ?? "");
    if (!role) continue;

    const rig = fields.rig ?? parsed?.rig ?? null;
    const name =
      parsed?.name ??
      (role === "mayor" || role === "deacon" || role === "witness" || role === "refinery"
        ? role
        : issue.title || role);
    const address = buildAgentAddress(role, rig, name);
    if (!address) continue;

    const identity = addressToIdentity(address);
    // Skip if we've already seen this agent (dedup across beads directories)
    if (identities.has(identity)) continue;
    identities.add(identity);

    const sessionName = sessionNameForAgent(role, rig, name);
    const running = sessionName ? sessions.has(sessionName) : false;
    const state = issue.agent_state ?? fields.agentState;
    const hookBead = issue.hook_bead ?? fields.hookBead;

    const agentEntry: Omit<AgentRuntimeInfo, "unreadMail" | "firstSubject"> = {
      id: issue.id,
      name,
      role,
      rig,
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
    let rig: string | null = null;
    let role: string | null = null;
    let name: string | null = null;

    if (sessionName === "hq-mayor") {
      role = "mayor";
      name = "mayor";
    } else if (sessionName === "hq-deacon") {
      role = "deacon";
      name = "deacon";
    } else if (sessionName.startsWith("gt-")) {
      const parts = sessionName.split("-");
      // gt-{rig}-witness
      // gt-{rig}-refinery
      // gt-{rig}-crew-{name}
      // gt-{rig}-{name} (polecat)
      if (parts.length >= 3 && parts[1] && parts[2]) {
        rig = parts[1];
        const typeOrName = parts[2];
        
        if (typeOrName === "witness") {
          role = "witness";
          name = "witness";
        } else if (typeOrName === "refinery") {
          role = "refinery";
          name = "refinery";
        } else if (typeOrName === "crew" && parts.length >= 4) {
          role = "crew";
          name = parts.slice(3).join("-");
        } else {
          // Assume polecat if not one of the above known types
          role = "polecat";
          name = parts.slice(2).join("-");
        }
      }
    }

    if (role && name) {
      const address = buildAgentAddress(role, rig, name);
      if (address) {
        const identity = addressToIdentity(address);
        // Check if already found via beads
        if (!identities.has(identity)) {
          identities.add(identity);
          baseAgents.push({
            id: address, // Fallback ID
            name,
            role,
            rig,
            address,
            sessionName,
            running: true,
            state: "running", // It has a session, so it's running
          });
        }
      }
    }
  }

  const mailIssues = await listMailIssues(townRoot);
  const mailIndex = buildMailIndex(mailIssues, Array.from(identities));

  // Collect all hook bead IDs and fetch their titles
  const hookBeadIds = baseAgents
    .filter((a) => a.hookBead)
    .map((a) => a.hookBead as string);
  const uniqueHookBeadIds = [...new Set(hookBeadIds)];

  // Fetch hook bead titles, routing each to the correct beads database by prefix
  const hookBeadTitles = await fetchBeadTitles(uniqueHookBeadIds, townRoot);

  const agents: AgentRuntimeInfo[] = baseAgents.map((agent) => {
    const mailInfo = mailIndex.get(addressToIdentity(agent.address));
    const result: AgentRuntimeInfo = {
      ...agent,
      unreadMail: mailInfo?.unread ?? 0,
    };
    if (mailInfo?.firstSubject) result.firstSubject = mailInfo.firstSubject;

    // Add hook bead title for current task display
    if (agent.hookBead) {
      const title = hookBeadTitles.get(agent.hookBead);
      if (title) result.hookBeadTitle = title;
    }

    // Get branch for polecats
    if (agent.role === "polecat" && agent.rig) {
      const branch = getPolecatBranch(agent.rig, agent.name);
      if (branch) result.branch = branch;
    }

    return result;
  });

  return { agents, mailIndex };
}
