import type { NextRequest } from "next/server";
import { apiError, idParam, json, notFound, withUser } from "@/lib/apiRoute";
import { getMessagesPage } from "@/lib/chatData";

/**
 * GET /api/chats/[chatId]/messages
 *   (no cursor)     newest MESSAGE_PAGE_SIZE messages
 *   ?after=<id>     only messages newer than <id> (what the open chat polls)
 *   ?before=<id>    the page directly older than <id> ("load older")
 * Messages are oldest first. 404 for missing, foreign and blocked chats alike.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return withUser(async (userId) => {
    if (!idParam.safeParse(chatId).success) return notFound();

    const search = request.nextUrl.searchParams;
    const after = search.get("after");
    const before = search.get("before");
    if ((after !== null && !idParam.safeParse(after).success) || (before !== null && !idParam.safeParse(before).success)) {
      return apiError(400, "VALIDATION");
    }

    const page = await getMessagesPage(chatId, userId, { after, before });
    return page ? json(page) : notFound();
  });
}
