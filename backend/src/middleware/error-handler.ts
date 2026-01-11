import type { ErrorRequestHandler, RequestHandler } from 'express';

/**
 * Application error with structured fields for API responses.
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 500,
    public readonly details?: string
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'BAD_REQUEST', details?: string): AppError {
    return new AppError(code, message, 400, details);
  }

  static notFound(message: string, code = 'NOT_FOUND', details?: string): AppError {
    return new AppError(code, message, 404, details);
  }

  static internal(message: string, code = 'INTERNAL_ERROR', details?: string): AppError {
    return new AppError(code, message, 500, details);
  }

  static serviceUnavailable(message: string, code = 'SERVICE_UNAVAILABLE', details?: string): AppError {
    return new AppError(code, message, 503, details);
  }
}

/**
 * Error response matching ApiResponse<never> format.
 */
interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: string;
  };
  timestamp: string;
}

/**
 * Global error handling middleware.
 * Catches all errors and returns structured ApiResponse format.
 */
export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  // Determine error details
  let statusCode = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'An unexpected error occurred';
  let details: string | undefined;

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof SyntaxError && 'body' in err) {
    // JSON parse error from express.json()
    statusCode = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  } else if (err instanceof Error) {
    message = err.message;
    // Log unexpected errors in non-production
    if (process.env['NODE_ENV'] !== 'production') {
      console.error('Unhandled error:', err);
    }
  }

  const response: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
    },
    timestamp: new Date().toISOString(),
  };

  res.status(statusCode).json(response);
};

/**
 * 404 handler for unknown routes.
 */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new AppError('NOT_FOUND', `Route ${req.method} ${req.path} not found`, 404));
};
