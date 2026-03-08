import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import { spawnAgent } from "../../agent-spawner-service.js";
import { execBd } from "../../bd-client.js";

/** Cooldown window: don't spawn within 60 seconds of the last spawn */
const COOLDOWN_MS = 60_000;

/** Default maximum number of concurrent agents */
const DEFAULT_MAX_AGENTS = 5;

/** Statuses that count as "active" (connected and participating) */
const ACTIVE_STATUSES = new Set(["working", "idle", "connected"]);

/** Shape of a bead returned by `bd ready --json` */
interface ReadyBead {
  id: string;
  title: string;
  priority: number;
  type: string;
  parent?: string;
}

/**
 * Creates the agent-spawner behavior.
 *
 * Automatically spawns new agents when:
 * 1. There are unassigned ready beads
 * 2. No idle agents are available to take them
 * 3. We haven't hit the max concurrent agent cap
 *
 * IMPORTANT: Does NOT trigger on bead:assigned (adj-ud2f) to avoid
 * spawn-after-assign feedback loops. Only triggers on bead:created
 * (new work arrived) and bead:closed (resources freed).
 */
export function createAgentSpawnerBehavior(projectPath: string): AdjutantBehavior {
  /** Concurrency guard (adj-icqs fix) */
  let spawning = false;

  return {
    name: "agent-spawner",
    triggers: ["bead:created", "bead:closed"],
    schedule: "*/10 * * * *",

    shouldAct(_event: BehaviorEvent, state: AdjutantState): boolean {
      // Check cooldown: don't spawn within 60s of the last spawn
      const lastSpawnAt = state.getMeta("agent-spawner:last-spawn-at");
      if (lastSpawnAt) {
        const elapsed = Date.now() - new Date(lastSpawnAt).getTime();
        if (elapsed < COOLDOWN_MS) return false;
      }

      // Let act() do the heavy checking
      return true;
    },

    async act(_event: BehaviorEvent, state: AdjutantState, comm: CommunicationManager): Promise<void> {
      // Concurrency guard: prevent double-spawning
      if (spawning) return;
      spawning = true;

      try {
        // 1. Get all agent profiles
        const profiles = state.getAllAgentProfiles();

        // 2. Count active agents: status in [working, idle, connected] AND not disconnected
        const activeAgents = profiles.filter(
          (p) => ACTIVE_STATUSES.has(p.lastStatus) && p.disconnectedAt === null,
        );
        const activeCount = activeAgents.length;

        // 3. Get max from config
        const maxStr = state.getMeta("max_concurrent_agents");
        const maxAgents = maxStr !== null ? parseInt(maxStr, 10) : DEFAULT_MAX_AGENTS;

        // 4. If at capacity, return early
        if (activeCount >= maxAgents) return;

        // 5. Check if any idle agents exist (connected, not disconnected)
        const hasIdleAgent = activeAgents.some(
          (p) => p.lastStatus === "idle" && p.connectedAt !== null && p.disconnectedAt === null,
        );

        // 6. If idle agents exist, work-assigner will handle assignment — no need to spawn
        if (hasIdleAgent) return;

        // 7. Check for unassigned ready beads
        const result = await execBd<ReadyBead[]>(["ready", "--json"]);
        if (!result.success || !result.data || result.data.length === 0) return;

        const readyBeads = result.data;

        // 8. Build an initial prompt so the agent knows what to work on
        const topBeads = readyBeads
          .sort((a, b) => a.priority - b.priority)
          .slice(0, 3);
        const beadList = topBeads
          .map((b) => `- ${b.id} (P${b.priority}): ${b.title}`)
          .join("\n");

        const initialPrompt = [
          `You are an auto-spawned worker agent. There are ${readyBeads.length} ready bead(s) waiting for work.`,
          ``,
          `Top priority beads:`,
          beadList,
          ``,
          `Pick the highest-priority bead and start working on it:`,
          `1. Run \`bd show <id>\` to read the bead details`,
          `2. Run \`bd update <id> --assignee=<your-name> --status=in_progress\` to claim it`,
          `3. Report status via MCP: set_status({ status: "working", task: "..." })`,
          `4. Do the work, run build + tests, commit, and push`,
          `5. Run \`bd close <id>\` when done`,
          `6. Check \`bd ready\` for more work`,
        ].join("\n");

        // 9. Spawn a new agent
        const agentName = `worker-${Date.now()}`;
        const spawnResult = await spawnAgent({
          name: agentName,
          projectPath,
          mode: "swarm",
          initialPrompt,
        });

        if (spawnResult.success) {
          // Log spawn in state store
          state.logSpawn(agentName, "Ready beads available, no idle agents", readyBeads[0]?.id);

          // Update cooldown
          state.setMeta("agent-spawner:last-spawn-at", new Date().toISOString());

          // Queue routine message
          comm.queueRoutine("Spawned agent " + agentName + " — ready beads available with no idle workers");

          // Log decision
          state.logDecision({
            behavior: "agent-spawner",
            action: "spawn",
            target: agentName,
            reason: `Spawned ${agentName} — ${readyBeads.length} ready bead(s), no idle agents, ${activeCount}/${maxAgents} active`,
          });
        } else {
          // Send important message on failure
          comm.sendImportant("Failed to spawn agent: " + (spawnResult.error ?? "unknown error"));

          // Log decision with failure reason
          state.logDecision({
            behavior: "agent-spawner",
            action: "spawn",
            target: agentName,
            reason: `Failed to spawn ${agentName}: ${spawnResult.error ?? "unknown error"}`,
          });
        }
      } finally {
        spawning = false;
      }
    },
  };
}
