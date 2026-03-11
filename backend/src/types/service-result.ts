/**
 * Unified service result type for all service operations.
 *
 * Replaces per-service result wrappers (BeadsServiceResult, AgentsServiceResult, etc.)
 * that all shared the same `{ success, data?, error? }` shape.
 */

export interface ServiceError {
  code: string;
  message: string;
}

export interface ServiceResult<T> {
  success: boolean;
  data?: T;
  error?: ServiceError;
}

/** Convenience constructor for success results. */
export function ok<T>(data: T): ServiceResult<T> {
  return { success: true, data };
}

/** Convenience constructor for failure results. */
export function fail(code: string, message: string): ServiceResult<never> {
  return { success: false, error: { code, message } };
}
