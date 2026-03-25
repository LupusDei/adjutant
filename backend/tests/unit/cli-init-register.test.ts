import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock global fetch before importing the module
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { registerWithBackend } from "../../../cli/commands/init.js";

describe("registerWithBackend", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return created when backend responds 201", async () => {
    mockFetch.mockResolvedValue({ status: 201 });

    const result = await registerWithBackend("/some/project");

    expect(result.status).toBe("created");
    expect(result.message).toContain("registered");
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:4201/api/projects",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ path: "/some/project" }),
      }),
    );
  });

  it("should return skipped when project already registered (409)", async () => {
    mockFetch.mockResolvedValue({ status: 409, text: () => Promise.resolve("conflict") });

    const result = await registerWithBackend("/existing/project");

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("already registered");
  });

  it("should return warn when backend is not running", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await registerWithBackend("/some/project");

    expect(result.status).toBe("warn");
    expect(result.message).toContain("backend not running");
  });

  it("should return warn with status for unexpected HTTP responses", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      text: () => Promise.resolve("Internal Server Error"),
    });

    const result = await registerWithBackend("/some/project");

    expect(result.status).toBe("warn");
    expect(result.message).toContain("HTTP 500");
  });

  it("should truncate long error response bodies", async () => {
    const longBody = "x".repeat(200);
    mockFetch.mockResolvedValue({
      status: 400,
      text: () => Promise.resolve(longBody),
    });

    const result = await registerWithBackend("/some/project");

    expect(result.status).toBe("warn");
    // Body should be truncated to 100 chars
    expect(result.message!.length).toBeLessThan(200);
  });
});
