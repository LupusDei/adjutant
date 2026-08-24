/**
 * API Key Authentication Middleware
 *
 * Validates API keys on incoming requests.
 * Keys should be provided via Authorization header: "Bearer <api-key>"
 */

import type { RequestHandler } from "express";
import { hasApiKeys, validateApiKey } from "../services/api-key-service.js";
import { unauthorized } from "../utils/responses.js";
import { logWarn } from "../utils/logger.js";

/**
 * Paths that bypass API key authentication.
 * Health check is always public.
 */
const PUBLIC_PATHS = ["/health"];

/**
 * Path prefixes that bypass API key authentication.
 * - /mcp: MCP routes use their own identity system (agentId header on connect).
 * - /p/:  public, shareable proposal pages (adj-200) — intentionally no-API-key so a
 *         link works in any browser. Also mounted before this middleware in index.ts;
 *         listed here as defense in depth against future mount-order changes. The
 *         trailing slash keeps this from matching unrelated `/p…` routes (e.g. future
 *         /ping, /preview) — only the `/p/:token` page bypasses auth.
 * - /a/:  public, shareable Artifact pages (adj-j7az6) — same no-API-key contract as /p/.
 */
const PUBLIC_PREFIXES = ["/mcp", "/p/", "/a/", "/avatar"];

/**
 * Extract bearer token from Authorization header.
 */
function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const regex = /^Bearer\s+(.+)$/i;
  const match = regex.exec(authHeader);
  return match?.[1] ?? null;
}

/**
 * API key validation middleware.
 *
 * Behavior:
 * - If no API keys are configured, all requests are allowed (open mode)
 * - If keys are configured, requests must provide a valid key
 * - Returns 401 Unauthorized for invalid/missing keys
 */
export const apiKeyAuth: RequestHandler = (req, res, next) => {
  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(req.path)) {
    next();
    return;
  }

  // Skip auth for public path prefixes (MCP uses its own identity system)
  if (PUBLIC_PREFIXES.some((prefix) => req.path.startsWith(prefix))) {
    next();
    return;
  }

  // If no keys configured, allow all (open mode for development)
  if (!hasApiKeys()) {
    next();
    return;
  }

  // Extract and validate the API key
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    logWarn("request rejected: missing API key", {
      path: req.path,
      method: req.method,
      ip: req.ip,
    });
    return res.status(401).json(unauthorized("API key required"));
  }

  if (!validateApiKey(token)) {
    logWarn("request rejected: invalid API key", {
      path: req.path,
      method: req.method,
      ip: req.ip,
      keyPrefix: token.slice(0, 8),
    });
    return res.status(401).json(unauthorized("Invalid API key"));
  }

  // Valid key - proceed
  next();
  return;
};

/**
 * Fail-closed API key requirement for individually sensitive routes (adj-4lp30).
 *
 * {@link apiKeyAuth} is deliberately permissive: "if no API keys are configured, allow all
 * (open mode for development)". That default is what left POST /api/bridge/tool — a read surface
 * over the whole fleet, returning channel titles, member lists and message bodies — answering
 * anonymous requests from the public internet, because this deployment's key store holds zero
 * keys. Being mounted behind apiKeyAuth bought it nothing.
 *
 * This guard never opens. A route wearing it requires a valid key whether or not the server has
 * any configured, so "we never provisioned a key" can never silently mean "everyone is welcome".
 *
 * Responses are a uniform 401 for missing, malformed, and invalid keys alike — an attacker must
 * not be able to tell from the outside whether the server has keys configured at all.
 *
 * Apply it per-route rather than to a whole router: sibling routes may be intentionally reachable
 * (POST /api/bridge/session is how the web voice path starts), and blanket-gating them would trade
 * a security fix for an outage.
 */
export const requireApiKey: RequestHandler = (req, res, next) => {
  const token = extractBearerToken(req.headers.authorization);

  if (token === null || !validateApiKey(token)) {
    logWarn("request rejected: route requires an API key (fail-closed)", {
      path: req.path,
      method: req.method,
      ip: req.ip,
      presented: token !== null,
    });
    res.status(401).json(unauthorized("API key required"));
    return;
  }

  next();
};
