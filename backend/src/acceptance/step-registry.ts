/**
 * Step Definition Registry — Maps GWT clause patterns to executable test functions.
 *
 * Provides defineGiven/defineWhen/defineThen to register step implementations,
 * and findStep/executeStep to look up and run them during test execution.
 *
 * Pattern matching:
 * - String patterns: exact match (case-insensitive)
 * - RegExp patterns: match with capture groups passed as args
 *
 * @module acceptance/step-registry
 */

import type { StepDefinition, StepType } from "./types.js";

// ============================================================================
// Internal State
// ============================================================================

/** Global step registry — mutable, cleared between test runs via clearSteps() */
let registry: StepDefinition[] = [];

// ============================================================================
// Registration API
// ============================================================================

/**
 * Register a Given step definition.
 *
 * @param pattern - String for exact match (case-insensitive) or RegExp for flexible matching
 * @param fn - Async function to execute; receives harness and any captured groups
 */
export function defineGiven(
  pattern: string | RegExp,
  fn: StepDefinition["fn"]
): void {
  registry.push({ type: "given", pattern, fn });
}

/**
 * Register a When step definition.
 *
 * @param pattern - String for exact match (case-insensitive) or RegExp for flexible matching
 * @param fn - Async function to execute; receives harness and any captured groups
 */
export function defineWhen(
  pattern: string | RegExp,
  fn: StepDefinition["fn"]
): void {
  registry.push({ type: "when", pattern, fn });
}

/**
 * Register a Then step definition.
 *
 * @param pattern - String for exact match (case-insensitive) or RegExp for flexible matching
 * @param fn - Async function to execute; receives harness and any captured groups
 */
export function defineThen(
  pattern: string | RegExp,
  fn: StepDefinition["fn"]
): void {
  registry.push({ type: "then", pattern, fn });
}

// ============================================================================
// Lookup & Execution API
// ============================================================================

/**
 * Find a matching step definition for a clause.
 *
 * @param type - Which GWT type to search ("given", "when", or "then")
 * @param text - The clause text to match against registered patterns
 * @returns The matching step and any captured args, or null if no match
 */
export function findStep(
  type: StepType,
  text: string
): { step: StepDefinition; args: string[] } | null {
  for (const step of registry) {
    if (step.type !== type) continue;

    if (typeof step.pattern === "string") {
      // Exact match, case-insensitive
      if (step.pattern.toLowerCase() === text.toLowerCase()) {
        return { step, args: [] };
      }
    } else {
      // RegExp match — capture groups become args
      const match = step.pattern.exec(text);
      if (match) {
        // Extract capture groups (skip the full match at index 0)
        const args = match.slice(1).filter((g): g is string => g !== undefined);
        return { step, args };
      }
    }
  }

  return null;
}

/**
 * Execute a step by finding and running its definition.
 *
 * @param type - Which GWT type to execute
 * @param text - The clause text to match
 * @param harness - The test harness instance to pass to the step function
 * @throws Error if no matching step definition is found
 */
export async function executeStep(
  type: StepType,
  text: string,
  harness: unknown
): Promise<void> {
  const result = findStep(type, text);

  if (!result) {
    const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
    const registerFn =
      type === "given"
        ? "defineGiven"
        : type === "when"
          ? "defineWhen"
          : "defineThen";
    throw new Error(
      `No step definition found for: ${typeLabel} "${text}". ` +
        `Register one with ${registerFn}("${text}", async (harness) => { ... })`
    );
  }

  await result.step.fn(harness, ...result.args);
}

// ============================================================================
// Utility API
// ============================================================================

/**
 * Clear all registered steps. Call this between test runs to reset state.
 */
export function clearSteps(): void {
  registry = [];
}

/**
 * Get all registered steps (for reporting/diagnostics).
 */
export function getRegisteredSteps(): readonly StepDefinition[] {
  return registry;
}
