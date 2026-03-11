/**
 * JSON fixture validation tests.
 *
 * Validates that exported JSON fixtures (used by iOS Codable tests) match
 * the declared Zod schemas. If a schema changes, fixture validation fails
 * here, prompting an update to both the fixture and the iOS test.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CostSummaryResponseSchema,
  BurnRateResponseSchema,
  BeadCostResponseSchema,
  BudgetListResponseSchema,
  ReconcileAllResponseSchema,
} from "../../src/types/cost-contracts.js";

function loadFixture(name: string): unknown {
  const path = join(import.meta.dirname, "fixtures", name);
  return JSON.parse(readFileSync(path, "utf-8"));
}

describe("JSON fixture schema validation", () => {
  it("cost-summary.json matches CostSummaryResponseSchema", () => {
    const fixture = loadFixture("cost-summary.json");
    const parsed = CostSummaryResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.error(parsed.error.issues);
  });

  it("burn-rate.json matches BurnRateResponseSchema", () => {
    const fixture = loadFixture("burn-rate.json");
    const parsed = BurnRateResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.error(parsed.error.issues);
  });

  it("bead-cost.json matches BeadCostResponseSchema", () => {
    const fixture = loadFixture("bead-cost.json");
    const parsed = BeadCostResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.error(parsed.error.issues);
  });

  it("budget.json matches BudgetListResponseSchema", () => {
    const fixture = loadFixture("budget.json");
    const parsed = BudgetListResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.error(parsed.error.issues);
  });

  it("reconciliation.json matches ReconcileAllResponseSchema", () => {
    const fixture = loadFixture("reconciliation.json");
    const parsed = ReconcileAllResponseSchema.safeParse(fixture);
    expect(parsed.success).toBe(true);
    if (!parsed.success) console.error(parsed.error.issues);
  });
});
