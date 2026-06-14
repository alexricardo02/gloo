"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

/**
 * Creates a temporary guest session by setting short-lived cookies.
 * Guests can browse the discovery feed but are blocked from messaging,
 * profile creation, and other features that require a real account.
 */
export async function loginAsGuest(locale: string) {
  const guestId = crypto.randomUUID();
  
  const cookieStore = await cookies();

  cookieStore.set("gloo_is_guest", "true", {
    path: "/",
    maxAge: 60 * 60 * 24,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });

  // A guestId is generated even without an account because the GameScores
  // schema requires a session identifier to attribute scores to anonymous users.
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
 * Clears the guest session cookies on login or registration.
 * Called to ensure a real authenticated session fully replaces the guest state.
 */
export async function clearGuestSession() {
  const cookieStore = await cookies();
  cookieStore.delete("gloo_is_guest");
  cookieStore.delete("gloo_guest_id");
}


export async function checkIsGuest() {
  const cookieStore = await cookies();
  return cookieStore.get("gloo_is_guest")?.value === "true";
}


export async function getGuestId() {
  const cookieStore = await cookies();
  return cookieStore.get("gloo_guest_id")?.value || null;
}