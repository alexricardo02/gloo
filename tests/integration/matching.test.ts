import { describe, it, expect, afterAll, vi } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { toggleLike, getDiscoveryGroups } from "@/app/actions/discoverGroups";
import { openExistingChat, sendMessage } from "@/app/actions/chat";
import { blockGroupAction, unblockGroupAction } from "@/app/actions/moderation";
import { ChatCreationError, canonicalPair, ensureChat, lockPair } from "@/lib/chats";
import { sessionCookiesFor } from "./helpers/session";
import { fetchChatHeader, fetchChatList, fetchLikes, fetchMessages } from "./helpers/api";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

/**
 * Pack 4 decisions under test: CHAT_CREATION = match-only,
 * UNLIKE_AFTER_MATCH = keep-chat, BLOCKED_CHAT = hidden-for-both,
 * MATCH_NOTICE = system-message, CARD_MESSAGE_BUTTON = only-if-chat-exists.
 */
describe("Matching & chat integrity (integration)", () => {
  const stamp = Date.now();
  const createdUserIds: string[] = [];
  let seq = 0;

  async function makeHost() {
    const n = seq++;
    const user = await prisma.user.create({
      data: {
        email: `match_${n}_${stamp}@test.com`,
        password: "x",
        name: `Host ${n}`,
        birthDate: new Date("1995-01-01"),
        group: {
          create: { membersCount: 2, gender: "MIXED", latitude: 50.0, longitude: 8.0, publicProfile: true },
        },
      },
      include: { group: true },
    });
    createdUserIds.push(user.id);
    return { userId: user.id, groupId: user.group!.id };
  }

  async function signInAs(userId: string) {
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(userId)) as never);
  }

  function chatsBetween(userA: string, userB: string) {
    return prisma.chat.findMany({
      where: {
        OR: [
          { hostAId: userA, hostBId: userB },
          { hostAId: userB, hostBId: userA },
        ],
      },
      include: { messages: true },
    });
  }

  async function match(a: { userId: string; groupId: string }, b: { userId: string; groupId: string }) {
    await signInAs(a.userId);
    expect((await toggleLike(b.groupId, true)).ok).toBe(true);
    await signInAs(b.userId);
    const result = await toggleLike(a.groupId, true);
    if (!result.ok || !result.data.chatId) throw new Error("expected a match");
    return result.data.chatId;
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  });

  describe("toggleLike (B5)", () => {
    it("rejects liking your own group, without creating a like or a chat", async () => {
      const a = await makeHost();
      await signInAs(a.userId);

      expect(await toggleLike(a.groupId, true)).toEqual({ ok: false, code: "FORBIDDEN" });
      expect(await prisma.groupLike.count({ where: { fromGroupId: a.groupId } })).toBe(0);
      expect(await chatsBetween(a.userId, a.userId)).toHaveLength(0);
    });

    it("rejects liking a group when either side blocked the other", async () => {
      const a = await makeHost();
      const b = await makeHost();
      await prisma.groupBlock.create({ data: { blockerId: b.userId, blockedGroupId: a.groupId } });

      await signInAs(a.userId); // A was blocked by B
      expect(await toggleLike(b.groupId, true)).toEqual({ ok: false, code: "NOT_FOUND" });
      await signInAs(b.userId); // B blocked A
      expect(await toggleLike(a.groupId, true)).toEqual({ ok: false, code: "NOT_FOUND" });

      expect(
        await prisma.groupLike.count({ where: { fromGroupId: { in: [a.groupId, b.groupId] } } }),
      ).toBe(0);
    });

    it("a double like (two concurrent requests) gives exactly one like and no error", async () => {
      const a = await makeHost();
      const b = await makeHost();
      await signInAs(a.userId);

      const results = await Promise.all([toggleLike(b.groupId, true), toggleLike(b.groupId, true)]);

      expect(results.map((r) => r.ok)).toEqual([true, true]);
      expect(await prisma.groupLike.count({ where: { fromGroupId: a.groupId, toGroupId: b.groupId } })).toBe(1);
    });

    it("concurrent A->B and B->A likes create exactly one MATCH chat and one match notice", async () => {
      // Several independent pairs at once to give the race a real chance.
      const pairs = await Promise.all(
        Array.from({ length: 5 }, async () => [await makeHost(), await makeHost()] as const),
      );

      await Promise.all(
        pairs.map(async ([a, b]) => {
          const cookiesA = await sessionCookiesFor(a.userId);
          const cookiesB = await sessionCookiesFor(b.userId);
          // Each toggleLike reads cookies() synchronously before its first await,
          // so the two calls below get A's and B's session respectively.
          vi.mocked(cookies)
            .mockResolvedValueOnce(cookiesA as never)
            .mockResolvedValueOnce(cookiesB as never);
          const results = await Promise.all([toggleLike(b.groupId, true), toggleLike(a.groupId, true)]);

          for (const r of results) expect(r.ok).toBe(true);
          const matched = results.filter((r) => r.ok && r.data.matched);
          expect(matched).toHaveLength(1);

          const chats = await chatsBetween(a.userId, b.userId);
          expect(chats).toHaveLength(1);
          const [chat] = chats;
          expect(chat.origin).toBe("MATCH");
          expect([chat.hostAId, chat.hostBId]).toEqual(canonicalPair(a.userId, b.userId));
          expect(matched[0].ok && matched[0].data.chatId).toBe(chat.id);

          expect(chat.messages).toHaveLength(1);
          expect(chat.messages[0]).toMatchObject({
            type: "SYSTEM",
            systemKey: "MATCH_CREATED",
            senderId: null,
          });
        }),
      );
    });

    it("a like waits for a concurrent like on the same pair, so the match is never missed", async () => {
      // Deterministic version of the race: the transaction below plays B's
      // like. It holds the pair lock and has inserted B->A but not committed
      // while A likes B. Without the lock, A would not see B's like and the
      // match would be lost (both likes saved, no chat).
      const a = await makeHost();
      const b = await makeHost();
      let lockHeld!: () => void;
      const lockAcquired = new Promise<void>((resolve) => (lockHeld = resolve));
      let commit!: () => void;
      const mayCommit = new Promise<void>((resolve) => (commit = resolve));

      const otherSide = prisma.$transaction(
        async (tx) => {
          await lockPair(tx, b.userId, a.userId);
          await tx.groupLike.create({ data: { fromGroupId: b.groupId, toGroupId: a.groupId } });
          lockHeld();
          await mayCommit;
        },
        { timeout: 15_000 },
      );
      await lockAcquired;

      await signInAs(a.userId);
      let settled = false;
      const like = toggleLike(b.groupId, true).then((r) => {
        settled = true;
        return r;
      });

      await new Promise((resolve) => setTimeout(resolve, 500));
      expect(settled).toBe(false); // blocked on the pair lock
      commit();
      await otherSide;

      const result = await like;
      const [chat] = await chatsBetween(a.userId, b.userId);
      expect(chat?.origin).toBe("MATCH");
      expect(result).toEqual({ ok: true, data: { liked: true, matched: true, chatId: chat.id } });
    });

    it("unlike after a match keeps the chat usable (UNLIKE_AFTER_MATCH = keep-chat); re-like adds no second notice", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const chatId = await match(a, b);

      await signInAs(a.userId);
      expect(await toggleLike(b.groupId, false)).toEqual({
        ok: true,
        data: { liked: false, matched: false, chatId },
      });
      expect(await prisma.groupLike.count({ where: { fromGroupId: a.groupId, toGroupId: b.groupId } })).toBe(0);

      const [chat] = await chatsBetween(a.userId, b.userId);
      expect(chat).toMatchObject({ id: chatId, origin: "MATCH" });
      expect((await sendMessage(chatId, "still here")).ok).toBe(true);

      expect(await toggleLike(b.groupId, true)).toEqual({ ok: true, data: { liked: true, matched: true, chatId } });
      const notices = await prisma.message.count({ where: { chatId, systemKey: "MATCH_CREATED" } });
      expect(notices).toBe(1);
      expect(await chatsBetween(a.userId, b.userId)).toHaveLength(1);
    });
  });

  describe("no chat without a match (S5)", () => {
    it("openExistingChat never creates a chat, and a one-way like creates none", async () => {
      const a = await makeHost();
      const c = await makeHost();
      await signInAs(a.userId);

      expect(await openExistingChat(c.userId)).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "blockedChatError" });
      expect(await openExistingChat(a.userId)).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "blockedChatError" });

      expect(await toggleLike(c.groupId, true)).toEqual({
        ok: true,
        data: { liked: true, matched: false, chatId: null },
      });
      expect(await chatsBetween(a.userId, c.userId)).toHaveLength(0);
    });

    it("ensureChat refuses self-chats, unknown groups and blocked pairs", async () => {
      const a = await makeHost();
      const b = await makeHost();
      await prisma.groupBlock.create({ data: { blockerId: a.userId, blockedGroupId: b.groupId } });

      await expect(ensureChat(a.groupId, a.groupId, "MATCH")).rejects.toMatchObject({ reason: "SELF_CHAT" });
      await expect(ensureChat(a.groupId, "no-such-group", "MATCH")).rejects.toMatchObject({
        reason: "GROUP_NOT_FOUND",
      });
      await expect(ensureChat(b.groupId, a.groupId, "MATCH")).rejects.toBeInstanceOf(ChatCreationError);
      await expect(ensureChat(b.groupId, a.groupId, "MATCH")).rejects.toMatchObject({ reason: "BLOCKED" });
      expect(await chatsBetween(a.userId, b.userId)).toHaveLength(0);
    });

    it("ensureChat is idempotent, canonical and only upgrades the origin", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const [hostAId, hostBId] = canonicalPair(a.userId, b.userId);
      const legacy = await prisma.chat.create({ data: { hostAId, hostBId, origin: "LEGACY" } });

      expect(await ensureChat(b.groupId, a.groupId, "EVENT_ACCESS")).toBe(legacy.id);
      expect((await prisma.chat.findUnique({ where: { id: legacy.id } }))!.origin).toBe("EVENT_ACCESS");
      expect(await ensureChat(a.groupId, b.groupId, "MATCH")).toBe(legacy.id);
      expect(await ensureChat(a.groupId, b.groupId, "EVENT_ACCESS")).toBe(legacy.id);
      expect((await prisma.chat.findUnique({ where: { id: legacy.id } }))!.origin).toBe("MATCH");
      expect(await chatsBetween(a.userId, b.userId)).toHaveLength(1);
    });
  });

  describe("discovery / likes payload (CARD_MESSAGE_BUTTON = only-if-chat-exists)", () => {
    it("includes a chatId only once a chat exists", async () => {
      const a = await makeHost();
      const b = await makeHost();

      await signInAs(a.userId);
      const before = await getDiscoveryGroups({ distance: 10 });
      expect(before.groups?.find((g) => g.id === b.groupId)?.chatId).toBeNull();

      const chatId = await match(a, b);

      await signInAs(a.userId);
      const after = await getDiscoveryGroups({ distance: 10 });
      expect(after.groups?.find((g) => g.id === b.groupId)?.chatId).toBe(chatId);

      const likedMe = await fetchLikes();
      expect(likedMe.status).toBe(200);
      expect(likedMe.body.groups.find((g) => g.id === b.groupId)?.chatId).toBe(chatId);
    });
  });

  describe("match notice (B14) and chat reads", () => {
    it("is returned with a null sender and a system key, in the chat and as the list preview", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const chatId = await match(a, b);

      await signInAs(a.userId);
      const header = await fetchChatHeader(chatId);
      expect(header.status).toBe(200);
      expect(header.body.isMatch).toBe(true);

      const result = await fetchMessages(chatId);
      expect(result.status).toBe(200);
      expect(result.body.messages).toHaveLength(1);
      expect(result.body.messages[0]).toMatchObject({
        type: "SYSTEM",
        systemKey: "MATCH_CREATED",
        text: null,
        isOwn: false,
      });
      expect(result.body.messages[0]).not.toHaveProperty("senderId");

      const list = await fetchChatList();
      expect(list.status).toBe(200);
      expect(list.body.items.find((c) => c.id === chatId)).toMatchObject({
        isMatch: true,
        lastMessage: null,
        lastMessageSystemKey: "MATCH_CREATED",
      });
    });
  });

  describe("blocked chats (BLOCKED_CHAT = hidden-for-both)", () => {
    it("disappear from both lists, cannot be opened or written to, keep their messages, and come back on unblock", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const chatId = await match(a, b);
      await signInAs(a.userId);
      expect((await sendMessage(chatId, "hi before the block")).ok).toBe(true);

      await signInAs(b.userId);
      expect((await blockGroupAction(chatId)).success).toBe(true);

      for (const [me, other] of [
        [a, b],
        [b, a],
      ] as const) {
        await signInAs(me.userId);
        const list = await fetchChatList();
        expect(list.body.items.map((c) => c.id)).not.toContain(chatId);

        const unavailable = { ok: false, code: "NOT_FOUND", messageKey: "blockedChatError" };
        expect((await fetchMessages(chatId)).status).toBe(404);
        expect((await fetchChatHeader(chatId)).status).toBe(404);
        expect(await sendMessage(chatId, "after the block")).toEqual(unavailable);
        expect(await openExistingChat(other.userId)).toEqual(unavailable);
        expect(await toggleLike(other.groupId, true)).toEqual({ ok: false, code: "NOT_FOUND" });
      }

      // Messages stay in the database.
      expect(await prisma.message.count({ where: { chatId } })).toBe(2);

      await signInAs(b.userId);
      expect((await unblockGroupAction(a.groupId)).success).toBe(true);
      await signInAs(a.userId);
      const list = await fetchChatList();
      expect(list.body.items.map((c) => c.id)).toContain(chatId);
    });
  });
});
