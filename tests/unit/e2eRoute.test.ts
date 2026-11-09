import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/e2e/route";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: { update: vi.fn(), findUnique: vi.fn() },
    group: { create: vi.fn() },
  },
}));

const SECRET = "unit-test-secret";

function makeRequest(
  url = "http://localhost:3100/api/e2e",
  headers: Record<string, string> = {},
) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-e2e-secret": SECRET, ...headers },
    body: JSON.stringify({ action: "verify", email: "a@test.com" }),
  });
}

describe("POST /api/e2e gating (S16)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("E2E_ENABLED", "1");
    vi.stubEnv("E2E_TEST_SECRET", SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("works when all gates are open (non-production, enabled, localhost, secret)", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { email: "a@test.com" },
      data: { isVerified: true },
    });
  });

  it.each(["http://127.0.0.1:3100/api/e2e", "http://[::1]:3100/api/e2e"])(
    "accepts loopback host %s",
    async (url) => {
      const res = await POST(makeRequest(url));
      expect(res.status).toBe(200);
    },
  );

  it("returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it.each([undefined, "0", "true"])("returns 404 when E2E_ENABLED is %s", async (value) => {
    vi.stubEnv("E2E_ENABLED", value as string);
    const res = await POST(makeRequest());
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a non-localhost host", async () => {
    const res = await POST(makeRequest("http://staging.gloo.app/api/e2e"));
    expect(res.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 404 when proxied from a non-loopback client", async () => {
    const res = await POST(makeRequest(undefined, { "x-forwarded-for": "203.0.113.7" }));
    expect(res.status).toBe(404);
    const res2 = await POST(makeRequest(undefined, { "x-real-ip": "203.0.113.7" }));
    expect(res2.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("returns 404 for a wrong secret, or when no secret is configured", async () => {
    const res = await POST(makeRequest(undefined, { "x-e2e-secret": "wrong" }));
    expect(res.status).toBe(404);

    vi.stubEnv("E2E_TEST_SECRET", "");
    const res2 = await POST(makeRequest(undefined, { "x-e2e-secret": "" }));
    expect(res2.status).toBe(404);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
