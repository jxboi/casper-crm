/**
 * Platform error taxonomy (D-016). Stable string codes that web/api map to
 * HTTP/UI responses and AI tools map to structured tool errors. Every module
 * throws `AppError`, never bare `Error`, for expected failure modes.
 */
export type AppErrorCode =
  | "not_found"
  | "permission_denied"
  | "validation_failed"
  | "conflict"
  | "budget_exceeded"
  | "rate_limited"
  | "unauthenticated"
  | "invalid_state"
  | "internal";

export interface AppErrorOptions {
  /** Machine-readable detail bag surfaced to callers (e.g. validation issues). */
  details?: unknown;
  /** Underlying cause, preserved for logs (never serialized to clients). */
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;

  constructor(code: AppErrorCode, message: string, opts: AppErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.details = opts.details;
  }

  static notFound(message = "Not found", details?: unknown): AppError {
    return new AppError("not_found", message, { details });
  }
  static permissionDenied(message = "Permission denied", details?: unknown): AppError {
    return new AppError("permission_denied", message, { details });
  }
  static validation(message = "Validation failed", details?: unknown): AppError {
    return new AppError("validation_failed", message, { details });
  }
  static conflict(message = "Conflict", details?: unknown): AppError {
    return new AppError("conflict", message, { details });
  }
  static invalidState(message = "Invalid state", details?: unknown): AppError {
    return new AppError("invalid_state", message, { details });
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
