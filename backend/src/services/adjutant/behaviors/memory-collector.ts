import type { AdjutantBehavior, BehaviorEvent } from "../behavior-registry.js";
import type { AdjutantState } from "../state-store.js";
import type { CommunicationManager } from "../communication.js";
import type { MemoryStore } from "../memory-store.js";
import type { MailReceivedEvent, BeadClosedEvent } from "../../event-bus.js";
import { getEventBus } from "../../event-bus.js";

// ============================================================================
// Correction detection patterns
// ============================================================================

interface CorrectionPattern {
  regex: RegExp;
  type: "prohibition" | "mandate" | "reminder";
}

const CORRECTION_PATTERNS: CorrectionPattern[] = [
  // Prohibition: "don't/do not/never/stop" + verb
  {
    regex: /\b(?:don'?t|do not|never|stop)\s+(?:do|us|mak|creat|add|runn?|skip|writ|put|set|send|generat|spawn|push|commit)\w*/i,
    type: "prohibition",
  },
  // Mandate: "always/must/should" + verb
  {
    regex: /\b(?:always|must|should)\s+(?:use|do|include|check|run|add|assign|write|set|test|verify|ensure)/i,
    type: "mandate",
  },
  // Reminder: "remember/note/important" + connector
  {
    regex: /\b(?:remember|note|important)\s*(?:that|:)/i,
    type: "reminder",
  },
];

// ============================================================================
// Category inference from content keywords
// ============================================================================

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  operational: ["bead", "assign", "status", "commit", "push", "merge", "sync", "deploy", "workflow", "process"],
  technical: ["type", "strict", "test", "code", "function", "import", "module", "typescript", "react", "sql", "api"],
  coordination: ["agent", "team", "spawn", "delegate", "communicate", "message", "nudge", "assign"],
  project: ["spec", "plan", "epic", "task", "feature", "design", "architecture", "pattern"],
};

function inferCategory(content: string): string {
  const lower = content.toLowerCase();
  let bestCategory = "operational";
  let bestScore = 0;

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  return bestCategory;
}

/**
 * Infer a topic from the content by finding the most relevant keyword.
 *
 * Scores all categories by match count, picks the best category,
 * then returns the longest matching keyword from that category
 * (longer keywords are more specific and thus more relevant).
 */
function inferTopic(content: string): string {
  const lower = content.toLowerCase();

  let bestCategory = "";
  let bestScore = 0;
  let bestKeyword = "";

  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    let score = 0;
    let longestMatch = "";
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        score++;
        if (kw.length > longestMatch.length) {
          longestMatch = kw;
        }
      }
    }
    if (score > bestScore || (score === bestScore && longestMatch.length > bestKeyword.length)) {
      bestScore = score;
      bestCategory = category;
      bestKeyword = longestMatch;
    }
  }

  if (bestScore === 0) return "general";
  return `${bestCategory}-${bestKeyword}`;
}

// ============================================================================
// Memory Collector Behavior
// ============================================================================

/**
 * Create the memory-collector behavior.
 *
 * This behavior listens for:
 * - mail:received (from user): detects corrections using regex patterns
 * - bead:closed: captures bead outcomes for learning
 * - agent:status_changed: tracks agent failure patterns
 *
 * Uses closure to capture the MemoryStore dependency.
 */
export function createMemoryCollector(memoryStore: MemoryStore): AdjutantBehavior {
  return {
    name: "memory-collector",
    triggers: ["mail:received", "bead:closed", "agent:status_changed"],

    shouldAct(_event: BehaviorEvent, _state: AdjutantState): boolean {
      return true;
    },

    async act(event: BehaviorEvent, state: AdjutantState, _comm: CommunicationManager): Promise<void> {
      switch (event.name) {
        case "mail:received":
          handleMailReceived(event, state, memoryStore);
          break;
        case "bead:closed":
          handleBeadClosed(event, state, memoryStore);
          break;
        case "agent:status_changed":
          // Handled in adj-053.2.2 (bead outcome capture)
          break;
      }
    },
  };
}

/**
 * Handle incoming mail for correction detection.
 * Only processes messages from the user.
 */
function handleMailReceived(
  event: BehaviorEvent,
  state: AdjutantState,
  memoryStore: MemoryStore,
): void {
  const data = event.data as MailReceivedEvent;

  // Only detect corrections from user messages
  if (data.from !== "user") {
    return;
  }

  const body = data.preview || "";
  if (!body) return;

  // Check each correction pattern
  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.regex.exec(body);
    if (!match) continue;

    const category = inferCategory(body);
    const topic = inferTopic(body);
    const matchedText = match[0];

    // Check for similar existing learnings (dedup)
    const similar = memoryStore.findSimilarLearnings(topic, body);
    if (similar.length > 0) {
      const existing = similar[0]!;
      // Reinforce the most relevant existing learning
      memoryStore.reinforceLearning(existing.id);

      // Check for similar correction and increment recurrence
      const existingCorrection = memoryStore.findSimilarCorrection(pattern.type, matchedText);
      if (existingCorrection) {
        memoryStore.incrementRecurrence(existingCorrection.id);
      }

      state.logDecision({
        behavior: "memory-collector",
        action: "correction_reinforced",
        target: `learning:${existing.id}`,
        reason: `Matched pattern "${matchedText}" — reinforced existing learning`,
      });
      return;
    }

    // Create new learning
    const learning = memoryStore.insertLearning({
      category,
      topic,
      content: body,
      sourceType: "user_correction",
      sourceRef: data.id,
      confidence: 0.6,
    });

    // Create correction record
    memoryStore.insertCorrection({
      messageId: data.id,
      correctionType: pattern.type,
      pattern: matchedText,
      description: body,
      learningId: learning.id,
    });

    // Emit correction:detected event
    try {
      getEventBus().emit("correction:detected", {
        messageId: data.id,
        from: data.from,
        pattern: matchedText,
        body,
      });
    } catch {
      // EventBus may not be initialized in tests
    }

    // Emit learning:created event
    try {
      getEventBus().emit("learning:created", {
        learningId: learning.id,
        category,
        topic,
        sourceType: "user_correction",
      });
    } catch {
      // EventBus may not be initialized in tests
    }

    state.logDecision({
      behavior: "memory-collector",
      action: "correction_detected",
      target: `learning:${learning.id}`,
      reason: `Matched pattern "${matchedText}" in message from ${data.from}`,
    });

    // Only capture the first matching pattern per message
    return;
  }
}

/**
 * Handle bead:closed events to capture outcomes.
 *
 * Detects failure patterns by checking the decisions log:
 * - Bead reopened: decisions with action "bead_reopened" targeting this bead
 * - Multiple assignments: 3+ "assign" decisions targeting this bead
 */
function handleBeadClosed(
  event: BehaviorEvent,
  state: AdjutantState,
  memoryStore: MemoryStore,
): void {
  const data = event.data as BeadClosedEvent;

  // Log the closure
  state.logDecision({
    behavior: "memory-collector",
    action: "bead_outcome_noted",
    target: data.id,
    reason: `Bead "${data.title}" closed at ${data.closedAt}`,
  });

  // Check decisions log for failure patterns
  const recentDecisions = state.getRecentDecisions(200);
  const beadDecisions = recentDecisions.filter((d) => d.target === data.id);

  // Check 1: Was this bead reopened?
  const wasReopened = beadDecisions.some((d) => d.action === "bead_reopened");

  // Check 2: Multiple assignments (3+ assigns = trouble)
  const assignCount = beadDecisions.filter((d) => d.action === "assign").length;
  const hadMultipleAssignments = assignCount >= 3;

  if (wasReopened) {
    memoryStore.insertLearning({
      category: "operational",
      topic: "bead-quality",
      content: `Bead ${data.id} ("${data.title}") was reopened after initial closure — indicates incomplete or incorrect work on first attempt.`,
      sourceType: "bead_outcome",
      sourceRef: data.id,
      confidence: 0.6,
    });

    state.logDecision({
      behavior: "memory-collector",
      action: "failure_pattern_detected",
      target: data.id,
      reason: "Bead was reopened — created learning about reopened bead pattern",
    });
  }

  if (hadMultipleAssignments) {
    memoryStore.insertLearning({
      category: "operational",
      topic: "bead-assignment",
      content: `Bead ${data.id} ("${data.title}") required multiple reassignments (${assignCount} assignments) — indicates task difficulty or agent capability mismatch.`,
      sourceType: "bead_outcome",
      sourceRef: data.id,
      confidence: 0.5,
    });

    state.logDecision({
      behavior: "memory-collector",
      action: "failure_pattern_detected",
      target: data.id,
      reason: `Bead had ${assignCount} assignments — created learning about multiple reassignment pattern`,
    });
  }
}
