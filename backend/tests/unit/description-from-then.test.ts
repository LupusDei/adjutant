import { describe, it, expect } from "vitest";

import { descriptionFromThen } from "../../src/acceptance/test-generator.js";

describe("descriptionFromThen", () => {
  // ============================================================================
  // Basic article/pronoun stripping
  // ============================================================================

  it("should strip leading 'the' and lowercase verb", () => {
    expect(descriptionFromThen("the system responds with 200")).toBe(
      "should respond with 200"
    );
  });

  it("should strip leading 'it' pronoun", () => {
    expect(descriptionFromThen("it is persisted with a generated ID")).toBe(
      "should be persisted with a generated ID"
    );
  });

  it("should strip leading 'they' pronoun", () => {
    expect(descriptionFromThen("they are returned sorted by newest first")).toBe(
      "should be returned sorted by newest first"
    );
  });

  it("should strip leading 'a' article", () => {
    expect(descriptionFromThen("a new record is created")).toBe(
      "should create a new record"
    );
  });

  it("should strip leading 'an' article", () => {
    expect(descriptionFromThen("an error is returned")).toBe(
      "should return an error"
    );
  });

  // ============================================================================
  // Passive to active voice transformations
  // ============================================================================

  it("should convert 'is persisted' passive to active", () => {
    expect(descriptionFromThen("it is persisted with status \"pending\"")).toBe(
      "should be persisted with status \"pending\""
    );
  });

  it("should convert 'are returned' passive to active", () => {
    expect(descriptionFromThen("only pending proposals are returned sorted by newest first")).toBe(
      "should return only pending proposals sorted by newest first"
    );
  });

  it("should convert 'status updates to' to active voice", () => {
    expect(
      descriptionFromThen("proposal status updates to 'accepted' and updated_at is refreshed")
    ).toBe(
      "should update proposal status to 'accepted' and refresh updated_at"
    );
  });

  // ============================================================================
  // "is/are" handling
  // ============================================================================

  it("should transform 'is' to 'be' after stripping subject", () => {
    expect(descriptionFromThen("it is persisted")).toBe("should be persisted");
  });

  it("should transform 'are' to 'be' after stripping subject", () => {
    expect(descriptionFromThen("they are sorted by date")).toBe(
      "should be sorted by date"
    );
  });

  // ============================================================================
  // Lowercase verb after "should"
  // ============================================================================

  it("should lowercase the verb after 'should'", () => {
    expect(descriptionFromThen("The Response includes a body")).toBe(
      "should include a body"
    );
  });

  // ============================================================================
  // Complex real-world examples
  // ============================================================================

  it("should handle 'the response includes proposals from both agents'", () => {
    expect(
      descriptionFromThen("the response includes proposals from both agents")
    ).toBe("should include proposals from both agents");
  });

  it("should handle 'each proposal has required fields'", () => {
    expect(descriptionFromThen("each proposal has required fields")).toBe(
      "should have required fields for each proposal"
    );
  });

  it("should handle 'the discussion is appended to the proposal'", () => {
    expect(descriptionFromThen("the discussion is appended to the proposal")).toBe(
      "should append the discussion to the proposal"
    );
  });

  // ============================================================================
  // Truncation at ~80 chars
  // ============================================================================

  it("should truncate long descriptions at ~80 chars on word boundary", () => {
    const longThen =
      "the system responds with a very long description that keeps going and going and should eventually be truncated at around eighty characters";
    const result = descriptionFromThen(longThen);
    expect(result.length).toBeLessThanOrEqual(80);
    expect(result).toMatch(/\.\.\.$/);
  });

  it("should not truncate descriptions under 80 chars", () => {
    const shortThen = "it is returned with status 200";
    const result = descriptionFromThen(shortThen);
    expect(result).not.toContain("...");
  });

  // ============================================================================
  // Edge cases
  // ============================================================================

  it("should handle empty string", () => {
    expect(descriptionFromThen("")).toBe("should handle empty then clause");
  });

  it("should handle already well-formed text", () => {
    expect(descriptionFromThen("return all records")).toBe(
      "should return all records"
    );
  });
});
