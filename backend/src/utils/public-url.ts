/**
 * adj-200.2.6.1 — resolve the EXTERNAL base URL of the dashboard for building public
 * share links (`/p/:token`).
 *
 * Adjutant is served through a reverse proxy / tunnel (ngrok), so the direct-connection
 * `req.protocol` / Host header resolve to the internal origin (e.g. `http://localhost`).
 * The share link is the core deliverable, so it must reflect the EXTERNAL origin. We
 * resolve, in order:
 *   1. An explicit `PROPOSAL_PUBLIC_BASE_URL` override (deployment-pinned origin).
 *   2. The `X-Forwarded-Proto` / `X-Forwarded-Host` headers set by the proxy/tunnel.
 *   3. The request's own protocol + Host header (direct, no proxy).
 *
 * The app also sets `trust proxy` (index.ts) so Express's own `req.protocol`/`req.ip`
 * reflect the proxy; reading the forwarded headers here additionally preserves any host
 * PORT (which `req.hostname` strips) and works in isolation for testing.
 */

/** The subset of an Express `Request` we need (kept minimal so it is trivially testable). */
export interface PublicUrlRequest {
  protocol: string;
  get(name: string): string | undefined;
}

/** X-Forwarded-* headers may be a comma-chained list (proxy hops); the leftmost is the client-facing origin. */
function firstForwardedValue(headerValue: string | undefined): string | undefined {
  if (!headerValue) return undefined;
  const first = headerValue.split(",")[0]?.trim();
  return first && first.length > 0 ? first : undefined;
}

/**
 * Resolve the external base URL (`scheme://host[:port]`, no trailing slash) for public links.
 */
export function resolvePublicBaseUrl(req: PublicUrlRequest): string {
  const configured = process.env["PROPOSAL_PUBLIC_BASE_URL"]?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  const proto = firstForwardedValue(req.get("x-forwarded-proto")) || req.protocol || "http";
  const host = firstForwardedValue(req.get("x-forwarded-host")) || req.get("host") || "localhost";
  return `${proto}://${host}`;
}
