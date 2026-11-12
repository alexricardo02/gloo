import { json, withUser } from "@/lib/apiRoute";
import { countChatsWithUnread } from "@/lib/chatData";
import type { UnreadSummary } from "@/lib/apiTypes";

/** GET /api/unread: the navigation badge (BADGE_COUNTS = chats-with-unread). */
export async function GET() {
  return withUser(async (userId) => json<UnreadSummary>({ chatsWithUnread: await countChatsWithUnread(userId) }));
}
