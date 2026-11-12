import "server-only";

import { prisma } from "@/lib/prisma";
import { toPublicUrl } from "@/lib/storage";
import { boundingBox, haversineKm } from "@/lib/geo";
import { getBlockSet } from "@/lib/blocks";
import { findChatBetween } from "@/lib/chats";
import { MASK_RADIUS_METERS } from "@/lib/eventMask";
import { nightOf } from "@/lib/venueNight";
import { maybeCleanupExpiredEvents } from "@/lib/eventRetention";
import type { MapDataDTO, MapEventDTO, MapGroupSummaryDTO, VenueDTO } from "@/lib/apiTypes";

/**
 * Everything the map shows, served by GET /api/map (Pack 7).
 *
 * Venues (B10, P2): only venues within VENUE_RADIUS_KM of the requested map
 * center (bounding box, then exact haversine distance), with the number of
 * groups going there TONIGHT (lib/venueNight.ts). VENUE_ATTENDEES_VISIBILITY =
 * count-public-names-logged-in: everyone gets the count, only signed-in users
 * get the groups (name, first photo, size; never ids or coordinates).
 *
 * Pre-parties (S3): GUEST_MAP = venues-only, so signed-out visitors get none.
 * Signed-in users get active events whose masked center lies within
 * PREPARTY_RADIUS_KM of the map center, except those of blocked pairs:
 *  - host and groups with an ACCEPTED request: the exact point (and label);
 *  - everyone else: the masked center stored at creation and
 *    MASK_RADIUS_METERS; no exact point, no label, no owner id, no owner group
 *    location.
 * No user or group ids of other users are returned; an accepted group gets
 * the chatId of its chat with the host instead.
 */

export const VENUE_RADIUS_KM = 15;
/**
 * Pre-parties within this distance of the requested map center. Measured to
 * the MASKED center for every viewer: filtering on the exact point would let
 * anyone binary-search it by moving the map center across the boundary.
 */
export const PREPARTY_RADIUS_KM = 50;
/** Map center when the client sends none (Mainz). */
export const DEFAULT_MAP_CENTER: [number, number] = [49.9929, 8.2473];
/** Groups listed per venue (the count is always exact). */
const VENUE_ATTENDEE_LIST_LIMIT = 30;

const groupSummarySelect = {
  membersCount: true,
  photos: true,
  user: { select: { name: true } },
} as const;

function toSummary(group: { membersCount: number; photos: string[]; user: { name: string } }): MapGroupSummaryDTO {
  return { name: group.user.name, photo: toPublicUrl(group.photos[0] ?? null), membersCount: group.membersCount };
}

export async function getVenues(
  center: [number, number],
  viewer: { signedIn: boolean; groupId: string | null },
  now = new Date(),
): Promise<VenueDTO[]> {
  const night = nightOf(now);
  const box = boundingBox(center[0], center[1], VENUE_RADIUS_KM);

  const [venues, mine] = await Promise.all([
    prisma.venue.findMany({
      where: {
        latitude: { gte: box.minLat, lte: box.maxLat },
        OR: box.lonRanges.map(([min, max]) => ({ longitude: { gte: min, lte: max } })),
      },
      select: {
        id: true,
        name: true,
        type: true,
        latitude: true,
        longitude: true,
        _count: { select: { attendees: { where: { night } } } },
        // Guests: no rows at all (take 0), only the count above.
        attendees: {
          where: { night },
          orderBy: { createdAt: "asc" },
          take: viewer.signedIn ? VENUE_ATTENDEE_LIST_LIMIT : 0,
          select: { group: { select: groupSummarySelect } },
        },
      },
    }),
    viewer.groupId
      ? prisma.venueAttendance.findUnique({
          where: { groupId_night: { groupId: viewer.groupId, night } },
          select: { venueId: true },
        })
      : null,
  ]);

  return venues
    .filter((v) => haversineKm(center[0], center[1], v.latitude, v.longitude) <= VENUE_RADIUS_KM)
    .map((v) => ({
      id: v.id,
      name: v.name,
      type: v.type,
      latitude: v.latitude,
      longitude: v.longitude,
      attendeeCount: v._count.attendees,
      attendees: viewer.signedIn ? v.attendees.map((a) => toSummary(a.group)) : null,
      isMine: mine?.venueId === v.id,
    }));
}

export async function getActiveEvents(
  userId: string,
  myGroupId: string | null,
  now = new Date(),
  center: [number, number] = DEFAULT_MAP_CENTER,
): Promise<MapEventDTO[]> {
  const box = boundingBox(center[0], center[1], PREPARTY_RADIUS_KM);
  const [events, blocks] = await Promise.all([
    prisma.event.findMany({
      where: {
        endTime: { gt: now },
        maskedLatitude: { gte: box.minLat, lte: box.maxLat },
        OR: box.lonRanges.map(([min, max]) => ({ maskedLongitude: { gte: min, lte: max } })),
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        description: true,
        locationName: true,
        latitude: true,
        longitude: true,
        maskedLatitude: true,
        maskedLongitude: true,
        endTime: true,
        ownerId: true,
        owner: { select: { name: true, group: { select: { membersCount: true } } } },
        attendees: {
          where: { status: { in: ["PENDING", "ACCEPTED", "REJECTED"] } },
          orderBy: { createdAt: "asc" },
          select: { id: true, status: true, groupId: true, group: { select: groupSummarySelect } },
        },
      },
    }),
    getBlockSet(userId),
  ]);

  const visible = events.filter(
    (event) =>
      !blocks.userIds.has(event.ownerId) &&
      haversineKm(center[0], center[1], event.maskedLatitude, event.maskedLongitude) <= PREPARTY_RADIUS_KM,
  );

  return Promise.all(
    visible.map(async (event): Promise<MapEventDTO> => {
      const isHost = event.ownerId === userId;
      const mine = myGroupId ? event.attendees.find((a) => a.groupId === myGroupId) : undefined;
      const myStatus = isHost || !mine ? null : (mine.status as "PENDING" | "ACCEPTED" | "REJECTED");
      const accepted = myStatus === "ACCEPTED";

      const listed = isHost
        ? event.attendees.filter((a) => a.status === "PENDING" || a.status === "ACCEPTED")
        : accepted
          ? event.attendees.filter((a) => a.status === "ACCEPTED")
          : [];

      const chat = accepted ? await findChatBetween(userId, event.ownerId) : null;

      return {
        id: event.id,
        description: event.description,
        endTime: event.endTime?.toISOString() ?? null,
        isHost,
        myStatus,
        location:
          isHost || accepted
            ? { kind: "exact", latitude: event.latitude, longitude: event.longitude, label: event.locationName }
            : { kind: "masked", center: [event.maskedLatitude, event.maskedLongitude], radiusM: MASK_RADIUS_METERS },
        chatId: chat?.id ?? null,
        owner: { name: event.owner.name, membersCount: event.owner.group?.membersCount ?? null },
        attendees: listed.map((a) => ({
          id: a.id,
          status: a.status as "PENDING" | "ACCEPTED",
          group: toSummary(a.group),
        })),
      };
    }),
  );
}

/** All map data for the caller (null = signed out / guest) around `center`. */
export async function getMapData(userId: string | null, center: [number, number] = DEFAULT_MAP_CENTER): Promise<MapDataDTO> {
  const now = new Date();
  maybeCleanupExpiredEvents(prisma, now);

  if (!userId) {
    return {
      signedIn: false,
      isGuest: true,
      venues: await getVenues(center, { signedIn: false, groupId: null }, now),
      events: [],
      myEvent: null,
    };
  }

  const myGroup = await prisma.group.findUnique({ where: { userId }, select: { id: true } });
  const myGroupId = myGroup?.id ?? null;

  const [venues, events, myEvent] = await Promise.all([
    getVenues(center, { signedIn: true, groupId: myGroupId }, now),
    getActiveEvents(userId, myGroupId, now, center),
    prisma.event.findFirst({
      where: { ownerId: userId, endTime: { gt: now } },
      select: { id: true, endTime: true },
    }),
  ]);

  return {
    signedIn: true,
    isGuest: false,
    venues,
    events,
    myEvent: myEvent ? { id: myEvent.id, endTime: myEvent.endTime?.toISOString() ?? null } : null,
  };
}
