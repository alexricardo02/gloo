"use server";

import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export async function verifyAccountAction(token: string, locale: string) {
  if (!token) return { error: "invalidTokenError" };

  const user = await prisma.user.findFirst({
    where: { 
      verificationToken: token,
      verificationTokenExpiry: {
        gt: new Date() 
      }
    },
  });

  if (!user) {
    return { error: "invalidTokenError" };
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

  const cookieStore = await cookies();
  cookieStore.set("gloo_user_id", user.id, { 
    httpOnly: true, 
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax"
  });
  // The user may have browsed as a guest before clicking the verification link.
  // Clearing the guest flag grants full authenticated access immediately,
  // so they don't need a separate login step after confirming their email.
  cookieStore.delete("gloo_is_guest");

  redirect(`/${locale}/search-groups`);
}
