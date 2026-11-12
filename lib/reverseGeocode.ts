import "server-only";

/**
 * Server-side reverse geocoding (S12, REVERSE_GEOCODING = server-side).
 *
 * The browser never talks to Nominatim. It calls GET /api/geocode, and this
 * module follows the Nominatim usage policy
 * (https://operations.osmfoundation.org/policies/nominatim/):
 *  - coordinates are rounded to 3 decimals (~100 m) before they leave the
 *    server, which is enough for a district name;
 *  - an identifying User-Agent with a contact (NOMINATIM_CONTACT env var);
 *  - at most 1 request per second for the whole server process; a caller
 *    that would have to wait more than MAX_WAIT_MS gets null instead;
 *  - results (also "nothing found") are cached in memory by rounded point.
 */

export const GEOCODE_DECIMALS = 3;
export const MIN_INTERVAL_MS = 1000;
export const MAX_WAIT_MS = 5000;
const CACHE_LIMIT = 2000;
const TIMEOUT_MS = 4000;
const ENDPOINT = "https://nominatim.openstreetmap.org/reverse";

/** Placeholder until NOMINATIM_CONTACT is set (see .env.example). */
export const CONTACT_PLACEHOLDER = "contact@example.invalid";

export function userAgent(env: Record<string, string | undefined> = process.env): string {
  return `Gloo/0.1 (+https://github.com/alexricardo02/gloo; contact: ${env.NOMINATIM_CONTACT || CONTACT_PLACEHOLDER})`;
}

export function roundForGeocoding(value: number): number {
  const factor = 10 ** GEOCODE_DECIMALS;
  return Math.round(value * factor) / factor;
}

const cache = new Map<string, string | null>();
let nextSlotAt = 0;

/** Test helper. */
export function resetGeocoderForTests(): void {
  cache.clear();
  nextSlotAt = 0;
}

type NominatimResponse = {
  address?: Record<string, string | undefined>;
};

function pickName(data: NominatimResponse): string | null {
  const a = data.address ?? {};
  return a.suburb || a.city_district || a.city || a.town || a.village || null;
}

/**
 * District/town name for a point, or null (unknown, throttled or failed).
 * `lang` is a two-letter locale for Accept-Language.
 */
export async function reverseGeocode(lat: number, lon: number, lang = "en"): Promise<string | null> {
  const rLat = roundForGeocoding(lat);
  const rLon = roundForGeocoding(lon);
  const key = `${rLat.toFixed(GEOCODE_DECIMALS)},${rLon.toFixed(GEOCODE_DECIMALS)},${lang}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  // Reserve the next free 1-second slot synchronously, so concurrent callers queue up.
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  if (slot - now > MAX_WAIT_MS) return null;
  nextSlotAt = slot + MIN_INTERVAL_MS;
  if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));

  const url = new URL(ENDPOINT);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", rLat.toFixed(GEOCODE_DECIMALS));
  url.searchParams.set("lon", rLon.toFixed(GEOCODE_DECIMALS));
  url.searchParams.set("zoom", "14");

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": userAgent(), "Accept-Language": lang, Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null; // not cached: may be a transient error
    const name = pickName((await response.json()) as NominatimResponse);
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
    cache.set(key, name);
    return name;
  } catch (error) {
    console.error("[geocode] Reverse geocoding failed:", error);
    return null;
  }
}
