import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { prisma } from "@/lib/prisma";
import { canonicalPair } from "@/lib/chats";

/**
 * Runs migration 20261111130000_chat_origin_and_system_messages against the
 * local test DB (guarded: localhost "*_test" only) on data shaped like
 * production before Pack 4: reversed duplicate chats, non-canonical pairs and
 * the old hard-coded English match message.
 *
 * The test DB already has the new columns (db push), so the run exercises the
 * data steps and the "create only if missing" guards. The canonical-pair CHECK
 * is dropped first so pre-migration rows can be inserted; the migration adds
 * it back.
 */
const MIGRATION = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20261111130000_chat_origin_and_system_messages",
  "migration.sql",
);
const OLD_NOTICE = "Your groups matched! Start chatting now.";

/** Runs the whole file as one simple-protocol query (it contains DO blocks). */
async function runMigration() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
  } finally {
    await client.end();
  }
}

const at = (iso: string) => new Date(iso);

describe("chat_origin_and_system_messages migration (integration, local test DB)", () => {
  const stamp = Date.now();
  const users: string[] = [];
  const ids = {} as Record<"oldDup" | "newDup" | "oneWay" | "untouched", string>;
  let pair12: [string, string];
  let pair34: [string, string];

  async function host(n: number) {
    const user = await prisma.user.create({
      data: {
        email: `mig4_${n}_${stamp}@test.com`,
        password: "x",
        name: `M${n}`,
        birthDate: new Date("1990-01-01"),
        group: { create: {} },
      },
      include: { group: true },
    });
    users.push(user.id);
    return { userId: user.id, groupId: user.group!.id };
  }

  async function snapshot() {
    return prisma.chat.findMany({
      where: { OR: [{ hostAId: { in: users } }, { hostBId: { in: users } }] },
      orderBy: { id: "asc" },
      include: { messages: { orderBy: { id: "asc" } } },
    });
  }

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Chat" DROP CONSTRAINT IF EXISTS "Chat_canonical_pair_check"`);

    const [h1, h2, h3, h4, h5, h6] = await Promise.all([1, 2, 3, 4, 5, 6].map(host));
    pair12 = canonicalPair(h1.userId, h2.userId);
    pair34 = canonicalPair(h3.userId, h4.userId);
    const [lo, hi] = pair12;

    // 1 <-> 2 matched (mutual like), with a reversed duplicate chat pair.
    await prisma.groupLike.createMany({
      data: [
        { fromGroupId: h1.groupId, toGroupId: h2.groupId },
        { fromGroupId: h2.groupId, toGroupId: h1.groupId },
      ],
    });
    const oldDup = await prisma.chat.create({
      data: { hostAId: hi, hostBId: lo, origin: "LEGACY", createdAt: at("2020-01-01T00:00:00Z") },
    });
    const newDup = await prisma.chat.create({
      data: { hostAId: lo, hostBId: hi, origin: "LEGACY", createdAt: at("2020-01-02T00:00:00Z") },
    });
    await prisma.message.createMany({
      data: [
        { chatId: oldDup.id, senderId: hi, text: OLD_NOTICE, createdAt: at("2020-01-01T00:00:00Z") },
        { chatId: oldDup.id, senderId: lo, text: "hello from old", createdAt: at("2020-01-01T00:01:00Z") },
        { chatId: newDup.id, senderId: lo, text: OLD_NOTICE, createdAt: at("2020-01-02T00:00:00Z") },
        { chatId: newDup.id, senderId: hi, text: "hello from new", createdAt: at("2020-01-02T00:01:00Z") },
      ],
    });

    // 3 -> 4 one-way like only, non-canonical chat that still has an old notice.
    await prisma.groupLike.create({ data: { fromGroupId: h3.groupId, toGroupId: h4.groupId } });
    const oneWay = await prisma.chat.create({
      data: { hostAId: pair34[1], hostBId: pair34[0], origin: "LEGACY" },
    });
    await prisma.message.create({ data: { chatId: oneWay.id, senderId: pair34[1], text: OLD_NOTICE } });

    // 5 - 6 canonical, no likes, ordinary message: must stay exactly as it is.
    const [lo56, hi56] = canonicalPair(h5.userId, h6.userId);
    const untouched = await prisma.chat.create({ data: { hostAId: lo56, hostBId: hi56, origin: "LEGACY" } });
    await prisma.message.create({ data: { chatId: untouched.id, senderId: lo56, text: "We matched yesterday!" } });

    Object.assign(ids, { oldDup: oldDup.id, newDup: newDup.id, oneWay: oneWay.id, untouched: untouched.id });

    await runMigration();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  it("classifies MATCH / LEGACY by mutual like", async () => {
    const chats = await prisma.chat.findMany({ where: { id: { in: Object.values(ids) } } });
    const origin = Object.fromEntries(chats.map((c) => [c.id, c.origin]));
    expect(origin[ids.oldDup]).toBe("MATCH");
    expect(origin[ids.oneWay]).toBe("LEGACY");
    expect(origin[ids.untouched]).toBe("LEGACY");
  });

  it("merges the reversed duplicate into the oldest chat and leaves one canonical pair", async () => {
    const [lo, hi] = pair12;
    const chats = await prisma.chat.findMany({
      where: { OR: [{ hostAId: lo, hostBId: hi }, { hostAId: hi, hostBId: lo }] },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    expect(chats).toHaveLength(1);
    expect(chats[0]).toMatchObject({ id: ids.oldDup, hostAId: lo, hostBId: hi });
    expect(await prisma.chat.findUnique({ where: { id: ids.newDup } })).toBeNull();

    // All user messages moved; the two old notices became ONE system notice.
    expect(chats[0].messages.map((m) => [m.type, m.systemKey, m.senderId, m.text])).toEqual([
      ["SYSTEM", "MATCH_CREATED", null, OLD_NOTICE],
      ["USER", null, lo, "hello from old"],
      ["USER", null, hi, "hello from new"],
    ]);
  });

  it("reorders other pairs canonically and converts their old notice, leaving other messages alone", async () => {
    const oneWay = await prisma.chat.findUnique({ where: { id: ids.oneWay }, include: { messages: true } });
    expect([oneWay!.hostAId, oneWay!.hostBId]).toEqual(pair34);
    expect(oneWay!.messages).toEqual([
      expect.objectContaining({ type: "SYSTEM", systemKey: "MATCH_CREATED", senderId: null }),
    ]);

    const untouched = await prisma.message.findMany({ where: { chatId: ids.untouched } });
    expect(untouched).toEqual([expect.objectContaining({ type: "USER", text: "We matched yesterday!" })]);
  });

  it("enforces the canonical unique pair and one notice per chat", async () => {
    const [lo, hi] = pair12;
    await expect(prisma.chat.create({ data: { hostAId: hi, hostBId: lo, origin: "LEGACY" } })).rejects.toThrow();
    await expect(prisma.chat.create({ data: { hostAId: lo, hostBId: hi, origin: "MATCH" } })).rejects.toThrow();
    await expect(
      prisma.message.create({
        data: { chatId: ids.oldDup, senderId: null, type: "SYSTEM", systemKey: "MATCH_CREATED", text: "" },
      }),
    ).rejects.toThrow();
    // A SYSTEM message must not have a sender.
    await expect(
      prisma.message.create({ data: { chatId: ids.untouched, senderId: lo, type: "SYSTEM", systemKey: "MATCH_CREATED", text: "" } }),
    ).rejects.toThrow();
  });

  it("leaves Chat.origin without a default (the app must always set it)", async () => {
    const rows = await prisma.$queryRaw<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
       WHERE table_name = 'Chat' AND column_name = 'origin'`;
    expect(rows[0].column_default).toBeNull();
  });

  it("is idempotent", async () => {
    const before = await snapshot();
    await runMigration();
    expect(await snapshot()).toEqual(before);
  });
});
