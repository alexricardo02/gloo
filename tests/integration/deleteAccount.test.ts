import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { deleteAccountAction } from "@/app/actions/auth";
import { cookies } from "next/headers";
import type { PrismaClient } from "@prisma/client";

// Next.js Header/Cookies mocken
vi.mock("next/headers", () => {
  const mockCookieStore = {
    set: vi.fn(),
    get: vi.fn(),
    delete: vi.fn(),
  };

  return {
    cookies: vi.fn().mockImplementation(async () => mockCookieStore),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: vi.fn().mockReturnValue({
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      })
    }
  }
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://dummy.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "dummy-key";

describe.skip("Account Deletion - ST0-122", () => {
  let prisma: PrismaClient;
  let testUserId: string;
  let testUserEmail: string;

  beforeAll(async () => {
    // DATABASE_URL setzen BEVOR Prisma geladen wird
    if (!process.env.DATABASE_URL) {
      process.env.DATABASE_URL =
        "postgresql://postgres:postgres@localhost:5432/test_db";
    }

    // Prisma erst jetzt importieren
    const prismaModule = await import("@/lib/prisma");
    prisma = prismaModule.prisma;

    // Verbindung testen
    let retries = 5;

    while (retries > 0) {
      try {
        await prisma.$connect();

        // Echten Query ausführen
        await prisma.$queryRaw`SELECT 1`;

        console.log("✅ Erfolgreich mit Test-Datenbank verbunden.");
        break;
      } catch (err: any) {
        retries--;

        console.warn(
          `⚠️ DB-Verbindungsfehler (${err.code || err.message}). Retry in 2s...`
        );

        if (retries === 0) {
          throw err;
        }

        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    }

    testUserEmail = `testdelete-${Math.random()
      .toString(36)
      .substring(2, 11)}@test.com`;

    const user = await prisma.user.create({
      data: {
        email: testUserEmail,
        password:
          "$2a$12$R9h/cIPz0gi.URNNX3kh2OPSTV/7NcyWLFFO7Z8JtP6B0r1rX1Wq2",
        name: "Test User Delete",
        birthDate: new Date("1990-01-01"),
        isVerified: true,
        verificationToken: null,
      },
    });

    testUserId = user.id;

    // Rest deiner Testdaten...
  });

  afterAll(async () => {
    if (!prisma) return;

    try {
      await prisma.user.deleteMany({
        where: {
          email: {
            startsWith: "testdelete-",
          },
        },
      });

      await prisma.$disconnect();
    } catch {
      // Cleanup ignorieren
    }
  });

  it("Should delete user account and all related data", async () => {
    const userBefore = await prisma.user.findUnique({
      where: { id: testUserId },
    });

    expect(userBefore).toBeDefined();

    const cookieStore = await cookies();
    cookieStore.set("gloo_user_id", testUserId);

    try {
      await deleteAccountAction("en");
    } catch {
      // Next.js Redirect ignorieren
    }

    const userAfter = await prisma.user.findUnique({
      where: { id: testUserId },
    });

    expect(userAfter).toBeNull();
  });
});