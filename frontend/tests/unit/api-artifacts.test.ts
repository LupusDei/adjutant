/**
 * Tests for the artifacts API client block (adj-j7az6.3.1 / T301a).
 *
 * Verifies api.artifacts.{list,get,create,update,delete,publish,unpublish,download}
 * hit the correct REST endpoints, plus buildPublicArtifactUrl(token) → <origin>/a/<token>
 * and buildArtifactDownloadUrl(id) → <base>/artifacts/<id>/download.
 *
 * @module tests/unit/api-artifacts
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

import { api, buildPublicArtifactUrl, buildArtifactDownloadUrl } from "../../src/services/api";
import type { Artifact } from "../../src/types";

const sampleArtifact: Artifact = {
  id: "a1",
  title: "My Page",
  slug: "my-page",
  description: "A standalone page",
  html: "<section><h1>Hi</h1></section>",
  isPublic: false,
  createdAt: "2026-08-01T00:00:00Z",
  updatedAt: "2026-08-01T00:00:00Z",
};

const publishedArtifact: Artifact = {
  ...sampleArtifact,
  isPublic: true,
  shareToken: "abc123def456ghi7",
  publishedAt: "2026-08-01T01:00:00Z",
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

describe("api.artifacts (adj-j7az6.3.1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage.clear();
    // The api key lives in localStorage (jsdom provides it). Clear between tests.
    try { localStorage.clear(); } catch { /* ignore */ }
    // Provide a stable origin for buildPublicArtifactUrl.
    Object.defineProperty(globalThis, "window", {
      value: { location: { origin: "https://dash.example" } },
      writable: true,
      configurable: true,
    });
  });

  describe("list()", () => {
    it("should GET /artifacts and return the array", async () => {
      mockFetchResponse({ success: true, data: [sampleArtifact] });
      const result = await api.artifacts.list();
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts");
      expect(options.method ?? "GET").toBe("GET");
      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe("a1");
    });
  });

  describe("get()", () => {
    it("should GET /artifacts/:id (url-encoded)", async () => {
      mockFetchResponse({ success: true, data: sampleArtifact });
      const result = await api.artifacts.get("a/b");
      const [url] = lastCall();
      expect(url).toContain("/artifacts/a%2Fb");
      expect(result.id).toBe("a1");
    });
  });

  describe("create()", () => {
    it("should POST /artifacts with the body and return the created artifact", async () => {
      mockFetchResponse({ success: true, data: sampleArtifact }, 201);
      const result = await api.artifacts.create({ title: "My Page", html: "<h1>Hi</h1>" });
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts");
      expect(options.method).toBe("POST");
      expect(options.body).toContain("My Page");
      expect(result.id).toBe("a1");
    });
  });

  describe("update()", () => {
    it("should PATCH /artifacts/:id", async () => {
      mockFetchResponse({ success: true, data: { ...sampleArtifact, title: "New" } });
      const result = await api.artifacts.update("a1", { title: "New" });
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts/a1");
      expect(options.method).toBe("PATCH");
      expect(result.title).toBe("New");
    });
  });

  describe("delete()", () => {
    it("should DELETE /artifacts/:id", async () => {
      mockFetchResponse({ success: true, data: { id: "a1", deleted: true } });
      const result = await api.artifacts.delete("a1");
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts/a1");
      expect(options.method).toBe("DELETE");
      expect(result.deleted).toBe(true);
    });
  });

  describe("publish()", () => {
    it("should POST /artifacts/:id/publish and return artifact + publicUrl", async () => {
      const publicUrl = "https://dash.example/a/abc123def456ghi7";
      mockFetchResponse({ success: true, data: { artifact: publishedArtifact, publicUrl } });
      const result = await api.artifacts.publish("a1");
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts/a1/publish");
      expect(options.method).toBe("POST");
      expect(result.artifact.isPublic).toBe(true);
      expect(result.publicUrl).toBe(publicUrl);
    });

    it("should propagate an API error for an unknown id", async () => {
      mockFetchResponse(
        { success: false, error: { code: "NOT_FOUND", message: "no artifact" } },
        404,
      );
      await expect(api.artifacts.publish("missing")).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });
  });

  describe("unpublish()", () => {
    it("should POST /artifacts/:id/unpublish and return the updated artifact", async () => {
      const unpublished: Artifact = { ...publishedArtifact, isPublic: false };
      mockFetchResponse({ success: true, data: { artifact: unpublished } });
      const result = await api.artifacts.unpublish("a1");
      const [url, options] = lastCall();
      expect(url).toContain("/artifacts/a1/unpublish");
      expect(options.method).toBe("POST");
      expect(result.artifact.isPublic).toBe(false);
      expect(result.artifact.shareToken).toBe("abc123def456ghi7");
    });
  });

  describe("download()", () => {
    it("should fetch the authed download endpoint WITH the api key and return blob + filename", async () => {
      localStorage.setItem("adjutant-api-key", "secret-key");
      const blob = new Blob(["<html></html>"], { type: "text/html" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: {
          get: (h: string) =>
            h.toLowerCase() === "content-disposition"
              ? 'attachment; filename="my-page.html"'
              : null,
        },
        blob: async () => blob,
      });

      const result = await api.artifacts.download("a1");

      const [url, options] = lastCall();
      expect(url).toContain("/artifacts/a1/download");
      expect((options.headers as Record<string, string>)["Authorization"]).toBe(
        "Bearer secret-key",
      );
      expect(result.filename).toBe("my-page.html");
      expect(result.blob).toBeInstanceOf(Blob);
    });

    it("should fall back to artifact-<id>.html when no filename header is present", async () => {
      const blob = new Blob(["<html></html>"], { type: "text/html" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: { get: () => null },
        blob: async () => blob,
      });

      const result = await api.artifacts.download("a1");
      expect(result.filename).toBe("artifact-a1.html");
    });

    it("should throw an ApiError on a failed download", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => null },
        blob: async () => new Blob([]),
      });
      await expect(api.artifacts.download("missing")).rejects.toMatchObject({
        code: "DOWNLOAD_ERROR",
      });
    });
  });

  describe("buildPublicArtifactUrl()", () => {
    it("should build <origin>/a/<token> when the API base is relative", () => {
      expect(buildPublicArtifactUrl("tok123")).toBe("https://dash.example/a/tok123");
    });
  });

  describe("buildArtifactDownloadUrl()", () => {
    it("should build <base>/artifacts/<id>/download (url-encoded)", () => {
      expect(buildArtifactDownloadUrl("a1")).toContain("/artifacts/a1/download");
    });
  });

  describe("Artifact type", () => {
    it("should carry the sharing fields", () => {
      const a: Artifact = publishedArtifact;
      expect(a.shareToken).toBe("abc123def456ghi7");
      expect(a.isPublic).toBe(true);
    });
  });
});
