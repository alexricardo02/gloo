import { describe, it, expect } from "vitest";
import {
  PASSWORD_MAX_BYTES,
  getPasswordCriteria,
  passwordErrorKey,
  utf8ByteLength,
  validatePassword,
} from "@/lib/password";

describe("shared password validator (S15)", () => {
  it.each([
    "ValidPass123!",
    "Valid Pass 123", // space counts as a special character
    "Passw0rd#", // '#' was rejected by the old regex
    "Pässwörd1€", // non-ASCII letters and symbols
    "ÜBERGRÖßE1_",
  ])("accepts %s (any characters allowed)", (pw) => {
    expect(validatePassword(pw)).toEqual({ ok: true });
  });

  it.each([
    ["too short", "Ab1!xyz"],
    ["no uppercase", "lowercase1!"],
    ["no number", "NoNumber!!"],
    ["no special character", "NoSpecial123"],
    ["empty", ""],
  ])("rejects a password that is %s", (_why, pw) => {
    expect(validatePassword(pw)).toEqual({ ok: false, reason: "WEAK" });
  });

  it("rejects non-strings", () => {
    expect(validatePassword(undefined)).toEqual({ ok: false, reason: "WEAK" });
    expect(validatePassword(12345678)).toEqual({ ok: false, reason: "WEAK" });
  });

  it("counts the minimum length in characters, not bytes", () => {
    // 7 characters but 13 bytes: still too short.
    expect(getPasswordCriteria("Ää1!äää").length).toBe(false);
    expect(getPasswordCriteria("Ää1!ääää").length).toBe(true);
  });

  it("allows exactly 72 UTF-8 bytes and rejects 73", () => {
    const at72 = "Aa1!" + "x".repeat(68);
    expect(utf8ByteLength(at72)).toBe(PASSWORD_MAX_BYTES);
    expect(validatePassword(at72)).toEqual({ ok: true });

    const at73 = at72 + "x";
    expect(validatePassword(at73)).toEqual({ ok: false, reason: "TOO_LONG" });
  });

  it("measures the maximum in bytes, so multi-byte characters hit it sooner", () => {
    // 36 'é' = 72 bytes; adding one more character crosses the bcrypt limit.
    const pw = "A1!" + "é".repeat(35); // 3 + 70 = 73 bytes, only 38 characters
    expect([...pw].length).toBe(38);
    expect(validatePassword(pw)).toEqual({ ok: false, reason: "TOO_LONG" });
  });

  it("maps reasons to i18n keys", () => {
    expect(passwordErrorKey("WEAK")).toBe("passwordWeakError");
    expect(passwordErrorKey("TOO_LONG")).toBe("passwordTooLongError");
  });
});
