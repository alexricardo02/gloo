import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { haversineKm } from "@/lib/geo";
import { destinationPoint, MASK_RADIUS_METERS, maskedCenter } from "@/lib/eventMask";
import { secureRandomUnit } from "@/lib/secureRandom";
import { nightOf } from "@/lib/venueNight";
import {
  CONTACT_PLACEHOLDER,
  resetGeocoderForTests,
  reverseGeocode,
  roundForGeocoding,
  userAgent,
} from "@/lib/reverseGeocode";
import { actionErrorKey } from "@/lib/actionErrors";
import {
  CLEANUP_INTERVAL_MS,
  cleanupExpiredEvents,
  cleanupOldVenueAttendance,
  maybeCleanupExpiredEvents,
  venueAttendanceCutoff,
  resetEventCleanupForTests,
} from "@/lib/eventRetention";

// Real CSPRNG by default; individual tests can queue fixed draws.
vi.mock("@/lib/secureRandom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/secureRandom")>();
  return { secureRandomUnit: vi.fn(actual.secureRandomUnit) };
});

describe("secureRandomUnit (lib/secureRandom.ts)", () => {
  it("returns floats in [0, 1), roughly uniform over 10 buckets", async () => {
    const { secureRandomUnit: real } = await vi.importActual<typeof import("@/lib/secureRandom")>("@/lib/secureRandom");
    const N = 100_000;
    const buckets = new Array(10).fill(0);
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i += 1) {
      const u = real();
      if (u < min) min = u;
      if (u > max) max = u;
      buckets[Math.floor(u * 10)] += 1;
      sum += u;
    }
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    // Expected 10,000 per bucket; sd ~95, so ±600 is > 6 sd.
    for (const count of buckets) {
      expect(count).toBeGreaterThan(N / 10 - 600);
      expect(count).toBeLessThan(N / 10 + 600);
    }
    expect(sum / N).toBeGreaterThan(0.495);
    expect(sum / N).toBeLessThan(0.505);
    // 53-bit resolution: values are multiples of 2^-53.
    expect(Number.isInteger(real() * 2 ** 53)).toBe(true);
  });
});

describe("destinationPoint (pure geometry)", () => {
  const meters = (a: [number, number], b: [number, number]) => haversineKm(a[0], a[1], b[0], b[1]) * 1000;

  it("goes due north: latitude grows by d / R, longitude unchanged", () => {
    const [lat, lon] = destinationPoint(50, 8, 1000, 0);
    expect(lat).toBeCloseTo(50 + (1 / 6371) * (180 / Math.PI), 10);
    expect(lon).toBeCloseTo(8, 12);
    expect(meters([50, 8], [lat, lon])).toBeCloseTo(1000, 6);
  });

  it("goes due east along the equator by d / R degrees", () => {
    const [lat, lon] = destinationPoint(0, 0, 10_000, Math.PI / 2);
    expect(lat).toBeCloseTo(0, 12);
    expect(lon).toBeCloseTo((10 / 6371) * (180 / Math.PI), 10);
  });

  it("goes due south and west", () => {
    expect(destinationPoint(50, 8, 1000, Math.PI)[0]).toBeCloseTo(50 - (1 / 6371) * (180 / Math.PI), 10);
    expect(destinationPoint(0, 0, 10_000, (3 * Math.PI) / 2)[1]).toBeCloseTo(-(10 / 6371) * (180 / Math.PI), 10);
  });

  it("wraps longitude across the antimeridian into [-180, 180)", () => {
    const [, east] = destinationPoint(10, 179.9999, 400, Math.PI / 2);
    expect(east).toBeLessThan(-179.99);
    expect(east).toBeGreaterThanOrEqual(-180);
    const [, west] = destinationPoint(10, -179.9999, 400, (3 * Math.PI) / 2);
    expect(west).toBeGreaterThan(179.99);
    expect(west).toBeLessThan(180);
    expect(destinationPoint(0, 180, 0, 0)[1]).toBe(-180);
    expect(destinationPoint(50, 8, 0, 1.234)).toEqual([50, 8]);
  });
});

describe("maskedCenter (S3, random-offset-circle)", () => {
  afterEach(() => vi.mocked(secureRandomUnit).mockClear());

  it("always keeps the exact point within MASK_RADIUS_METERS of the masked center", () => {
    for (let i = 0; i < 2000; i += 1) {
      const lat = -80 + Math.random() * 160;
      const lon = -180 + Math.random() * 360;
      const [mLat, mLon] = maskedCenter(lat, lon);
      expect(haversineKm(lat, lon, mLat, mLon) * 1000).toBeLessThanOrEqual(MASK_RADIUS_METERS + 1e-6);
    }
  });

  it("draws only from secureRandomUnit: bearing = 2π·u1, distance = R·sqrt(u2)", () => {
    vi.mocked(secureRandomUnit).mockReturnValueOnce(0.25).mockReturnValueOnce(0.25); // east, R/2
    const [lat, lon] = maskedCenter(0, 0);
    expect(secureRandomUnit).toHaveBeenCalledTimes(2);
    expect(lat).toBeCloseTo(0, 12);
    expect(haversineKm(0, 0, lat, lon) * 1000).toBeCloseTo(MASK_RADIUS_METERS / 2, 6);
    expect(lon).toBeGreaterThan(0);

    vi.mocked(secureRandomUnit).mockReturnValueOnce(0).mockReturnValueOnce(0);
    expect(maskedCenter(50, 8)).toEqual([50, 8]);
  });

  it("is uniform over the circle's AREA: ~25% of masked centers within R/2 (not ~50%)", () => {
    const N = 20000;
    let inner = 0;
    let max = 0;
    for (let i = 0; i < N; i += 1) {
      const [mLat, mLon] = maskedCenter(50, 8);
      const m = haversineKm(50, 8, mLat, mLon) * 1000;
      if (m <= MASK_RADIUS_METERS / 2) inner += 1;
      max = Math.max(max, m);
    }
    expect(inner / N).toBeGreaterThan(0.23);
    expect(inner / N).toBeLessThan(0.27);
    expect(max).toBeGreaterThan(MASK_RADIUS_METERS * 0.99);
    expect(max).toBeLessThanOrEqual(MASK_RADIUS_METERS + 1e-6);
  });
});

describe("venue night (VENUE_NIGHT_BOUNDARY = 06:00 Europe/Berlin)", () => {
  afterEach(() => vi.useRealTimers());

  const day = (iso: string) => nightOf(new Date(iso)).toISOString().slice(0, 10);

  it("switches at 06:00 Berlin time in winter (UTC+1) and summer (UTC+2)", () => {
    expect(day("2026-11-14T04:59:00Z")).toBe("2026-11-13"); // 05:59 CET
    expect(day("2026-11-14T05:01:00Z")).toBe("2026-11-14"); // 06:01 CET
    expect(day("2026-07-11T03:59:00Z")).toBe("2026-07-10"); // 05:59 CEST
    expect(day("2026-07-11T04:00:00Z")).toBe("2026-07-11"); // 06:00 CEST
    expect(day("2026-07-10T21:30:00Z")).toBe("2026-07-10"); // 23:30 CEST
  });

  it("handles month/year boundaries and DST change nights", () => {
    expect(day("2027-01-01T03:00:00Z")).toBe("2026-12-31");
    expect(day("2026-03-29T03:30:00Z")).toBe("2026-03-28"); // 05:30 CEST, the DST night
    expect(day("2026-10-25T04:30:00Z")).toBe("2026-10-24"); // 05:30 CET, the DST night
  });

  it("uses the current time by default (fake timers around 05:59 / 06:01)", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-14T04:59:00Z"));
    expect(nightOf().toISOString()).toBe("2026-11-13T00:00:00.000Z");
    vi.setSystemTime(new Date("2026-11-14T05:01:00Z"));
    expect(nightOf().toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });
});

describe("reverse geocoding (S12, server-side)", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-12T20:00:00Z"));
    resetGeocoderForTests();
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ address: { suburb: "Neustadt" } })));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NOMINATIM_CONTACT", "ops@gloo.example");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("rounds coordinates to 3 decimals and sends an identifying User-Agent", async () => {
    expect(await reverseGeocode(49.992912, 8.247311, "de")).toBe("Neustadt");

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("lat")).toBe("49.993");
    expect(url.searchParams.get("lon")).toBe("8.247");
    expect(url.toString()).not.toContain("49.9929");
    const headers = init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^Gloo\/.+contact: ops@gloo\.example\)$/);
    expect(headers["Accept-Language"]).toBe("de");
    expect(roundForGeocoding(-8.24751)).toBe(-8.248);
  });

  it("uses a placeholder contact until NOMINATIM_CONTACT is set", () => {
    expect(userAgent({})).toContain(CONTACT_PLACEHOLDER);
  });

  it("caches by rounded point (also 'no result')", async () => {
    await reverseGeocode(49.99291, 8.24731);
    await reverseGeocode(49.99289, 8.24728); // same rounded point
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockImplementation(async () => new Response(JSON.stringify({})));
    vi.advanceTimersByTime(1000);
    expect(await reverseGeocode(10, 10)).toBeNull();
    vi.advanceTimersByTime(1000);
    expect(await reverseGeocode(10, 10)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throttles Nominatim to 1 request per second and gives up beyond 5 s of queue", async () => {
    const calls = [1, 2, 3, 4, 5, 6, 7].map((i) => reverseGeocode(40 + i, 10));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4000);
    const results = await Promise.all(calls);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(results.slice(0, 6)).toEqual(Array(6).fill("Neustadt"));
    expect(results[6]).toBeNull(); // would have waited 6 s
  });

  it("returns null (uncached) on HTTP errors", async () => {
    fetchMock.mockImplementation(async () => new Response("busy", { status: 503 }));
    expect(await reverseGeocode(1, 1)).toBeNull();
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ address: { town: "Town" } })));
    vi.advanceTimersByTime(1000);
    expect(await reverseGeocode(1, 1)).toBe("Town");
  });
});

describe("no client code calls Nominatim", () => {
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.(tsx?|jsx?|mjs)$/.test(entry.name) ? [full] : [];
    });
  }

  it("only lib/reverseGeocode.ts (server-only) contains the Nominatim host", () => {
    const root = process.cwd();
    const hits = [...files(path.join(root, "app")), ...files(path.join(root, "lib"))]
      .filter((file) => /nominatim\.openstreetmap\.org/i.test(fs.readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file));
    expect(hits).toEqual(["lib/reverseGeocode.ts"]);
    expect(fs.readFileSync(path.join(root, "lib/reverseGeocode.ts"), "utf8")).toContain('import "server-only"');
    expect(fs.readFileSync(path.join(root, "app/components/MapDisplay.tsx"), "utf8")).toContain("/api/geocode");
  });
});

describe("actionErrorKey (B11)", () => {
  const keys = new Set(["UNAUTHORIZED", "INTERNAL", "NOT_FOUND", "partyEnded"]);
  const has = (k: string) => keys.has(k);

  it("prefers a known messageKey, then the code, then INTERNAL", () => {
    expect(actionErrorKey({ code: "NOT_FOUND", messageKey: "partyEnded" }, has)).toBe("partyEnded");
    expect(actionErrorKey({ code: "NOT_FOUND", messageKey: "unknownKey" }, has)).toBe("NOT_FOUND");
    expect(actionErrorKey({ code: "RATE_LIMITED" }, has)).toBe("INTERNAL");
  });
});

describe("retention throttle", () => {
  afterEach(() => resetEventCleanupForTests());

  it("runs the cleanup at most once per CLEANUP_INTERVAL_MS and never throws", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const venueDeleteMany = vi.fn().mockResolvedValue({ count: 0 });
    const db = { event: { deleteMany }, venueAttendance: { deleteMany: venueDeleteMany } } as never;
    const t0 = new Date("2026-11-12T20:00:00Z");

    maybeCleanupExpiredEvents(db, t0);
    maybeCleanupExpiredEvents(db, new Date(t0.getTime() + CLEANUP_INTERVAL_MS - 1));
    expect(deleteMany).toHaveBeenCalledTimes(1);
    expect(venueDeleteMany).toHaveBeenCalledTimes(1);
    maybeCleanupExpiredEvents(db, new Date(t0.getTime() + CLEANUP_INTERVAL_MS));
    expect(deleteMany).toHaveBeenCalledTimes(2);
    expect(venueDeleteMany).toHaveBeenCalledTimes(2);

    const reject = () => vi.fn().mockRejectedValue(new Error("db down"));
    const failing = { event: { deleteMany: reject() }, venueAttendance: { deleteMany: reject() } } as never;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    resetEventCleanupForTests();
    expect(() => maybeCleanupExpiredEvents(failing, t0)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });

  it("deletes venue marks whose night is more than 30 days old", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 4 });
    const now = new Date("2026-11-12T20:00:00Z");
    expect(venueAttendanceCutoff(now).toISOString()).toBe("2026-10-13T00:00:00.000Z");
    expect(await cleanupOldVenueAttendance({ venueAttendance: { deleteMany } } as never, now)).toBe(4);
    expect(deleteMany).toHaveBeenCalledWith({ where: { night: { lt: new Date("2026-10-13T00:00:00Z") } } });
  });

  it("deletes events that ended more than 24 h ago (and undated ones older than 32 h)", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const now = new Date("2026-11-12T20:00:00Z");
    expect(await cleanupExpiredEvents({ event: { deleteMany } } as never, now)).toBe(3);
    expect(deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { endTime: { lt: new Date("2026-11-11T20:00:00Z") } },
          { endTime: null, createdAt: { lt: new Date("2026-11-11T12:00:00Z") } },
        ],
      },
    });
  });
});
