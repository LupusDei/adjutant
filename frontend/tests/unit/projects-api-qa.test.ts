/**
 * QA tests for the frontend projects API client (adj-050.4.2).
 *
 * Verifies that api.projects.create() has the correct signature,
 * sends the right HTTP request, and handles response/error cases.
 *
 * @module tests/unit/projects-api-qa
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// Mock import.meta.env
vi.stubEnv("VITE_API_URL", undefined);

import { api, ApiError } from "../../src/services/api";

function mockFetchResponse(data: unknown, status = 200): void {
  mockFetch.mockResolvedValueOnce({
    ok: status >= 200 && status < 300,
    status,
    json: async () => data,
  });
}

function mockFetchError(errorCode: string, message: string, status = 400): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    json: async () => ({
      success: false,
      error: { code: errorCode, message },
    }),
  });
}

describe("QA: Frontend projects API client (adj-050.4.2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStorage.clear();
  });

  // ===========================================================================
  // api.projects.create() method existence and signature
  // ===========================================================================

  describe("api.projects.create() method", () => {
    it("should exist as a function", () => {
      expect(api.projects.create).toBeDefined();
      expect(typeof api.projects.create).toBe("function");
    });

    it("should send POST request to /projects endpoint", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-1",
          name: "test-project",
          path: "/tmp/test-project",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      await api.projects.create({
        cloneUrl: "https://github.com/user/test-project.git",
        targetDir: "/tmp/test-project",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, options] = mockFetch.mock.calls[0];
      expect(url).toContain("/projects");
      expect(options.method).toBe("POST");
    });

    it("should include targetDir in the request body when provided", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-1",
          name: "test-project",
          path: "/tmp/custom-dir",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      await api.projects.create({
        cloneUrl: "https://github.com/user/test-project.git",
        targetDir: "/tmp/custom-dir",
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.cloneUrl).toBe("https://github.com/user/test-project.git");
      expect(body.targetDir).toBe("/tmp/custom-dir");
    });

    it("should NOT include targetDir in the request body when not provided", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-1",
          name: "test-project",
          path: "/home/user/projects/test-project",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      await api.projects.create({
        cloneUrl: "https://github.com/user/test-project.git",
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.cloneUrl).toBe("https://github.com/user/test-project.git");
      expect(body.targetDir).toBeUndefined();
    });

    it("should support path mode create request", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-2",
          name: "local-project",
          path: "/Users/test/code/local-project",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      await api.projects.create({
        path: "/Users/test/code/local-project",
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.path).toBe("/Users/test/code/local-project");
      expect(body.cloneUrl).toBeUndefined();
    });

    it("should support empty project create request", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-3",
          name: "new-project",
          path: "/home/user/projects/new-project",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      await api.projects.create({
        name: "new-project",
        empty: true,
      });

      const [, options] = mockFetch.mock.calls[0];
      const body = JSON.parse(options.body as string);
      expect(body.name).toBe("new-project");
      expect(body.empty).toBe(true);
    });

    it("should return ProjectInfo on successful create", async () => {
      mockFetchResponse({
        success: true,
        data: {
          id: "proj-1",
          name: "test-project",
          path: "/tmp/test-project",
          gitRemote: "https://github.com/user/test-project.git",
          mode: "swarm",
          sessions: [],
          createdAt: "2026-03-06T00:00:00.000Z",
          hasBeads: false,
        },
      }, 201);

      const result = await api.projects.create({
        cloneUrl: "https://github.com/user/test-project.git",
        targetDir: "/tmp/test-project",
      });

      expect(result.id).toBe("proj-1");
      expect(result.name).toBe("test-project");
      expect(result.path).toBe("/tmp/test-project");
      expect(result.gitRemote).toBe("https://github.com/user/test-project.git");
    });
  });

  // ===========================================================================
  // Error handling
  // ===========================================================================

  describe("error handling for create", () => {
    it("should throw ApiError on validation error", async () => {
      mockFetchError("VALIDATION_ERROR", "Path does not exist", 400);

      await expect(
        api.projects.create({ path: "/nonexistent" })
      ).rejects.toThrow(ApiError);

      try {
        await api.projects.create({ path: "/nonexistent" });
      } catch (err) {
        // Need a fresh mock for the second call
      }
    });

    it("should throw ApiError on conflict", async () => {
      mockFetchError("CONFLICT", "Directory already exists", 409);

      await expect(
        api.projects.create({
          cloneUrl: "https://github.com/user/repo.git",
          targetDir: "/existing/dir",
        })
      ).rejects.toThrow(ApiError);
    });

    it("should throw ApiError on CLI error (clone failure)", async () => {
      mockFetchError("CLI_ERROR", "Git clone failed: authentication error", 500);

      await expect(
        api.projects.create({
          cloneUrl: "https://github.com/private/repo.git",
        })
      ).rejects.toThrow(ApiError);
    });

    it("should include error details in ApiError", async () => {
      mockFetchError("VALIDATION_ERROR", "Must provide path, cloneUrl, or empty with name", 400);

      try {
        await api.projects.create({});
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        const apiErr = err as ApiError;
        expect(apiErr.code).toBe("VALIDATION_ERROR");
        expect(apiErr.message).toContain("Must provide path");
      }
    });
  });

  // ===========================================================================
  // Other project API methods still work
  // ===========================================================================

  describe("other project methods are intact", () => {
    it("should have list() method", () => {
      expect(typeof api.projects.list).toBe("function");
    });

    it("should have get() method", () => {
      expect(typeof api.projects.get).toBe("function");
    });

    it("should have discover() method", () => {
      expect(typeof api.projects.discover).toBe("function");
    });

    it("should have health() method", () => {
      expect(typeof api.projects.health).toBe("function");
    });

    it("should have getOverview() method", () => {
      expect(typeof api.projects.getOverview).toBe("function");
    });
  });
});
