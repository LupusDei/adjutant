/**
 * Tests for the uploads API client (adj-203.4.1 / T010).
 *
 * Verifies:
 *  - api.uploads.upload(file) POSTs a multipart body to /api/uploads, attaches
 *    the Authorization header when an API key is configured, and returns the
 *    backend attachment record ({ id, filename, mimeType, sizeBytes }).
 *  - a failed upload surfaces a structured ApiError (draft-preserve depends on it).
 *  - api.uploads.url(id) builds the GET /api/uploads/:id URL (id encoded).
 *  - api.uploads.fetchObjectUrl(id) fetches the image WITH auth and returns a
 *    blob object URL — `<img src>` cannot carry the Authorization header, so
 *    attachment images must be fetched through the authenticated client.
 *  - api.messages.send forwards attachmentIds in the POST body when provided,
 *    and omits the key entirely when not.
 *
 * @module tests/unit/api-uploads
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

import { api, ApiError, setApiKey } from "../../src/services/api";

interface UploadEnvelope {
  success: boolean;
  data?: { id: string; filename: string; mimeType: string; sizeBytes: number };
  error?: { code: string; message: string; details?: string };
}

function mockJson(data: unknown, status = 200): void {
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

function makeFile(): File {
  return new File([new Uint8Array([1, 2, 3, 4])], "shot.png", { type: "image/png" });
}

describe("api.uploads.upload", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSessionStorage.clear();
  });

  it("should POST a multipart body to /api/uploads and return the attachment record", async () => {
    const record = { id: "att-1", filename: "shot.png", mimeType: "image/png", sizeBytes: 4 };
    mockJson({ success: true, data: record } satisfies UploadEnvelope, 201);

    const result = await api.uploads.upload(makeFile());

    expect(result).toEqual(record);
    const [url, init] = lastCall();
    expect(url).toBe("/api/uploads");
    expect(init.method).toBe("POST");
    // Body must be FormData with the file under the 'file' field the backend expects.
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("file")).toBeInstanceOf(File);
    // The multipart boundary is set by the browser — we must NOT force a JSON
    // Content-Type header (that would corrupt the multipart parse).
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("should attach the Authorization header when an API key is configured", async () => {
    setApiKey("secret-key");
    mockJson(
      { success: true, data: { id: "att-2", filename: "a.png", mimeType: "image/png", sizeBytes: 4 } },
      201,
    );

    await api.uploads.upload(makeFile());

    const [, init] = lastCall();
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret-key");
  });

  it("should throw an ApiError when the upload is rejected", async () => {
    mockJson(
      { success: false, error: { code: "too-large", message: "Upload exceeds 10485760 bytes" } },
      400,
    );

    await expect(api.uploads.upload(makeFile())).rejects.toBeInstanceOf(ApiError);
  });

  it("should throw an ApiError with the backend code preserved", async () => {
    mockJson(
      { success: false, error: { code: "unsupported-type", message: "Only images allowed" } },
      400,
    );

    await expect(api.uploads.upload(makeFile())).rejects.toMatchObject({
      code: "unsupported-type",
      status: 400,
    });
  });
});

describe("api.uploads.url", () => {
  it("should build the GET /api/uploads/:id URL", () => {
    expect(api.uploads.url("att-1")).toBe("/api/uploads/att-1");
  });

  it("should URL-encode the id", () => {
    expect(api.uploads.url("a/b?c")).toBe("/api/uploads/a%2Fb%3Fc");
  });
});

describe("api.uploads.fetchObjectUrl", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSessionStorage.clear();
    // jsdom lacks URL.createObjectURL — stub it deterministically.
    globalThis.URL.createObjectURL = vi.fn(() => "blob:mock-url");
  });

  it("should fetch the image WITH the Authorization header and return a blob object URL", async () => {
    setApiKey("secret-key");
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      blob: async () => blob,
    });

    const objectUrl = await api.uploads.fetchObjectUrl("att-1");

    expect(objectUrl).toBe("blob:mock-url");
    const [url, init] = lastCall();
    expect(url).toBe("/api/uploads/att-1");
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer secret-key");
    expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(blob);
  });

  it("should throw an ApiError when the image fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, blob: async () => new Blob() });

    await expect(api.uploads.fetchObjectUrl("missing")).rejects.toBeInstanceOf(ApiError);
  });
});

describe("api.messages.send with attachmentIds", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockSessionStorage.clear();
  });

  it("should include attachmentIds in the POST body when provided", async () => {
    mockJson({ success: true, data: { messageId: "m1", timestamp: "2026-07-06T00:00:00Z" } });

    await api.messages.send({ to: "agent-1", body: "look", attachmentIds: ["att-1", "att-2"] });

    const [url, init] = lastCall();
    expect(url).toBe("/api/messages");
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body["attachmentIds"]).toEqual(["att-1", "att-2"]);
  });

  it("should omit attachmentIds from the body when not provided", async () => {
    mockJson({ success: true, data: { messageId: "m2", timestamp: "2026-07-06T00:00:00Z" } });

    await api.messages.send({ to: "agent-1", body: "hi" });

    const [, init] = lastCall();
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).not.toHaveProperty("attachmentIds");
  });
});
