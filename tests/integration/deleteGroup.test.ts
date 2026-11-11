import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { deleteGroupAction } from "@/app/actions/group";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { sessionCookiesFor } from "./helpers/session";
import { remove, removePrefix } from "@/lib/storage";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// lib/storage.ts is the only module that talks to Supabase Storage; mock it.
vi.mock("@/lib/storage", () => ({
  remove: vi.fn().mockResolvedValue(undefined),
  removePrefix: vi.fn().mockResolvedValue([]),
  upload: vi.fn(),
  toPublicUrl: (v: string) => v,
  withPhotoUrls: <T,>(g: T) => g,
}));

describe("Group Deletion Capability (Integration)", () => {
  let testUserId: string;
  const testEmail = `keep_account_${Date.now()}@test.com`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: testEmail, password: "123", name: "Host to Spectator", birthDate: new Date(), 
        group: { create: { membersCount: 3, photos: ["https://dummy.com/photo.jpg", "groups/someone-else-group-x.jpg"] } }
      }
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: testUserId } });
  });

  it("should delete the group but keep the user account active", async () => {
    vi.mocked(cookies).mockResolvedValue((await sessionCookiesFor(testUserId)) as never);

    // Check group exists before
    let groupCheck = await prisma.group.findUnique({ where: { userId: testUserId } });
    expect(groupCheck).not.toBeNull();

    // Execute Delete Group Action
    const result = await deleteGroupAction();
    expect(result.success).toBe(true);

    // Storage: only this group's own prefix; never the foreign key or external URL.
    expect(removePrefix).toHaveBeenCalledWith(`groups/${groupCheck!.id}/`);
    expect(remove).not.toHaveBeenCalled();

    // Verify group is gone
    groupCheck = await prisma.group.findUnique({ where: { userId: testUserId } });
    expect(groupCheck).toBeNull();

    // CRITICAL: Verify user account is STILL alive
    const userCheck = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userCheck).not.toBeNull();
    expect(userCheck?.email).toBe(testEmail);
  });
});