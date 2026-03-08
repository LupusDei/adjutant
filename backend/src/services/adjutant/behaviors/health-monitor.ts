import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import { isAdjutantAlive, spawnAdjutant } from "../../adjutant-spawner.js";

export function createHealthMonitorBehavior(projectPath: string): AdjutantBehavior {
  return {
    name: "health-monitor",
    triggers: [],
    schedule: "*/5 * * * *",

    shouldAct(_event: BehaviorEvent, _state: unknown): boolean {
      return true;
    },

    async act(_event: BehaviorEvent, state: unknown, comm: unknown): Promise<void> {
      const adjState = state as AdjutantState;
      const adjComm = comm as CommunicationManager;

      const alive = await isAdjutantAlive();

      if (alive) {
        adjState.setMeta("adjutant_last_healthy", new Date().toISOString());
        return;
      }

      // Not alive — attempt respawn
      adjState.logDecision({
        behavior: "health-monitor",
        action: "respawn_adjutant",
        target: "adjutant-coordinator",
        reason: "Adjutant agent tmux session not found",
      });

      await spawnAdjutant(projectPath);

      // Verify respawn succeeded
      const respawned = await isAdjutantAlive();
      if (respawned) {
        adjState.setMeta("adjutant_last_respawn", new Date().toISOString());
        adjComm.queueRoutine("Health monitor: Adjutant agent was down, respawned successfully");
      } else {
        await adjComm.sendImportant(
          "\u26a0\ufe0f Health monitor: Adjutant agent is down and respawn failed. Manual intervention may be needed.",
        );
      }
    },
  };
}
