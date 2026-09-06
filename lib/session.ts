/**
 * Centralised session helper — single source of truth for resolving the
 * authenticated user from the request cookies.
 *
 * Every server action that requires authentication must call `requireUserId()`
 * rather than reading the cookie directly. This enforces a consistent,
 * auditable auth boundary and satisfies the SRP requirement: cookie parsing
 * lives here, business logic lives in the action.
 *
 * CSRF note: Next.js Server Actions automatically compare the `Origin` header
 * to the `Host` / `X-Forwarded-Host` header and abort mismatching requests
 * before they reach application code (see data-security.md#allowed-origins).
 * No additional CSRF token is needed. The `SameSite=lax` cookie attribute
 * provides a second line of defence for older clients.
 */

import { cookies } from "next/headers";

/** Returns the authenticated user ID or null (non-throwing). */
export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get("gloo_user_id")?.value ?? null;
}

/**
 * Returns the authenticated user ID.
 * Throws a structured, client-safe error object instead of propagating raw
 * infrastructure exceptions, preventing stack-trace leakage.
 */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new Error("Unauthorized");
  return userId;
}
