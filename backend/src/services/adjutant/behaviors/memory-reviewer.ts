/**
 * Memory Reviewer Behavior for Adjutant.
 *
 * Two modes of operation:
 * 1. Startup Review: On first fire after startup (no last_review_at meta),
 *    query top learnings by confidence*recency and recent retro action items,
 *    then inject as "Lessons to remember" into the next heartbeat.
 *
 * 2. Weekly Review: Prune stale learnings, decay confidence for unreinforced
 *    learnings, escalate recurring corrections, and generate a weekly summary.
 *
 * Bead: adj-053.4.1
 */

import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { MemoryStore, Learning } from "../memory-store.js";

/** Confidence decay per week for unreinforced learnings */
const CONFIDENCE_DECAY_RATE = 0.05;

/** Learnings with lastValidatedAt older than this are considered unreinforced */
const UNREINFORCED_THRESHOLD_DAYS = 7;

/** Maximum age in days for stale learning pruning */
const PRUNE_MAX_AGE_DAYS = 90;

/** Recurrence threshold for correction escalation */
const RECURRENCE_ESCALATION_THRESHOLD = 2;

/**
 * Parse JSON array from a string | null field, returning empty array on failure.
 * Used for retrospective fields (wentWell, wentWrong, actionItems) which are
 * stored as JSON strings in the database.
 */
function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Create a memory-reviewer behavior.
 *
 * Uses closure pattern to inject the MemoryStore dependency.
 */
export function createMemoryReviewer(memoryStore: MemoryStore): AdjutantBehavior {
  return {
    name: "memory-reviewer",
    triggers: ["agent:status_changed"],
    schedule: "0 0 * * 1", // Weekly on Monday midnight

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(
      _event: BehaviorEvent,
      state: AdjutantState,
      comm: CommunicationManager,
    ): Promise<void> {
      const lastReviewAt = state.getMeta("last_review_at");
      const lastWeeklyReviewAt = state.getMeta("last_weekly_review_at");

      if (!lastReviewAt) {
        // Startup review — first fire
        await performStartupReview(memoryStore, state, comm);
      } else if (shouldRunWeeklyReview(lastWeeklyReviewAt)) {
        // Weekly review — first weekly since startup, or 7+ days since last weekly
        await performWeeklyReview(memoryStore, state, comm);
      }
      // If weekly review ran recently (<7 days), skip silently
    },
  };
}

// ============================================================================
// Startup Review
// ============================================================================

async function performStartupReview(
  memoryStore: MemoryStore,
  state: AdjutantState,
  comm: CommunicationManager,
): Promise<void> {
  // Query top 10 learnings by confidence (recency weighting done by caller)
  const topLearnings = memoryStore.queryLearnings({
    minConfidence: 0.3,
    limit: 10,
  });

  // Sort by confidence * recency weight
  const now = Date.now();
  const scoredLearnings = topLearnings
    .map((l) => {
      const daysSinceCreated =
        (now - new Date(l.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      const recencyWeight = 1 / (1 + daysSinceCreated / 30);
      return { learning: l, score: l.confidence * recencyWeight };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Query last 3 retrospectives for recurring action items
  const recentRetros = memoryStore.getRecentRetrospectives(3);

  // Collect recurring action items (items that appear in multiple retros)
  // actionItems is stored as a JSON string in the DB
  const actionItemCounts = new Map<string, number>();
  for (const retro of recentRetros) {
    const items = parseJsonArray(retro.actionItems);
    for (const item of items) {
      actionItemCounts.set(item, (actionItemCounts.get(item) ?? 0) + 1);
    }
  }
  const recurringActionItems = [...actionItemCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([item]) => item);

  // Format the review message
  const lines: string[] = [];
  lines.push("## Lessons to remember this session");
  lines.push("");

  if (scoredLearnings.length > 0) {
    lines.push("**Top Learnings:**");
    for (const { learning } of scoredLearnings) {
      lines.push(
        `- [${learning.category}/${learning.topic}] ${learning.content} (confidence: ${learning.confidence.toFixed(2)})`,
      );
    }
    lines.push("");
  }

  if (recurringActionItems.length > 0) {
    lines.push("**Recurring Action Items (from recent retros):**");
    for (const item of recurringActionItems) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  if (scoredLearnings.length > 0 || recurringActionItems.length > 0) {
    comm.queueRoutine(lines.join("\n"));
  }

  // Update meta and log
  state.setMeta("last_review_at", new Date().toISOString());

  state.logDecision({
    behavior: "memory-reviewer",
    action: "startup_review",
    target: null,
    reason: `Reviewed ${scoredLearnings.length} learnings and ${recurringActionItems.length} recurring action items`,
  });
}

// ============================================================================
// Weekly Review
// ============================================================================

async function performWeeklyReview(
  memoryStore: MemoryStore,
  state: AdjutantState,
  comm: CommunicationManager,
): Promise<void> {
  // 1. Prune stale learnings (>90 days with confidence decay)
  const prunedCount = memoryStore.pruneStale(PRUNE_MAX_AGE_DAYS);

  // 2. Identify corrections with recurrence_count > 2 and escalate
  const unresolvedCorrections = memoryStore.getUnresolvedCorrections();
  const recurringCorrections = unresolvedCorrections.filter(
    (c) => c.recurrenceCount > RECURRENCE_ESCALATION_THRESHOLD,
  );

  if (recurringCorrections.length > 0) {
    const lines = [
      "**Recurring corrections detected** — these mistakes keep happening:",
      "",
    ];
    for (const c of recurringCorrections) {
      lines.push(
        `- ${c.description} (recurring ${c.recurrenceCount} times, type: ${c.correctionType})`,
      );
    }
    lines.push("");
    lines.push(
      "Consider creating a proposal to update rules or agent definitions to address these patterns.",
    );
    await comm.sendImportant(lines.join("\n"));
  }

  // 3. Decay confidence for unreinforced learnings
  const allLearnings = memoryStore.queryLearnings({ limit: 1000 });
  const now = Date.now();
  let decayedCount = 0;

  for (const learning of allLearnings) {
    if (!shouldDecayConfidence(learning, now)) continue;

    const newConfidence = Math.max(0, learning.confidence - CONFIDENCE_DECAY_RATE);
    memoryStore.updateLearning(learning.id, { confidence: newConfidence });
    decayedCount++;
  }

  // 4. Generate weekly summary
  const topicFreq = memoryStore.getTopicFrequency();
  const avgConfidence =
    allLearnings.length > 0
      ? allLearnings.reduce((sum, l) => sum + l.confidence, 0) / allLearnings.length
      : 0;

  const summaryLines = [
    "## Weekly Memory Review Summary",
    "",
    `- **Total learnings**: ${allLearnings.length}`,
    `- **Average confidence**: ${avgConfidence.toFixed(2)}`,
    `- **Pruned stale learnings**: ${prunedCount}`,
    `- **Confidence decayed**: ${decayedCount} unreinforced learnings`,
    `- **Recurring corrections**: ${recurringCorrections.length}`,
    `- **Unresolved corrections**: ${unresolvedCorrections.length}`,
  ];

  if (topicFreq.length > 0) {
    summaryLines.push("");
    summaryLines.push("**Top topics:**");
    for (const t of topicFreq.slice(0, 5)) {
      summaryLines.push(`- ${t.topic}: ${t.count} learnings`);
    }
  }

  await comm.sendImportant(summaryLines.join("\n"));

  // Update meta and log
  state.setMeta("last_weekly_review_at", new Date().toISOString());

  state.logDecision({
    behavior: "memory-reviewer",
    action: "weekly_review",
    target: null,
    reason: `Pruned ${prunedCount}, decayed ${decayedCount}, escalated ${recurringCorrections.length} recurring corrections`,
  });
}

// ============================================================================
// Helpers
// ============================================================================

/** Minimum number of days between weekly reviews */
const WEEKLY_REVIEW_INTERVAL_DAYS = 7;

/**
 * Determine if the weekly review should run.
 * Returns true if lastWeeklyReviewAt is null (never ran) or 7+ days have elapsed.
 */
function shouldRunWeeklyReview(lastWeeklyReviewAt: string | null): boolean {
  if (!lastWeeklyReviewAt) return true;

  const lastRan = new Date(lastWeeklyReviewAt).getTime();
  const daysSinceLast = (Date.now() - lastRan) / (1000 * 60 * 60 * 24);
  return daysSinceLast >= WEEKLY_REVIEW_INTERVAL_DAYS;
}

/**
 * Determine if a learning's confidence should be decayed.
 *
 * A learning is considered unreinforced if its most recent activity
 * (lastValidatedAt or updatedAt) is older than UNREINFORCED_THRESHOLD_DAYS.
 *
 * Falls back to updatedAt when lastValidatedAt is null, since
 * lastValidatedAt is not set by all code paths (e.g., reinforceLearning
 * only updates confidence and reinforcement_count).
 */
function shouldDecayConfidence(learning: Learning, nowMs: number): boolean {
  // Use lastValidatedAt if available, otherwise fall back to updatedAt
  const referenceDate = learning.lastValidatedAt ?? learning.updatedAt;
  const lastActivity = new Date(referenceDate).getTime();
  const daysSinceActivity = (nowMs - lastActivity) / (1000 * 60 * 60 * 24);

  return daysSinceActivity > UNREINFORCED_THRESHOLD_DAYS;
}
