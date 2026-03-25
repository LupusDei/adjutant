import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { MemoryStore } from "../memory-store.js";
import type { ProposalStore } from "../../proposal-store.js";
import type { LearningCreatedEvent } from "../../event-bus.js";

/** Minimum number of learnings in a topic before proposing improvements */
const MIN_LEARNINGS_FOR_PROPOSAL = 5;

/** Minimum average confidence threshold for a topic to qualify */
const MIN_AVG_CONFIDENCE = 0.6;

/** Debounce window: only 1 proposal per topic per this many milliseconds */
const DEBOUNCE_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** Metadata key prefix for per-topic debounce timestamps */
const DEBOUNCE_META_PREFIX = "self_improver_debounce_";

/** Metadata key for weekly review gate timestamp */
const WEEKLY_RUN_META_KEY = "self_improver_last_weekly_run";

/** Categories that map to 'engineering' proposal type */
const ENGINEERING_CATEGORIES = new Set(["technical", "project"]);

/**
 * Determine the proposal type from the majority category of learnings.
 * 'technical' and 'project' -> 'engineering'; everything else -> 'product'.
 */
function inferProposalType(learnings: { category: string }[]): "product" | "engineering" {
  let engineeringCount = 0;
  for (const l of learnings) {
    if (ENGINEERING_CATEGORIES.has(l.category)) {
      engineeringCount++;
    }
  }
  return engineeringCount > learnings.length / 2 ? "engineering" : "product";
}

/**
 * Create the self-improver behavior.
 *
 * This behavior:
 * - Triggers on learning:created events
 * - Runs weekly on a cron schedule
 * - When a topic accumulates 5+ learnings with avg confidence > 0.6,
 *   creates a proposal for process improvement
 * - Debounces: only 1 proposal per topic per week (persisted via state metadata)
 */
export function createSelfImprover(
  memoryStore: MemoryStore,
  proposalStore: ProposalStore,
): AdjutantBehavior {
  function isDebounced(topic: string, state: AdjutantState): boolean {
    const raw = state.getMeta(`${DEBOUNCE_META_PREFIX}${topic}`);
    if (raw === null) return false;
    const lastTime = parseInt(raw, 10);
    if (isNaN(lastTime)) return false;
    return Date.now() - lastTime < DEBOUNCE_MS;
  }

  function markProposed(topic: string, state: AdjutantState): void {
    state.setMeta(`${DEBOUNCE_META_PREFIX}${topic}`, String(Date.now()));
  }

  /**
   * Check a specific topic and create a proposal if it qualifies.
   */
  function checkTopicAndPropose(
    topic: string,
    state: AdjutantState,
  ): boolean {
    if (isDebounced(topic, state)) {
      return false;
    }

    const learnings = memoryStore.queryLearnings({ topic });
    if (learnings.length < MIN_LEARNINGS_FOR_PROPOSAL) {
      return false;
    }

    const avgConfidence = learnings.reduce((sum, l) => sum + l.confidence, 0) / learnings.length;
    if (avgConfidence < MIN_AVG_CONFIDENCE) {
      return false;
    }

    // Build proposal description from accumulated learnings
    const learningsSummary = learnings
      .slice(0, 10)
      .map((l, i) => `${i + 1}. ${l.content}`)
      .join("\n");

    const proposalType = inferProposalType(learnings);

    const proposal = proposalStore.insertProposal({
      author: "adjutant-core",
      title: `Process improvement: ${topic} (${learnings.length} learnings)`,
      description: [
        `## Topic: ${topic}`,
        "",
        `Based on ${learnings.length} accumulated learnings with average confidence ${avgConfidence.toFixed(2)}:`,
        "",
        learningsSummary,
        "",
        "### Suggested Action",
        `Review and consolidate these ${learnings.length} learnings into actionable process improvements.`,
      ].join("\n"),
      type: proposalType,
      project: "adjutant",
    });

    markProposed(topic, state);

    state.logDecision({
      behavior: "self-improver",
      action: "proposal_created",
      target: proposal.id,
      reason: `Topic "${topic}" has ${learnings.length} learnings (avg confidence: ${avgConfidence.toFixed(2)})`,
    });

    return true;
  }

  /**
   * Weekly review: check all topics with 5+ learnings.
   */
  function weeklyReview(state: AdjutantState): void {
    const topicFreqs = memoryStore.getTopicFrequency();

    for (const { topic, count } of topicFreqs) {
      if (count >= MIN_LEARNINGS_FOR_PROPOSAL) {
        checkTopicAndPropose(topic, state);
      }
    }
  }

  return {
    name: "self-improver",
    triggers: ["learning:created"],
    schedule: "0 * * * *", // Hourly (actual weekly logic handled in act via meta check)

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-unused-vars
    async act(event: BehaviorEvent, state: AdjutantState, _comm: CommunicationManager): Promise<void> {
      const data = event.data as Record<string, unknown>;

      // Cron tick: run weekly review (gated to once per 7 days)
      if (data["cronTick"] === true) {
        const lastWeeklyRun = state.getMeta(WEEKLY_RUN_META_KEY);
        if (lastWeeklyRun !== null) {
          const elapsed = Date.now() - parseInt(lastWeeklyRun, 10);
          if (!isNaN(elapsed) && elapsed < DEBOUNCE_MS) {
            return; // Already ran within the past week
          }
        }
        state.setMeta(WEEKLY_RUN_META_KEY, String(Date.now()));
        weeklyReview(state);
        return;
      }

      // learning:created event: check the specific topic
      const learningEvent = event.data as LearningCreatedEvent;
      if (learningEvent.topic) {
        checkTopicAndPropose(learningEvent.topic, state);
      }
    },
  };
}
