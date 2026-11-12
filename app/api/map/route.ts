import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, json, runHandler } from "@/lib/apiRoute";
import { DEFAULT_MAP_CENTER, getMapData } from "@/lib/mapData";
import { getOptionalUserId } from "@/lib/session";

const centerQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
});

/**
 * GET /api/map?lat=&lng=: venues within VENUE_RADIUS_KM of the map center
 * for everyone (the map is open to guests), plus pre-parties (masked unless
 * the caller is the host or accepted) and the caller's own pre-party when
 * signed in. Without lat/lng the default center (Mainz) is used.
 */
export async function GET(request?: NextRequest) {
  return runHandler(async () => {
    const parsed = centerQuery.safeParse(Object.fromEntries(request?.nextUrl.searchParams ?? []));
    if (!parsed.success) return apiError(400, "VALIDATION");
    const { lat, lng } = parsed.data;
    const center: [number, number] = lat !== undefined && lng !== undefined ? [lat, lng] : DEFAULT_MAP_CENTER;
    return json(await getMapData(await getOptionalUserId(), center));
  });
}
