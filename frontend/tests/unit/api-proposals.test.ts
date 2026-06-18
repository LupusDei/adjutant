/**
 * Tests for the proposals API client sharing methods (adj-200.4.1 / T011).
 *
 * Verifies api.proposals.publish(id) and unpublish(id) hit the correct REST
 * endpoints and return the backend payload (updated proposal + publicUrl on
 * publish). Also asserts the extended Proposal type carries the public-sharing
 * fields (html / isPublic / shareToken / publishedAt).
 *
 * @module tests/unit/api-proposals
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Mock sessionStorage for API key
const mockSessionStorage = new Map<string, string>();
Object.defineProperty(globalThis, "sessionStorage", {
  value: {
    getItem: (key: string) => mockSessionStorage.get(key) ?? null,
    setItem: (key: string, value: string) => mockSessionStorage.set(key, value),
    removeItem: (key: string) => mockSessionStorage.delete(key),
    clear: () => { mockSessionStorage.clear(); },
  },
  writable: true,
});

vi.stubEnv("VITE_API_URL", undefined);

import { api } from "../../src/services/api";
import type { Proposal } from "../../src/types";

/** A published proposal carrying the extended sharing fields. */
const publishedProposal: Proposal = {
  id: "p1",
  author: "agent-1",
  title: "Shareable Pages",
  description: "Make proposals shareable",
  project: "adjutant",
  type: "engineering",
  status: "pending",
  createdAt: "2026-06-17T00:00:00Z",
  updatedAt: "2026-06-17T01:00:00Z",
  html: "<section><h1>Shareable Pages</h1></section>",
  isPublic: true,
  shareToken: "abc123def456ghi7",
  publishedAt: "2026-06-17T01:00:00Z",
};

function mockFetchResponse(data: unknown, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

function lastCall(): [string, RequestInit] {
  const calls = mockFetch.mock.calls;
  return calls[calls.length - 1] as [string, RequestInit];
}

describe("api.proposals sharing methods (adj-200.4.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage.clear();
  });

  describe("api.proposals.publish()", () => {
    it("should exist as a function", () => {
      expect(typeof api.proposals.publish).toBe("function");
    });

    it("should POST to /proposals/:id/publish and return proposal + publicUrl", async () => {
      const publicUrl = "http://localhost:3000/p/abc123def456ghi7";
      mockFetchResponse({
        success: true,
        data: { proposal: publishedProposal, publicUrl },
      });

      const result = await api.proposals.publish("p1");

      const [url, options] = lastCall();
      expect(url).toContain("/proposals/p1/publish");
      expect(options.method).toBe("POST");
      expect(result.proposal.isPublic).toBe(true);
      expect(result.proposal.shareToken).toBe("abc123def456ghi7");
      expect(result.publicUrl).toBe(publicUrl);
    });

    it("should URL-encode the proposal id", async () => {
      mockFetchResponse({
        success: true,
        data: { proposal: publishedProposal, publicUrl: "http://x/p/t" },
      });

      await api.proposals.publish("a/b");

      const [url] = lastCall();
      expect(url).toContain("/proposals/a%2Fb/publish");
    });

    it("should propagate an API error for an unknown id", async () => {
      mockFetchResponse(
        { success: false, error: { code: "NOT_FOUND", message: "no proposal" } },
        404,
      );

      await expect(api.proposals.publish("missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("api.proposals.unpublish()", () => {
    it("should exist as a function", () => {
      expect(typeof api.proposals.unpublish).toBe("function");
    });

    it("should POST to /proposals/:id/unpublish and return the updated proposal", async () => {
      const unpublished: Proposal = { ...publishedProposal, isPublic: false };
      mockFetchResponse({
        success: true,
        data: { proposal: unpublished },
      });

      const result = await api.proposals.unpublish("p1");

      const [url, options] = lastCall();
      expect(url).toContain("/proposals/p1/unpublish");
      expect(options.method).toBe("POST");
      expect(result.proposal.isPublic).toBe(false);
      // Token is retained on unpublish so a later re-publish revives the link.
      expect(result.proposal.shareToken).toBe("abc123def456ghi7");
    });

    it("should propagate an API error for an unknown id", async () => {
      mockFetchResponse(
        { success: false, error: { code: "NOT_FOUND", message: "no proposal" } },
        404,
      );

      await expect(api.proposals.unpublish("missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("Proposal type carries sharing fields", () => {
    it("should accept html/isPublic/shareToken/publishedAt on a Proposal", () => {
      // Compile-time contract: this object must type-check as a Proposal.
      const p: Proposal = publishedProposal;
      expect(p.html).toContain("<section>");
      expect(p.isPublic).toBe(true);
      expect(p.shareToken).toBe("abc123def456ghi7");
      expect(p.publishedAt).toBe("2026-06-17T01:00:00Z");
    });
  });
});
