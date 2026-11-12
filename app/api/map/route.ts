import { json, runHandler } from "@/lib/apiRoute";
import { getMapData } from "@/lib/mapData";
import { getOptionalUserId } from "@/lib/session";

/**
 * GET /api/map: venues for everyone (the map is open to guests), plus
 * pre-party events and the caller's own event when signed in.
 */
export async function GET() {
  return runHandler(async () => json(await getMapData(await getOptionalUserId())));
}
