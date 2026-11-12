import { Prisma } from "@prisma/client";

/**
 * Geo helpers for discovery and the "liked me" view (Pack 6: S4, B1).
 *
 * The one source of the distance formula: `haversineKm` (JS) and
 * `haversineSql` (PostgreSQL) are the same spherical great-circle formula
 * with the same Earth radius, so the feed filter, the displayed distance and
 * the tests can never disagree.
 *
 * Location privacy decisions (see lib/discovery.ts, lib/likesData.ts):
 *  - coordinates are stored rounded to STORED_PRECISION_DECIMALS (~1 km);
 *  - other groups' coordinates never leave the server; discovery returns a
 *    distance rounded to whole km (0 = "< 1 km");
 *  - the liked-me map gets an approximate circle around the stored point.
 */

/** Mean Earth radius in km (also used by haversineSql). */
export const EARTH_RADIUS_KM = 6371;

/** STORED_PRECISION_DECIMALS = 2: ~1.1 km north/south, less east/west. */
export const STORED_PRECISION_DECIMALS = 2;

/** Server-side clamp of the requested search radius (km). */
export const MIN_DISTANCE_KM = 1;
export const MAX_DISTANCE_KM = 50;

/** LOCATION_CHANGE_LIMIT_PER_DAY, per group; 0 disables the limit. */
export const LOCATION_CHANGE_LIMIT_PER_DAY = 10;

/** LIKED_ME_MAP = approximate-circles: radius of the circle drawn per group. */
export const APPROXIMATE_AREA_RADIUS_M = 1000;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Great-circle distance in km (haversine). NaN if any input is not a finite
 * number, so a missing coordinate can never look like "0 km away".
 */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return NaN;
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * The same formula as `haversineKm` as a SQL expression: distance in km from
 * the point (`lat`, `lon`) (bound parameters) to the columns `latCol` /
 * `lonCol` (trusted SQL identifiers built by the caller, never user input).
 */
export function haversineSql(latCol: Prisma.Sql, lonCol: Prisma.Sql, lat: number, lon: number): Prisma.Sql {
  return Prisma.sql`(2 * ${EARTH_RADIUS_KM}::float8 * asin(least(1::float8, sqrt(
      power(sin(radians(${latCol} - ${lat}::float8) / 2), 2)
    + cos(radians(${lat}::float8)) * cos(radians(${latCol}))
    * power(sin(radians(${lonCol} - ${lon}::float8) / 2), 2)
  ))))`;
}

export interface BoundingBox {
  minLat: number;
  maxLat: number;
  /** One range normally; two when the box crosses the antimeridian. */
  lonRanges: [number, number][];
}

/**
 * Smallest lat/lon box that contains every point within `distanceKm` of
 * (`lat`, `lon`) on the haversine sphere. It is only a pre-filter for the
 * [latitude, longitude] index; the exact haversine check runs after it.
 *
 * Latitude: d / R radians (= d / 111.19 degrees).
 * Longitude: asin(sin(d/R) / cos(lat)), the exact half-width of a spherical
 * cap. For small d this equals d / (111.19 * cos(lat)); unlike that
 * approximation it is never too narrow toward the pole. If the cap reaches
 * a pole (sin(d/R) >= cos(lat)) every longitude is included. Ranges past
 * +/-180 are wrapped and split into two.
 */
export function boundingBox(lat: number, lon: number, distanceKm: number): BoundingBox {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const dLat = toDeg(angular);
  const minLat = Math.max(-90, lat - dLat);
  const maxLat = Math.min(90, lat + dLat);

  const cosLat = Math.cos(toRad(lat));
  const sinAngular = Math.sin(angular);
  if (minLat <= -90 || maxLat >= 90 || sinAngular >= cosLat) {
    return { minLat, maxLat, lonRanges: [[-180, 180]] };
  }

  const dLon = toDeg(Math.asin(sinAngular / cosLat));
  const minLon = lon - dLon;
  const maxLon = lon + dLon;
  if (minLon < -180) return { minLat, maxLat, lonRanges: [[minLon + 360, 180], [-180, maxLon]] };
  if (maxLon > 180) return { minLat, maxLat, lonRanges: [[minLon, 180], [-180, maxLon - 360]] };
  return { minLat, maxLat, lonRanges: [[minLon, maxLon]] };
}

/**
 * Rounds a coordinate to `decimals` places, half away from zero, the same as
 * PostgreSQL `round(x::numeric, decimals)` (used by the coarsening migration).
 * The 12-significant-digit step removes binary noise such as
 * 8.245 * 100 = 824.4999999999999.
 */
export function coarsenCoordinate(value: number, decimals = STORED_PRECISION_DECIMALS): number {
  const factor = 10 ** decimals;
  const scaled = Number((Math.abs(value) * factor).toPrecision(12));
  const rounded = (Math.sign(value) * Math.round(scaled)) / factor;
  return rounded === 0 ? 0 : rounded; // no -0
}

/**
 * Parses a submitted latitude/longitude pair. Returns null for anything that
 * is missing, not a number or out of range (the group is then stored without
 * a location, as before), otherwise the coarsened pair.
 */
export function parseCoarseLocation(
  rawLat: unknown,
  rawLon: unknown,
): { latitude: number; longitude: number } | null {
  if (typeof rawLat !== "string" || typeof rawLon !== "string") return null;
  if (rawLat.trim() === "" || rawLon.trim() === "") return null;
  const lat = Number(rawLat);
  const lon = Number(rawLon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { latitude: coarsenCoordinate(lat), longitude: coarsenCoordinate(lon) };
}

/** DISTANCE_DISPLAY = rounded-km: whole km; 0 means "< 1 km". */
export function roundDistanceKm(distanceKm: number): number {
  return distanceKm < 1 ? 0 : Math.round(distanceKm);
}

/** Clamps a requested radius to MIN_DISTANCE_KM..MAX_DISTANCE_KM. */
export function clampDistanceKm(distanceKm: number): number {
  return Math.min(MAX_DISTANCE_KM, Math.max(MIN_DISTANCE_KM, distanceKm));
}

/** Approximate area for the liked-me map: a circle around the coarsened point. */
export interface ApproximateArea {
  center: [number, number];
  radiusM: number;
}

export function approximateArea(lat: number | null, lon: number | null): ApproximateArea | null {
  if (lat === null || lon === null || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { center: [coarsenCoordinate(lat), coarsenCoordinate(lon)], radiusM: APPROXIMATE_AREA_RADIUS_M };
}
