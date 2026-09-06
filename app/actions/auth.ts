"use server";

import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { validateImage } from "@/lib/validateImage";

/**
 * Registers a new user and establishes their initial security boundaries.
 * Enforces strict age verification (18+) and password complexity to comply with security standards.
 * Accounts are created in a locked state (isVerified: false) until email confirmation is completed.
 * * @param formData - Contains email, password, username, name, and birthDate.
 * @param locale - The current routing locale used for generating the verification email link.
 * @returns Object indicating success status or specific i18n error keys (e.g., "emailExistsError").
 */
export async function registerUser(formData: FormData, locale: string) {
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;
  const username = formData.get("username") as string;
  const name = formData.get("name") as string;

  const birthDateRaw = formData.get("birthDate") as string;
  if (!birthDateRaw) return { error: "Date of birth is required" };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "invalidEmailError" };
  const birthDate = new Date(birthDateRaw);

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDifference = today.getMonth() - birthDate.getMonth();

  // A simple year subtraction gives the wrong age for birthdays that haven't
  // occurred yet this year (e.g., today is March, birthday is December → off by 1).
  // monthDifference corrects this before the age gate is applied.
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < birthDate.getDate())
  ) {
    age--;
  }

  if (age < 18) {
    return { error: "ageMinError" };
  }

  if (username && /\s/.test(username)) {
    return { error: "usernameSpaceError" };
  }

  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
  if (!passwordRegex.test(password)) {
    return { error: "passwordWeakError" };
  }

  try {
    const existingEmail = await prisma.user.findUnique({ where: { email } });
    if (existingEmail) {
      return { error: "emailExistsError" };
    }

    if (username) {
      const existingUsername = await prisma.user.findUnique({
        where: { username },
      });
      if (existingUsername) {
        return { error: "usernameTakenError" };
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

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

    return { success: true, needsVerification: true };
  } catch (error) {
    console.error("Registration critical error:", error);
    return { error: "registrationGenericError" };
  }
}

/**
 * Authenticates a user using either their email or username.
 * Establishes a secure HttpOnly session cookie upon success, mitigating XSS attack vectors.
 * Rejects authentication if the user's email has not been verified.
 * * @param formData - Contains the identifier (email/username) and raw password.
 * @param locale - The current routing locale for redirection after successful login.
 */
export async function loginUser(formData: FormData, locale: string) {
  const identifier = formData.get("identifier") as string;
  const password = formData.get("password") as string;

  // Search user
  const user = await prisma.user.findFirst({
    where: {
      OR: [{ email: identifier }, { username: identifier }],
    },
  });

  if (!user) return { error: "invalidCredentialsError" };

  // Validate password
  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) return { error: "invalidCredentialsError" };

  if (!user.isVerified) {
    return { error: "emailNotVerifiedError" };
  }

  // Create session with cookies
  const cookieStore = await cookies();
  cookieStore.set("gloo_user_id", user.id, { 
    httpOnly: true, 
    path: "/",
    maxAge: 60 * 60 * 24 * 30, 
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
  cookieStore.delete("gloo_is_guest");

  redirect(`/${locale}/search-groups`);
}

export async function getCurrentUser() {

  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get("gloo_user_id")?.value;
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
  const cookieStore = await cookies();

  cookieStore.delete("gloo_user_id");

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

export async function checkUsernameAvailability(username: string) {
  if (!username || username.length < 3 || /\s/.test(username))
    return { available: false };

  try {
    // Selecting only the ID avoids loading the full user row from the DB.
    // At scale, this matters because username checks fire on every keystroke.
    const user = await prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });

    return { available: !user };
  } catch (error) {
    console.error("Error checking username:", error);
    return { available: false };
  }
}

export async function updateProfileImage(formData: FormData) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

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
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) {
    return { error: "Unauthorized" };
  }

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
    // cleanup (Group, Chats, Messages, GameScores) atomically. Supabase storage
    // has no foreign key constraints, so file deletion order doesn't affect
    // data integrity — only UX speed.
    await prisma.user.delete({
      where: { id: userId },
    });

    cookieStore.delete("gloo_user_id");

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

export async function requestPasswordReset(email: string, locale: string) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    // Return a validation error — this is a client-side input mistake,
    // not a privacy-sensitive case. User enumeration protection only applies
    // to valid-format emails that are simply not registered in the system.
    return { error: "invalidEmailError" };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    // Returning success even when the email is not registered prevents user
    // enumeration — an attacker can't use the response to check which emails
    // exist in the system.
    if (!user) {
      return { success: true };
    }

    const resetToken = crypto.randomUUID() + "-" + crypto.randomUUID();

    const expiryTime = new Date(Date.now() + 60 * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordToken: resetToken,
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

    return { success: true };
  } catch (error) {
    console.error("Error requesting password reset:", error);
    return { success: true };
  }
}

export async function resetPassword(token: string, newPassword: string) {
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.])[A-Za-z\d@$!%*?&.]{8,}$/;
  if (!passwordRegex.test(newPassword)) {
    return { error: "passwordWeakError" };
  }

  try {
    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetPasswordExpiry: {
          gt: new Date(),
        },
      },
    });

    if (!user) {
      return { error: "tokenInvalidOrExpired" };
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Single-use: clearing both fields after a successful reset ensures
        // the same link cannot be replayed even within its original validity window.
        password: hashedPassword,
        resetPasswordToken: null,
        resetPasswordExpiry: null,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Error resetting password:", error);
    return { error: "Failed to reset password" };
  }
}
