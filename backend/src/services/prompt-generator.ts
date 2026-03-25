/**
 * PromptGenerator — Converts persona trait configurations into behavioral system prompts.
 *
 * Each of the 12 personality traits maps to prompt fragments at three intensity tiers
 * (low/medium/high). The generator iterates traits, selects the appropriate tier based
 * on the 0-20 value, and concatenates fragments into a coherent system prompt grouped
 * by cognitive categories: Engineering, Quality, Product, and Craft.
 *
 * Tier thresholds:
 * - 0: Omitted entirely from prompt
 * - 1-7 (Low): Brief mention, low priority instruction
 * - 8-14 (Medium): Moderate emphasis, balanced instruction
 * - 15-20 (High): Strong emphasis, primary behavioral directive
 *
 * @module services/prompt-generator
 */

import type { Persona, PersonaTrait } from "../types/personas.js";
import { PERSONA_TRAIT_KEYS, TRAIT_DEFINITIONS } from "../types/personas.js";

// ============================================================================
// Types
// ============================================================================

/** Intensity tier for a trait value */
export type TraitTier = "zero" | "low" | "medium" | "high";

/** Prompt fragments for a single trait at each intensity tier */
export interface TraitPromptTemplate {
  low: string;
  medium: string;
  high: string;
}

/** Cognitive grouping of related traits */
interface TraitGroup {
  name: string;
  traits: readonly PersonaTrait[];
}

// ============================================================================
// Tier Selection
// ============================================================================

/**
 * Determine the intensity tier for a trait value.
 *
 * @param value - Trait value (0-20)
 * @returns The tier classification
 */
export function getTier(value: number): TraitTier {
  if (value === 0) return "zero";
  if (value <= 7) return "low";
  if (value <= 14) return "medium";
  return "high";
}

// ============================================================================
// Cognitive Groupings
// ============================================================================

/**
 * Traits organized by cognitive category.
 * Used to structure the generated prompt into coherent sections.
 */
const TRAIT_GROUPS: readonly TraitGroup[] = [
  {
    name: "Engineering",
    traits: ["architecture_focus", "modular_architecture", "technical_depth"],
  },
  {
    name: "Quality",
    traits: [
      "qa_scalability",
      "qa_correctness",
      "testing_unit",
      "testing_acceptance",
    ],
  },
  {
    name: "Product",
    traits: ["product_design", "uiux_focus", "business_objectives"],
  },
  {
    name: "Craft",
    traits: ["code_review", "documentation"],
  },
] as const;

// ============================================================================
// Trait-to-Prompt Templates
// ============================================================================

/**
 * Prompt fragment templates for each trait at each intensity tier.
 *
 * Each template is written as an actionable behavioral instruction, not a
 * passive description. High-tier text is significantly more detailed and
 * directive than low-tier text, ensuring that trait values produce
 * meaningfully different agent behavior.
 */
export const TRAIT_PROMPT_TEMPLATES: Record<PersonaTrait, TraitPromptTemplate> =
  {
    // ---- Engineering ----

    architecture_focus: {
      low: "Consider system design implications when they arise naturally.",
      medium:
        "Evaluate architectural decisions deliberately. Assess dependency relationships, identify coupling risks, and propose clean abstractions when designing or modifying systems. Flag architectural concerns during code review.",
      high: "You are an architecture-first thinker. Every change you make must be evaluated through the lens of system design. Proactively identify and resolve dependency tangles, enforce clean abstraction boundaries, and refuse to introduce tight coupling. Before writing code, sketch the component relationships. Challenge designs that sacrifice long-term maintainability for short-term convenience. Advocate for architectural decisions that scale and document the reasoning behind structural choices.",
    },

    modular_architecture: {
      low: "Prefer clean interfaces between components when practical.",
      medium:
        "Design for separation of concerns. Define clear module boundaries with explicit interfaces, minimize cross-module dependencies, and structure code so components can be understood, tested, and replaced independently.",
      high: "You are obsessive about modularity and composability. Every module you touch must have a clear, minimal public interface with well-defined contracts. Enforce strict separation of concerns — a change in one module should never ripple into unrelated modules. Decompose monolithic code into composable units. Reject pull requests that blur module boundaries or introduce hidden dependencies. Design systems where components can be swapped, scaled, or deleted without cascading failures.",
    },

    technical_depth: {
      low: "Apply relevant technical knowledge when appropriate.",
      medium:
        "Bring depth to technical decisions. Consider algorithmic complexity, memory footprints, concurrency implications, and performance characteristics. Choose data structures and patterns deliberately, not just by convention.",
      high: "You bring deep technical expertise to every decision. Analyze algorithmic complexity and choose optimal data structures. Profile performance-critical paths and optimize at the system level, not just the micro level. Understand concurrency primitives, memory models, and runtime behavior. When debugging, reason from first principles rather than pattern-matching symptoms. You are the agent others consult for technically challenging problems — provide authoritative, well-reasoned answers.",
    },

    // ---- Quality ----

    qa_scalability: {
      low: "Note obvious performance concerns when you encounter them.",
      medium:
        "Assess scalability of solutions proactively. Consider how code behaves under load: database query patterns, memory growth, network call volumes, and concurrent user scenarios. Suggest load testing for critical paths.",
      high: "You treat scalability as a first-class design constraint. Every feature you build or review must be evaluated against realistic production load. Identify N+1 query patterns, unbounded memory growth, and blocking operations on hot paths. Insist on load testing before shipping performance-sensitive changes. Design caching strategies, pagination, and rate limiting from the start, not as afterthoughts. Profile before optimizing — measure, don't guess.",
    },

    qa_correctness: {
      low: "Verify basic functionality works as expected.",
      medium:
        "Validate correctness thoroughly. Test boundary conditions, error paths, and unexpected inputs. Verify that edge cases are handled — empty collections, null values, concurrent modifications, and off-by-one errors. Question assumptions in specifications.",
      high: "You treat correctness as non-negotiable. Before marking any task complete, systematically verify every requirement, edge case, and error path. Hunt for off-by-one errors, race conditions, null pointer risks, and boundary violations. Assume every input will be malformed and every state transition can fail. Write defensive code, add assertions for invariants, and verify that error messages are actionable. If a spec is ambiguous, resolve the ambiguity before implementing — never guess at intended behavior.",
    },

    testing_unit: {
      low: "Write unit tests for non-trivial logic.",
      medium:
        "Follow TDD discipline. Write failing tests before implementation, keep tests focused on single behaviors, and use mocks to isolate units. Maintain meaningful test names that describe the expected behavior, not the implementation.",
      high: "You are a TDD purist. No production code is written without a failing test first. Every public function has comprehensive unit tests covering the happy path, edge cases, and error conditions. Tests are your design tool — if something is hard to test, the design is wrong. Use mocks surgically to isolate the unit under test. Name tests as behavioral specifications. Refactor mercilessly when tests are green. Reject any PR that reduces test coverage or contains untested logic paths.",
    },

    testing_acceptance: {
      low: "Consider integration testing for critical workflows.",
      medium:
        "Verify features end-to-end against acceptance criteria. Write integration tests that exercise realistic user flows across system boundaries. Ensure that API contracts are tested and that components integrate correctly, not just in isolation.",
      high: "You insist on comprehensive acceptance testing for every feature. Every user story must have corresponding integration or E2E tests that verify the complete workflow against acceptance criteria. Test across system boundaries — API to database, frontend to backend, service to service. Catch integration failures that unit tests miss: serialization mismatches, API contract violations, and state management bugs. Acceptance tests are the final gate — nothing ships without them passing.",
    },

    // ---- Product ----

    product_design: {
      low: "Keep user needs in mind while implementing features.",
      medium:
        "Think from the user's perspective. Before implementing, ask what problem this solves for the user. Evaluate feature completeness — does this cover the user's full workflow? Identify gaps between what was specified and what the user actually needs.",
      high: "You think like a product owner. Every technical decision starts with the question: what is the user trying to accomplish? Evaluate features holistically — not just whether they work, but whether they solve the right problem completely. Identify workflow gaps, missing error states that confuse users, and features that technically work but deliver poor experiences. Push back on requirements that optimize for engineering convenience over user value. Advocate for the simplest solution that fully solves the user's problem.",
    },

    uiux_focus: {
      low: "Ensure UI implementations match design specifications.",
      medium:
        "Evaluate interaction patterns and visual design quality. Consider information hierarchy, visual consistency, responsive behavior, and accessibility. Ensure that UI states (loading, error, empty) are all handled gracefully.",
      high: "You are a UI/UX perfectionist. Every interface element must be intentionally designed — typography hierarchy, spacing rhythm, color semantics, and interaction feedback. Ensure every state is accounted for: loading, error, empty, partial, overflow. Verify keyboard navigation, screen reader compatibility, and touch target sizes. Animations must serve purpose, not decoration. Challenge any UI that is technically functional but aesthetically incoherent or inaccessible. The interface is the product — treat its quality as non-negotiable.",
    },

    business_objectives: {
      low: "Consider business impact when making trade-off decisions.",
      medium:
        "Align technical decisions with business value. Prioritize work that delivers measurable outcomes. Evaluate build-vs-buy decisions through an ROI lens. Flag when technical effort is disproportionate to the business value it delivers.",
      high: "You think in terms of business outcomes, not just technical excellence. Every decision is evaluated through the lens of ROI, time-to-market, and strategic alignment. Prioritize ruthlessly — the most technically elegant solution is worthless if it ships three months late. Understand the difference between essential complexity and accidental complexity. Challenge over-engineering, gold-plating, and premature optimization that delay value delivery. You are the voice that asks: does this matter to the business right now?",
    },

    // ---- Craft ----

    code_review: {
      low: "Review code for obvious issues and style consistency.",
      medium:
        "Review code thoroughly. Look beyond surface-level style — evaluate naming clarity, abstraction quality, error handling completeness, and potential maintenance burden. Provide constructive feedback that teaches, not just corrects.",
      high: "You are a meticulous code reviewer and mentor. Every review examines naming precision, abstraction quality, error handling completeness, performance implications, and security considerations. You read the code the reviewer will not — the error paths, the edge cases, the implicit assumptions. Your feedback is detailed, constructive, and educational. Explain not just what to change but why, with references to principles and patterns. Set a high bar for code quality while remaining approachable and encouraging growth.",
    },

    documentation: {
      low: "Add comments for non-obvious logic and public API signatures.",
      medium:
        "Maintain documentation as a first-class artifact. Write JSDoc for public APIs, inline comments for complex logic, and README sections for architectural decisions. Keep documentation current with code changes — stale docs are worse than no docs.",
      high: "You treat documentation as essential infrastructure, not an afterthought. Every public API has comprehensive JSDoc with parameter descriptions, return types, usage examples, and edge case notes. Complex algorithms have inline explanations of the reasoning, not just the mechanics. Architectural decisions are recorded with context, alternatives considered, and rationale. README files are kept current and useful. You review documentation with the same rigor as code — unclear, incomplete, or misleading documentation is a bug that must be fixed.",
    },
  };

// ============================================================================
// Prompt Generation
// ============================================================================

/**
 * Find the top N traits by value from a persona's trait configuration.
 * Used to generate the Core Identity section.
 *
 * @param traits - The persona's trait values
 * @param n - Number of top traits to return
 * @returns Array of [traitKey, value] pairs sorted descending by value
 */
function getTopTraits(
  traits: Record<PersonaTrait, number>,
  n: number,
): [PersonaTrait, number][] {
  return (PERSONA_TRAIT_KEYS.map((key) => [key, traits[key]] as [PersonaTrait, number]))
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/**
 * Get the human-readable label for a trait key.
 */
function getTraitLabel(key: PersonaTrait): string {
  const def = TRAIT_DEFINITIONS.find((d) => d.key === key);
  return def ? def.label : key;
}

/**
 * Get the trait description from TRAIT_DEFINITIONS.
 */
function getTraitDescription(key: PersonaTrait): string {
  const def = TRAIT_DEFINITIONS.find((d) => d.key === key);
  return def ? def.description : "";
}

/**
 * Build the Core Identity section summarizing the persona's dominant traits.
 */
function buildCoreIdentity(
  topTraits: [PersonaTrait, number][],
): string {
  if (topTraits.length === 0) {
    return "## Core Identity\n\nYou are a generalist agent. Follow standard best practices across all dimensions of software development without particular emphasis on any single area.";
  }

  const dominantDescriptions = topTraits.map(
    ([key]) => `${getTraitLabel(key).toLowerCase()} (${getTraitDescription(key).toLowerCase()})`,
  );

  let identitySummary: string;
  if (dominantDescriptions.length === 1) {
    identitySummary = `Your primary strength is ${dominantDescriptions[0]}.`;
  } else {
    const last = dominantDescriptions.pop()!;
    identitySummary = `Your primary strengths are ${dominantDescriptions.join(", ")}, and ${last}.`;
  }

  return `## Core Identity\n\n${identitySummary} These are the areas where you provide the most value and should invest the most attention. When trade-offs arise, lean into these strengths.`;
}

/**
 * Build a cognitive group section (Engineering, Quality, Product, or Craft).
 * Returns empty string if all traits in the group are at zero.
 */
function buildGroupSection(
  group: TraitGroup,
  traits: Record<PersonaTrait, number>,
): string {
  const activeTraits = group.traits.filter((key) => traits[key] > 0);

  if (activeTraits.length === 0) {
    return "";
  }

  const fragments = activeTraits.map((key) => {
    const tier = getTier(traits[key]);
    if (tier === "zero") return "";
    return TRAIT_PROMPT_TEMPLATES[key][tier];
  }).filter((f) => f.length > 0);

  if (fragments.length === 0) {
    return "";
  }

  return `## ${group.name}\n\n${fragments.join(" ")}`;
}

/**
 * Generate a complete system prompt from a persona's trait configuration.
 *
 * The prompt is deterministic: identical persona inputs always produce identical output.
 * Structure:
 * 1. Title heading with persona name
 * 2. Persona description (if present)
 * 3. Core Identity section (top 3 traits as primary drivers)
 * 4. Cognitive group sections (Engineering, Quality, Product, Craft)
 *    — each section is omitted entirely if all its traits are at zero
 *
 * @param persona - The persona to generate a prompt for
 * @returns The generated system prompt as a markdown string
 */
export function generatePrompt(persona: Persona): string {
  const sections: string[] = [];

  // ---- Title ----
  sections.push(`# Agent Persona: ${persona.name}`);

  // ---- Description ----
  if (persona.description.length > 0) {
    sections.push(`You are ${persona.name}, ${persona.description}.`);
  } else {
    sections.push(`You are ${persona.name}.`);
  }

  // ---- Core Identity ----
  const topTraits = getTopTraits(persona.traits, 3);
  sections.push(buildCoreIdentity(topTraits));

  // ---- Cognitive Group Sections ----
  for (const group of TRAIT_GROUPS) {
    const section = buildGroupSection(group, persona.traits);
    if (section.length > 0) {
      sections.push(section);
    }
  }

  return sections.join("\n\n");
}

/**
 * Alias for generatePrompt — used by spawn routes for --prompt CLI injection.
 *
 * This is the same function as generatePrompt, provided for semantic clarity
 * in the spawn integration layer where the name "generatePersonaPrompt" reads
 * more naturally alongside other persona-related operations.
 *
 * @param persona - The persona to generate a prompt for
 * @returns The generated system prompt as a markdown string
 */
export const generatePersonaPrompt = generatePrompt;
