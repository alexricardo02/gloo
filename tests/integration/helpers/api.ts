import { NextRequest } from "next/server";
import { GET as getChatList } from "@/app/api/chats/route";
import { GET as getChatHeader } from "@/app/api/chats/[chatId]/route";
import { GET as getMessages } from "@/app/api/chats/[chatId]/messages/route";
import { GET as getUnread } from "@/app/api/unread/route";
import { GET as getLikes } from "@/app/api/likes/route";
import { GET as getMap } from "@/app/api/map/route";
import type { ChatHeaderDTO, ChatListPage, LikedMeGroupDTO, MapDataDTO, MessagePage, UnreadSummary } from "@/lib/apiTypes";

/**
 * Calls the GET route handlers in-process. The session comes from the mocked
 * next/headers cookies() (see ./session.ts), exactly like the server actions.
 */
export type ApiResult<T> = { status: number; body: T; raw: string; cacheControl: string | null };

async function read<T>(response: Response): Promise<ApiResult<T>> {
  const raw = await response.text();
  return { status: response.status, body: JSON.parse(raw) as T, raw, cacheControl: response.headers.get("cache-control") };
}

const request = (path: string) => new NextRequest(new URL(path, "http://localhost"));
const ctx = (chatId: string) => ({ params: Promise.resolve({ chatId }) });

export const fetchChatList = async (query = "") =>
  read<ChatListPage>(await getChatList(request(`/api/chats${query}`)));

export const fetchChatHeader = async (chatId: string) =>
  read<ChatHeaderDTO>(await getChatHeader(request(`/api/chats/${chatId}`), ctx(chatId)));

export const fetchMessages = async (chatId: string, query = "") =>
  read<MessagePage>(await getMessages(request(`/api/chats/${chatId}/messages${query}`), ctx(chatId)));

export const fetchUnread = async () => read<UnreadSummary>(await getUnread());

export const fetchLikes = async () => read<{ groups: LikedMeGroupDTO[] }>(await getLikes());

export const fetchMap = async () => read<MapDataDTO>(await getMap());
