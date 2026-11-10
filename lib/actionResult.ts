/**
 * Shared result type for server actions.
 *
 * Actions return a discriminated union instead of throwing, so the client can
 * branch on `ok` and never sees raw infrastructure errors.
 *
 * `messageKey` is an optional i18n key (relative to the calling page's
 * next-intl namespace) for a more specific user-facing message than `code`
 * alone, e.g. { ok: false, code: "VALIDATION", messageKey: "ageMinError" }.
 */
export type ErrorCode =
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "INTERNAL";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; code: ErrorCode; messageKey?: string };

export function ok(): { ok: true; data: undefined };
export function ok<T>(data: T): { ok: true; data: T };
export function ok<T>(data?: T) {
  return { ok: true as const, data };
}

export function fail(code: ErrorCode, messageKey?: string): { ok: false; code: ErrorCode; messageKey?: string } {
  return messageKey ? { ok: false, code, messageKey } : { ok: false, code };
}
