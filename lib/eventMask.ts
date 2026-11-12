import "server-only";

import { randomBytes } from "node:crypto";
import { EARTH_RADIUS_KM } from "@/lib/geo";
import { MASK_RADIUS_METERS } from "@/lib/mapConfig";

export { MASK_RADIUS_METERS };

/**
 * Pre-party location masking (S3), MASKING = random-offset-circle.
 *
 * At creation the exact point is moved to a point drawn uniformly over the
 * AREA of a circle of MASK_RADIUS_METERS: angle uniform in [0, 2π), distance
 * R * sqrt(u). (A uniform distance would cluster masked centers near the exact
 * point: half of them within R/2; area-uniform puts only a quarter there.)
 * Randomness comes from a cryptographically secure source (node:crypto). The result is STORED on the
 * event and never recomputed: recomputing per request would let a viewer
 * average many reloads back to the exact point. A circle of
 * MASK_RADIUS_METERS around the masked center always contains the exact point.
 */

/** Uniform in [0, 1) from 48 random bits of the OS CSPRNG. */
export function secureRandom(): number {
  return randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

/** Destination point on the haversine sphere (degrees in, degrees out). */
export function offsetPoint(lat: number, lon: number, bearingRad: number, distanceM: number): [number, number] {
  const delta = distanceM / (EARTH_RADIUS_KM * 1000);
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  const lon2 = ((((lambda2 * 180) / Math.PI + 540) % 360) + 360) % 360 - 180;
  return [(phi2 * 180) / Math.PI, lon2];
}

/** The masked center for a new event. `random` is injectable for tests only. */
export function maskedCenter(lat: number, lon: number, random: () => number = secureRandom): [number, number] {
  const bearing = 2 * Math.PI * random();
  const distance = MASK_RADIUS_METERS * Math.sqrt(random());
  return offsetPoint(lat, lon, bearing, distance);
}
