"use server";

import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { validateImage } from "@/lib/validateImage";
import { type ActionResult, fail, ok } from "@/lib/actionResult";
import { validatePassword, passwordErrorKey } from "@/lib/password";
import { calendarDateToUtcDate, isAtLeastAge, parseCalendarDate } from "@/lib/birthdate";
import {
  SESSION_COOKIE,
  createSession,
  destroyCurrentSession,
  getCurrentSessionTokenHash,
  getOptionalUserId,
  requireUserId,
} from "@/lib/session";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { isEmailFlowEnabled } from "@/lib/features";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_ROUNDS = 10;
const TOO_MANY_ATTEMPTS = "tooManyAttemptsError";

/** Returns the first issue's message if it is a known i18n key, else `fallback`. */
function firstIssueKey(error: z.ZodError, known: readonly string[], fallback: string): string {
  const message = error.issues[0]?.message;
  return message && known.includes(message) ? message : fallback;
}

function isUniqueViolation(error: unknown): error is { code: "P2002"; meta?: { target?: unknown } } {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

/** Normalised unique-constraint target, e.g. "email" (shape differs across Prisma adapters). */
function uniqueViolationTarget(error: { meta?: { target?: unknown } }): string {
  const target = error.meta?.target;
  return Array.isArray(target) ? target.join(",") : JSON.stringify(target ?? "");
}

// ── Register ─────────────────────────────────────────────────────────────────

const REGISTER_ERROR_KEYS = [
  "dobInvalidError",
  "ageMinError",
  "invalidEmailError",
  "usernameTooShort",
  "usernameSpaceError",
  "passwordWeakError",
  "passwordTooLongError",
  "registrationGenericError",
] as const;

const RegisterSchema = z.object({
  birthDate: z
    .string({ error: "dobInvalidError" })
    .superRefine((raw, ctx) => {
      const date = parseCalendarDate(raw);
      if (!date) ctx.addIssue({ code: "custom", message: "dobInvalidError" });
      else if (!isAtLeastAge(date, 18)) ctx.addIssue({ code: "custom", message: "ageMinError" });
    })
    .transform((raw) => calendarDateToUtcDate(parseCalendarDate(raw)!)),
  email: z
    .string({ error: "invalidEmailError" })
    .max(254, { error: "invalidEmailError" })
    .regex(EMAIL_REGEX, { error: "invalidEmailError" }),
  username: z
    .string({ error: "usernameTooShort" })
    .min(3, { error: "usernameTooShort" })
    .max(50, { error: "registrationGenericError" })
    .refine((u) => !/\s/.test(u), { error: "usernameSpaceError" }),
  password: z.string({ error: "passwordWeakError" }).superRefine((pw, ctx) => {
    const result = validatePassword(pw);
    if (!result.ok) ctx.addIssue({ code: "custom", message: passwordErrorKey(result.reason) });
  }),
  name: z
    .string({ error: "registrationGenericError" })
    .trim()
    .min(1, { error: "registrationGenericError" })
    .max(100, { error: "registrationGenericError" }),
});

/**
 * Registers a new user and establishes their initial security boundaries.
 * Enforces strict age verification (18+) and the shared password policy.
 * Accounts are always created with isVerified: false.
 *
 * EMAIL_FLOWS_ENABLED on: the account stays locked until email confirmation.
 * S14: the result is identical whether or not the email is already registered
 * ("check your email"), so the form cannot be used to enumerate accounts.
 * The username availability check remains (rate limited).
 *
 * EMAIL_FLOWS_ENABLED off (default, see lib/features.ts): no verification token;
 * the user is signed in and redirected like after a login. A taken email
 * returns `emailExistsError`.
 *
 * @param formData - Contains email, password, username, name, and birthDate.
 * @param locale - The current routing locale (verification link / redirect target).
 * @returns ActionResult on failure, or with email flows on; redirects on success with them off.
 *          On failure `messageKey` is a key in the "Register" i18n namespace.
 */
export async function registerUser(
  formData: FormData,
  locale: string,
): Promise<ActionResult<{ needsVerification: true }>> {
  const rawEmail = formData.get("email");
  const genericSuccess = ok({ needsVerification: true as const });

  try {
    const allowed = await checkRateLimit("register", {
      ip: await getClientIp(),
      identifier: typeof rawEmail === "string" ? rawEmail : null,
    });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);
  } catch (error) {
    console.error("Registration rate limiter error:", error);
    return fail("INTERNAL", "registrationGenericError");
  }

  const parsed = RegisterSchema.safeParse({
    birthDate: formData.get("birthDate") ?? undefined,
    email: rawEmail ?? undefined,
    username: formData.get("username") ?? undefined,
    password: formData.get("password") ?? undefined,
    name: formData.get("name") ?? undefined,
  });
  if (!parsed.success) {
    return fail("VALIDATION", firstIssueKey(parsed.error, REGISTER_ERROR_KEYS, "registrationGenericError"));
  }
  const { email, username, password, name, birthDate } = parsed.data;
  const emailFlows = isEmailFlowEnabled();

  try {
    const existingUsername = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (existingUsername) {
      return fail("VALIDATION", "usernameTakenError");
    }

    // Hash before looking at the email so both outcomes cost the same bcrypt time.
    const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const existingEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingEmail) {
      // Without email there is no "check your inbox" to hide behind, so the
      // user is told directly (the username check already reveals accounts too).
      if (!emailFlows) return fail("VALIDATION", "emailExistsError");
      // TODO: email the owner ("someone tried to sign up with your address")
      //       once a mail provider is wired up. Never tell the requester.
      if (process.env.NODE_ENV === "development") {
        console.log(`\n[EMAIL SIMULATION] Sign-up attempt for an already registered email: ${email}\n`);
      }
      return genericSuccess;
    }

    if (emailFlows) {
      const verificationToken = crypto.randomUUID();

      const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await prisma.user.create({
        data: {
          email,
          username,
          name,
          password: hashedPassword,
          birthDate,
          // Account stays locked until the user confirms their email.
          // This prevents access with typo'd or stolen email addresse
          isVerified: false,
          verificationToken,
          verificationTokenExpiry,
        },
      });

      // DEV-ONLY: log the full verification link so developers can click it
      // directly from the terminal. The token is intentionally exposed here —
      // this is a known, accepted trade-off for local development convenience.
      // TODO: replace this block with Resend / SendGrid in production and
      //       re-apply the H-5 restriction (token must never appear in logs).
      if (process.env.NODE_ENV === "development") {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
        const verificationUrl = `${baseUrl}/${locale}/verify?token=${verificationToken}`;
        console.log(`\n[EMAIL SIMULATION] Verification email for: ${email}`);
        console.log(`[EMAIL SIMULATION] Click to verify → ${verificationUrl}\n`);
      }

      return genericSuccess;
    }

    // Email flows suspended: no verification token is generated or logged.
    // isVerified stays truthful (false); login does not require it while the flag is off.
    const user = await prisma.user.create({
      data: { email, username, name, password: hashedPassword, birthDate, isVerified: false },
      select: { id: true },
    });
    await createSession(user.id);
    const cookieStore = await cookies();
    cookieStore.delete("gloo_is_guest");
  } catch (error) {
    // A concurrent registration hit a unique constraint after our checks.
    if (isUniqueViolation(error)) {
      const target = uniqueViolationTarget(error);
      if (target.includes("username")) return fail("VALIDATION", "usernameTakenError");
      if (target.includes("email")) return emailFlows ? genericSuccess : fail("VALIDATION", "emailExistsError");
    }
    console.error("Registration critical error:", error);
    return fail("INTERNAL", "registrationGenericError");
  }

  // Only reached with email flows off: signed in, go where a successful login goes.
  // Outside the try: redirect() works by throwing and must not be caught.
  redirect(`/${locale}/search-groups`);
}

// ── Login ────────────────────────────────────────────────────────────────────

const LoginSchema = z.object({
  identifier: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
});

/**
 * Authenticates a user using either their email or username.
 * Creates a server-side session (lib/session.ts) and sets the HttpOnly session cookie.
 * Rejects authentication if the user's email has not been verified (only while
 * EMAIL_FLOWS_ENABLED is on; see lib/features.ts).
 *
 * @param formData - Contains the identifier (email/username) and raw password.
 * @param locale - The current routing locale for redirection after successful login.
 * @returns Only on failure (success redirects); `messageKey` is a key in the "Login" namespace.
 */
export async function loginUser(formData: FormData, locale: string): Promise<ActionResult> {
  const parsed = LoginSchema.safeParse({
    identifier: formData.get("identifier") ?? undefined,
    password: formData.get("password") ?? undefined,
  });
  if (!parsed.success) return fail("VALIDATION", "invalidCredentialsError");
  const { identifier, password } = parsed.data;

  try {
    const allowed = await checkRateLimit("login", { ip: await getClientIp(), identifier });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);

    const user = await prisma.user.findFirst({
      where: {
        OR: [{ email: identifier }, { username: identifier }],
      },
      select: { id: true, password: true, isVerified: true },
    });

    if (!user) return fail("UNAUTHORIZED", "invalidCredentialsError");

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) return fail("UNAUTHORIZED", "invalidCredentialsError");

    // Without email flows nobody can verify, so verification is not required.
    if (isEmailFlowEnabled() && !user.isVerified) {
      return fail("FORBIDDEN", "emailNotVerifiedError");
    }

    await createSession(user.id);
    const cookieStore = await cookies();
    cookieStore.delete("gloo_is_guest");
  } catch (error) {
    console.error("Login error:", error);
    return fail("INTERNAL", "error");
  }

  // Outside the try: redirect() works by throwing and must not be caught.
  redirect(`/${locale}/search-groups`);
}

export async function getCurrentUser() {

  try {
    const userId = await getOptionalUserId();
    if (!userId) return null;

    return await prisma.user.findUnique({
      where: { id: userId },
      select: {
        name: true,
        username: true,
        image: true,
        email: true,
      },
    });
  } catch (error) {
    console.error("Connection error in getCurrentUser:", error);
    return null;
  }
}

export async function logOutAction(locale: string) {
  try {
    // Deletes this browser's session row (server-side revocation) and the cookie.
    await destroyCurrentSession();
  } catch (error) {
    console.error("Error revoking session on logout:", error);
  }

  const cookieStore = await cookies();
  const guestId = crypto.randomUUID();

  // After logout the user lands on the discovery feed, which requires a valid
  // session to render. Setting guest cookies prevents a redirect loop by
  // providing a browsing session without account privileges.
  cookieStore.set("gloo_is_guest", "true", {
    path: "/",
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  cookieStore.set("gloo_guest_id", guestId, {
    path: "/",
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  redirect(`/${locale}/search-groups`);
}

/**
 * Live username availability check for the register form (rate limited per IP
 * and per username, S8/S14).
 */
export async function checkUsernameAvailability(
  username: string,
): Promise<ActionResult<{ available: boolean }>> {
  if (typeof username !== "string" || username.length < 3 || username.length > 50 || /\s/.test(username))
    return ok({ available: false });

  try {
    const allowed = await checkRateLimit("usernameCheck", { ip: await getClientIp(), identifier: username });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);

    // Selecting only the ID avoids loading the full user row from the DB.
    // At scale, this matters because username checks fire on every keystroke.
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    return ok({ available: !user });
  } catch (error) {
    console.error("Error checking username:", error);
    return fail("INTERNAL");
  }
}

export async function updateProfileImage(formData: FormData) {
  const userId = await getOptionalUserId();

  if (!userId) return { error: "Unauthorized" };

  const file = formData.get("image") as File;

  // H-2 fix: validate the image using magic bytes (not the client-supplied
  // file.type or file.name, which are attacker-controlled strings).
  // validateImage() also enforces the 5 MB size cap.
  let validated;
  try {
    validated = await validateImage(file);
  } catch (err) {
    // Surface validation errors as user-friendly messages; do NOT propagate
    // the raw error, which might contain internal details.
    const message = err instanceof Error ? err.message : "Invalid image file.";
    return { error: message };
  }

  try {
    // Use the safe extension derived from magic bytes, not the original filename.
    const fileName = `${userId}-${Date.now()}.${validated.safeExtension}`;
    const filePath = `profiles/${fileName}`;

    const { error: uploadError } = await supabase.storage
      .from("gloo-images")
      .upload(filePath, validated.buffer, {
        cacheControl: "3600",
        upsert: true,
        contentType: validated.mimeType,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);
      return { error: "Failed to upload image to storage" };
    }

    const { data: publicUrlData } = supabase.storage
      .from("gloo-images")
      .getPublicUrl(filePath);

    const publicUrl = publicUrlData.publicUrl;

    await prisma.user.update({
      where: { id: userId },
      data: { image: publicUrl },
    });

    return { success: true, image: publicUrl };
  } catch (error) {
    console.error("Error updating profile image:", error);
    return { error: "Internal server error" };
  }
}

export async function deleteAccountAction(locale: string) {
  const userId = await getOptionalUserId();

  if (!userId) {
    return { error: "Unauthorized" };
  }

  const cookieStore = await cookies();

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        group: {
          select: { photos: true },
        },
      },
    });

    if (!user) {
      return { error: "User not found" };
    }

    // DB record is deleted first because Prisma's cascade handles all relational
    // cleanup (Group, Chats, Messages, GameScores, Sessions) atomically. Supabase storage
    // has no foreign key constraints, so file deletion order doesn't affect
    // data integrity — only UX speed.
    await prisma.user.delete({
      where: { id: userId },
    });

    // All Session rows were removed by the cascade; drop the now-dead cookie.
    cookieStore.delete(SESSION_COOKIE);

    const guestId = crypto.randomUUID();
    cookieStore.set("gloo_is_guest", "true", {
      path: "/",
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    cookieStore.set("gloo_guest_id", guestId, {
      path: "/",
      maxAge: 60 * 60 * 24,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
    });

    // Supabase file deletion is intentionally fire-and-forget (not awaited).
    // The DB record is already gone at this point, so the redirect should not
    // be held back by storage cleanup — a slow CDN response would degrade UX
    // with zero user-facing benefit.
    (async () => {
      try {
        const filesToDelete: string[] = [];

        if (user.image && user.image.includes("supabase")) {
          const imageFileName = user.image.split("/").pop();
          if (imageFileName) {
            filesToDelete.push(`profiles/${imageFileName}`);
          }
        }

        if (user.group?.photos && user.group.photos.length > 0) {
          user.group.photos.forEach((url) => {
            if (url.includes("supabase")) {
              const photoFileName = url.split("/").pop();
              if (photoFileName) {
                filesToDelete.push(`groups/${photoFileName}`);
              }
            }
          });
        }

        if (filesToDelete.length > 0) {
          await supabase.storage.from("gloo-images").remove(filesToDelete);
        }
      } catch (error) {
        console.error("Error deleting Supabase files in background:", error);
      }
    })();
  } catch (error) {
    console.error("Error deleting account:", error);
    return { error: "Failed to delete account" };
  }

  redirect(`/${locale}/search-groups`);
}

// ── Password reset ───────────────────────────────────────────────────────────

const ResetRequestSchema = z.string().max(254).regex(EMAIL_REGEX);

/**
 * Reset tokens are stored only as their SHA-256 hash (like session tokens), so
 * a database leak does not hand out working reset links. SHA-256 (not bcrypt)
 * is right here: the token is high-entropy random data, not a password.
 */
function hashResetToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a password reset. Always reports success for well-formed emails so
 * the response cannot be used to enumerate accounts.
 * Returns FEATURE_DISABLED (and does nothing) while EMAIL_FLOWS_ENABLED is off.
 * @returns ActionResult; on failure `messageKey` is a key in the "ForgotPassword" namespace.
 */
export async function requestPasswordReset(email: string, locale: string): Promise<ActionResult> {
  // First, before validation/rate limiting: no token is generated, stored or logged.
  if (!isEmailFlowEnabled()) return fail("FEATURE_DISABLED");

  const parsedEmail = ResetRequestSchema.safeParse(email);
  if (!parsedEmail.success) {
    // Return a validation error — this is a client-side input mistake,
    // not a privacy-sensitive case. User enumeration protection only applies
    // to valid-format emails that are simply not registered in the system.
    return fail("VALIDATION", "invalidEmailError");
  }

  try {
    const allowed = await checkRateLimit("passwordResetRequest", {
      ip: await getClientIp(),
      identifier: parsedEmail.data,
    });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);
  } catch (error) {
    console.error("Password reset rate limiter error:", error);
    return fail("INTERNAL");
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email: parsedEmail.data },
      select: { id: true },
    });

    // Returning success even when the email is not registered prevents user
    // enumeration — an attacker can't use the response to check which emails
    // exist in the system.
    if (!user) {
      return ok();
    }

    const resetToken = crypto.randomUUID() + "-" + crypto.randomUUID();

    const expiryTime = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Only the hash is stored; the raw token exists only in the link.
        resetPasswordToken: hashResetToken(resetToken),
        resetPasswordExpiry: expiryTime,
      },
    });

    // DEV-ONLY: log the full password reset link so developers can click it
    // directly from the terminal. The token is intentionally exposed here —
    // this is a known, accepted trade-off for local development convenience.
    // TODO: replace with Resend / SendGrid in production and re-apply the
    //       H-5 restriction (token must never appear in logs).
    if (process.env.NODE_ENV === "development") {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
      const resetUrl = `${baseUrl}/${locale}/resetPassword?token=${resetToken}`;
      console.log(`\n[EMAIL SIMULATION] Password reset email for: ${email}`);
      console.log(`[EMAIL SIMULATION] Click to reset → ${resetUrl}\n`);
    }

    return ok();
  } catch (error) {
    console.error("Error requesting password reset:", error);
    return ok();
  }
}

/**
 * Completes a password reset. On success the reset token is consumed and ALL
 * of the user's sessions are revoked (any stolen session dies with the old password).
 * Returns FEATURE_DISABLED (and does nothing) while EMAIL_FLOWS_ENABLED is off.
 * @returns ActionResult; on failure `messageKey` is a key in the "ResetPassword" namespace.
 */
export async function resetPassword(token: string, newPassword: string): Promise<ActionResult> {
  if (!isEmailFlowEnabled()) return fail("FEATURE_DISABLED");

  if (typeof token !== "string" || token.length === 0 || token.length > 200) {
    return fail("VALIDATION", "tokenInvalidOrExpired");
  }

  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.ok) {
    return fail("VALIDATION", passwordErrorKey(passwordCheck.reason));
  }

  try {
    // IP only: the submitted token is attacker-chosen, so a per-token bucket
    // would never fill for someone guessing a new token each time.
    const allowed = await checkRateLimit("passwordResetSubmit", { ip: await getClientIp() });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: hashResetToken(token),
        resetPasswordExpiry: {
          gt: new Date(),
        },
      },
      select: { id: true },
    });

    if (!user) {
      return fail("NOT_FOUND", "tokenInvalidOrExpired");
    }

    const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: {
          // Single-use: clearing both fields after a successful reset ensures
          // the same link cannot be replayed even within its original validity window.
          password: hashedPassword,
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        },
      }),
      // Every password change revokes every existing session.
      prisma.session.deleteMany({ where: { userId: user.id } }),
    ]);

    return ok();
  } catch (error) {
    console.error("Error resetting password:", error);
    return fail("INTERNAL", "resetGenericError");
  }
}

// ── Change password (signed in) ──────────────────────────────────────────────

const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(1024),
  newPassword: z.string().max(1024),
  confirmPassword: z.string().max(1024),
});

/**
 * Changes the signed-in user's password. Works whether or not EMAIL_FLOWS_ENABLED is on.
 * Verifies the current password (bcrypt), applies the shared password policy,
 * rejects reusing the current password, and revokes every OTHER session of the
 * user; the session making the change stays signed in. Attempts are rate
 * limited per user (they are effectively guesses of the current password).
 * @returns ActionResult; on failure `messageKey` is a key in the "AccountSettings" namespace.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  confirmPassword: string,
): Promise<ActionResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED", "sessionExpiredError");
  }

  const parsed = ChangePasswordSchema.safeParse({ currentPassword, newPassword, confirmPassword });
  if (!parsed.success) return fail("VALIDATION", "currentPasswordIncorrect");
  const input = parsed.data;

  if (input.newPassword !== input.confirmPassword) return fail("VALIDATION", "passwordMismatch");

  const policy = validatePassword(input.newPassword);
  if (!policy.ok) return fail("VALIDATION", passwordErrorKey(policy.reason));

  try {
    const allowed = await checkRateLimit("passwordChange", { identifier: userId });
    if (!allowed) return fail("RATE_LIMITED", TOO_MANY_ATTEMPTS);

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { password: true },
    });
    if (!user) return fail("UNAUTHORIZED", "sessionExpiredError");

    const currentMatches = await bcrypt.compare(input.currentPassword, user.password);
    if (!currentMatches) return fail("VALIDATION", "currentPasswordIncorrect");

    // The current password was just verified, so equal strings mean "same password".
    if (input.newPassword === input.currentPassword) {
      return fail("VALIDATION", "passwordSameAsCurrent");
    }

    const hashedPassword = await bcrypt.hash(input.newPassword, BCRYPT_ROUNDS);
    const currentTokenHash = await getCurrentSessionTokenHash();

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: {
          password: hashedPassword,
          // Any outstanding reset link was issued for the old password.
          resetPasswordToken: null,
          resetPasswordExpiry: null,
        },
      }),
      // Every other device is signed out; this one keeps its session.
      prisma.session.deleteMany({
        where: currentTokenHash ? { userId, NOT: { tokenHash: currentTokenHash } } : { userId },
      }),
    ]);

    return ok();
  } catch (error) {
    console.error("Error changing password:", error);
    return fail("INTERNAL", "changePasswordGenericError");
  }
}
