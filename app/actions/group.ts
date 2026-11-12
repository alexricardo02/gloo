"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Gender } from "@prisma/client";
import { z } from "zod";
import { getOptionalUserId, requireUserId } from "@/lib/session";
import { ImageValidationError, validateImage } from "@/lib/validateImage";
import { processImage } from "@/lib/imageProcessing";
import { toPublicUrl, upload, withPhotoUrls } from "@/lib/storage";
import { groupPrefix, isOwnedGroupPhotoKey, newGroupPhotoKey } from "@/lib/storageKeys";
import { cleanupStorage } from "@/lib/storageCleanup";
import { type ActionResult, fail } from "@/lib/actionResult";
import { checkRateLimit } from "@/lib/rateLimit";
import { LOCATION_CHANGE_LIMIT_PER_DAY, parseCoarseLocation } from "@/lib/geo";

const MAX_GROUP_PHOTOS = 6;

export async function getGroupByUser() {
  try {
    const userId = await getOptionalUserId();

    if (!userId) return null;

    const group = await prisma.group.findUnique({
      where: { userId: userId },
    });

    if (!group) return null;

    return {
      ...withPhotoUrls(group),
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error("Connection error in getGroupByUser:", error);
    return null;
  }
}

// Values the client echoes back for photos it wants to keep. They are only
// used to SELECT from the photos already stored on the caller's group (S6).
const ExistingPhotosSchema = z.array(z.string().max(2048)).max(50);

/**
 * Creates or updates the caller's group. Redirects on success.
 *
 * Photos (S6/S7/B15):
 *  - `existingPhotos` is matched against the photos stored on the caller's own
 *    group (by stored key or its public URL). Anything else, such as another
 *    group's photo or an external URL, is ignored.
 *  - New files are validated (magic bytes), re-encoded to WebP and uploaded
 *    with the service-role client to `groups/{groupId}/{uuid}.webp`.
 *  - Photos removed by this edit are deleted from storage after the DB write.
 *
 * Location (S4): latitude/longitude are rounded to STORED_PRECISION_DECIMALS
 * on the server (lib/geo.ts). A change of the stored location is limited to
 * LOCATION_CHANGE_LIMIT_PER_DAY per group (RATE_LIMITED, messageKey
 * "locationChangeLimit").
 *
 * @returns ActionResult on failure; `messageKey` is a key in the "ImageUpload"
 * namespace for photo errors.
 */
export async function createGroupAction(formData: FormData, locale: string): Promise<ActionResult> {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return fail("UNAUTHORIZED");
  }

  const membersCount = Number(formData.get("membersCount")) || 1;
  const groupGender = (formData.get("groupGender") as Gender) || "MIXED";
  const ageMin = Number(formData.get("ageMin")) || 18;
  const ageMax = Number(formData.get("ageMax")) || 30;

  const searchGender = (formData.get("searchGender") as Gender) || "MIXED";
  const searchAgeMin = Number(formData.get("searchAgeMin")) || 18;
  const searchAgeMax = Number(formData.get("searchAgeMax")) || 35;
  const maxDistance = Number(formData.get("maxDistance")) || 10;

  // S4: coordinates are validated and coarsened to STORED_PRECISION_DECIMALS
  // here, on the server. Missing or invalid values store no location.
  const location = parseCoarseLocation(formData.get("latitude"), formData.get("longitude"));
  const latitude = location?.latitude ?? null;
  const longitude = location?.longitude ?? null;

  const publicProfile = ["true", "on", "1"].includes(
    String(formData.get("publicProfile")),
  );

  const description = String(formData.get("description") || "");

  const instagram: string[] = [];
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("instagram")) {
      instagram.push(String(value).replace("@", ""));
    }
  }

  const requested = ExistingPhotosSchema.safeParse(formData.getAll("existingPhotos"));
  if (!requested.success) return fail("VALIDATION", "invalid");
  const requestedSet = new Set(requested.data);

  const validFiles = formData
    .getAll("photos")
    .filter((file): file is File => typeof file === "object" && file !== null && file.size > 0);

  let existing: { id: string; photos: string[]; latitude: number | null; longitude: number | null } | null;
  try {
    existing = await prisma.group.findUnique({
      where: { userId },
      select: { id: true, photos: true, latitude: true, longitude: true },
    });
  } catch (error) {
    console.error("Error loading group for edit:", error);
    return fail("INTERNAL");
  }

  // Keep = stored photos the client asked to keep, in their stored order.
  // Never trust the client list itself (S6).
  const storedPhotos = existing?.photos ?? [];
  const keptPhotos = storedPhotos.filter((stored) => requestedSet.has(stored) || requestedSet.has(toPublicUrl(stored)));
  const keptValues = new Set(keptPhotos.flatMap((p) => [p, toPublicUrl(p)]));
  const ignoredCount = [...requestedSet].filter((value) => !keptValues.has(value)).length;
  if (ignoredCount > 0) {
    console.warn(`[group] Ignored ${ignoredCount} existingPhotos value(s) not stored on the caller's group (user ${userId}).`);
  }

  if (keptPhotos.length === 0 && validFiles.length === 0) {
    return fail("VALIDATION", "photoRequired");
  }

  if (keptPhotos.length + validFiles.length > MAX_GROUP_PHOTOS) {
    return fail("VALIDATION", "tooManyPhotos");
  }

  // New groups get their id up front so photos land under groups/{groupId}/.
  const groupId = existing?.id ?? crypto.randomUUID();

  // Every change of the stored (coarsened) location counts against
  // LOCATION_CHANGE_LIMIT_PER_DAY for this group. Checked before any upload.
  const locationChanged =
    location !== null && (existing?.latitude !== latitude || existing?.longitude !== longitude);
  if (
    locationChanged &&
    LOCATION_CHANGE_LIMIT_PER_DAY > 0 &&
    !(await checkRateLimit("locationChange", { identifier: groupId }))
  ) {
    return fail("RATE_LIMITED", "locationChangeLimit");
  }

  // Validate and re-encode everything before any storage write.
  let processed;
  try {
    processed = await Promise.all(
      validFiles.map(async (file) => processImage(await validateImage(file))),
    );
  } catch (error) {
    if (error instanceof ImageValidationError) return fail("VALIDATION", error.messageKey);
    console.error("Group photo processing error:", error);
    return fail("INTERNAL", "uploadFailed");
  }

  const newKeys = processed.map((image) => newGroupPhotoKey(groupId, image.extension));

  const uploads = await Promise.allSettled(
    processed.map((image, i) => upload(newKeys[i], image.buffer, image.contentType)),
  );
  if (uploads.some((result) => result.status === "rejected")) {
    console.error(
      "Group photo upload error:",
      uploads.filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason),
    );
    await cleanupStorage(
      { paths: newKeys.filter((_, i) => uploads[i].status === "fulfilled") },
      `rollback of failed group photo upload (group ${groupId})`,
    );
    return fail("INTERNAL", "uploadFailed");
  }

  const finalPhotos = [...keptPhotos, ...newKeys];

  try {
    // upsert handles both initial group creation and subsequent edits in a single
    // atomic operation. A user can only have one group (1:1 DB relation), so
    // separate create/update paths would risk race conditions on concurrent requests.
    await prisma.group.upsert({
      where: { userId: userId },
      update: {
        membersCount,
        gender: groupGender,
        ageMin,
        ageMax,
        searchGender,
        searchAgeMin,
        searchAgeMax,
        maxDistance,
        publicProfile,
        description,
        instagram,
        photos: finalPhotos,
        // Geolocation is optional at profile creation time. Groups without
        // coordinates are skipped by the discovery distance filter.
        latitude,
        longitude,
      },
      create: {
        id: groupId,
        userId: userId,
        membersCount,
        gender: groupGender,
        ageMin,
        ageMax,
        searchGender,
        searchAgeMin,
        searchAgeMax,
        maxDistance,
        publicProfile,
        description,
        instagram,
        photos: finalPhotos,
        latitude,
        longitude,
      },
    });
  } catch (error) {
    console.error("Error saving group:", error);
    // The new objects are not referenced by any row; remove them again.
    await cleanupStorage({ paths: newKeys }, `rollback of group photos after failed save (group ${groupId})`);
    return fail("INTERNAL");
  }

  // B15: the DB no longer references removed/replaced photos; delete the ones
  // this group owns (never anything copied from elsewhere).
  const removed = storedPhotos.filter(
    (stored) => !keptPhotos.includes(stored) && isOwnedGroupPhotoKey(stored, groupId, userId),
  );
  if (removed.length > 0) {
    await cleanupStorage({ paths: removed }, `removed photos of group ${groupId}`);
  }

  redirect(`/${locale}/search-groups`);
}

/**
 * Executes a partial account teardown by deleting only the user's host group and associated media.
 * Relies on Prisma's Cascade constraints to automatically prune related Likes, Blocks, and Chats.
 * The underlying User account and authentication session remain fully intact, reverting the user to spectator mode.
 * Storage cleanup (the group's prefix plus its owned legacy keys) runs after the
 * DB delete and is awaited; failures are logged with the remaining keys and do
 * not fail the action.
 * @returns Object indicating operation success or authorization failure.
 */
export async function deleteGroupAction() {
  let userId: string;
  try {
    userId = await requireUserId();
  } catch {
    return { error: "Unauthorized" };
  }

  try {
    const group = await prisma.group.findUnique({
      where: { userId },
      select: { id: true, photos: true },
    });

    if (!group) return { error: "No group found to delete" };

    await prisma.group.delete({
      where: { userId },
    });

    await cleanupStorage(
      {
        prefixes: [groupPrefix(group.id)],
        paths: group.photos.filter(
          (key) => isOwnedGroupPhotoKey(key, group.id, userId) && !key.startsWith(groupPrefix(group.id)),
        ),
      },
      `deleted group ${group.id}`,
    );

    return { success: true };
  } catch (error) {
    console.error("Error deleting group:", error);
    return { error: "Failed to delete group" };
  }
}
