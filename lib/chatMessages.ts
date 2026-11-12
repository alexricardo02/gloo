/**
 * Pure helpers for the open chat's message list (client-safe).
 *
 * The list is kept as [...confirmed (server order), ...pending]. Pending
 * entries are optimistic copies of messages the user is sending; they are
 * replaced by the stored message when sendMessage returns. Everything is
 * deduplicated by id, so a message that arrives through a poll and through
 * the send response shows up once.
 */
import type { ChatMessageDTO, UserChatMessage } from "@/lib/apiTypes";

export type PendingMessage = UserChatMessage & { pending: true };
export type ClientMessage = ChatMessageDTO | PendingMessage;

export const isPending = (m: ClientMessage): m is PendingMessage => "pending" in m && m.pending === true;

export function confirmedOf(messages: readonly ClientMessage[]): ChatMessageDTO[] {
  return messages.filter((m): m is ChatMessageDTO => !isPending(m));
}

/** The newest server-confirmed message (cursor for `?after=`). */
export function newestConfirmed(messages: readonly ClientMessage[]): ChatMessageDTO | null {
  const confirmed = confirmedOf(messages);
  return confirmed[confirmed.length - 1] ?? null;
}

/** The oldest server-confirmed message (cursor for `?before=`). */
export function oldestConfirmed(messages: readonly ClientMessage[]): ChatMessageDTO | null {
  return confirmedOf(messages)[0] ?? null;
}

/** The newest message from the other side (what "mark as read" needs). */
export function newestIncoming(messages: readonly ClientMessage[]): ChatMessageDTO | null {
  const confirmed = confirmedOf(messages);
  for (let i = confirmed.length - 1; i >= 0; i--) {
    if (!confirmed[i].isOwn) return confirmed[i];
  }
  return null;
}

export function createPendingMessage(id: string, text: string, now = new Date()): PendingMessage {
  return { id, type: "USER", text, systemKey: null, createdAt: now.toISOString(), isOwn: true, pending: true };
}

/** Inserts `message` into the (oldest-first) confirmed list at its createdAt position. */
function insertSorted(confirmed: ChatMessageDTO[], message: ChatMessageDTO): ChatMessageDTO[] {
  let index = confirmed.length;
  while (index > 0 && confirmed[index - 1].createdAt > message.createdAt) index--;
  return [...confirmed.slice(0, index), message, ...confirmed.slice(index)];
}

/**
 * Adds newer messages from a poll (`?after=` or a fresh latest page). Own
 * messages that match a pending copy by text replace that copy, so the
 * optimistic message never shows twice even if the poll wins the race
 * against the send response.
 */
export function appendNewer(prev: readonly ClientMessage[], incoming: readonly ChatMessageDTO[]): ClientMessage[] {
  let confirmed = confirmedOf(prev);
  let pending = prev.filter(isPending);
  const known = new Set(confirmed.map((m) => m.id));

  for (const message of incoming) {
    if (known.has(message.id)) continue;
    known.add(message.id);
    confirmed = insertSorted(confirmed, message);
    if (message.type === "USER" && message.isOwn) {
      const match = pending.findIndex((p) => p.text === message.text);
      if (match !== -1) pending = [...pending.slice(0, match), ...pending.slice(match + 1)];
    }
  }

  if (confirmed.length === confirmedOf(prev).length && pending.length === prev.filter(isPending).length) {
    return prev as ClientMessage[];
  }
  return [...confirmed, ...pending];
}

/** Adds an older page ("load older") in front; skips ids already shown. */
export function prependOlder(prev: readonly ClientMessage[], older: readonly ChatMessageDTO[]): ClientMessage[] {
  const known = new Set(prev.map((m) => m.id));
  const fresh = older.filter((m) => !known.has(m.id));
  return fresh.length === 0 ? (prev as ClientMessage[]) : [...fresh, ...prev];
}

/** Replaces the optimistic copy `pendingId` with the stored message (once). */
export function reconcileSent(prev: readonly ClientMessage[], pendingId: string, stored: ChatMessageDTO): ClientMessage[] {
  const pending = prev.filter((m): m is PendingMessage => isPending(m) && m.id !== pendingId);
  const confirmed = confirmedOf(prev);
  const merged = confirmed.some((m) => m.id === stored.id) ? confirmed : insertSorted(confirmed, stored);
  return [...merged, ...pending];
}

/** Drops the optimistic copy after a failed send. */
export function dropPending(prev: readonly ClientMessage[], pendingId: string): ClientMessage[] {
  return prev.filter((m) => m.id !== pendingId);
}
