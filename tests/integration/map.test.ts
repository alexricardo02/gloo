import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
  cancelEventRequest,
  requestEventAttendance,
  respondToEventRequest,
  startPreParty,
  stopPreParty,
  toggleVenueAttendance,
} from "@/app/actions/map";
import { haversineKm } from "@/lib/geo";
import { MASK_RADIUS_METERS } from "@/lib/mapConfig";
import { cleanupExpiredEvents, cleanupOldVenueAttendance } from "@/lib/eventRetention";
import { offsetPoint } from "@/lib/eventMask";
import { PREPARTY_RADIUS_KM } from "@/lib/mapData";
import { canonicalPair } from "@/lib/chats";
import { fakeCookieStore, sessionCookiesFor } from "./helpers/session";
import { fetchMap } from "./helpers/api";
import type { MapEventDTO } from "@/lib/apiTypes";

/**
 * Pack 7 against the local test DB: pre-party masking (S3), durations (D7),
 * access requests (B8/B9), venues per night within a radius (B10/P2),
 * retention and the data migration.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

const MIGRATION = path.join(process.cwd(), "prisma", "migrations", "20261112120000_map_preparty_privacy", "migration.sql");

const stamp = Date.now();
let seq = 0;
const users: string[] = [];
const venues: string[] = [];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.venue.deleteMany({ where: { id: { in: venues } } });
});

async function host(groupLat = 49.55, groupLon = 8.77) {
  const n = seq++;
  const user = await prisma.user.create({
    data: {
      email: `map7_${n}_${stamp}@test.com`,
      password: "x",
      name: `MapHost${n}_${stamp}`,
      birthDate: new Date("1996-01-01"),
      group: { create: { latitude: groupLat, longitude: groupLon, photos: [`groups/map7-${n}/a.webp`] } },
    },
    include: { group: true },
  });
  users.push(user.id);
  return { userId: user.id, groupId: user.group!.id, name: user.name };
}

async function signInAs(userId: string) {
  vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(userId)) as never);
}

function signOut() {
  vi.mocked(cookies).mockResolvedValue(fakeCookieStore() as never);
}

/** GET /api/map as `viewerId`, centered on the event's stored masked center (inside PREPARTY_RADIUS_KM). */
async function eventFor(viewerId: string | null, eventId: string): Promise<{ event: MapEventDTO | undefined; raw: string }> {
  if (viewerId) await signInAs(viewerId);
  else signOut();
  const stored = await prisma.event.findUnique({ where: { id: eventId }, select: { maskedLatitude: true, maskedLongitude: true } });
  const res = await fetchMap(stored ? `?lat=${stored.maskedLatitude}&lng=${stored.maskedLongitude}` : "");
  expect(res.status).toBe(200);
  return { event: res.body.events.find((e) => e.id === eventId), raw: res.raw };
}

async function startParty(userId: string, lat: number, lon: number, durationHours = 2) {
  await signInAs(userId);
  const result = await startPreParty({ latitude: lat, longitude: lon, description: "Bring snacks", durationHours });
  if (!result.ok) throw new Error(`startPreParty failed: ${result.code} ${result.messageKey}`);
  return result.data.id;
}

async function attendanceId(eventId: string, groupId: string) {
  return (await prisma.eventAttendance.findUniqueOrThrow({ where: { groupId_eventId: { groupId, eventId } } })).id;
}

// ── Migration ─────────────────────────────────────────────────────────────

describe("map_preparty_privacy migration (local test DB, private schema)", () => {
  /**
   * Runs the real migration file on legacy-shaped copies of the affected
   * tables in a temporary schema (search_path), so it never locks the shared
   * public tables other test files use in parallel.
   */
  it("maps legacy statuses case-insensitively, backfills masked centers and venue nights, dedupes per night", async () => {
    const schema = `mig7_${stamp}`;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);
      // Pre-migration shape (only the columns the migration touches).
      await client.query(`
        CREATE TABLE "Event" (
          "id" TEXT PRIMARY KEY, "title" TEXT NOT NULL, "locationName" TEXT NOT NULL,
          "latitude" DOUBLE PRECISION NOT NULL, "longitude" DOUBLE PRECISION NOT NULL,
          "endTime" TIMESTAMP(3), "ownerId" TEXT NOT NULL
        );
        CREATE TABLE "EventAttendance" (
          "id" TEXT PRIMARY KEY, "groupId" TEXT NOT NULL, "eventId" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'Pending'
        );
        CREATE TABLE "VenueAttendance" (
          "id" TEXT PRIMARY KEY, "groupId" TEXT NOT NULL, "venueId" TEXT NOT NULL,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        CREATE UNIQUE INDEX "VenueAttendance_groupId_venueId_key" ON "VenueAttendance"("groupId", "venueId");

        INSERT INTO "Event" VALUES
          ('e1', 'Vorglühen', 'Versteckt (Genauer Ort im Chat)', 49.9, 8.2, now() + interval '1 hour', 'u1'),
          ('e2', 'Vorglühen', 'Versteckt', 10, 179.9999, now(), 'u2');
        INSERT INTO "EventAttendance"("id", "groupId", "eventId", "status") VALUES
          ('Pending', 'g1', 'e2', 'Pending'), ('PENDING', 'g3', 'e2', 'PENDING'), ('ACCEPTED', 'g2', 'e1', 'ACCEPTED'),
          ('rejected', 'g1', 'e1', 'rejected'), ('Cancelled', 'g3', 'e1', ' Cancelled '), ('weird', 'g2', 'e2', 'weird');
        -- 05:59 and 06:01 Berlin (CET) the same morning: two nights. va3/va4: same
        -- group and night (only possible under races before), the newer one stays.
        INSERT INTO "VenueAttendance"("id", "groupId", "venueId", "createdAt") VALUES
          ('va1', 'g1', 'v1', '2026-11-14 04:59:00'),
          ('va2', 'g1', 'v2', '2026-11-14 05:01:00'),
          ('va3', 'g2', 'v1', '2026-11-13 20:00:00'),
          ('va4', 'g2', 'v2', '2026-11-13 21:00:00');
      `);

      await client.query(fs.readFileSync(MIGRATION, "utf8"));

      const att = await client.query<{ id: string; status: string }>(`SELECT "id", "status"::text AS "status" FROM "EventAttendance"`);
      expect(Object.fromEntries(att.rows.map((r) => [r.id, r.status]))).toEqual({
        Pending: "PENDING", PENDING: "PENDING", ACCEPTED: "ACCEPTED", rejected: "REJECTED", Cancelled: "CANCELLED", weird: "CANCELLED",
      });

      const ev = await client.query<{ latitude: number; longitude: number; maskedLatitude: number; maskedLongitude: number }>(
        `SELECT "latitude", "longitude", "maskedLatitude", "maskedLongitude" FROM "Event"`,
      );
      expect(ev.rows).toHaveLength(2);
      for (const row of ev.rows) {
        expect(haversineKm(row.latitude, row.longitude, row.maskedLatitude, row.maskedLongitude) * 1000).toBeLessThanOrEqual(MASK_RADIUS_METERS);
        expect(Math.abs(row.maskedLongitude)).toBeLessThanOrEqual(180);
      }

      const nights = await client.query<{ id: string; night: string }>(`SELECT "id", "night"::text AS "night" FROM "VenueAttendance" ORDER BY "id"`);
      expect(nights.rows).toEqual([
        { id: "va1", night: "2026-11-13" },
        { id: "va2", night: "2026-11-14" },
        { id: "va4", night: "2026-11-13" },
      ]);
      // The new constraint is in place.
      await expect(
        client.query(`INSERT INTO "VenueAttendance"("id", "groupId", "venueId", "night") VALUES ('dup', 'g1', 'v9', '2026-11-14')`),
      ).rejects.toThrow(/VenueAttendance_groupId_night_key/);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
      await client.end();
    }
  });
});

// ── Pre-parties: masking (S3) ─────────────────────────────────────────────

describe("GET /api/map pre-party masking (S3)", () => {
  it("non-accepted viewers get only the stored masked center; host and accepted groups get the exact point", async () => {
    const h = await host(49.5511, 8.7722);
    const viewer = await host();
    const accepted = await host();
    const EXACT = { lat: 49.123456, lon: 8.654321 };
    const eventId = await startParty(h.userId, EXACT.lat, EXACT.lon);

    // A non-accepted, logged-in viewer.
    const asViewer = await eventFor(viewer.userId, eventId);
    expect(asViewer.event?.location.kind).toBe("masked");
    const eventsJson = JSON.stringify(asViewer.event);
    expect(eventsJson).not.toMatch(/"(latitude|longitude|label|ownerId|userId|locationName)"/);
    for (const raw of [asViewer.raw, eventsJson]) {
      expect(raw).not.toContain("49.123456");
      expect(raw).not.toContain("8.654321");
      expect(raw).not.toContain(h.userId);
      expect(raw).not.toContain(h.groupId);
      expect(raw).not.toContain("49.5511"); // owner group GPS
      expect(raw).not.toContain("8.7722");
    }
    if (asViewer.event?.location.kind !== "masked") throw new Error("expected masked");
    const { center, radiusM } = asViewer.event.location;
    expect(radiusM).toBe(MASK_RADIUS_METERS);
    expect(haversineKm(center[0], center[1], EXACT.lat, EXACT.lon) * 1000).toBeLessThanOrEqual(MASK_RADIUS_METERS);
    expect(asViewer.event.chatId).toBeNull();
    expect(asViewer.event.attendees).toEqual([]);

    // Stored once: the same center on every request and in the DB.
    const again = await eventFor(viewer.userId, eventId);
    expect(again.event?.location).toEqual(asViewer.event.location);
    const stored = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    expect(center).toEqual([stored.maskedLatitude, stored.maskedLongitude]);
    expect([stored.latitude, stored.longitude]).toEqual([EXACT.lat, EXACT.lon]);

    // Host: exact.
    const asHost = await eventFor(h.userId, eventId);
    expect(asHost.event?.isHost).toBe(true);
    expect(asHost.event?.location).toEqual({ kind: "exact", latitude: EXACT.lat, longitude: EXACT.lon, label: null });

    // Accepted group: exact + chat; still masked while pending.
    await signInAs(accepted.userId);
    expect(await requestEventAttendance(eventId)).toEqual({ ok: true, data: { status: "PENDING" } });
    expect((await eventFor(accepted.userId, eventId)).event?.location.kind).toBe("masked");
    await signInAs(h.userId);
    const res = await respondToEventRequest(await attendanceId(eventId, accepted.groupId), true);
    expect(res.ok).toBe(true);
    const asAccepted = await eventFor(accepted.userId, eventId);
    expect(asAccepted.event?.location).toEqual({ kind: "exact", latitude: EXACT.lat, longitude: EXACT.lon, label: null });
    expect(asAccepted.event?.myStatus).toBe("ACCEPTED");
    expect(asAccepted.event?.chatId).toBe(res.ok ? res.data.chatId : null);
    expect(asAccepted.raw).not.toContain(h.userId);

    // The other viewer is still masked.
    expect((await eventFor(viewer.userId, eventId)).event?.location.kind).toBe("masked");
  });

  it(`returns only pre-parties whose masked center is within ${PREPARTY_RADIUS_KM} km of the map center`, async () => {
    const h = await host();
    const viewer = await host();
    const eventId = await startParty(h.userId, -33.0, 151.0);
    const { maskedLatitude, maskedLongitude } = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
    await signInAs(viewer.userId);

    const centerAt = async (km: number) => {
      const [lat, lng] = offsetPoint(maskedLatitude, maskedLongitude, Math.PI / 2, km * 1000); // due east
      return (await fetchMap(`?lat=${lat}&lng=${lng}`)).body.events.map((e) => e.id);
    };
    expect(await centerAt(0)).toContain(eventId);
    expect(await centerAt(49.5)).toContain(eventId);
    expect(await centerAt(50.5)).not.toContain(eventId);
    expect(await centerAt(200)).not.toContain(eventId);
    // Default center (Mainz) is ~16,000 km away.
    expect((await fetchMap()).body.events.map((e) => e.id)).not.toContain(eventId);
    // The host's own active pre-party is still reported as myEvent anywhere.
    await signInAs(h.userId);
    expect((await fetchMap()).body.myEvent?.id).toBe(eventId);
  });

  it("guests get no pre-parties at all (GUEST_MAP = venues-only)", async () => {
    const h = await host();
    const eventId = await startParty(h.userId, 49.2, 8.2);
    const asGuest = await eventFor(null, eventId);
    const body = JSON.parse(asGuest.raw);
    expect(body).toMatchObject({ signedIn: false, isGuest: true, events: [], myEvent: null });
    expect(asGuest.raw).not.toContain(eventId);
  });

  it("hides pre-parties of blocked pairs", async () => {
    const h = await host();
    const blocker = await host();
    const eventId = await startParty(h.userId, 49.3, 8.3);
    await prisma.groupBlock.create({ data: { blockerId: blocker.userId, blockedGroupId: h.groupId } });
    expect((await eventFor(blocker.userId, eventId)).event).toBeUndefined();
    await signInAs(blocker.userId);
    expect(await requestEventAttendance(eventId)).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "partyNotFound" });
  });
});

// ── Creating and ending (D7) ──────────────────────────────────────────────

describe("startPreParty / stopPreParty (D7)", () => {
  it("validates duration (1..8 whole hours), description and coordinates", async () => {
    const h = await host();
    await signInAs(h.userId);
    const base = { latitude: 49, longitude: 8, description: "" };
    for (const durationHours of [0, 9, 2.5, -1]) {
      expect(await startPreParty({ ...base, durationHours })).toEqual({ ok: false, code: "VALIDATION" });
    }
    expect(await startPreParty({ ...base, durationHours: 2, latitude: 91 })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await startPreParty({ ...base, durationHours: 2, longitude: -181 })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await startPreParty({ ...base, durationHours: 2, description: "x".repeat(281) })).toEqual({ ok: false, code: "VALIDATION" });
    expect(await prisma.event.count({ where: { ownerId: h.userId } })).toBe(0);
  });

  it("uses the chosen duration, allows one active pre-party, and only the host can end it", async () => {
    const h = await host();
    const other = await host();
    await signInAs(h.userId);
    const before = Date.now();
    const first = await startPreParty({ latitude: 49.4, longitude: 8.4, durationHours: 6 });
    if (!first.ok) throw new Error(first.code);
    const hours = (new Date(first.data.endTime).getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(5.99);
    expect(hours).toBeLessThan(6.01);

    expect(await startPreParty({ latitude: 49.4, longitude: 8.4, durationHours: 1 })).toEqual({
      ok: false, code: "FORBIDDEN", messageKey: "activePartyExists",
    });

    // Concurrent creates by a fresh host: exactly one wins.
    const racer = await host();
    await signInAs(racer.userId);
    const results = await Promise.all([1, 2, 3].map(() => startPreParty({ latitude: 49.45, longitude: 8.45, durationHours: 1 })));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.event.count({ where: { ownerId: racer.userId } })).toBe(1);

    // "End now": another user cannot end it.
    await signInAs(other.userId);
    expect(await stopPreParty()).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "partyEnded" });
    expect((await eventFor(other.userId, first.data.id)).event).toBeDefined();

    await signInAs(h.userId);
    expect(await stopPreParty()).toEqual({ ok: true, data: undefined });
    expect((await eventFor(other.userId, first.data.id)).event).toBeUndefined();
    const ended = await fetchMap();
    expect(ended.body.myEvent).toBeNull();

    // Pending requests of an ended pre-party can't be answered; a new one can be started.
    expect((await startPreParty({ latitude: 49.4, longitude: 8.4, durationHours: 1 })).ok).toBe(true);
  });

  it("requires a session and a group", async () => {
    signOut();
    expect(await startPreParty({ latitude: 49, longitude: 8, durationHours: 1 })).toEqual({ ok: false, code: "UNAUTHORIZED" });
    const lonely = await prisma.user.create({
      data: { email: `map7_nogroup_${stamp}@test.com`, password: "x", name: "No Group", birthDate: new Date("1990-01-01") },
    });
    users.push(lonely.id);
    await signInAs(lonely.id);
    expect(await startPreParty({ latitude: 49, longitude: 8, durationHours: 1 })).toEqual({
      ok: false, code: "NOT_FOUND", messageKey: "groupRequired",
    });
  });
});

// ── Access requests (B8, B9) ──────────────────────────────────────────────

describe("access requests (B8, B9)", () => {
  it("rejects nonexistent, own, expired and duplicate requests", async () => {
    const h = await host();
    const r = await host();
    const eventId = await startParty(h.userId, 49.6, 8.6);

    await signInAs(r.userId);
    expect(await requestEventAttendance("does-not-exist")).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "partyNotFound" });

    await signInAs(h.userId);
    expect(await requestEventAttendance(eventId)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "ownParty" });

    const expired = await prisma.event.create({
      data: { latitude: 1, longitude: 1, maskedLatitude: 1, maskedLongitude: 1, startTime: new Date(Date.now() - 7200_000), endTime: new Date(Date.now() - 60_000), ownerId: h.userId },
    });
    await signInAs(r.userId);
    expect(await requestEventAttendance(expired.id)).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "partyEnded" });

    expect(await requestEventAttendance(eventId)).toEqual({ ok: true, data: { status: "PENDING" } });
    expect(await requestEventAttendance(eventId)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "alreadyRequested" });
    expect(await prisma.eventAttendance.count({ where: { eventId } })).toBe(1);
    // Requesting does not touch the group's requests for other events.
    const second = await startParty((await host()).userId, 49.61, 8.61);
    await signInAs(r.userId);
    expect((await requestEventAttendance(second)).ok).toBe(true);
    expect(await prisma.eventAttendance.count({ where: { groupId: r.groupId } })).toBe(2);
  });

  it("accepting twice concurrently creates exactly one EVENT_ACCESS chat and reveals the location", async () => {
    const h = await host();
    const r = await host();
    const eventId = await startParty(h.userId, 49.7, 8.7);
    await signInAs(r.userId);
    await requestEventAttendance(eventId);
    const id = await attendanceId(eventId, r.groupId);

    await signInAs(h.userId);
    const results = await Promise.all([respondToEventRequest(id, true), respondToEventRequest(id, true)]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(results.find((x) => !x.ok)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "requestNotPending" });

    const [hostAId, hostBId] = canonicalPair(h.userId, r.userId);
    const chats = await prisma.chat.findMany({ where: { hostAId, hostBId } });
    expect(chats).toHaveLength(1);
    expect(chats[0].origin).toBe("EVENT_ACCESS");

    const seen = await eventFor(r.userId, eventId);
    expect(seen.event?.location.kind).toBe("exact");
    expect(seen.event?.chatId).toBe(chats[0].id);

    // Only PENDING requests can be answered.
    await signInAs(h.userId);
    expect(await respondToEventRequest(id, false)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "requestNotPending" });
  });

  it("rejecting shows 'not accepted' (no re-request); cancelling works and allows a new request", async () => {
    const h = await host();
    const rejected = await host();
    const canceller = await host();
    const eventId = await startParty(h.userId, 49.8, 8.8);

    await signInAs(rejected.userId);
    await requestEventAttendance(eventId);
    await signInAs(h.userId);
    expect(await respondToEventRequest(await attendanceId(eventId, rejected.groupId), false)).toEqual({
      ok: true, data: { status: "REJECTED", chatId: null },
    });
    const asRejected = await eventFor(rejected.userId, eventId);
    expect(asRejected.event?.myStatus).toBe("REJECTED");
    expect(asRejected.event?.location.kind).toBe("masked");
    await signInAs(rejected.userId);
    expect(await requestEventAttendance(eventId)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "requestRejected" });
    expect(await prisma.chat.count({ where: { OR: [{ hostAId: rejected.userId }, { hostBId: rejected.userId }] } })).toBe(0);

    await signInAs(canceller.userId);
    await requestEventAttendance(eventId);
    expect(await cancelEventRequest(eventId)).toEqual({ ok: true, data: undefined });
    expect((await prisma.eventAttendance.findUniqueOrThrow({ where: { groupId_eventId: { groupId: canceller.groupId, eventId } } })).status).toBe("CANCELLED");
    expect((await eventFor(canceller.userId, eventId)).event?.myStatus).toBeNull();
    await signInAs(canceller.userId);
    expect(await cancelEventRequest(eventId)).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "requestNotPending" });
    expect(await requestEventAttendance(eventId)).toEqual({ ok: true, data: { status: "PENDING" } });

    // The host sees pending + accepted only (no rejected/cancelled), without ids.
    const asHost = await eventFor(h.userId, eventId);
    expect(asHost.event?.attendees.map((a) => a.status)).toEqual(["PENDING"]);
    expect(asHost.raw).not.toContain(canceller.groupId);
  });

  it("only the host can answer, and only while the pre-party is active", async () => {
    const h = await host();
    const r = await host();
    const stranger = await host();
    const eventId = await startParty(h.userId, 49.9, 8.9);
    await signInAs(r.userId);
    await requestEventAttendance(eventId);
    const id = await attendanceId(eventId, r.groupId);

    await signInAs(stranger.userId);
    expect(await respondToEventRequest(id, true)).toEqual({ ok: false, code: "NOT_FOUND" });
    await signInAs(r.userId);
    expect(await respondToEventRequest(id, true)).toEqual({ ok: false, code: "NOT_FOUND" });

    await signInAs(h.userId);
    await stopPreParty();
    expect(await respondToEventRequest(id, true)).toEqual({ ok: false, code: "FORBIDDEN", messageKey: "partyEnded" });
  });
});

// ── Venues (B10, P2) ──────────────────────────────────────────────────────

describe("venues: tonight's counts within VENUE_RADIUS_KM (B10, P2)", () => {
  afterEach(() => vi.useRealTimers());

  it("counts only tonight (06:00 Europe/Berlin boundary), one venue per group per night, names for signed-in users only", async () => {
    const CENTER = "?lat=30&lng=30";
    const near1 = await prisma.venue.create({ data: { name: `Near1_${stamp}`, type: "BAR", latitude: 30.01, longitude: 30.01 } });
    const near2 = await prisma.venue.create({ data: { name: `Near2_${stamp}`, type: "CLUB", latitude: 29.95, longitude: 30.05 } });
    const far = await prisma.venue.create({ data: { name: `Far_${stamp}`, type: "BAR", latitude: 30.2, longitude: 30 } }); // ~22 km
    venues.push(near1.id, near2.id, far.id);
    const a = await host();
    const b = await host();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2030-11-15T04:59:00Z")); // Fri 05:59 Berlin -> Thursday's night

    await signInAs(a.userId);
    expect(await toggleVenueAttendance(near1.id)).toEqual({ ok: true, data: { attending: true } });
    await signInAs(b.userId);
    expect(await toggleVenueAttendance(near1.id)).toEqual({ ok: true, data: { attending: true } });

    // Signed in: count + names, no ids; venues outside the radius are not returned.
    const signedIn = await fetchMap(CENTER);
    const ids = signedIn.body.venues.map((v) => v.id);
    expect(ids).toEqual(expect.arrayContaining([near1.id, near2.id]));
    expect(ids).not.toContain(far.id);
    const v1 = signedIn.body.venues.find((v) => v.id === near1.id)!;
    expect(v1.attendeeCount).toBe(2);
    expect(v1.attendees?.map((x) => x.name).sort()).toEqual([a.name, b.name].sort());
    expect(v1.isMine).toBe(true);
    for (const secret of [a.userId, a.groupId, b.userId, b.groupId]) expect(signedIn.raw).not.toContain(secret);

    // Guests: the count only.
    signOut();
    const guest = await fetchMap(CENTER);
    const g1 = guest.body.venues.find((v) => v.id === near1.id)!;
    expect(g1.attendeeCount).toBe(2);
    expect(g1.attendees).toBeNull();
    expect(guest.raw).not.toContain(a.name);

    // Switching venue moves the mark (one per night); toggling again leaves.
    await signInAs(a.userId);
    expect(await toggleVenueAttendance(near2.id)).toEqual({ ok: true, data: { attending: true } });
    let map = await fetchMap(CENTER);
    expect(map.body.venues.find((v) => v.id === near1.id)!.attendeeCount).toBe(1);
    expect(map.body.venues.find((v) => v.id === near2.id)!.attendeeCount).toBe(1);
    expect(await toggleVenueAttendance(near2.id)).toEqual({ ok: true, data: { attending: false } });
    map = await fetchMap(CENTER);
    expect(map.body.venues.find((v) => v.id === near2.id)!.attendeeCount).toBe(0);

    // 06:01 Berlin: a new night, counts start at zero again.
    vi.setSystemTime(new Date("2030-11-15T05:01:00Z"));
    await signInAs(b.userId);
    map = await fetchMap(CENTER);
    expect(map.body.venues.find((v) => v.id === near1.id)!.attendeeCount).toBe(0);
    expect(map.body.venues.find((v) => v.id === near1.id)!.isMine).toBe(false);
    // ...and b can mark a venue for the new night (the old mark stays on the old night).
    expect(await toggleVenueAttendance(near1.id)).toEqual({ ok: true, data: { attending: true } });
    expect(await prisma.venueAttendance.count({ where: { groupId: b.groupId } })).toBe(2);
  });

  it("validates the map center and requires a group to mark a venue", async () => {
    signOut();
    expect((await fetchMap("?lat=91&lng=0")).status).toBe(400);
    expect((await fetchMap("?lat=abc&lng=0")).status).toBe(400);
    expect(await toggleVenueAttendance("x")).toEqual({ ok: false, code: "UNAUTHORIZED" });
    const lonely = await prisma.user.create({
      data: { email: `map7_nogroup2_${stamp}@test.com`, password: "x", name: "No Group 2", birthDate: new Date("1990-01-01") },
    });
    users.push(lonely.id);
    await signInAs(lonely.id);
    expect(await toggleVenueAttendance("x")).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "groupRequired" });
  });
});

// ── Retention ─────────────────────────────────────────────────────────────

describe("retention: venue marks older than 30 days", () => {
  it("deletes marks whose night is more than 30 days old and keeps recent ones", async () => {
    const g = await host();
    const venue = await prisma.venue.create({ data: { name: `Ret_${stamp}`, type: "BAR", latitude: 0, longitude: 0 } });
    venues.push(venue.id);
    const now = new Date("2030-06-15T12:00:00Z");
    const nightsAgo = (n: number) => new Date(Date.UTC(2030, 5, 15 - n));
    const mark = (n: number) => prisma.venueAttendance.create({ data: { groupId: g.groupId, venueId: venue.id, night: nightsAgo(n) } });
    await mark(45);
    await mark(31);
    const kept30 = await mark(30);
    const kept1 = await mark(1);

    expect(await cleanupOldVenueAttendance(prisma, now)).toBeGreaterThanOrEqual(2);
    const left = await prisma.venueAttendance.findMany({ where: { groupId: g.groupId }, select: { id: true } });
    expect(left.map((m) => m.id).sort()).toEqual([kept30.id, kept1.id].sort());
  });
});

describe("retention (EXPIRED_EVENT_RETENTION_HOURS = 24)", () => {
  it("deletes only events past the retention window (with their requests) and keeps EVENT_ACCESS chats", async () => {
    const h = await host();
    const r = await host();
    const now = new Date();
    const hoursAgo = (n: number) => new Date(now.getTime() - n * 3_600_000);
    const mk = (endTime: Date | null, createdAt = hoursAgo(1)) =>
      prisma.event.create({
        data: { latitude: 1, longitude: 1, maskedLatitude: 1, maskedLongitude: 1, startTime: hoursAgo(30), endTime, createdAt, ownerId: h.userId },
      });
    const old = await mk(hoursAgo(25));
    const recent = await mk(hoursAgo(23));
    const active = await mk(new Date(now.getTime() + 3_600_000));
    const undatedOld = await mk(null, hoursAgo(40));
    const undatedNew = await mk(null, hoursAgo(10));
    await prisma.eventAttendance.create({ data: { groupId: r.groupId, eventId: old.id, status: "ACCEPTED" } });
    const [hostAId, hostBId] = canonicalPair(h.userId, r.userId);
    const chat = await prisma.chat.create({ data: { hostAId, hostBId, origin: "EVENT_ACCESS" } });

    expect(await cleanupExpiredEvents(prisma, now)).toBeGreaterThanOrEqual(2);

    const left = (await prisma.event.findMany({ where: { ownerId: h.userId }, select: { id: true } })).map((e) => e.id);
    expect(left.sort()).toEqual([recent.id, active.id, undatedNew.id].sort());
    expect(left).not.toContain(undatedOld.id);
    expect(await prisma.eventAttendance.count({ where: { eventId: old.id } })).toBe(0);
    expect(await prisma.chat.findUnique({ where: { id: chat.id } })).not.toBeNull();
  });
});
