import "server-only";

import { prisma } from "@/lib/prisma";
import { toPublicUrls } from "@/lib/storage";
import type { MapAttendeeGroupDTO, MapDataDTO, MapEventDTO, VenueDTO } from "@/lib/apiTypes";

/**
 * Everything the map shows, served by GET /api/map and loaded in parallel.
 *
 * Signed-out visitors (guests) get the venues only; pre-party events need a
 * session. Explicit selects: other users' ids are not returned. Per event the
 * caller gets a computed `isHost` / `myStatus`, and the attendee list the UI
 * shows them: the host sees every request, an accepted guest sees the
 * accepted guests, everybody else sees none. `ownerId` is only included for
 * an accepted guest (it opens the existing chat with the host).
 * Location masking / bounding boxes are a separate pack.
 */

const attendeeGroupSelect = {
  membersCount: true,
  gender: true,
  photos: true,
  user: { select: { name: true } },
} as const;

function toAttendeeGroup(group: { membersCount: number; gender: string; photos: string[]; user: { name: string } }): MapAttendeeGroupDTO {
  return { membersCount: group.membersCount, gender: group.gender, photos: toPublicUrls(group.photos), user: { name: group.user.name } };
}

export async function getVenues(): Promise<VenueDTO[]> {
  const venues = await prisma.venue.findMany({
    select: {
      id: true,
      name: true,
      type: true,
      latitude: true,
      longitude: true,
      attendees: { select: { id: true, group: { select: attendeeGroupSelect } } },
    },
  });
  return venues.map((venue) => ({
    ...venue,
    attendees: venue.attendees.map((a) => ({ id: a.id, group: toAttendeeGroup(a.group) })),
  }));
}

export async function getActiveEvents(userId: string, now = new Date()): Promise<MapEventDTO[]> {
  const events = await prisma.event.findMany({
    where: { endTime: { gt: now } },
    select: {
      id: true,
      description: true,
      locationName: true,
      latitude: true,
      longitude: true,
      endTime: true,
      ownerId: true,
      owner: { select: { name: true, group: { select: { membersCount: true } } } },
      attendees: {
        // group.userId is only used here to find the caller's own request; it is not returned.
        select: { id: true, status: true, group: { select: { ...attendeeGroupSelect, userId: true } } },
      },
    },
  });

  return events.map((event) => {
    const isHost = event.ownerId === userId;
    const mine = event.attendees.find((a) => a.group.userId === userId);
    const myStatus = mine?.status === "ACCEPTED" ? "ACCEPTED" : mine?.status === "PENDING" ? "PENDING" : null;
    const visibleAttendees = isHost
      ? event.attendees
      : myStatus === "ACCEPTED"
        ? event.attendees.filter((a) => a.status === "ACCEPTED")
        : [];

    return {
      id: event.id,
      description: event.description,
      locationName: event.locationName,
      latitude: event.latitude,
      longitude: event.longitude,
      endTime: event.endTime?.toISOString() ?? null,
      isHost,
      myStatus,
      ownerId: myStatus === "ACCEPTED" ? event.ownerId : null,
      owner: { name: event.owner.name, group: event.owner.group },
      attendees: visibleAttendees.map((a) => ({ id: a.id, status: a.status, group: toAttendeeGroup(a.group) })),
    };
  });
}

/** All map data for the caller (null = signed out), with every query running in parallel. */
export async function getMapData(userId: string | null): Promise<MapDataDTO> {
  const now = new Date();
  if (!userId) {
    return { signedIn: false, venues: await getVenues(), events: [], myEvent: null };
  }

  const [venues, events, myEvent] = await Promise.all([
    getVenues(),
    getActiveEvents(userId, now),
    prisma.event.findFirst({
      where: { ownerId: userId, endTime: { gt: now } },
      select: { id: true, endTime: true },
    }),
  ]);

  return {
    signedIn: true,
    venues,
    events,
    myEvent: myEvent ? { id: myEvent.id, endTime: myEvent.endTime?.toISOString() ?? null } : null,
  };
}
