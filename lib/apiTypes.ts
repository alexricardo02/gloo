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
import type { ApproximateArea } from "@/lib/geo";

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

/**
 * One group that liked the caller's group. No user ids and no coordinates
 * (S4): `distanceKm` is rounded to whole km (0 = "< 1 km"; null when either
 * group has no location) and `area` is an approximate ~1 km circle around the
 * group's coarsened point (LIKED_ME_MAP = approximate-circles).
 */
export type LikedMeGroupDTO = {
  id: string;
  user: { name: string; image: string | null; username: string | null };
  photos: string[];
  description: string | null;
  membersCount: number;
  gender: Gender;
  ageMin: number;
  ageMax: number;
  distanceKm: number | null;
  area: ApproximateArea | null;
  createdAt: string;
  likedByCurrentUser: boolean;
  isMutualLike: boolean;
  /** Existing chat with this group's host (match-only: no chat, no button). */
  chatId: string | null;
};

// ── Discovery feed (server action getDiscoveryGroups) ───────────────────

/**
 * One discovery card. The group id is the only id (needed to like and
 * report); no user ids and no coordinates (S4).
 */
export type DiscoveryGroupDTO = {
  id: string;
  user: { name: string; image: string | null; username: string | null };
  photos: string[];
  description: string | null;
  membersCount: number;
  gender: Gender;
  ageMin: number;
  ageMax: number;
  /** DISTANCE_DISPLAY = rounded-km: whole km, 0 = "< 1 km". */
  distanceKm: number;
  /** ALREADY_LIKED = show-with-badge: my group already likes this group. */
  likedByMe: boolean;
  /** Existing chat with this group's host (CARD_MESSAGE_BUTTON = only-if-chat-exists). */
  chatId: string | null;
};

/**
 * GUEST_TEASER = static-placeholders: invented cards for guests and users
 * without a group. No real data; `nameKey` is a key of
 * SearchGroups.teaserNames, `tone` picks a neutral gradient.
 */
export type DiscoveryTeaserCardDTO = {
  id: string;
  nameKey: "a" | "b" | "c" | "d";
  tone: number;
  membersCount: number;
  gender: Gender;
  ageMin: number;
  ageMax: number;
  distanceKm: number;
};

export type DiscoveryFeedPage =
  | { hasNoGroup: false; groups: DiscoveryGroupDTO[]; nextCursor: string | null }
  | { hasNoGroup: true; teaser: DiscoveryTeaserCardDTO[] };

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
