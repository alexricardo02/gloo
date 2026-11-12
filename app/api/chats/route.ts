import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, withUser } from "@/lib/apiRoute";
import { listChats } from "@/lib/chatData";
import { CHAT_LIST_MAX_LIMIT, CHAT_LIST_PAGE_SIZE } from "@/lib/liveUpdates";

const querySchema = z.object({
  cursor: z.string().min(1).max(512).nullable(),
  limit: z.coerce.number().int().min(1).max(CHAT_LIST_MAX_LIMIT).nullable(),
});

/**
 * GET /api/chats?cursor=&limit=
 * The caller's chats (matches first, newest activity first) with unread
 * counts. Only the fields the chat list shows.
 */
export async function GET(request: NextRequest) {
  return withUser(async (userId) => {
    const params = request.nextUrl.searchParams;
    const query = querySchema.safeParse({ cursor: params.get("cursor"), limit: params.get("limit") });
    if (!query.success) return apiError(400, "VALIDATION");

    return json(
      await listChats(userId, {
        cursor: query.data.cursor,
        limit: query.data.limit ?? CHAT_LIST_PAGE_SIZE,
      }),
    );
  });
}
