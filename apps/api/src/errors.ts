// Error envelope + status semantics (docs/api-contract.md "Error envelope").
// The one thing global reads must get right here: a DB outage becomes 503 with
// a retry hint, never a silent empty list (07-api.md §7.5).

import type { ApiError } from "@monkyesuite/shared";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export type ErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "gone"
  | "validation_error"
  | "server_error"
  | "service_unavailable";

const STATUS: Record<ErrorCode, ContentfulStatusCode> = {
  bad_request: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  gone: 410,
  validation_error: 422,
  server_error: 500,
  service_unavailable: 503,
};

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = (message = "Not found.") =>
  new HttpError("not_found", message);
export const validationError = (message: string) =>
  new HttpError("validation_error", message);
export const unauthenticated = (message = "Sign in required.") =>
  new HttpError("unauthenticated", message);
export const forbidden = (message = "Not permitted.") =>
  new HttpError("forbidden", message);
export const conflict = (message: string) => new HttpError("conflict", message);
export const gone = (message: string) => new HttpError("gone", message);

// Postgres unique-violation (e.g. duplicate project slug, duplicate tag apply)
// → 409 conflict. drizzle-orm wraps the real pg error in a DrizzleQueryError,
// so the SQLSTATE lands on `.cause.code`, not the thrown error itself — check
// both so this holds regardless of which layer's error object is passed in.
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export function sendError(c: Context, err: HttpError) {
  const body: ApiError = {
    error: {
      code: err.code,
      message: err.message,
      ...(err.retryAfter !== undefined ? { retryAfter: err.retryAfter } : {}),
    },
  };
  const status = STATUS[err.code];
  if (err.retryAfter !== undefined)
    c.header("Retry-After", String(err.retryAfter));
  return c.json(body, status);
}

// Postgres connection failures (server down, pool exhausted, auth) surface as
// 503 with a retry hint rather than an empty result.
const DB_DOWN_CODES = new Set([
  "ECONNREFUSED",
  "ETIMEDOUT",
  "ENOTFOUND",
  "57P03",
  "08006",
  "08001",
  "53300",
]);

export function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  const anyErr = err as { code?: string; cause?: { code?: string } } | null;
  const code = anyErr?.code ?? anyErr?.cause?.code;
  if (code && DB_DOWN_CODES.has(code)) {
    return new HttpError(
      "service_unavailable",
      "Database temporarily unavailable.",
      5,
    );
  }
  const msg = (err as { message?: string } | null)?.message;
  return new HttpError(
    "server_error",
    msg ? `Server error: ${msg}` : "Unexpected server error.",
  );
}
