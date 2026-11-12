import "server-only";

import { createHash } from "node:crypto";
import { Prisma, type Gender } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getChatIdsWith } from "@/lib/chats";
import { toPublicUrl, toPublicUrls } from "@/lib/storage";
import { boundingBox, haversineSql, roundDistanceKm } from "@/lib/geo";
import type { DiscoveryGroupDTO } from "@/lib/apiTypes";

/**
 * Discovery feed query (Pack 6: S4, B1, B2, B3, B4).
 *
 * Every filter runs in ONE parameterized PostgreSQL query, before any limit:
 * bounding box (uses the [latitude, longitude] index), exact haversine
 * distance (lib/geo.ts), age overlap in both directions, gender preferences
 * in both directions, publicProfile, not my own group, and no blocked pair in
 * either direction (same rule as getBlockSet in lib/blocks.ts). isPartyMode is
 * not filtered (PARTY_MODE_FILTER = ignore).
 *
 * ALREADY_LIKED = show-with-badge: liked groups stay in the feed with
 * `likedByMe` computed in the same query.
 *
 * FEED_ORDER = nearest: ORDER BY distance, id with keyset pagination on
 * (distance, id), DISCOVERY_PAGE_SIZE per page. The cursor is opaque
 * (base64url JSON) and holds only the last group id plus a fingerprint of the
 * query origin. The server recomputes that group's distance inside the query,
 * so the cursor never carries an exact distance (S4). A malformed cursor, an
 * unknown group or a fingerprint from another origin/radius throws
 * InvalidDiscoveryCursorError; it never restarts the feed at page 1.
 */

export const DISCOVERY_PAGE_SIZE = 10;

export class InvalidDiscoveryCursorError extends Error {
  constructor() {
    super("Invalid or stale discovery cursor");
    this.name = "InvalidDiscoveryCursorError";
  }
}

/** The caller's own group: where and for whom the feed is searched. */
export interface DiscoveryOrigin {
  userId: string;
  groupId: string;
  latitude: number;
  longitude: number;
  gender: Gender;
  searchGender: Gender;
  ageMin: number;
  ageMax: number;
  searchAgeMin: number;
  searchAgeMax: number;
}

const cursorSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(64),
  fp: z.string().regex(/^[0-9a-f]{16}$/),
});

/** Changes whenever the result set would change: own location, radius or preferences. */
function fingerprint(origin: DiscoveryOrigin, radiusKm: number): string {
  const parts = [
    origin.groupId,
    origin.latitude,
    origin.longitude,
    radiusKm,
    origin.gender,
    origin.searchGender,
    origin.ageMin,
    origin.ageMax,
    origin.searchAgeMin,
    origin.searchAgeMax,
  ];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

export function encodeDiscoveryCursor(lastGroupId: string, fp: string): string {
  return Buffer.from(JSON.stringify({ v: 1, id: lastGroupId, fp })).toString("base64url");
}

function decodeCursor(cursor: string, expectedFp: string): { id: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new InvalidDiscoveryCursorError();
  }
  const result = cursorSchema.safeParse(parsed);
  if (!result.success || result.data.fp !== expectedFp) throw new InvalidDiscoveryCursorError();
  return { id: result.data.id };
}

type Row = {
  id: string;
  ownerId: string;
  description: string | null;
  membersCount: number;
  gender: Gender;
  ageMin: number;
  ageMax: number;
  photos: string[];
  userName: string;
  userUsername: string | null;
  userImage: string | null;
  distance: number;
  likedByMe: boolean;
};

export interface DiscoveryPage {
  groups: DiscoveryGroupDTO[];
  nextCursor: string | null;
}

export async function queryDiscoveryPage(
  origin: DiscoveryOrigin,
  radiusKm: number,
  cursor?: string,
): Promise<DiscoveryPage> {
  const fp = fingerprint(origin, radiusKm);
  const after = cursor ? decodeCursor(cursor, fp) : null;

  const distanceOf = (alias: string) =>
    haversineSql(Prisma.raw(`${alias}."latitude"`), Prisma.raw(`${alias}."longitude"`), origin.latitude, origin.longitude);

  if (after) {
    const exists = await prisma.$queryRaw<{ ok: number }[]>`
      SELECT 1 AS "ok" FROM "Group" c
       WHERE c."id" = ${after.id} AND c."latitude" IS NOT NULL AND c."longitude" IS NOT NULL
    `;
    if (exists.length === 0) throw new InvalidDiscoveryCursorError();
  }

  const box = boundingBox(origin.latitude, origin.longitude, radiusKm);
  const inLonRange = Prisma.join(
    box.lonRanges.map(([min, max]) => Prisma.sql`g."longitude" BETWEEN ${min}::float8 AND ${max}::float8`),
    " OR ",
  );
  // Keyset: strictly after the cursor group's (distance, id), recomputed here.
  const afterCursor = after
    ? Prisma.sql`AND (d."distance", g."id") > (SELECT ${distanceOf("c")}, c."id" FROM "Group" c WHERE c."id" = ${after.id})`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<Row[]>`
    SELECT g."id",
           g."userId" AS "ownerId",
           g."description",
           g."membersCount",
           g."gender"::text AS "gender",
           g."ageMin",
           g."ageMax",
           g."photos",
           u."name" AS "userName",
           u."username" AS "userUsername",
           u."image" AS "userImage",
           d."distance",
           EXISTS (
             SELECT 1 FROM "GroupLike" l
              WHERE l."fromGroupId" = ${origin.groupId} AND l."toGroupId" = g."id"
           ) AS "likedByMe"
      FROM "Group" g
      JOIN "User" u ON u."id" = g."userId"
     CROSS JOIN LATERAL (SELECT ${distanceOf("g")} AS "distance") d
     WHERE g."id" <> ${origin.groupId}
       AND g."userId" <> ${origin.userId}
       AND g."publicProfile" = true
       AND g."latitude" IS NOT NULL
       AND g."longitude" IS NOT NULL
       AND g."latitude" BETWEEN ${box.minLat}::float8 AND ${box.maxLat}::float8
       AND (${inLonRange})
       AND d."distance" <= ${radiusKm}::float8
       AND (${origin.searchGender}::text = 'MIXED' OR g."gender" = ${origin.searchGender}::"Gender")
       AND (g."searchGender" = 'MIXED' OR g."searchGender" = ${origin.gender}::"Gender")
       AND g."ageMax" >= ${origin.searchAgeMin}::int AND g."ageMin" <= ${origin.searchAgeMax}::int
       AND g."searchAgeMin" <= ${origin.ageMax}::int AND g."searchAgeMax" >= ${origin.ageMin}::int
       AND NOT EXISTS (
             SELECT 1 FROM "GroupBlock" b
              WHERE b."blockerId" = ${origin.userId} AND b."blockedGroupId" = g."id"
           )
       AND NOT EXISTS (
             SELECT 1 FROM "GroupBlock" b
              WHERE b."blockerId" = g."userId" AND b."blockedGroupId" = ${origin.groupId}
           )
       ${afterCursor}
     ORDER BY d."distance", g."id"
     LIMIT ${DISCOVERY_PAGE_SIZE + 1}
  `;

  const page = rows.slice(0, DISCOVERY_PAGE_SIZE);
  const chatIds = await getChatIdsWith(origin.userId, page.map((row) => row.ownerId));

  // Explicit DTO: no owner/user ids, no coordinates, no exact distance.
  const groups: DiscoveryGroupDTO[] = page.map((row) => ({
    id: row.id,
    user: { name: row.userName, username: row.userUsername, image: toPublicUrl(row.userImage) },
    photos: toPublicUrls(row.photos),
    description: row.description,
    membersCount: row.membersCount,
    gender: row.gender,
    ageMin: row.ageMin,
    ageMax: row.ageMax,
    distanceKm: roundDistanceKm(row.distance),
    likedByMe: row.likedByMe,
    chatId: chatIds.get(row.ownerId) ?? null,
  }));

  const nextCursor = rows.length > DISCOVERY_PAGE_SIZE ? encodeDiscoveryCursor(page[page.length - 1].id, fp) : null;
  return { groups, nextCursor };
}
