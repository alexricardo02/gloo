/**
 * Wire types of the GET route handlers in app/api/** (chats, unread badge,
 * liked-me, map). Client-safe: type-only, shared by lib/*Data.ts (server)
 * and the polling components (client).
 *
 * Responses never carry another user's id. Instead of `senderId`, a message
 * says whether the viewer sent it (`isOwn`). Read state of the other
 * participant is never exposed (READ_RECEIPTS = no).
 */
import type { Gender, SystemMessageKey } from "@prisma/client";

/** A message written by a user. `isOwn` is false for the partner and for deleted accounts. */
export type UserChatMessage = {
  id: string;
  type: "USER";
  text: string;
  systemKey: null;
  createdAt: string;
  isOwn: boolean;
};

/** A notice with no sender, rendered from Chat.systemMessages.<systemKey>. */
export type SystemChatMessage = {
  id: string;
  type: "SYSTEM";
  text: null;
  systemKey: SystemMessageKey | null;
  createdAt: string;
  isOwn: false;
};

export type ChatMessageDTO = UserChatMessage | SystemChatMessage;

/** GET /api/chats/[chatId]/messages */
export type MessagePage = {
  /** Oldest first. */
  messages: ChatMessageDTO[];
  /** `?after=`: more newer messages exist (fetch again). Otherwise: older messages exist. */
  hasMore: boolean;
};

/** GET /api/chats/[chatId] */
export type ChatHeaderDTO = {
  id: string;
  isMatch: boolean;
  partner: { name: string; image: string };
};

/** One row of GET /api/chats */
export type ChatListItemDTO = {
  id: string;
  /** Name and first photo of the other host (group photo, else profile image). */
  name: string;
  image: string;
  isMatch: boolean;
  /** null when the chat has no messages or the last one is a SYSTEM message. */
  lastMessage: string | null;
  lastMessageSystemKey: SystemMessageKey | null;
  /** Last activity (last message, else chat creation). ISO string. */
  time: string;
  /** Messages from the other side (incl. system notices) after my last read. */
  unread: number;
};

/** GET /api/chats */
export type ChatListPage = {
  items: ChatListItemDTO[];
  /** Opaque; pass as `?cursor=` for the next page. null on the last page. */
  nextCursor: string | null;
};

/** GET /api/unread (BADGE_COUNTS = chats-with-unread) */
export type UnreadSummary = {
  chatsWithUnread: number;
};

// ── GET /api/likes ──────────────────────────────────────────────────────

/** One group that liked the caller's group (no user ids). */
export type LikedMeGroupDTO = {
  id: string;
  user: { name: string; image: string | null; username: string | null };
  photos: string[];
  description: string | null;
  membersCount: number;
  gender: Gender;
  ageMin: number;
  ageMax: number;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  likedByCurrentUser: boolean;
  isMutualLike: boolean;
  /** Existing chat with this group's host (match-only: no chat, no button). */
  chatId: string | null;
};

// ── GET /api/map ────────────────────────────────────────────────────────

export type MapAttendeeGroupDTO = {
  membersCount: number;
  gender: string;
  photos: string[];
  user: { name: string };
};

export type VenueDTO = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  attendees: { id: string; group: MapAttendeeGroupDTO }[];
};

export type MapEventDTO = {
  id: string;
  description: string | null;
  locationName: string;
  latitude: number;
  longitude: number;
  /** Only events with an end time in the future are listed, so set in practice. */
  endTime: string | null;
  isHost: boolean;
  /** The caller's own request for this event, if any. */
  myStatus: "PENDING" | "ACCEPTED" | null;
  /** Only for an accepted guest. */
  ownerId: string | null;
  owner: { name: string; group: { membersCount: number } | null };
  attendees: { id: string; status: string; group: MapAttendeeGroupDTO }[];
};

export type MapDataDTO = {
  signedIn: boolean;
  venues: VenueDTO[];
  events: MapEventDTO[];
  myEvent: { id: string; endTime: string | null } | null;
};
