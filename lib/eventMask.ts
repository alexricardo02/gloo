import "server-only";

import { EARTH_RADIUS_KM } from "@/lib/geo";
import { MASK_RADIUS_METERS } from "@/lib/mapConfig";
import { secureRandomUnit } from "@/lib/secureRandom";

export { MASK_RADIUS_METERS };

/**
 * Pre-party location masking (S3), MASKING = random-offset-circle.
 *
 * At creation the exact point is moved to a point drawn uniformly over the
 * AREA of a circle of MASK_RADIUS_METERS: bearing uniform in [0, 2π),
 * distance R * sqrt(u). (A uniform distance would cluster masked centers near
 * the exact point: half of them within R/2; area-uniform puts only a quarter
 * there.) Both draws come from secureRandomUnit() (lib/secureRandom.ts, an
 * unbiased float from the OS CSPRNG). The result is STORED on the event and
 * never recomputed: recomputing per request would let a viewer average many
 * reloads back to the exact point. A circle of MASK_RADIUS_METERS around the
 * masked center always contains the exact point.
 */

/**
 * Destination point on the haversine sphere: start at (lat, lon) in degrees,
 * travel `distanceM` meters along initial bearing `bearingRad` (0 = north,
 * π/2 = east). Returns [lat, lon] in degrees, longitude normalized to
 * [-180, 180).
 *
 * Pure geometry on plain numbers; it knows nothing about randomness. Static
 * analysis (CodeQL js/biased-cryptographic-random) may still follow the
 * random draws from maskedCenter() into this arithmetic. That is not a
 * security issue: the inputs are already-unbiased continuous values, the
 * trigonometry is a continuous mapping (no integer range reduction), and the
 * `%` below only wraps an angle into [-180, 180); it never reduces random
 * bits to a smaller range.
 */
export function destinationPoint(lat: number, lon: number, distanceM: number, bearingRad: number): [number, number] {
  const delta = distanceM / (EARTH_RADIUS_KM * 1000); // angular distance
  const phi1 = (lat * Math.PI) / 180;
  const lambda1 = (lon * Math.PI) / 180;
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return [(phi2 * 180) / Math.PI, normalizeLongitude((lambda2 * 180) / Math.PI)];
}

/** Wraps any longitude in degrees into [-180, 180). */
function normalizeLongitude(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return wrapped === 0 ? 0 : wrapped; // no -0
}

/** The masked center for a new event, from two CSPRNG draws (bearing first, then distance). */
export function maskedCenter(lat: number, lon: number): [number, number] {
  const bearing = 2 * Math.PI * secureRandomUnit();
  const distance = MASK_RADIUS_METERS * Math.sqrt(secureRandomUnit());
  return destinationPoint(lat, lon, distance, bearing);
}
