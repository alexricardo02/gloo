import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId, UnauthorizedError } from "@/lib/session";
import { InvalidCursorError } from "@/lib/chatData";

/**
 * Shared plumbing for the authenticated GET route handlers that replaced the
 * client-side Supabase Realtime subscriptions (LIVE_UPDATES = smart-polling).
 *
 * Status codes: 401 without a valid session, 404 for chats that do not exist,
 * are foreign or are blocked (Pack 4: indistinguishable on purpose, so a
 * route can't be used to probe whether a chat exists), 400 for bad
 * query parameters, 500 otherwise. Responses are per-user and never cached.
 */

export type ApiErrorCode = "UNAUTHORIZED" | "NOT_FOUND" | "VALIDATION" | "INTERNAL";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

export function json<T>(data: T, status = 200): NextResponse<T> {
  return NextResponse.json(data, { status, headers: NO_STORE });
}

export function apiError(status: 400 | 401 | 404 | 500, code: ApiErrorCode) {
  return json({ error: code }, status);
}

export const notFound = () => apiError(404, "NOT_FOUND");

/** Same bounds as the server actions' ids. */
export const idParam = z.string().min(1).max(64);

/**
 * Runs `handler` with the authenticated user's id (requireUserId), mapping
 * errors to JSON responses without leaking details.
 */
export async function withUser(handler: (userId: string) => Promise<Response>): Promise<Response> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch (error) {
    if (error instanceof UnauthorizedError) return apiError(401, "UNAUTHORIZED");
    console.error("[api] Session lookup failed:", error);
    return apiError(500, "INTERNAL");
  }
  return runHandler(() => handler(userId));
}

/** Like withUser for routes that also serve signed-out visitors (map venues for guests). */
export async function runHandler(handler: () => Promise<Response>): Promise<Response> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof InvalidCursorError) return apiError(400, "VALIDATION");
    console.error("[api] Request failed:", error);
    return apiError(500, "INTERNAL");
  }
}
