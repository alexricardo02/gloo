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

/** A group shown in a venue or pre-party list: name and first photo only (no ids, no coordinates). */
export type MapGroupSummaryDTO = {
  name: string;
  photo: string | null;
  membersCount: number;
};

/**
 * A venue within VENUE_RADIUS_KM of the requested map center. Counts are for
 * the current night only (06:00 Europe/Berlin boundary).
 * VENUE_ATTENDEES_VISIBILITY = count-public-names-logged-in: `attendees` is
 * null for guests.
 */
export type VenueDTO = {
  id: string;
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  attendeeCount: number;
  attendees: MapGroupSummaryDTO[] | null;
  /** My group marked this venue for tonight. */
  isMine: boolean;
};

/**
 * Where a pre-party is, depending on who asks (S3):
 *  - `exact`: host and groups with an ACCEPTED request;
 *  - `masked`: everyone else. The center was moved by a random 0..radiusM
 *    offset once, at creation; the exact point lies inside the circle.
 */
export type MapEventLocationDTO =
  | { kind: "exact"; latitude: number; longitude: number; label: string | null }
  | { kind: "masked"; center: [number, number]; radiusM: number };

export type AttendanceStatusDTO = "PENDING" | "ACCEPTED" | "REJECTED";

export type MapEventDTO = {
  id: string;
  description: string | null;
  endTime: string | null;
  isHost: boolean;
  /** My group's request. CANCELLED is reported as null (can request again). */
  myStatus: AttendanceStatusDTO | null;
  location: MapEventLocationDTO;
  /** Chat with the host, for an accepted group (ON_ACCEPT = open-chat). */
  chatId: string | null;
  owner: { name: string; membersCount: number | null };
  /** Host: every PENDING/ACCEPTED request; accepted group: accepted groups; others: none. */
  attendees: { id: string; status: "PENDING" | "ACCEPTED"; group: MapGroupSummaryDTO }[];
};

export type MapDataDTO = {
  signedIn: boolean;
  /** Guests and signed-out visitors (GUEST_MAP = venues-only). */
  isGuest: boolean;
  venues: VenueDTO[];
  events: MapEventDTO[];
  myEvent: { id: string; endTime: string | null } | null;
};
