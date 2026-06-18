import { afterEach, describe, it, expect } from "vitest";

import { resolvePublicBaseUrl } from "../../src/utils/public-url.js";

/**
 * adj-200.2.6.1 — the proposal share link is the core deliverable. When Adjutant is
 * served through a reverse proxy / tunnel (ngrok), the publish route must build the
 * public URL from the EXTERNAL origin (X-Forwarded-Proto/Host), not the internal
 * direct-connection scheme/host — otherwise the shared link is http://localhost.
 */

/** Minimal Express-Request-like stub: a Host header plus arbitrary forwarded headers. */
function fakeReq(opts: {
  protocol?: string;
  host?: string;
  forwardedProto?: string;
  forwardedHost?: string;
}): { protocol: string; get(name: string): string | undefined } {
  const headers: Record<string, string | undefined> = {
    host: opts.host,
    "x-forwarded-proto": opts.forwardedProto,
    "x-forwarded-host": opts.forwardedHost,
  };
  return {
    protocol: opts.protocol ?? "http",
    get(name: string): string | undefined {
      return headers[name.toLowerCase()];
    },
  };
}

describe("resolvePublicBaseUrl", () => {
  const ORIG_ENV = process.env.PROPOSAL_PUBLIC_BASE_URL;
  afterEach(() => {
    if (ORIG_ENV === undefined) delete process.env.PROPOSAL_PUBLIC_BASE_URL;
    else process.env.PROPOSAL_PUBLIC_BASE_URL = ORIG_ENV;
  });

  it("should use X-Forwarded-Proto and X-Forwarded-Host behind a tunnel", () => {
    delete process.env.PROPOSAL_PUBLIC_BASE_URL;
    const base = resolvePublicBaseUrl(
      fakeReq({
        protocol: "http",
        host: "localhost:8787",
        forwardedProto: "https",
        forwardedHost: "happy-otter.ngrok.app",
      }),
    );
    expect(base).toBe("https://happy-otter.ngrok.app");
  });

  it("should fall back to req.protocol and Host header with no forwarded headers", () => {
    delete process.env.PROPOSAL_PUBLIC_BASE_URL;
    const base = resolvePublicBaseUrl(fakeReq({ protocol: "http", host: "localhost:8787" }));
    expect(base).toBe("http://localhost:8787");
  });

  it("should use the FIRST value when forwarded headers are comma-chained", () => {
    delete process.env.PROPOSAL_PUBLIC_BASE_URL;
    const base = resolvePublicBaseUrl(
      fakeReq({
        protocol: "http",
        host: "internal:80",
        forwardedProto: "https, http",
        forwardedHost: "edge.example.com, internal:80",
      }),
    );
    expect(base).toBe("https://edge.example.com");
  });

  it("should honor PROPOSAL_PUBLIC_BASE_URL override (trailing slash trimmed)", () => {
    process.env.PROPOSAL_PUBLIC_BASE_URL = "https://shares.example.com/";
    const base = resolvePublicBaseUrl(
      fakeReq({ forwardedProto: "http", forwardedHost: "ignored.example.com" }),
    );
    expect(base).toBe("https://shares.example.com");
  });

  it("should default scheme/host when nothing is available", () => {
    delete process.env.PROPOSAL_PUBLIC_BASE_URL;
    const base = resolvePublicBaseUrl(fakeReq({ protocol: "", host: undefined }));
    expect(base).toBe("http://localhost");
  });
});
