import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDiscoveryGroups, toggleLike } from "@/app/actions/discoverGroups";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { fakeCookieStore, sessionCookiesFor } from "./helpers/session";
import { discoveryPage, fullDiscoveryFeed } from "./helpers/discovery";
import { fetchLikes } from "./helpers/api";
import { DISCOVERY_PAGE_SIZE, encodeDiscoveryCursor } from "@/lib/discovery";
import { DISCOVERY_TEASER } from "@/lib/discoveryTeaser";
import { EARTH_RADIUS_KM, haversineKm, haversineSql, MAX_DISTANCE_KM } from "@/lib/geo";
import { Prisma } from "@prisma/client";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const stamp = Date.now();
let seq = 0;
const createdUserIds: string[] = [];

type GroupExtra = Partial<Prisma.GroupCreateWithoutUserInput>;

/** A host with a group at (lat, lon). Coordinates are written as given (no coarsening). */
async function host(lat: number | null, lon: number | null, extra: GroupExtra = {}) {
  const n = seq++;
  const user = await prisma.user.create({
    data: {
      email: `disc_${n}_${stamp}@test.com`,
      password: "x",
      name: `DiscoveryHost${n}_${stamp}`,
      birthDate: new Date("1998-01-01"),
      group: {
        create: { membersCount: 2, gender: "MIXED", latitude: lat, longitude: lon, publicProfile: true, ...extra },
      },
    },
    include: { group: true },
  });
  createdUserIds.push(user.id);
  return { userId: user.id, groupId: user.group!.id, name: user.name, lat, lon };
}

async function signInAs(userId: string) {
  vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(userId)) as never);
}

/** Longitude offset (degrees) of a point `km` due east of latitude `lat` (haversine sphere). */
function eastOffsetDeg(lat: number, km: number) {
  const rad = 2 * Math.asin(Math.sin(km / (2 * EARTH_RADIUS_KM)) / Math.cos((lat * Math.PI) / 180));
  return (rad * 180) / Math.PI;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe("Discovery Algorithm & Feed Integrity (Integration)", () => {
  let mainUserId: string, mainGroupId: string;
  let farUserId: string, farGroupId: string;
  let alreadyLikedUserId: string, alreadyLikedGroupId: string;
  let freshUserId: string, freshGroupId: string;

  const emailMain = `main_${Date.now()}@test.com`;
  const emailFar = `far_${Date.now()}@test.com`;
  const emailLiked = `liked_${Date.now()}@test.com`;
  const emailFresh = `fresh_${Date.now()}@test.com`;

  beforeAll(async () => {
    // 1. Create Main User (Searching)
    const mainUser = await prisma.user.create({
      data: { email: emailMain, password: "123", name: "Main", birthDate: new Date(), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 50.0, longitude: 8.0, publicProfile: true }
      }}
    });
    mainUserId = mainUser.id;
    mainGroupId = (await prisma.group.findUnique({ where: { userId: mainUserId } }))!.id;

    // 2. Create user far away (Out of bounds)
    const farUser = await prisma.user.create({
      data: { email: emailFar, password: "123", name: "Far", birthDate: new Date(), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 52.0, longitude: 13.0, publicProfile: true } // Berlin coordinates approx
      }}
    });
    farUserId = farUser.id;
    farGroupId = (await prisma.group.findUnique({ where: { userId: farUserId } }))!.id;

    // 3. Create user already liked by Main
    const alreadyLikedUser = await prisma.user.create({
      data: { email: emailLiked, password: "123", name: "Liked", birthDate: new Date(), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 50.01, longitude: 8.01, publicProfile: true }
      }}
    });
    alreadyLikedUserId = alreadyLikedUser.id;
    alreadyLikedGroupId = (await prisma.group.findUnique({ where: { userId: alreadyLikedUserId } }))!.id;

    // 4. Create fresh valid user nearby
    const freshUser = await prisma.user.create({
      data: { email: emailFresh, password: "123", name: "Fresh", birthDate: new Date(), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 50.02, longitude: 8.02, publicProfile: true }
      }}
    });
    freshUserId = freshUser.id;
    freshGroupId = (await prisma.group.findUnique({ where: { userId: freshUserId } }))!.id;

    // Simulate Main User liking the "Already Liked" group to set up the state
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(mainUserId)) as never);
    await toggleLike(alreadyLikedGroupId);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [emailMain, emailFar, emailLiked, emailFresh] } } });
  });

  it("should accurately filter the discovery feed according to proximity and interaction history", async () => {
    // Simulate Main User session
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(mainUserId)) as never);

    const distanceLimit = 20; // km
    // Cards carry no user ids (S4), so the feed is matched on group ids. Other
    // test files share this area, so the whole feed is collected.
    const feed = await fullDiscoveryFeed(distanceLimit);
    const feedIds = feed.map(g => g.id);

    // Standard Requirement 1: A user MUST NOT see their own group
    expect(feedIds).not.toContain(mainGroupId);

    // Standard Requirement 2: Geofencing bounds MUST be respected
    expect(feedIds).not.toContain(farGroupId);

    // Standard Requirement 3: Previously interacted groups MUST NOT be excluded from discovery
    expect(feedIds).toContain(alreadyLikedGroupId);

    // Standard Requirement 4: Valid, nearby, fresh users MUST be included
    expect(feedIds).toContain(freshGroupId);

    // ALREADY_LIKED = show-with-badge: the liked group is flagged, the others are not.
    expect(feed.find(g => g.id === alreadyLikedGroupId)?.likedByMe).toBe(true);
    expect(feed.find(g => g.id === freshGroupId)?.likedByMe).toBe(false);
  });
});

describe("haversine: SQL and JS are the same production formula", () => {
  it("haversineSql matches haversineKm", async () => {
    const points: [number, number, number, number][] = [
      [49.9929, 8.2473, 50.1109, 8.6821],
      [50, 30, 50, 30.12577],
      [-20, 140, -20.3, 140.4],
      [10, 179.99, 10, -179.98],
      [0, 0, 0, 0],
    ];
    for (const [lat1, lon1, lat2, lon2] of points) {
      const [row] = await prisma.$queryRaw<{ km: number }[]>`
        SELECT ${haversineSql(Prisma.sql`${lat2}::float8`, Prisma.sql`${lon2}::float8`, lat1, lon1)} AS "km"
      `;
      expect(row.km).toBeCloseTo(haversineKm(lat1, lon1, lat2, lon2), 9);
    }
  });
});

describe("geofence (B1) and server-side radius clamp", () => {
  it("includes a group 9 km due east at 50°N within 10 km and excludes one just outside", async () => {
    const origin = await host(50.0, 30.0);
    const east9 = await host(50.0, 30.0 + eastOffsetDeg(50, 9));
    const north9 = await host(50.0 + (9 / EARTH_RADIUS_KM) * (180 / Math.PI), 30.0);
    const east10_5 = await host(50.0, 30.0 + eastOffsetDeg(50, 10.5));

    expect(haversineKm(50, 30, east9.lat!, east9.lon!)).toBeCloseTo(9, 6);

    await signInAs(origin.userId);
    const ids = (await fullDiscoveryFeed(10)).map((g) => g.id);
    expect(ids).toContain(east9.groupId);
    expect(ids).toContain(north9.groupId);
    expect(ids).not.toContain(east10_5.groupId);
  });

  it("finds groups across the antimeridian", async () => {
    const origin = await host(10.0, 179.99);
    const across = await host(10.0, -179.98); // ~3.3 km away
    await signInAs(origin.userId);
    const feed = await fullDiscoveryFeed(10);
    expect(feed.map((g) => g.id)).toContain(across.groupId);
    expect(feed.find((g) => g.id === across.groupId)?.distanceKm).toBe(3);
  });

  it(`clamps distance 20000 to MAX_DISTANCE_KM (${MAX_DISTANCE_KM}) and 0 to 1`, async () => {
    const origin = await host(45.0, -60.0);
    const at45 = await host(45.0, -60.0 + eastOffsetDeg(45, 45));
    const at60 = await host(45.0, -60.0 + eastOffsetDeg(45, 60));
    const at0_5 = await host(45.0, -60.0 + eastOffsetDeg(45, 0.5));

    await signInAs(origin.userId);
    const huge = await getDiscoveryGroups({ distance: 20000 });
    expect(huge.ok).toBe(true);
    const ids = (await fullDiscoveryFeed(20000)).map((g) => g.id);
    expect(ids).toContain(at45.groupId);
    expect(ids).not.toContain(at60.groupId);

    const tiny = await fullDiscoveryFeed(0);
    expect(tiny.map((g) => g.id)).toEqual([at0_5.groupId]);
    expect(tiny[0].distanceKm).toBe(0); // "< 1 km"

    expect(await getDiscoveryGroups({ distance: Number.NaN })).toEqual({ ok: false, code: "VALIDATION" });
  });

  it("does not filter on isPartyMode (B4) and returns an empty feed without an own location", async () => {
    const origin = await host(-35.0, -70.0);
    const party = await host(-35.0, -70.01, { isPartyMode: true });
    await signInAs(origin.userId);
    expect((await fullDiscoveryFeed(10)).map((g) => g.id)).toContain(party.groupId);

    const noLocation = await host(null, null);
    await signInAs(noLocation.userId);
    expect(await getDiscoveryGroups({ distance: 10 })).toEqual({
      ok: true,
      data: { hasNoGroup: false, groups: [], nextCursor: null },
    });
  });

  it("applies gender and age preferences in both directions", async () => {
    const origin = await host(-10.0, 20.0, { gender: "FEMALE", searchGender: "MALE", ageMin: 25, ageMax: 30, searchAgeMin: 25, searchAgeMax: 35 });
    const ok = await host(-10.0, 20.01, { gender: "MALE", searchGender: "FEMALE", ageMin: 26, ageMax: 32, searchAgeMin: 20, searchAgeMax: 40 });
    const wrongGender = await host(-10.0, 20.01, { gender: "FEMALE", searchGender: "MIXED", ageMin: 26, ageMax: 32 });
    const theyWantOtherGender = await host(-10.0, 20.01, { gender: "MALE", searchGender: "MALE", ageMin: 26, ageMax: 32 });
    const tooOld = await host(-10.0, 20.01, { gender: "MALE", searchGender: "MIXED", ageMin: 40, ageMax: 45, searchAgeMin: 20, searchAgeMax: 40 });
    const theyWantYounger = await host(-10.0, 20.01, { gender: "MALE", searchGender: "MIXED", ageMin: 26, ageMax: 32, searchAgeMin: 18, searchAgeMax: 22 });

    await signInAs(origin.userId);
    const ids = (await fullDiscoveryFeed(10)).map((g) => g.id);
    expect(ids).toEqual([ok.groupId]);
    for (const excluded of [wrongGender, theyWantOtherGender, tooOld, theyWantYounger]) {
      expect(ids).not.toContain(excluded.groupId);
    }
  });
});

describe("location privacy (S4): no coordinates or user ids in responses", () => {
  it("discovery and GET /api/likes carry no latitude, longitude, userId or other users' ids", async () => {
    const origin = await host(60.0, 25.0);
    const other = await host(60.0123, 25.0456);

    // `other` likes `origin`, `origin` likes back: data in both responses.
    await signInAs(other.userId);
    expect((await toggleLike(origin.groupId, true)).ok).toBe(true);
    await signInAs(origin.userId);
    expect((await toggleLike(other.groupId, true)).ok).toBe(true);

    const discovery = await getDiscoveryGroups({ distance: 10 });
    const likes = await fetchLikes();
    expect(likes.status).toBe(200);

    for (const raw of [JSON.stringify(discovery), likes.raw]) {
      expect(raw).toContain(other.groupId);
      expect(raw).not.toMatch(/"(latitude|longitude|lat|lng|lon|userId|ownerId|hostAId|hostBId)"/);
      expect(raw).not.toContain(other.userId);
      expect(raw).not.toContain(origin.userId);
      expect(raw).not.toContain("60.0123");
      expect(raw).not.toContain("25.0456");
    }

    const card = discovery.ok && !discovery.data.hasNoGroup ? discovery.data.groups[0] : null;
    expect(card?.distanceKm).toBe(Math.round(haversineKm(60, 25, 60.0123, 25.0456)));
    expect(card?.user).toEqual({ name: other.name, username: null, image: null });

    const liked = likes.body.groups.find((g) => g.id === other.groupId);
    // LIKED_ME_MAP = approximate-circles: coarsened center, ~1 km radius.
    expect(liked?.area).toEqual({ center: [60.01, 25.05], radiusM: 1000 });
    expect(liked?.distanceKm).toBe(Math.round(haversineKm(60, 25, 60.0123, 25.0456)));
  });
});

describe("pagination (B2, B3): nearest first, keyset, every eligible group exactly once", () => {
  const ORIGIN = { lat: -20.0, lon: 140.0 };
  let origin: Awaited<ReturnType<typeof host>>;
  let expectedOrder: string[];
  let likedIds: Set<string>;

  beforeAll(async () => {
    origin = await host(ORIGIN.lat, ORIGIN.lon);

    // 28 groups 0.3..8.4 km east (all distinct), plus 3 sharing one point (tie on distance -> id order).
    const groups: Awaited<ReturnType<typeof host>>[] = [];
    for (let i = 0; i < 28; i += 1) {
      groups.push(await host(ORIGIN.lat, ORIGIN.lon + eastOffsetDeg(ORIGIN.lat, 0.3 * (i + 1))));
    }
    const tieLon = ORIGIN.lon + eastOffsetDeg(ORIGIN.lat, 4.05);
    for (let i = 0; i < 3; i += 1) groups.push(await host(ORIGIN.lat, tieLon));
    // Older groups created later in time must not matter (no createdAt cut-off).
    const old = await host(ORIGIN.lat, ORIGIN.lon + eastOffsetDeg(ORIGIN.lat, 0.1), {
      createdAt: new Date("2020-01-01"),
    });
    groups.push(old);

    // Blocks in both directions, and one hidden profile.
    const blockedByMe = [groups[0], groups[11]];
    const blockedMe = [groups[5], groups[29]];
    for (const g of blockedByMe) {
      await prisma.groupBlock.create({ data: { blockerId: origin.userId, blockedGroupId: g.groupId } });
    }
    for (const g of blockedMe) {
      await prisma.groupBlock.create({ data: { blockerId: g.userId, blockedGroupId: origin.groupId } });
    }
    const hidden = groups[7];
    await prisma.group.update({ where: { id: hidden.groupId }, data: { publicProfile: false } });

    const excluded = new Set([...blockedByMe, ...blockedMe, hidden].map((g) => g.groupId));
    const eligible = groups.filter((g) => !excluded.has(g.groupId));

    // Some of them already liked by me.
    likedIds = new Set([eligible[0], eligible[9], eligible[10], eligible[20], eligible[eligible.length - 1]].map((g) => g.groupId));
    await prisma.groupLike.createMany({
      data: [...likedIds].map((toGroupId) => ({ fromGroupId: origin.groupId, toGroupId })),
    });

    expectedOrder = eligible
      .map((g) => ({ id: g.groupId, d: haversineKm(ORIGIN.lat, ORIGIN.lon, g.lat!, g.lon!) }))
      .sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((g) => g.id);
    expect(expectedOrder.length).toBeGreaterThanOrEqual(25);
  });

  it("returns each eligible group once, in distance order, with likedByMe", async () => {
    await signInAs(origin.userId);

    const pages: string[][] = [];
    const seen: { id: string; likedByMe: boolean; distanceKm: number }[] = [];
    let cursor: string | undefined;
    do {
      const page = await discoveryPage(10, cursor);
      pages.push(page.groups.map((g) => g.id));
      seen.push(...page.groups);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen.map((g) => g.id)).toEqual(expectedOrder);
    expect(new Set(seen.map((g) => g.id)).size).toBe(seen.length);
    expect(pages.slice(0, -1).every((p) => p.length === DISCOVERY_PAGE_SIZE)).toBe(true);
    for (const g of seen) expect(g.likedByMe).toBe(likedIds.has(g.id));
    // Rounded distances never decrease along the feed.
    const km = seen.map((g) => g.distanceKm);
    expect(km).toEqual([...km].sort((a, b) => a - b));
  });

  it("never restarts the feed for a garbage, tampered, unknown or stale cursor", async () => {
    await signInAs(origin.userId);
    const first = await discoveryPage(10);
    const validCursor = first.nextCursor!;
    const firstIds = first.groups.map((g) => g.id);

    const fp = JSON.parse(Buffer.from(validCursor, "base64url").toString()).fp as string;
    const bad = [
      "garbage",
      Buffer.from("{not json").toString("base64url"),
      Buffer.from(JSON.stringify({ v: 2, id: firstIds[0], fp })).toString("base64url"),
      encodeDiscoveryCursor("unknown-group-id", fp),
      encodeDiscoveryCursor(firstIds[9], "0000000000000000"),
    ];
    for (const cursor of bad) {
      expect(await getDiscoveryGroups({ distance: 10, cursor })).toEqual({
        ok: false,
        code: "VALIDATION",
        messageKey: "staleCursor",
      });
    }

    // Stale: same cursor with a different radius (fingerprint changes).
    expect(await getDiscoveryGroups({ distance: 11, cursor: validCursor })).toMatchObject({ ok: false, code: "VALIDATION" });

    // Valid cursor continues after page 1.
    const second = await discoveryPage(10, validCursor);
    expect(second.groups.map((g) => g.id)).toEqual(expectedOrder.slice(10, 20));
    expect(second.groups.some((g) => firstIds.includes(g.id))).toBe(false);
  });
});

describe("teaser for guests and users without a group (D5)", () => {
  it("guests get static placeholders only", async () => {
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore({ gloo_is_guest: "true" }) as never);
    const result = await getDiscoveryGroups({ distance: 10 });
    expect(result).toEqual({ ok: true, data: { hasNoGroup: true, teaser: [...DISCOVERY_TEASER] } });
    const raw = JSON.stringify(result);
    expect(raw).not.toMatch(/photos|image|"user"|description|DiscoveryHost|groups\//);
  });

  it("signed-in users without a group get the same teaser", async () => {
    const user = await prisma.user.create({
      data: { email: `nogroup_${stamp}@test.com`, password: "x", name: "No Group", birthDate: new Date("1999-01-01") },
    });
    createdUserIds.push(user.id);
    await signInAs(user.id);
    expect(await getDiscoveryGroups({ distance: 10 })).toEqual({
      ok: true,
      data: { hasNoGroup: true, teaser: [...DISCOVERY_TEASER] },
    });
  });
});
