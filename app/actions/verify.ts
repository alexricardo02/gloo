"use server";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { type ActionResult, fail } from "@/lib/actionResult";
import { createSession } from "@/lib/session";

const TokenSchema = z.string().min(1).max(200);

/**
 * Confirms an email address, then signs the user in (creates a session) and
 * redirects. Only returns on failure.
 */
export async function verifyAccountAction(token: string, locale: string): Promise<ActionResult> {
  const parsedToken = TokenSchema.safeParse(token);
  if (!parsedToken.success) return fail("VALIDATION", "invalidTokenError");

  try {
    const user = await prisma.user.findUnique({
      where: {
        verificationToken: parsedToken.data,
        verificationTokenExpiry: {
          gt: new Date()
        }
      },
      select: { id: true },
    });

    if (!user) {
      return fail("NOT_FOUND", "invalidTokenError");
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        // Token is cleared immediately after first use to prevent the same
        // email link from being reused to hijack the account later.
        isVerified: true,
        verificationToken: null,
        verificationTokenExpiry: null,
      },
    });

    await createSession(user.id);
    // The user may have browsed as a guest before clicking the verification link.
    // Clearing the guest flag grants full authenticated access immediately,
    // so they don't need a separate login step after confirming their email.
    const cookieStore = await cookies();
    cookieStore.delete("gloo_is_guest");
  } catch (error) {
    console.error("Error verifying account:", error);
    return fail("INTERNAL", "invalidTokenError");
  }

  // Outside the try: redirect() works by throwing and must not be caught.
  redirect(`/${locale}/profile/create-group`);
}
