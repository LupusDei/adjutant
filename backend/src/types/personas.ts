/**
 * Persona types, trait definitions, and Zod validation schemas.
 *
 * A Persona defines an agent's personality through 12 trait dimensions.
 * Each trait is scored 0-20 with a total budget of 100 points,
 * enforcing specialization over generalization.
 */

import { z } from "zod";

// ============================================================================
// Constants
// ============================================================================

/** Maximum points any single trait can have */
export const TRAIT_MAX = 20;

/** Minimum points any single trait can have */
export const TRAIT_MIN = 0;

/** Total point budget across all traits */
export const POINT_BUDGET = 100;

// ============================================================================
// PersonaTrait Enum
// ============================================================================

/**
 * The 12 personality trait dimensions.
 * Each maps to a behavioral axis that influences prompt generation.
 */
export const PersonaTrait = {
  ARCHITECTURE_FOCUS: "architecture_focus",
  PRODUCT_DESIGN: "product_design",
  UIUX_FOCUS: "uiux_focus",
  QA_SCALABILITY: "qa_scalability",
  QA_CORRECTNESS: "qa_correctness",
  TESTING_UNIT: "testing_unit",
  TESTING_ACCEPTANCE: "testing_acceptance",
  MODULAR_ARCHITECTURE: "modular_architecture",
  BUSINESS_OBJECTIVES: "business_objectives",
  TECHNICAL_DEPTH: "technical_depth",
  CODE_REVIEW: "code_review",
  DOCUMENTATION: "documentation",
} as const;

export type PersonaTrait = (typeof PersonaTrait)[keyof typeof PersonaTrait];

/** All trait keys as an array, for iteration and validation */
export const PERSONA_TRAIT_KEYS: readonly PersonaTrait[] = Object.values(PersonaTrait);

// ============================================================================
// Trait Definitions
// ============================================================================

/** Metadata for a single trait dimension */
export interface TraitDefinition {
  /** Machine-readable key */
  key: PersonaTrait;
  /** Human-readable label */
  label: string;
  /** Description of what this trait controls */
  description: string;
}

/**
 * Canonical trait definitions.
 * Used by UI for labels/descriptions and by prompt generator for mapping.
 */
export const TRAIT_DEFINITIONS: readonly TraitDefinition[] = [
  {
    key: PersonaTrait.ARCHITECTURE_FOCUS,
    label: "Architecture Focus",
    description: "System design, dependency management, clean abstractions",
  },
  {
    key: PersonaTrait.PRODUCT_DESIGN,
    label: "Product Design",
    description: "Product thinking, user needs, feature completeness",
  },
  {
    key: PersonaTrait.UIUX_FOCUS,
    label: "UI/UX Focus",
    description: "Visual design, interaction patterns, accessibility",
  },
  {
    key: PersonaTrait.QA_SCALABILITY,
    label: "QA: Scalability",
    description: "Performance testing, load handling, scaling concerns",
  },
  {
    key: PersonaTrait.QA_CORRECTNESS,
    label: "QA: Correctness",
    description: "Functional correctness, edge cases, does everything work",
  },
  {
    key: PersonaTrait.TESTING_UNIT,
    label: "Testing: Unit",
    description: "Unit test rigor, TDD discipline, mock strategies",
  },
  {
    key: PersonaTrait.TESTING_ACCEPTANCE,
    label: "Testing: Acceptance",
    description: "Integration/E2E test coverage, acceptance criteria",
  },
  {
    key: PersonaTrait.MODULAR_ARCHITECTURE,
    label: "Modular Architecture",
    description: "Separation of concerns, clean interfaces, composability",
  },
  {
    key: PersonaTrait.BUSINESS_OBJECTIVES,
    label: "Business Objectives",
    description: "Business value alignment, ROI thinking, prioritization",
  },
  {
    key: PersonaTrait.TECHNICAL_DEPTH,
    label: "Technical Depth",
    description: "Low-level knowledge, performance optimization, algorithms",
  },
  {
    key: PersonaTrait.CODE_REVIEW,
    label: "Code Review",
    description: "Review thoroughness, attention to detail, mentoring",
  },
  {
    key: PersonaTrait.DOCUMENTATION,
    label: "Documentation",
    description: "Code comments, README, API docs, inline documentation",
  },
] as const;

// ============================================================================
// Persona Entity Types
// ============================================================================

/** Trait values object mapping each trait key to its point allocation */
export type TraitValues = Record<PersonaTrait, number>;

/** A persona entity as stored/returned by the service layer */
export interface Persona {
  /** Unique identifier (UUID) */
  id: string;
  /** Unique display name (case-insensitive uniqueness) */
  name: string;
  /** Optional description of this persona's role/purpose */
  description: string;
  /** Point allocation across all 12 trait dimensions */
  traits: TraitValues;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last-update timestamp */
  updatedAt: string;
}

/** Raw SQLite row shape before camelCase mapping */
export interface PersonaRow {
  id: string;
  name: string;
  description: string;
  traits: string; // JSON-serialized TraitValues
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Zod Schemas
// ============================================================================

/**
 * Zod schema for a single trait value: integer 0-20.
 */
const TraitValueSchema = z.number().int().min(TRAIT_MIN).max(TRAIT_MAX);

/**
 * Zod schema for the traits object.
 * All 12 keys required, each an integer 0-20.
 */
export const TraitValuesSchema = z.object({
  architecture_focus: TraitValueSchema,
  product_design: TraitValueSchema,
  uiux_focus: TraitValueSchema,
  qa_scalability: TraitValueSchema,
  qa_correctness: TraitValueSchema,
  testing_unit: TraitValueSchema,
  testing_acceptance: TraitValueSchema,
  modular_architecture: TraitValueSchema,
  business_objectives: TraitValueSchema,
  technical_depth: TraitValueSchema,
  code_review: TraitValueSchema,
  documentation: TraitValueSchema,
});

/**
 * Compute the sum of all trait values in a traits object.
 */
export function sumTraits(traits: TraitValues): number {
  return PERSONA_TRAIT_KEYS.reduce((sum, key) => sum + traits[key], 0);
}

/**
 * Zod schema for creating a new persona.
 * Validates name (non-empty, trimmed), description, traits (all keys, ranges),
 * and enforces the total point budget constraint.
 */
export const CreatePersonaSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(64, "Name must be 64 characters or fewer"),
    description: z
      .string()
      .trim()
      .max(500, "Description must be 500 characters or fewer")
      .default(""),
    traits: TraitValuesSchema,
  })
  .refine(
    (data) => sumTraits(data.traits as TraitValues) <= POINT_BUDGET,
    {
      message: `Total trait points must not exceed ${POINT_BUDGET}`,
      path: ["traits"],
    },
  );

/** Inferred type from the create schema */
export type CreatePersonaInput = z.infer<typeof CreatePersonaSchema>;

/**
 * Zod schema for updating an existing persona.
 * All fields optional. If traits are provided, they must satisfy budget.
 * Partial trait updates are not supported -- provide all 12 keys or none.
 */
export const UpdatePersonaSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required")
      .max(64, "Name must be 64 characters or fewer")
      .optional(),
    description: z
      .string()
      .trim()
      .max(500, "Description must be 500 characters or fewer")
      .optional(),
    traits: TraitValuesSchema.optional(),
  })
  .refine(
    (data) => {
      if (data.traits === undefined) return true;
      return sumTraits(data.traits as TraitValues) <= POINT_BUDGET;
    },
    {
      message: `Total trait points must not exceed ${POINT_BUDGET}`,
      path: ["traits"],
    },
  );

/** Inferred type from the update schema */
export type UpdatePersonaInput = z.infer<typeof UpdatePersonaSchema>;

// ============================================================================
// Living Personas Types (adj-158)
// ============================================================================

/** How a persona was created */
export type PersonaSource = "hand-crafted" | "self-generated";

/** Junction record linking a StarCraft callsign to a persona */
export interface CallsignPersona {
  callsign: string;
  personaId: string;
  createdAt: string;
}

/** A single trait evolution event */
export interface PersonaEvolution {
  id: number;
  personaId: string;
  trait: PersonaTrait;
  oldValue: number;
  newValue: number;
  changedAt: string;
}

/** Maximum adjustment per trait in a single evolve_persona call */
export const EVOLUTION_MAX_DELTA = 2;
