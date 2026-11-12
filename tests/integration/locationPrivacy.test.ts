import { describe, it, expect, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { createGroupAction } from "@/app/actions/group";
import { coarsenCoordinate, LOCATION_CHANGE_LIMIT_PER_DAY } from "@/lib/geo";
import { sessionCookiesFor } from "./helpers/session";

/**
 * S4 on the local test DB: coordinates are coarsened when a group is saved,
 * location changes are rate limited per group, and the coarsening migration
 * rounds existing rows the same way as lib/geo.ts.
 */

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

const MIGRATION = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261112015321_coarsen_group_locations",
  "migration.sql",
);

const stamp = Date.now();
let seq = 0;
const createdUserIds: string[] = [];

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

async function hostWithGroup(lat: number | null = null, lon: number | null = null) {
  const n = seq++;
  const user = await prisma.user.create({
    data: {
      email: `locpriv_${n}_${stamp}@test.com`,
      password: "x",
      name: `LocPriv ${n}`,
      birthDate: new Date("1997-01-01"),
      group: { create: { latitude: lat, longitude: lon, photos: [`groups/locpriv-${n}/photo.webp`] } },
    },
    include: { group: true },
  });
  createdUserIds.push(user.id);
  return { userId: user.id, groupId: user.group!.id, photo: user.group!.photos[0] };
}

/** The form the preferences page submits (keeps the stored photo). */
function form(photo: string, latitude: string, longitude: string) {
  const data = new FormData();
  data.append("existingPhotos", photo);
  data.append("latitude", latitude);
  data.append("longitude", longitude);
  return data;
}

async function stored(groupId: string) {
  return prisma.group.findUniqueOrThrow({ where: { id: groupId }, select: { latitude: true, longitude: true } });
}

describe("createGroupAction stores coarsened coordinates", () => {
  it("rounds GPS coordinates to 2 decimals on the server", async () => {
    const h = await hostWithGroup();
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(h.userId)) as never);

    await createGroupAction(form(h.photo, "49.992912345", "-8.247312345"), "en");

    expect(redirect).toHaveBeenCalledWith("/en/search-groups");
    expect(await stored(h.groupId)).toEqual({ latitude: 49.99, longitude: -8.25 });
  });

  it("stores no location for invalid or out-of-range input", async () => {
    const h = await hostWithGroup(50, 8);
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(h.userId)) as never);

    await createGroupAction(form(h.photo, "91", "8"), "en");
    expect(await stored(h.groupId)).toEqual({ latitude: null, longitude: null });
  });
});

describe(`location changes are limited to ${LOCATION_CHANGE_LIMIT_PER_DAY} per group per day`, () => {
  it("rejects the next change with RATE_LIMITED / locationChangeLimit and keeps the stored location", async () => {
    const h = await hostWithGroup();
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(h.userId)) as never);

    for (let i = 0; i < LOCATION_CHANGE_LIMIT_PER_DAY; i += 1) {
      expect(await createGroupAction(form(h.photo, String(50 + i * 0.05), "8"), "en")).toBeUndefined();
    }
    const last = await stored(h.groupId);
    expect(last).toEqual({ latitude: coarsenCoordinate(50 + (LOCATION_CHANGE_LIMIT_PER_DAY - 1) * 0.05), longitude: 8 });

    expect(await createGroupAction(form(h.photo, "40", "8"), "en")).toEqual({
      ok: false,
      code: "RATE_LIMITED",
      messageKey: "locationChangeLimit",
    });
    expect(await stored(h.groupId)).toEqual(last);

    // Saving without moving (same coarsened point) does not count and still works.
    expect(
      await createGroupAction(form(h.photo, String(last.latitude! + 0.001), String(last.longitude! + 0.001)), "en"),
    ).toBeUndefined();
  });

  it("counts per group: another group can still move", async () => {
    const other = await hostWithGroup();
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(other.userId)) as never);
    expect(await createGroupAction(form(other.photo, "48.1", "11.5"), "en")).toBeUndefined();
    expect(await stored(other.groupId)).toEqual({ latitude: 48.1, longitude: 11.5 });
  });
});

describe("coarsen_group_locations migration (integration, local test DB)", () => {
  it("rounds existing rows like coarsenCoordinate and leaves rounded/null rows alone", async () => {
    const values: [number | null, number | null][] = [
      [49.9929, 8.2473],
      [8.245, -8.245],
      [-0.005, 0.005],
      [50.01, 8.02],
      [null, null],
      [89.999, 179.996],
    ];
    const hosts = [];
    for (const [lat, lon] of values) hosts.push(await hostWithGroup(lat, lon));
    const ids = hosts.map((h) => h.groupId);

    // Runs inside a transaction that is rolled back, so other test files that
    // share the database never see their rows change.
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(fs.readFileSync(MIGRATION, "utf8"));
      const { rows } = await client.query<{ id: string; latitude: number | null; longitude: number | null }>(
        `SELECT "id", "latitude", "longitude" FROM "Group" WHERE "id" = ANY($1)`,
        [ids],
      );
      await client.query("ROLLBACK");

      // At least the 4 unrounded rows of this test (3 changed + the 89.999 row).
      expect(result.rowCount).toBeGreaterThanOrEqual(4);
      const byId = new Map(rows.map((r) => [r.id, r]));
      values.forEach(([lat, lon], i) => {
        const row = byId.get(ids[i])!;
        expect(row.latitude).toBe(lat === null ? null : coarsenCoordinate(lat));
        expect(row.longitude).toBe(lon === null ? null : coarsenCoordinate(lon));
      });
      expect(byId.get(ids[1])).toMatchObject({ latitude: 8.25, longitude: -8.25 });
      expect(byId.get(ids[2])).toMatchObject({ latitude: -0.01, longitude: 0.01 });
      expect(byId.get(ids[5])).toMatchObject({ latitude: 90, longitude: 180 });
    } finally {
      await client.end();
    }

    // Rolled back: the rows are unchanged outside the transaction.
    expect(await stored(ids[0])).toEqual({ latitude: 49.9929, longitude: 8.2473 });
  });
});
