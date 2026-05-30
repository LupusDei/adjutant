import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createHash } from "node:crypto";

import { dmConversationId } from "../../src/services/conversation-store.js";

/**
 * CROSS-PLATFORM CONTRACT TEST — adj-pgwa4.
 *
 * The DM conversation id must be derived byte-for-byte identically on every
 * platform that derives it (backend `conversation-store.ts` and iOS
 * `ChatViewModel.swift`; the web uses server-provided ids and does NOT derive).
 * Divergence strands messages from the view — the adj-pgwa4 incident was iOS
 * using a SPACE separator while the backend uses a NUL byte, so every
 * backend-stamped message was filtered out of the iOS DM view.
 *
 * The SAME fixtures file (`contracts/dm-conversation-id.vectors.json`) is
 * consumed by the iOS contract test
 * (`ios/.../DmConversationIdContractTests.swift`), so both platforms are pinned
 * to identical expected ids. Editing the derivation on either side without
 * updating the other breaks one of the two suites.
 */

interface Vector {
  memberA: string;
  memberB: string;
  expected: string;
  liveAnchored?: boolean;
}
interface Contract {
  vectors: Vector[];
  orderIndependenceCheck: { memberA: string; memberB: string; expected: string };
  negativeGuard: { memberA: string; memberB: string; spaceSeparatedWrongId: string };
}

const CONTRACT: Contract = JSON.parse(
  readFileSync(resolve(__dirname, "../../../contracts/dm-conversation-id.vectors.json"), "utf-8"),
);

describe("dmConversationId cross-platform contract (adj-pgwa4)", () => {
  it("matches every shared contract vector byte-for-byte", () => {
    for (const v of CONTRACT.vectors) {
      expect(dmConversationId(v.memberA, v.memberB), `${v.memberA} ↔ ${v.memberB}`).toBe(v.expected);
    }
  });

  it("is order-independent (unordered pair → same id)", () => {
    const c = CONTRACT.orderIndependenceCheck;
    expect(dmConversationId(c.memberA, c.memberB)).toBe(c.expected);
    expect(dmConversationId(c.memberB, c.memberA)).toBe(c.expected);
    // And every vector is symmetric.
    for (const v of CONTRACT.vectors) {
      expect(dmConversationId(v.memberB, v.memberA)).toBe(dmConversationId(v.memberA, v.memberB));
    }
  });

  it("uses a NUL-byte separator — NOT a space (the exact adj-pgwa4 bug)", () => {
    const { memberA, memberB, spaceSeparatedWrongId } = CONTRACT.negativeGuard;
    // Independently recompute the WRONG (space-separated) id and prove the real
    // derivation does not equal it. If anyone reformats the NUL to a space, this
    // (and the vector assertions) fail loudly.
    const pair = [memberA, memberB].sort();
    const spaceId = "dm_" + createHash("sha1").update(`${pair[0]} ${pair[1]}`).digest("hex").slice(0, 24);
    expect(spaceId).toBe(spaceSeparatedWrongId); // sanity: our documented wrong id is correct
    expect(dmConversationId(memberA, memberB)).not.toBe(spaceId);
  });

  it("derives the expected format: dm_ prefix + 24 lowercase hex chars", () => {
    const id = dmConversationId("user", "raynor");
    expect(id).toMatch(/^dm_[0-9a-f]{24}$/);
  });

  it("keeps at least the four live-anchored vectors (regression anchor to real data)", () => {
    const anchored = CONTRACT.vectors.filter((v) => v.liveAnchored);
    expect(anchored.length).toBeGreaterThanOrEqual(4);
  });
});
