import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { blockGroupAction } from "@/app/actions/moderation";
import { getDiscoveryGroups } from "@/app/actions/discoverGroups";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

// Mocking cookies to simulate sessions
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

describe("Moderation & Security Flow (Integration)", () => {
  let userAId: string, groupAId: string;
  let userBId: string, groupBId: string;
  let sharedChatId: string;

  beforeAll(async () => {
    // 1. Create 2 users and nearby groups
    const userA = await prisma.user.create({
      data: { email: "a@mod.com", password: "123", name: "User A", birthDate: new Date("2000-01-01"), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 50.0, longitude: 8.0, publicProfile: true }
      }}
    });
    userAId = userA.id;
    groupAId = (await prisma.group.findUnique({ where: { userId: userAId } }))!.id;

    const userB = await prisma.user.create({
      data: { email: "b@mod.com", password: "123", name: "User B", birthDate: new Date("2000-01-01"), group: {
        create: { membersCount: 1, gender: "MIXED", latitude: 50.001, longitude: 8.001, publicProfile: true }
      }}
    });
    userBId = userB.id;

    // 2. Create a chat between them to enable blocking
    const chat = await prisma.chat.create({
      data: { hostAId: userAId, hostBId: userBId }
    });
    sharedChatId = chat.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: ["a@mod.com", "b@mod.com"] } } });
  });

  it("should mutually isolate users after a block is executed", async () => {
    // Step 1: Simulate User A session
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: userAId }) } as any);

    // Verify that BEFORE blocking, User B appears in User A's discovery feed
    const preBlockFeed = await getDiscoveryGroups({ page: 0, distance: 10 });
    const isUserBPresentBefore = preBlockFeed.groups?.some(g => g.userId === userBId);
    expect(isUserBPresentBefore).toBe(true);

    // Step 2: Execute the Block Action
    const blockResult = await blockGroupAction(sharedChatId);
    expect(blockResult.success).toBe(true);

    // Step 3: Verify that AFTER blocking, User B no longer appears
    const postBlockFeedA = await getDiscoveryGroups({ page: 0, distance: 10 });
    const isUserBPresentAfter = postBlockFeedA.groups?.some(g => g.userId === userBId);
    expect(isUserBPresentAfter).toBe(false);

    // Step 4: Bidirectional isolation (User B should not see User A either)
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: userBId }) } as any);
    const postBlockFeedB = await getDiscoveryGroups({ page: 0, distance: 10 });
    const isUserAPresentAfter = postBlockFeedB.groups?.some(g => g.userId === userAId);
    expect(isUserAPresentAfter).toBe(false);
  });
});