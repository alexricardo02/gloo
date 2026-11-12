"use server";

/**
 * Map writes. Reads (venues, events, my event) are served by GET /api/map
 * (lib/mapData.ts) so the map can poll without queueing server actions.
 */

import { prisma } from "@/lib/prisma";
import { getOptionalUserId } from "@/lib/session";

export async function toggleVenueAttendance(venueId: string) {
  const userId = await getOptionalUserId();

  if (!userId) return { error: "Not authorized" };

  try {
    const group = await prisma.group.findUnique({
      where: { userId },
    });

    if (!group) return { error: "You have to create a group first" };

    const existingAttendance = await prisma.venueAttendance.findUnique({
      where: {
        groupId_venueId: {
          groupId: group.id,
          venueId: venueId,
        },
      },
    });

    if (existingAttendance) {
      await prisma.venueAttendance.delete({
        where: { id: existingAttendance.id },
      });
      return { success: true, isAttending: false };
    } else {
      // A group can only commit to one venue per night. Clearing all previous
      // attendances before inserting the new one enforces this constraint at
      // the application layer — the DB has no unique-across-venues rule.
      await prisma.venueAttendance.deleteMany({
        where: { groupId: group.id },
      });
      await prisma.venueAttendance.create({
        data: {
          groupId: group.id,
          venueId: venueId,
        },
      });
      return { success: true, isAttending: true };
    }
  } catch (error) {
    console.error("Error toggling attendance:", error);
    return { error: "Server error" };
  }
}

export async function startPreParty(
  latitude: number,
  longitude: number,
  description: string,
) {
  const userId = await getOptionalUserId();
  if (!userId) return { error: "Not authorized" };

  try {
    const group = await prisma.group.findUnique({ where: { userId } });
    if (!group)
      return { error: "You must create a group first to be able to host." };

    const startTime = new Date();
    const endTime = new Date(startTime.getTime() + 4 * 60 * 60 * 1000);

    // A user can only host one active pre-party at a time. Deleting stale events
    // before creating a new one prevents orphaned records if a previous event
    // was never properly closed (e.g., server restart, browser crash).
    await prisma.event.deleteMany({ where: { ownerId: userId } });

    const newEvent = await prisma.event.create({
      data: {
        title: "Vorglühen",
        description: description || "Wir glühen vor! Kommt vorbei.",
        locationName: "Versteckt (Genauer Ort im Chat)",
        latitude,
        longitude,
        startTime,
        endTime,
        ownerId: userId,
      },
    });

    return { success: true, event: newEvent };
  } catch (error) {
    console.error("Error starting pre-party:", error);
    return { error: "Error starting pre-party" };
  }
}

export async function stopPreParty() {
  const userId = await getOptionalUserId();
  if (!userId) return { error: "Not authorized" };

  try {
    await prisma.event.deleteMany({ where: { ownerId: userId } });
    return { success: true };
  } catch (error) {
    console.error("Error stopping pre-party:", error);
    return { error: "Error stopping pre-party" };
  }
}

export async function requestEventAttendance(eventId: string) {
  const userId = await getOptionalUserId();
  if (!userId) return { error: "Nicht autorisiert" };

  try {
    const group = await prisma.group.findUnique({ where: { userId } });
    if (!group) return { error: "Gruppe erforderlich" };

    await prisma.eventAttendance.deleteMany({ where: { groupId: group.id } });

    await prisma.eventAttendance.create({
      data: { groupId: group.id, eventId: eventId, status: "PENDING" },
    });
    return { success: true };
  } catch (error) {
    return { error: "Fehler" };
  }
}

export async function respondToEventRequest(
  attendanceId: string,
  accept: boolean,
) {
  const userId = await getOptionalUserId();
  if (!userId) return { error: "Nicht autorisiert" };

  try {
    const attendance = await prisma.eventAttendance.findUnique({
      where: { id: attendanceId },
      include: { event: true },
    });

    if (!attendance || attendance.event.ownerId !== userId)
      return { error: "Forbidden" };

    if (accept) {
      await prisma.eventAttendance.update({
        where: { id: attendanceId },
        data: { status: "ACCEPTED" },
      });
    } else {
      await prisma.eventAttendance.delete({ where: { id: attendanceId } });
    }
    return { success: true };
  } catch (error) {
    return { error: "Fehler" };
  }
}
