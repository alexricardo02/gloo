import type { NextRequest } from "next/server";
import { idParam, json, notFound, withUser } from "@/lib/apiRoute";
import { getChatHeader } from "@/lib/chatData";

/**
 * GET /api/chats/[chatId]
 * Header of an open chat (partner name + photo, match flag). 404 for missing,
 * foreign and blocked chats alike.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = await params;
  return withUser(async (userId) => {
    if (!idParam.safeParse(chatId).success) return notFound();
    const header = await getChatHeader(chatId, userId);
    return header ? json(header) : notFound();
  });
}
