import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { getDiscoveryGroups, toggleLike } from "@/app/actions/discoverGroups";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

describe("Discovery Algorithm & Feed Integrity (Integration)", () => {
  let mainUserId: string, mainGroupId: string;
  let farUserId: string;
  let alreadyLikedUserId: string, alreadyLikedGroupId: string;
  let freshUserId: string;

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

    // Simulate Main User liking the "Already Liked" group to set up the state
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: mainUserId }) } as any);
    await toggleLike(alreadyLikedGroupId);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: [emailMain, emailFar, emailLiked, emailFresh] } } });
  });

  it("should accurately filter the discovery feed according to proximity and interaction history", async () => {
    // Simulate Main User session
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: mainUserId }) } as any);

    const distanceLimit = 20; // km
    const feedResult = await getDiscoveryGroups({ distance: distanceLimit });
    const feedIds = feedResult.groups?.map(g => g.userId) || [];

    // Standard Requirement 1: A user MUST NOT see their own group
    expect(feedIds).not.toContain(mainUserId);

    // Standard Requirement 2: Geofencing bounds MUST be respected
    expect(feedIds).not.toContain(farUserId);

    // Standard Requirement 3: Previously interacted groups MUST NOT be excluded from discovery
    expect(feedIds).toContain(alreadyLikedUserId);

    // Standard Requirement 4: Valid, nearby, fresh users MUST be included
    expect(feedIds).toContain(freshUserId);
  });
});