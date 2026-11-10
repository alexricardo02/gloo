/**
 * Single source of truth for the password policy (S15). Pure and dependency-free
 * so it can run on the server (register / reset) and in client components
 * (live strength hints).
 *
 * Policy:
 *  - any characters are allowed (Unicode, spaces, any symbol)
 *  - at least PASSWORD_MIN_LENGTH characters (counted as Unicode code points)
 *  - at most PASSWORD_MAX_BYTES bytes in UTF-8 (bcrypt silently ignores
 *    everything after byte 72, so longer passwords would be truncated)
 *  - at least one uppercase letter, one number and one special character
 *    (= anything that is not a letter or a digit)
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordCriteria {
  length: boolean;
  uppercase: boolean;
  number: boolean;
  special: boolean;
  maxBytes: boolean;
}

export type PasswordValidation =
  | { ok: true }
  | { ok: false; reason: "WEAK" | "TOO_LONG" };

export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function getPasswordCriteria(password: string): PasswordCriteria {
  const value = typeof password === "string" ? password : "";
  return {
    length: [...value].length >= PASSWORD_MIN_LENGTH,
    uppercase: /\p{Lu}/u.test(value),
    number: /\p{Nd}/u.test(value),
    special: /[^\p{L}\p{Nd}]/u.test(value),
    maxBytes: utf8ByteLength(value) <= PASSWORD_MAX_BYTES,
  };
}

/** True when every "strength" rule passes (ignores the max-length rule). */
export function meetsPasswordStrength(c: PasswordCriteria): boolean {
  return c.length && c.uppercase && c.number && c.special;
}

export function validatePassword(password: unknown): PasswordValidation {
  if (typeof password !== "string") return { ok: false, reason: "WEAK" };
  const criteria = getPasswordCriteria(password);
  if (!criteria.maxBytes) return { ok: false, reason: "TOO_LONG" };
  if (!meetsPasswordStrength(criteria)) return { ok: false, reason: "WEAK" };
  return { ok: true };
}

/** i18n key (Register / ResetPassword namespaces) for a failed validation. */
export function passwordErrorKey(reason: "WEAK" | "TOO_LONG"): string {
  return reason === "TOO_LONG" ? "passwordTooLongError" : "passwordWeakError";
}
