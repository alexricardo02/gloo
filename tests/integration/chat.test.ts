import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { sendMessage } from "@/app/actions/chat";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { sessionCookiesFor } from "./helpers/session";
import { fetchMessages } from "./helpers/api";
import { canonicalPair } from "@/lib/chats";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

describe("Chat Security & Data Boundaries (Integration)", () => {
  let userAId: string;
  let userBId: string;
  let hackerUserId: string; // User attempting unauthorized access
  let sharedChatId: string;

  const emailA = `chatA_${Date.now()}@test.com`;
  const emailB = `chatB_${Date.now()}@test.com`;
  const emailHacker = `hacker_${Date.now()}@test.com`;

  beforeAll(async () => {
    // 1. Create legit participants
    const userA = await prisma.user.create({ data: { email: emailA, password: "123", name: "User A", birthDate: new Date() } });
    userAId = userA.id;

    const userB = await prisma.user.create({ data: { email: emailB, password: "123", name: "User B", birthDate: new Date() } });
    userBId = userB.id;

    // 2. Create the malicious third-party user
    const hacker = await prisma.user.create({ data: { email: emailHacker, password: "123", name: "Hacker", birthDate: new Date() } });
    hackerUserId = hacker.id;

    // 3. Establish a private (pre-existing, unmatched) chat between A and B.
    // EXISTING_UNMATCHED_CHATS = keep-as-legacy: it must keep working.
    const [hostAId, hostBId] = canonicalPair(userAId, userBId);
    const chat = await prisma.chat.create({
      data: { hostAId, hostBId, origin: "LEGACY" }
    });
    sharedChatId = chat.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [emailA, emailB, emailHacker] } } });
  });

  it("should securely allow legitimate participants to send and retrieve messages", async () => {
    // Simulate User A session
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(userAId)) as never);

    // Standard Requirement: Sending a message must succeed
    const sendResult = await sendMessage(sharedChatId, "Hello securely!");
    expect(sendResult.ok).toBe(true);

    // Standard Requirement: Retrieving messages must return the data
    const messagesResult = await fetchMessages(sharedChatId);
    expect(messagesResult.status).toBe(200);
    expect(messagesResult.body.messages.length).toBeGreaterThan(0);
    expect(messagesResult.body.messages[0]).toMatchObject({ type: "USER", text: "Hello securely!", isOwn: true });
  });

  it("SECURITY BOUNDARY: should strictly block non-participants from reading messages", async () => {
    // Simulate Hacker session
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(hackerUserId)) as never);

    // Standard Requirement: Access must be explicitly denied (Horizontal Privilege Escalation prevention)
    const messagesResult = await fetchMessages(sharedChatId);
    expect(messagesResult.status).toBe(404);
    expect(messagesResult.body).toEqual({ error: "NOT_FOUND" });
  });

  it("SECURITY BOUNDARY: should strictly block non-participants from sending messages", async () => {
    // Simulate Hacker session
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(hackerUserId)) as never);

    // Standard Requirement: Writing to another user's chat must fail and not hit the database
    const sendResult = await sendMessage(sharedChatId, "Malicious injection!");
    expect(sendResult).toEqual({ ok: false, code: "NOT_FOUND", messageKey: "blockedChatError" });

    // Verify database integrity: the message must not exist
    const unauthorizedMessages = await prisma.message.findMany({
      where: { chatId: sharedChatId, senderId: hackerUserId }
    });
    expect(unauthorizedMessages.length).toBe(0);
  });
});