import { describe, it, expect } from "vitest";
import {
  approximateArea,
  boundingBox,
  clampDistanceKm,
  coarsenCoordinate,
  EARTH_RADIUS_KM,
  haversineKm,
  MAX_DISTANCE_KM,
  parseCoarseLocation,
  roundDistanceKm,
} from "@/lib/geo";

// The production helper (lib/geo.ts) — also used to build the discovery SQL.
describe("Mathematical Formula: Haversine Distance (TC19)", () => {
  it("should calculate correct distance between Mainz and Frankfurt (~34km)", () => {
    const mainz = { lat: 49.9929, lon: 8.2473 };
    const frankfurt = { lat: 50.1109, lon: 8.6821 };

    const distance = haversineKm(mainz.lat, mainz.lon, frankfurt.lat, frankfurt.lon);

    expect(distance).toBeGreaterThan(33);
    expect(distance).toBeLessThan(35);
  });

  it("should return 0 when coordinates are identical", () => {
    expect(haversineKm(50.0, 8.0, 50.0, 8.0)).toBe(0);
  });

  it("returns NaN (never 0 = 'nearby') for invalid or NaN coordinates", () => {
    expect(haversineKm(NaN, 8.0, 50.0, NaN)).toBeNaN();
    expect(haversineKm(50, Infinity, 50, 8)).toBeNaN();
  });

  it("is symmetric and handles the antimeridian", () => {
    expect(haversineKm(10, 179.99, 10, -179.98)).toBeCloseTo(haversineKm(10, -179.98, 10, 179.99), 12);
    expect(haversineKm(10, 179.99, 10, -179.98)).toBeCloseTo(3.285, 2);
  });
});

/** Longitude (deg) of the point `km` due east of (lat, 0). */
const eastOf = (lat: number, km: number) =>
  (2 * Math.asin(Math.sin(km / (2 * EARTH_RADIUS_KM)) / Math.cos((lat * Math.PI) / 180)) * 180) / Math.PI;

describe("boundingBox (B1)", () => {
  it("widens the longitude range by 1/cos(lat): 9 km east at 50°N is inside a 10 km box", () => {
    const box = boundingBox(50, 0, 10);
    const lon9 = eastOf(50, 9);
    expect(haversineKm(50, 0, 50, lon9)).toBeCloseTo(9, 9);
    expect(box.lonRanges).toHaveLength(1);
    expect(box.lonRanges[0][1]).toBeGreaterThan(lon9);
    // The old box (d / 111) stopped at ~6.4 km east.
    expect(10 / 111).toBeLessThan(lon9);
  });

  it("contains every point on the radius circle", () => {
    for (const lat of [-60, -20, 0, 35, 50, 70]) {
      const box = boundingBox(lat, 10, 25);
      for (let bearing = 0; bearing < 360; bearing += 5) {
        const b = (bearing * Math.PI) / 180;
        const d = 25 / EARTH_RADIUS_KM;
        const p1 = (lat * Math.PI) / 180;
        const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
        const l2 = (10 * Math.PI) / 180 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
        const [pLat, pLon] = [(p2 * 180) / Math.PI, (l2 * 180) / Math.PI];
        expect(pLat).toBeGreaterThanOrEqual(box.minLat - 1e-9);
        expect(pLat).toBeLessThanOrEqual(box.maxLat + 1e-9);
        expect(box.lonRanges.some(([min, max]) => pLon >= min - 1e-9 && pLon <= max + 1e-9)).toBe(true);
      }
    }
  });

  it("splits the longitude range at the antimeridian", () => {
    const box = boundingBox(10, 179.99, 10);
    expect(box.lonRanges).toHaveLength(2);
    expect(box.lonRanges[0][1]).toBe(180);
    expect(box.lonRanges[1][0]).toBe(-180);
    expect(box.lonRanges.some(([min, max]) => -179.98 >= min && -179.98 <= max)).toBe(true);

    const west = boundingBox(10, -179.99, 10);
    expect(west.lonRanges.some(([min, max]) => 179.98 >= min && 179.98 <= max)).toBe(true);
  });

  it("uses every longitude when the circle reaches a pole", () => {
    expect(boundingBox(89.9, 0, 50).lonRanges).toEqual([[-180, 180]]);
    expect(boundingBox(-90, 0, 1).lonRanges).toEqual([[-180, 180]]);
  });
});

describe("coarsening and display (S4)", () => {
  it("rounds to 2 decimals, half away from zero (same as PostgreSQL numeric round)", () => {
    expect(coarsenCoordinate(49.9929)).toBe(49.99);
    expect(coarsenCoordinate(8.2473)).toBe(8.25);
    expect(coarsenCoordinate(8.245)).toBe(8.25);
    expect(coarsenCoordinate(-8.245)).toBe(-8.25);
    expect(coarsenCoordinate(-0.004)).toBe(0);
    expect(Object.is(coarsenCoordinate(-0.004), -0)).toBe(false);
  });

  it("parses, validates and coarsens submitted coordinates", () => {
    expect(parseCoarseLocation("50.123", "8.456")).toEqual({ latitude: 50.12, longitude: 8.46 });
    expect(parseCoarseLocation("", "8")).toBeNull();
    expect(parseCoarseLocation("abc", "8")).toBeNull();
    expect(parseCoarseLocation("91", "8")).toBeNull();
    expect(parseCoarseLocation("50", "-181")).toBeNull();
    expect(parseCoarseLocation(null, "8")).toBeNull();
  });

  it("rounds distances to whole km with 0 meaning '< 1 km'", () => {
    expect(roundDistanceKm(0)).toBe(0);
    expect(roundDistanceKm(0.99)).toBe(0);
    expect(roundDistanceKm(1.49)).toBe(1);
    expect(roundDistanceKm(9.5)).toBe(10);
  });

  it("clamps the radius to 1..MAX_DISTANCE_KM", () => {
    expect(clampDistanceKm(20000)).toBe(MAX_DISTANCE_KM);
    expect(clampDistanceKm(0)).toBe(1);
    expect(clampDistanceKm(-5)).toBe(1);
    expect(clampDistanceKm(12.5)).toBe(12.5);
  });

  it("returns an approximate ~1 km area around the coarsened point", () => {
    expect(approximateArea(60.0123, 25.0456)).toEqual({ center: [60.01, 25.05], radiusM: 1000 });
    expect(approximateArea(null, 8)).toBeNull();
  });
});
