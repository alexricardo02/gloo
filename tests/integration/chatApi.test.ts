import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { canonicalPair } from "@/lib/chats";
import { markChatRead, sendMessage } from "@/app/actions/chat";
import { MESSAGE_PAGE_SIZE } from "@/lib/liveUpdates";
import type { ChatMessageDTO } from "@/lib/apiTypes";
import { fakeCookieStore, sessionCookiesFor } from "./helpers/session";
import {
  fetchChatHeader,
  fetchChatList,
  fetchLikes,
  fetchMap,
  fetchMessages,
  fetchUnread,
} from "./helpers/api";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

/**
 * Pack 5: authenticated GET route handlers (LIVE_UPDATES = smart-polling),
 * keyset pagination, unread tracking (READ_TRACKING = columns-on-chat,
 * BADGE_COUNTS = chats-with-unread, READ_RECEIPTS = no).
 */
describe("Chat route handlers, pagination and unread counts (integration)", () => {
  const stamp = Date.now();
  const users: string[] = [];
  let seq = 0;

  async function makeHost() {
    const n = seq++;
    const user = await prisma.user.create({
      data: {
        email: `api5_${n}_${stamp}@test.com`,
        password: "x",
        name: `Api Host ${n}`,
        birthDate: new Date("1995-01-01"),
        group: { create: { membersCount: 2 } },
      },
      include: { group: true },
    });
    users.push(user.id);
    return { userId: user.id, groupId: user.group!.id };
  }

  async function makeChat(a: { userId: string }, b: { userId: string }, origin: "MATCH" | "LEGACY" = "MATCH") {
    const [hostAId, hostBId] = canonicalPair(a.userId, b.userId);
    return (await prisma.chat.create({ data: { hostAId, hostBId, origin } })).id;
  }

  const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));

  async function addMessage(chatId: string, senderId: string | null, text: string, createdAt?: Date) {
    return prisma.message.create({
      data: senderId
        ? { chatId, senderId, text, type: "USER", createdAt }
        : { chatId, senderId: null, text: "", type: "SYSTEM", systemKey: "MATCH_CREATED", createdAt },
    });
  }

  async function signInAs(userId: string) {
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(userId)) as never);
  }

  function signOut() {
    vi.mocked(cookies).mockResolvedValue(fakeCookieStore() as never);
  }

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });

  describe("access control", () => {
    let a: Awaited<ReturnType<typeof makeHost>>;
    let b: Awaited<ReturnType<typeof makeHost>>;
    let outsider: Awaited<ReturnType<typeof makeHost>>;
    let chatId: string;

    beforeAll(async () => {
      [a, b, outsider] = [await makeHost(), await makeHost(), await makeHost()];
      chatId = await makeChat(a, b);
      await addMessage(chatId, a.userId, "private");
    });

    it("rejects unauthenticated requests with 401 (and never caches)", async () => {
      signOut();
      for (const result of [
        await fetchChatList(),
        await fetchChatHeader(chatId),
        await fetchMessages(chatId),
        await fetchUnread(),
        await fetchLikes(),
      ]) {
        expect(result.status).toBe(401);
        expect(result.body).toEqual({ error: "UNAUTHORIZED" });
        expect(result.cacheControl).toContain("no-store");
      }
    });

    it("answers 404 to non-participants, like a missing chat (Pack 4: no existence oracle)", async () => {
      await signInAs(outsider.userId);
      expect((await fetchChatHeader(chatId)).status).toBe(404);
      expect((await fetchMessages(chatId)).status).toBe(404);
      expect((await fetchMessages("no-such-chat")).status).toBe(404);
      expect((await fetchChatList()).body.items.map((c) => c.id)).not.toContain(chatId);
      expect(await markChatRead(chatId, (await prisma.message.findFirstOrThrow({ where: { chatId } })).id)).toEqual({
        ok: false,
        code: "NOT_FOUND",
        messageKey: "blockedChatError",
      });
    });

    it("blocked chats are hidden for both sides (404, not listed, not in the badge)", async () => {
      const c = await makeHost();
      const d = await makeHost();
      const blockedChat = await makeChat(c, d);
      await addMessage(blockedChat, d.userId, "unread before block");
      await prisma.groupBlock.create({ data: { blockerId: c.userId, blockedGroupId: d.groupId } });

      for (const me of [c, d]) {
        await signInAs(me.userId);
        expect((await fetchChatHeader(blockedChat)).status).toBe(404);
        expect((await fetchMessages(blockedChat)).status).toBe(404);
        expect((await fetchChatList()).body.items.map((x) => x.id)).not.toContain(blockedChat);
        expect((await fetchUnread()).body.chatsWithUnread).toBe(0);
      }
    });

    it("rejects bad cursors with 400", async () => {
      await signInAs(a.userId);
      expect((await fetchMessages(chatId, "?after=does-not-exist")).status).toBe(400);
      expect((await fetchMessages(chatId, "?after=x&before=y")).status).toBe(400);
      expect((await fetchMessages(chatId, `?after=${"x".repeat(65)}`)).status).toBe(400);
      expect((await fetchChatList("?cursor=garbage")).status).toBe(400);
      expect((await fetchChatList("?limit=0")).status).toBe(400);

      // A message id from another chat is not a valid cursor here.
      const other = await makeChat(a, await makeHost());
      const foreign = await addMessage(other, a.userId, "elsewhere");
      expect((await fetchMessages(chatId, `?after=${foreign.id}`)).status).toBe(400);
    });

    it("returns only what the UI needs: no other users' ids", async () => {
      await signInAs(a.userId);
      const responses = [await fetchChatList(), await fetchChatHeader(chatId), await fetchMessages(chatId)];
      for (const { status, raw } of responses) {
        expect(status).toBe(200);
        expect(raw).not.toContain(b.userId);
        expect(raw).not.toContain(a.userId);
      }
      expect((await fetchMessages(chatId)).body.messages[0]).toEqual({
        id: expect.any(String),
        type: "USER",
        text: "private",
        systemKey: null,
        createdAt: expect.any(String),
        isOwn: true,
      });
    });

    it("the map endpoint serves guests (venues only) and signed-in users", async () => {
      signOut();
      const guest = await fetchMap();
      expect(guest.status).toBe(200);
      expect(guest.body).toMatchObject({ signedIn: false, events: [], myEvent: null });

      await signInAs(a.userId);
      expect((await fetchMap()).body.signedIn).toBe(true);
    });
  });

  describe("message pagination (keyset on createdAt, id)", () => {
    let a: Awaited<ReturnType<typeof makeHost>>;
    let chatId: string;
    const all: string[] = [];

    beforeAll(async () => {
      a = await makeHost();
      const b = await makeHost();
      chatId = await makeChat(a, b);
      // 130 messages, many sharing the same createdAt (10 per second), so
      // page boundaries fall inside groups of equal timestamps.
      const rows = Array.from({ length: 130 }, (_, i) => ({
        chatId,
        senderId: i % 2 ? a.userId : b.userId,
        text: `m${i}`,
        type: "USER" as const,
        createdAt: at(Math.floor(i / 10)),
      }));
      await prisma.message.createMany({ data: rows });
      const stored = await prisma.message.findMany({
        where: { chatId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      all.push(...stored.map((m) => m.id));
    });

    it("without a cursor returns the newest page, oldest first", async () => {
      await signInAs(a.userId);
      const page = await fetchMessages(chatId);
      expect(page.body.messages.map((m) => m.id)).toEqual(all.slice(-MESSAGE_PAGE_SIZE));
      expect(page.body.hasMore).toBe(true);
    });

    it("?before pages are stable: no gaps, no duplicates, even with equal timestamps", async () => {
      await signInAs(a.userId);
      let page = await fetchMessages(chatId);
      const seen: string[] = page.body.messages.map((m) => m.id);
      while (page.body.hasMore) {
        page = await fetchMessages(chatId, `?before=${seen[0]}`);
        expect(page.status).toBe(200);
        expect(page.body.messages.length).toBeLessThanOrEqual(MESSAGE_PAGE_SIZE);
        seen.unshift(...page.body.messages.map((m) => m.id));
      }
      expect(seen).toEqual(all);
      expect(new Set(seen).size).toBe(all.length);
    });

    it("?after returns only newer messages (incl. equal timestamps, higher id), in batches", async () => {
      await signInAs(a.userId);
      const pivot = 64; // inside a group of equal timestamps
      const first = await fetchMessages(chatId, `?after=${all[pivot]}`);
      expect(first.body.messages.map((m) => m.id)).toEqual(all.slice(pivot + 1, pivot + 1 + MESSAGE_PAGE_SIZE));
      expect(first.body.hasMore).toBe(true);

      const last = first.body.messages[first.body.messages.length - 1].id;
      const second = await fetchMessages(chatId, `?after=${last}`);
      expect(second.body.messages.map((m) => m.id)).toEqual(all.slice(pivot + 1 + MESSAGE_PAGE_SIZE));
      expect(second.body.hasMore).toBe(false);

      const none = await fetchMessages(chatId, `?after=${all[all.length - 1]}`);
      expect(none.body).toEqual({ messages: [], hasMore: false });
    });
  });

  describe("chat list pagination", () => {
    it("pages with a cursor: matches first, then newest activity, no duplicates", async () => {
      const me = await makeHost();
      const partners = await Promise.all(Array.from({ length: 5 }, () => makeHost()));
      const legacyOld = await makeChat(me, partners[0], "LEGACY");
      const legacyNew = await makeChat(me, partners[1], "LEGACY");
      const matchOld = await makeChat(me, partners[2], "MATCH");
      const matchNew = await makeChat(me, partners[3], "MATCH");
      const legacyTie = await makeChat(me, partners[4], "LEGACY");
      await addMessage(legacyOld, partners[0].userId, "old", at(1));
      await addMessage(legacyNew, partners[1].userId, "new", at(30));
      await addMessage(legacyTie, partners[4].userId, "tie", at(30)); // same activity as legacyNew
      await addMessage(matchOld, partners[2].userId, "m-old", at(2));
      await addMessage(matchNew, me.userId, "m-new", at(20));

      await signInAs(me.userId);
      const ids: string[] = [];
      let cursor: string | null = null;
      do {
        const page: Awaited<ReturnType<typeof fetchChatList>> = await fetchChatList(
          `?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        );
        expect(page.status).toBe(200);
        expect(page.body.items.length).toBeLessThanOrEqual(2);
        ids.push(...page.body.items.map((c) => c.id));
        cursor = page.body.nextCursor;
      } while (cursor);

      const ties = [legacyNew, legacyTie].sort().reverse(); // equal activity: id DESC
      expect(ids).toEqual([matchNew, matchOld, ...ties, legacyOld]);

      const full = await fetchChatList();
      expect(full.body.items.find((c) => c.id === matchNew)).toEqual({
        id: matchNew,
        name: "Api Host " + (seq - 2),
        image: "/images/bg-fallback.jpg",
        isMatch: true,
        lastMessage: "m-new",
        lastMessageSystemKey: null,
        time: at(20).toISOString(),
        unread: 0,
      });
    });
  });

  describe("unread counts (B7)", () => {
    it("my own messages never count; other side's messages and system notices do", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const chatId = await makeChat(a, b);
      await addMessage(chatId, null, "", new Date(Date.now() - 1000)); // match notice

      await signInAs(a.userId);
      expect((await sendMessage(chatId, "mine 1")).ok).toBe(true);
      expect((await sendMessage(chatId, "mine 2")).ok).toBe(true);
      // Only the system notice is unread for A.
      expect((await fetchChatList()).body.items.find((c) => c.id === chatId)?.unread).toBe(1);

      await signInAs(b.userId);
      // For B: the notice + A's two messages.
      expect((await fetchChatList()).body.items.find((c) => c.id === chatId)?.unread).toBe(3);
      expect((await fetchUnread()).body.chatsWithUnread).toBe(1);
    });

    it("opening a chat (mark read) clears it; other chats are unaffected; the badge counts chats", async () => {
      const me = await makeHost();
      const x = await makeHost();
      const y = await makeHost();
      const chatX = await makeChat(me, x);
      const chatY = await makeChat(me, y);

      await signInAs(x.userId);
      await sendMessage(chatX, "x1");
      await sendMessage(chatX, "x2");
      await signInAs(y.userId);
      await sendMessage(chatY, "y1");

      await signInAs(me.userId);
      expect((await fetchUnread()).body.chatsWithUnread).toBe(2); // chats, not messages (3)
      let list = (await fetchChatList()).body.items;
      expect(list.find((c) => c.id === chatX)?.unread).toBe(2);
      expect(list.find((c) => c.id === chatY)?.unread).toBe(1);

      // Open chat X: the page marks read up to the newest incoming message.
      const page = await fetchMessages(chatX);
      const newestIncoming = [...page.body.messages].reverse().find((m: ChatMessageDTO) => !m.isOwn)!;
      expect(await markChatRead(chatX, newestIncoming.id)).toEqual({ ok: true, data: undefined });

      list = (await fetchChatList()).body.items;
      expect(list.find((c) => c.id === chatX)?.unread).toBe(0);
      expect(list.find((c) => c.id === chatY)?.unread).toBe(1); // another chat's state is untouched
      expect((await fetchUnread()).body.chatsWithUnread).toBe(1);

      // Marking an older message later never moves the marker back.
      const oldest = page.body.messages[0];
      await markChatRead(chatX, oldest.id);
      expect((await fetchChatList()).body.items.find((c) => c.id === chatX)?.unread).toBe(0);

      // A new message from X makes chat X unread again.
      await signInAs(x.userId);
      await addMessage(chatX, x.userId, "x3", new Date(Date.now() + 1000));
      await signInAs(me.userId);
      expect((await fetchUnread()).body.chatsWithUnread).toBe(2);
    });

    it("never exposes the other participant's read state (READ_RECEIPTS = no)", async () => {
      const a = await makeHost();
      const b = await makeHost();
      const chatId = await makeChat(a, b);
      const m = await addMessage(chatId, a.userId, "hi");
      await signInAs(b.userId);
      await markChatRead(chatId, m.id);

      await signInAs(a.userId);
      for (const { raw } of [await fetchChatList(), await fetchChatHeader(chatId), await fetchMessages(chatId)]) {
        expect(raw).not.toMatch(/LastReadAt|lastRead|seen/i);
      }
    });
  });
});
