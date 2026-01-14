import { existsSync } from "fs";
import { join } from "path";
import { execBd, resolveBeadsDir, type BeadsIssue } from "./bd-client.js";
import { listRigNames } from "./gastown-workspace.js";
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
  unreadMail: number;
  firstSubject?: string;
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

export async function collectAgentSnapshot(
  townRoot: string,
  extraIdentities: string[] = []
): Promise<AgentSnapshot> {
  const sessions = await listTmuxSessions();
  const issues: BeadsIssue[] = [];
  const errors: string[] = [];

  const townBeadsDir = resolveBeadsDir(townRoot);
  const townAgentsResult = await execBd<BeadsIssue[]>(
    ["list", "--label=gt:agent", "--json"],
    { cwd: townRoot, beadsDir: townBeadsDir }
  );
  if (townAgentsResult.success) {
    issues.push(...(townAgentsResult.data ?? []));
  } else {
    errors.push(townAgentsResult.error?.message ?? "Failed to list town agent beads");
  }

  const rigNames = await listRigNames(townRoot);
  for (const rigName of rigNames) {
    const rigPath = join(townRoot, rigName);
    if (!existsSync(rigPath)) continue;
    const rigResult = await execBd<BeadsIssue[]>(
      ["list", "--label=gt:agent", "--json"],
      { cwd: rigPath, beadsDir: resolveBeadsDir(rigPath) }
    );
    if (rigResult.success) {
      issues.push(...(rigResult.data ?? []));
    } else if (rigResult.error?.message) {
      errors.push(rigResult.error.message);
    }
  }

  if (issues.length === 0 && errors.length > 0) {
    throw new Error(errors[0]);
  }

  const identities = new Set(extraIdentities.map(addressToIdentity));
  const baseAgents: Omit<AgentRuntimeInfo, "unreadMail" | "firstSubject">[] = [];

  for (const issue of issues) {
    const parsed = parseAgentBeadId(issue.id);
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

    const sessionName = sessionNameForAgent(role, rig, name);
    const running = sessionName ? sessions.has(sessionName) : false;
    const state = issue.agent_state ?? fields.agentState;
    const hookBead = issue.hook_bead ?? fields.hookBead;

    const identity = addressToIdentity(address);
    identities.add(identity);

    baseAgents.push({
      id: issue.id,
      name,
      role,
      rig,
      address,
      sessionName,
      running,
      state,
      hookBead,
    });
  }

  const mailIssues = await listMailIssues(townRoot);
  const mailIndex = buildMailIndex(mailIssues, Array.from(identities));

  const agents = baseAgents.map((agent) => {
    const mailInfo = mailIndex.get(addressToIdentity(agent.address));
    return {
      ...agent,
      unreadMail: mailInfo?.unread ?? 0,
      firstSubject: mailInfo?.firstSubject,
    };
  });

  return { agents, mailIndex };
}
