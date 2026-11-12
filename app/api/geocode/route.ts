import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, runHandler } from "@/lib/apiRoute";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { reverseGeocode } from "@/lib/reverseGeocode";

const query = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  lang: z.enum(["en", "de", "es", "fr", "it"]).default("en"),
});

/**
 * GET /api/geocode?lat=&lng=&lang= -> { name: string | null }
 *
 * Reverse geocoding for the map's "your location" label, done on the server
 * (S12; see lib/reverseGeocode.ts). Open to guests like the map itself, rate
 * limited per IP.
 */
export async function GET(request: NextRequest) {
  return runHandler(async () => {
    const parsed = query.safeParse(Object.fromEntries(request.nextUrl.searchParams));
    if (!parsed.success) return apiError(400, "VALIDATION");
    if (!(await checkRateLimit("reverseGeocode", { ip: await getClientIp() }))) {
      return json({ error: "RATE_LIMITED" }, 429);
    }
    const { lat, lng, lang } = parsed.data;
    return json({ name: await reverseGeocode(lat, lng, lang) });
  });
}
