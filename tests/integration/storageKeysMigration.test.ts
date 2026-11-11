import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { keyFromBucketPublicUrl } from "@/lib/storageKeys";

/**
 * Runs the storage_object_keys data migration against the local test DB
 * (guarded: localhost "*_test" only) and checks that it converts public URLs
 * of our bucket to object keys and leaves every other value untouched.
 */
const MIGRATION = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261111120000_storage_object_keys",
  "migration.sql",
);

const BASE = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public";
const OUR_GROUP_URL = `${BASE}/gloo-images/groups/userA-group-0b9d3c1e-5f0a-4c7b-9a51-6f3a8e2d1c4b.jpg`;
const OUR_PROFILE_URL = `${BASE}/gloo-images/profiles/userA-1700000000000.png`;
const UNTOUCHED = [
  "https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?q=80&w=1000&auto=format&fit=crop",
  "/images/bg-fallback.jpg",
  `${BASE}/other-bucket/groups/userA-group-x.jpg`, // another bucket
  `${BASE}/gloo-images/groups/userA-group-x.jpg?download=1`, // query string
  "https://evil.example/storage/v1/object/public/gloo-images/groups/a.jpg", // not supabase.co
  `${BASE}/gloo-images/groups/../users/x.jpg`, // path traversal
  "groups/grp_1/0b9d3c1e-5f0a-4c7b-9a51-6f3a8e2d1c4b.webp", // already a key
];

/** Splits the migration into statements (it has no semicolons inside strings). */
function statements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function runMigration() {
  for (const statement of statements(fs.readFileSync(MIGRATION, "utf8"))) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe("storage_object_keys data migration (integration, local test DB)", () => {
  const stamp = Date.now();
  let userA: string;
  let userB: string;
  let groupA: string;

  beforeAll(async () => {
    const a = await prisma.user.create({
      data: {
        email: `mig_a_${stamp}@test.com`,
        password: "x",
        name: "A",
        birthDate: new Date("1990-01-01"),
        image: OUR_PROFILE_URL,
        group: { create: { photos: [OUR_GROUP_URL, ...UNTOUCHED, OUR_GROUP_URL] } },
      },
      include: { group: true },
    });
    userA = a.id;
    groupA = a.group!.id;

    const b = await prisma.user.create({
      data: {
        email: `mig_b_${stamp}@test.com`,
        password: "x",
        name: "B",
        birthDate: new Date("1990-01-01"),
        image: "https://images.unsplash.com/photo-avatar?q=80",
      },
    });
    userB = b.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  });

  it("converts only our bucket's URLs to keys, keeps order, and leaves other values untouched", async () => {
    await runMigration();

    const group = await prisma.group.findUnique({ where: { id: groupA } });
    const expectedKey = "groups/userA-group-0b9d3c1e-5f0a-4c7b-9a51-6f3a8e2d1c4b.jpg";
    expect(group!.photos).toEqual([expectedKey, ...UNTOUCHED, expectedKey]);

    const a = await prisma.user.findUnique({ where: { id: userA } });
    expect(a!.image).toBe("profiles/userA-1700000000000.png");

    const b = await prisma.user.findUnique({ where: { id: userB } });
    expect(b!.image).toBe("https://images.unsplash.com/photo-avatar?q=80");
  });

  it("is idempotent", async () => {
    const before = await prisma.group.findUnique({ where: { id: groupA } });
    await runMigration();
    const after = await prisma.group.findUnique({ where: { id: groupA } });
    expect(after!.photos).toEqual(before!.photos);
  });

  it("agrees with the app's strict URL parser", () => {
    expect(keyFromBucketPublicUrl(OUR_GROUP_URL)).toBe(
      "groups/userA-group-0b9d3c1e-5f0a-4c7b-9a51-6f3a8e2d1c4b.jpg",
    );
    for (const value of UNTOUCHED) expect(keyFromBucketPublicUrl(value), value).toBeNull();
  });
});
