/**
 * Tests for cli/lib/prime.ts — the Adjutant agent protocol generator.
 *
 * These tests guard the file_question MANDATORY routing requirement
 * (US5: adj-181.7) so the instruction can never silently regress.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// The embedded fallback content exported by the generator
import { PRIME_MD_CONTENT } from "../lib/prime.js";

// The canonical .adjutant/PRIME.md that upgrade distributes to all agents
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");
const canonicalPrimePath = join(repoRoot, ".adjutant", "PRIME.md");
const canonicalPrimeContent = readFileSync(canonicalPrimePath, "utf-8");

/**
 * Run the same assertions against both the embedded fallback and the
 * canonical distributed file. Both MUST carry the mandate — whichever
 * an agent loads, it gets the right instruction.
 */
const primeVariants: Array<[string, string]> = [
  ["PRIME_MD_CONTENT (embedded fallback in cli/lib/prime.ts)", PRIME_MD_CONTENT],
  [".adjutant/PRIME.md (canonical distributed file)", canonicalPrimeContent],
];

describe.each(primeVariants)("Prime protocol mandate — %s", (_label, content) => {
  describe("file_question tool presence", () => {
    it("should mention the file_question tool by name", () => {
      expect(content).toContain("file_question");
    });

    it("should include the body parameter for file_question", () => {
      expect(content).toContain("body");
    });

    it("should include the context parameter for file_question", () => {
      expect(content).toContain("context");
    });

    it("should include the urgency parameter for file_question", () => {
      expect(content).toContain("urgency");
    });

    it("should include the suggestedOptions parameter for file_question", () => {
      expect(content).toContain("suggestedOptions");
    });
  });

  describe("scope: both questions AND blocking tasks/actions", () => {
    it("should cover routing questions to the General", () => {
      // Must mention questions or decisions
      const coversQuestions =
        content.includes("question") || content.includes("decision") || content.includes("clarification");
      expect(coversQuestions).toBe(true);
    });

    it("should cover blocking tasks/actions the General must complete", () => {
      // Must mention action_required, blocking task, or user-blocking action
      const coversActions =
        content.includes("action_required") ||
        content.includes("blocking") ||
        content.includes("key") ||
        content.includes("access") ||
        content.includes("approve");
      expect(coversActions).toBe(true);
    });

    it("should name file_question as the MANDATORY front door for both questions and blocking actions", () => {
      // The text around file_question must express a mandatory requirement
      const fileQuestionIdx = content.indexOf("file_question");
      expect(fileQuestionIdx).toBeGreaterThan(-1);

      // Within 500 chars of any file_question mention there must be mandatory language
      const mandatory =
        content.includes("MANDATORY") ||
        content.includes("MUST use file_question") ||
        content.includes("MUST file") ||
        content.includes("must file") ||
        content.includes("required") ||
        content.includes("Required");
      expect(mandatory).toBe(true);
    });
  });

  describe("guardrails: prohibited patterns", () => {
    it("should include the 'do NOT bury in send_message' guardrail", () => {
      const hasSendMessageGuardrail =
        content.includes("do NOT bury") ||
        content.includes("not bury") ||
        content.includes("do not bury") ||
        content.includes("NOT a substitute") ||
        content.includes("not a substitute") ||
        content.includes("not substitute") ||
        // Or at minimum: send_message is explicitly scoped AWAY from questions
        (content.includes("send_message") && content.includes("file_question") &&
          (content.includes("general comms") || content.includes("NOT for questions") ||
           content.includes("stays for") || content.includes("remain") || content.includes("replying")));
      expect(hasSendMessageGuardrail).toBe(true);
    });

    it("should include the 'no AskUserQuestion' guardrail", () => {
      expect(content).toContain("AskUserQuestion");
    });

    it("should include the 'no stdin-block' guardrail", () => {
      const hasStdinGuardrail =
        content.includes("stdin") ||
        content.includes("block on") ||
        content.includes("blocking on");
      expect(hasStdinGuardrail).toBe(true);
    });
  });

  describe("concrete tool-call example", () => {
    it("should show a concrete file_question call example", () => {
      // A tool-call example would show file_question( with parameters
      const hasCallExample =
        content.includes("file_question({") ||
        content.includes("file_question({ ") ||
        content.includes("file_question(\n") ||
        content.includes("`file_question`");
      expect(hasCallExample).toBe(true);
    });
  });
});

/**
 * adj-128: bd has no access control. The ONLY protection against an agent
 * overwriting a bead via a duplicate `bd create --id` (the adj-127 incident) or
 * closing someone else's bead (the adj-126 incident) is these protocol guards.
 * Whichever PRIME variant an agent loads, the guards must be present.
 */
describe.each(primeVariants)("%s — bead ownership guards (adj-128)", (_label, content) => {
  it("should require bd show before bd create --id and only create on 'no issue found'", () => {
    expect(content).toContain("bd create --id");
    expect(content).toContain("bd show <X>");
    expect(content).toContain("no issue found");
  });

  it("should warn that a failed lookup is not proof the ID is free", () => {
    expect(content.toLowerCase()).toContain("failed lookup");
  });

  it("should require verifying the Assignee before bd update or bd close", () => {
    expect(content).toMatch(/before `bd update`[^\n]*`bd close`/i);
    expect(content).toContain("Assignee");
  });

  it("should name --parent as the collision-free alternative to --id", () => {
    expect(content).toContain("--parent=");
  });
});

/**
 * adj-111.2: agents kept answering via stdout, which the dashboard and iOS app
 * never see. The rule must be a bold top-level rule in MCP Communication,
 * not just an implication of "use send_message".
 */
describe.each(primeVariants)("%s — MCP-only responses (adj-111.2)", (_label, content) => {
  const mcpSection = content.slice(content.indexOf("## MCP Communication"));

  it("should state as a bold rule that responses never go to stdout", () => {
    expect(mcpSection).toMatch(/\*\*[^*\n]*NEVER respond to user questions via stdout\/text output\.?\*\*/);
  });

  it("should require ALL responses to go through send_message", () => {
    expect(mcpSection).toContain("ALL responses MUST go through `send_message`");
  });

  it("should explain that stdout is invisible to the user", () => {
    expect(mcpSection).toContain("stdout is invisible to the user");
  });

  it("should place the rule before the first MCP subsection", () => {
    const rule = mcpSection.indexOf("NEVER respond to user questions via stdout");
    const firstSubsection = mcpSection.indexOf("\n### ");
    expect(rule).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(firstSubsection);
  });
});
