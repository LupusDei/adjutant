/**
 * adj-f9h87 — supervisorLabel() lockstep contract test.
 *
 * `backend/src/services/dolt-supervisor.ts` hand-duplicates `supervisorLabel()`
 * from `cli/lib/dolt-supervisor.ts` because `backend/src` cannot import the
 * repo-root `cli/` tree under the backend build (`rootDir: ./src`). Both must
 * produce the IDENTICAL launchd label — the self-heal `launchctl kickstart`
 * targets `gui/<uid>/<label>`, so if the two ever diverge (e.g. one side later
 * adds projectId sanitization for launchd-illegal chars) the kickstart silently
 * misses its target and self-heal breaks with no failing test.
 *
 * Until adj-f9h87 this contract was enforced ONLY by a code comment. This test
 * imports BOTH functions and asserts byte-for-byte equality across a sample of
 * projectIds (including edge chars) so a future divergence fails loudly here.
 *
 * NOTE: backend tests are permitted to import from `cli/lib` (the test tsconfig
 * is not bound by `src`'s rootDir) — several existing suites already do
 * (cli-init-dolt.test.ts, dolt-supervisor-gen.test.ts, etc.).
 */
import { describe, it, expect } from "vitest";

import { supervisorLabel as backendSupervisorLabel } from "../../src/services/dolt-supervisor.js";
import { supervisorLabel as cliSupervisorLabel } from "../../../cli/lib/dolt-supervisor.js";

describe("supervisorLabel lockstep (backend service vs cli/lib)", () => {
  // A spread of realistic and edge-case projectIds. UUIDs are the normal case;
  // the rest probe characters that a future sanitizer might treat differently
  // on one side (dots, underscores, mixed case, leading/trailing whitespace-like
  // separators) — any such divergence must fail this test.
  const projectIds = [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "00000000-0000-0000-0000-000000000000",
    "adjutant",
    "MixedCaseProject",
    "with.dots.in.id",
    "with_underscores",
    "with-hyphens-only",
    "123numeric456",
    "edge.case_MIX-99",
  ];

  it("should produce byte-identical labels for the same projectId on both sides", () => {
    for (const id of projectIds) {
      expect(backendSupervisorLabel(id)).toBe(cliSupervisorLabel(id));
    }
  });

  it("should both render the documented com.adjutant.dolt.<id> reverse-DNS form", () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    expect(backendSupervisorLabel(id)).toBe(`com.adjutant.dolt.${id}`);
    expect(cliSupervisorLabel(id)).toBe(`com.adjutant.dolt.${id}`);
  });

  it("should agree on the empty-string projectId edge case", () => {
    // Defensive: even a degenerate input must not silently diverge between the two
    // implementations — equality is the contract, not the specific value.
    expect(backendSupervisorLabel("")).toBe(cliSupervisorLabel(""));
  });
});
