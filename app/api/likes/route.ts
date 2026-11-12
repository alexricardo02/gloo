import { json, withUser } from "@/lib/apiRoute";
import { getGroupsThatLikedMe } from "@/lib/likesData";

/** GET /api/likes: groups that liked the caller's group ("liked me" tab). */
export async function GET() {
  return withUser(async (userId) => json({ groups: await getGroupsThatLikedMe(userId) }));
}
