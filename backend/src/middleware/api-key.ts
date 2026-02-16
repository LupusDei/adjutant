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
