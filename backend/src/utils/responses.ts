/**
 * API response helper functions.
 * Creates consistent response envelopes for all endpoints.
 *
 * @module utils/responses
 */
import type { ApiResponse, PaginatedResponse } from "../types/index.js";

// =============================================================================
// Common Error Codes
// =============================================================================

export const ErrorCode = {
  // Client errors (4xx)
  BAD_REQUEST: "BAD_REQUEST",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  CONFLICT: "CONFLICT",

  // Server errors (5xx)
  INTERNAL_ERROR: "INTERNAL_ERROR",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  CLI_ERROR: "CLI_ERROR",
  TIMEOUT: "TIMEOUT",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

// =============================================================================
// Response Builders
// =============================================================================

/**
 * Create a successful API response.
 *
 * @example
 * ```ts
 * res.json(success({ id: "123", name: "Test" }));
 * // { success: true, data: { id: "123", name: "Test" }, timestamp: "..." }
 * ```
 */
export function success<T>(data: T): ApiResponse<T> {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create an error API response.
 *
 * @example
 * ```ts
 * res.status(404).json(error("NOT_FOUND", "Message not found"));
 * // { success: false, error: { code: "NOT_FOUND", message: "..." }, timestamp: "..." }
 * ```
 */
export function error(
  code: ErrorCode | string,
  message: string,
  details?: string
): ApiResponse<never> {
  return {
    success: false,
    error: {
      code,
      message,
      ...(details && { details }),
    },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create a paginated response wrapper.
 *
 * @example
 * ```ts
 * const messages = await getMessages(offset, limit);
 * res.json(success(paginated(messages, 100, offset + limit < 100)));
 * ```
 */
export function paginated<T>(
  items: T[],
  total: number,
  hasMore: boolean
): PaginatedResponse<T> {
  return {
    items,
    total,
    hasMore,
  };
}

// =============================================================================
// Convenience Error Helpers
// =============================================================================

/** Create a 400 Bad Request error response */
export function badRequest(
  message: string,
  details?: string
): ApiResponse<never> {
  return error(ErrorCode.BAD_REQUEST, message, details);
}

/** Create a 400 Validation Error response (for Zod errors) */
export function validationError(
  message: string,
  details?: string
): ApiResponse<never> {
  return error(ErrorCode.VALIDATION_ERROR, message, details);
}

/** Create a 404 Not Found error response */
export function notFound(
  resource: string,
  id?: string
): ApiResponse<never> {
  const message = id ? `${resource} '${id}' not found` : `${resource} not found`;
  return error(ErrorCode.NOT_FOUND, message);
}

/** Create a 401 Unauthorized error response */
export function unauthorized(message = "Authentication required"): ApiResponse<never> {
  return error(ErrorCode.UNAUTHORIZED, message);
}

/** Create a 403 Forbidden error response */
export function forbidden(message = "Access denied"): ApiResponse<never> {
  return error(ErrorCode.FORBIDDEN, message);
}

/** Create a 409 Conflict error response */
export function conflict(message: string): ApiResponse<never> {
  return error(ErrorCode.CONFLICT, message);
}

/** Create a 500 Internal Server Error response */
export function internalError(
  message = "An unexpected error occurred",
  details?: string
): ApiResponse<never> {
  return error(ErrorCode.INTERNAL_ERROR, message, details);
}

/** Create a 503 Service Unavailable response */
export function serviceUnavailable(
  message = "Service temporarily unavailable"
): ApiResponse<never> {
  return error(ErrorCode.SERVICE_UNAVAILABLE, message);
}

/** Create a CLI error response (command failed) */
export function cliError(
  command: string,
  stderr?: string
): ApiResponse<never> {
  return error(
    ErrorCode.CLI_ERROR,
    `Command '${command}' failed`,
    stderr
  );
}

/** Create a timeout error response */
export function timeout(
  operation: string,
  timeoutMs: number
): ApiResponse<never> {
  return error(
    ErrorCode.TIMEOUT,
    `${operation} timed out after ${timeoutMs}ms`
  );
}
