import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { deleteGroupAction } from "@/app/actions/group";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Mock Supabase storage
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: { from: vi.fn().mockReturnValue({ remove: vi.fn().mockResolvedValue({ data: null, error: null }) }) }
  }
}));

describe("Group Deletion Capability (Integration)", () => {
  let testUserId: string;
  const testEmail = `keep_account_${Date.now()}@test.com`;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: testEmail, password: "123", name: "Host to Spectator", birthDate: new Date(), 
        group: { create: { membersCount: 3, photos: ["https://dummy.com/photo.jpg"] } }
      }
    });
    testUserId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: testUserId } });
  });

  it("should delete the group but keep the user account active", async () => {
    vi.mocked(cookies).mockResolvedValue({ get: () => ({ value: testUserId }) } as any);

    // Check group exists before
    let groupCheck = await prisma.group.findUnique({ where: { userId: testUserId } });
    expect(groupCheck).not.toBeNull();

    // Execute Delete Group Action
    const result = await deleteGroupAction();
    expect(result.success).toBe(true);

    // Verify group is gone
    groupCheck = await prisma.group.findUnique({ where: { userId: testUserId } });
    expect(groupCheck).toBeNull();

    // CRITICAL: Verify user account is STILL alive
    const userCheck = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userCheck).not.toBeNull();
    expect(userCheck?.email).toBe(testEmail);
  });
});