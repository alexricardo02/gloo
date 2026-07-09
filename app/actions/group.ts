"use server";

import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { Gender } from "@prisma/client";
import { cookies } from "next/headers";
import { supabase } from "@/lib/supabase";

export async function getGroupByUser() {
  try {
    const cookieStore = await cookies();
    const userId = cookieStore.get("gloo_user_id")?.value;

    if (!userId) return null;

    const group = await prisma.group.findUnique({
      where: { userId: userId },
    });

    if (!group) return null;

    return {
      ...group,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    };
  } catch (error) {
    console.error("Connection error in getGroupByUser:", error);
    return null;
  }
}

export async function createGroupAction(formData: FormData, locale: string) {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) throw new Error("User not found or unauthorized");

  const membersCount = Number(formData.get("membersCount")) || 1;
  const groupGender = (formData.get("groupGender") as Gender) || "MIXED";
  const ageMin = Number(formData.get("ageMin")) || 18;
  const ageMax = Number(formData.get("ageMax")) || 30;

  const searchGender = (formData.get("searchGender") as Gender) || "MIXED";
  const searchAgeMin = Number(formData.get("searchAgeMin")) || 18;
  const searchAgeMax = Number(formData.get("searchAgeMax")) || 35;
  const maxDistance = Number(formData.get("maxDistance")) || 10;

  const latitude = parseFloat(formData.get("latitude") as string);
  const longitude = parseFloat(formData.get("longitude") as string);

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

  const keptPhotos = formData.getAll("existingPhotos") as string[];
  const newPhotos: string[] = [];
  const uploadedFiles = formData.getAll("photos") as File[];

  const hasValidNewPhotos = uploadedFiles.some(
    (file) => file && typeof file === "object" && file.size > 0,
  );

  if (keptPhotos.length === 0 && !hasValidNewPhotos) {
    throw new Error("At least one photo is required.");
  }

  const uploadPromises = uploadedFiles.map(async (file) => {
    if (file && typeof file === "object" && file.size > 0) {
      const fileExt = file.name.split(".").pop();
      const fileName = `${userId}-group-${crypto.randomUUID()}.${fileExt}`;
      const filePath = `groups/${fileName}`;

      // Firefox serializes FormData File objects without a reliable content-type.
      // Converting to a Buffer with explicit contentType fixes browser incompatibility.
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);

      const { error: uploadError } = await supabase.storage
        .from("gloo-images")
        .upload(filePath, buffer, {
          cacheControl: "3600",
          // upsert: false prevents accidental overwrite if two requests arrive
          // simultaneously. Each photo gets a UUID-based filename so uploads
          // from different sessions never collide even on the same account.
          upsert: false,
          contentType: file.type || "image/jpeg",
        });

      if (uploadError) {
        console.error("Group photo upload error:", uploadError);
        return null;
      }

      const { data } = supabase.storage
        .from("gloo-images")
        .getPublicUrl(filePath);

      return data.publicUrl;
    }
    return null;
  });

  const uploadedUrls = (await Promise.all(uploadPromises)).filter(
    Boolean,
  ) as string[];

  const finalPhotos = [...keptPhotos, ...uploadedUrls];

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
      // Geolocation is optional at profile creation time. Storing null instead
      // of NaN ensures the DB accepts the value and the discovery distance
      // filter can safely skip groups without coordinates.
      latitude: isNaN(latitude) ? null : latitude,
      longitude: isNaN(longitude) ? null : longitude,
    },
    create: {
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
      latitude: isNaN(latitude) ? null : latitude,
      longitude: isNaN(longitude) ? null : longitude,
    },
  });

  redirect(`/${locale}/search-groups`);
}

/**
 * Executes a partial account teardown by deleting only the user's host group and associated media.
 * Relies on Prisma's Cascade constraints to automatically prune related Likes, Blocks, and Chats.
 * The underlying User account and authentication session remain fully intact, reverting the user to spectator mode.
 * * @throws Will silently fail and log if Supabase storage deletion encounters an error, preventing UI blocking.
 * @returns Object indicating operation success or authorization failure.
 */
export async function deleteGroupAction() {
  const cookieStore = await cookies();
  const userId = cookieStore.get("gloo_user_id")?.value;

  if (!userId) return { error: "Unauthorized" };

  try {
    const group = await prisma.group.findUnique({
      where: { userId },
      select: { id: true, photos: true },
    });

    if (!group) return { error: "No group found to delete" };

    if (group.photos && group.photos.length > 0) {
      const filesToDelete = group.photos
        .map((photoUrl) => {
          const urlParts = photoUrl.split("/");
          const fileName = urlParts.pop();
          return fileName ? `groups/${fileName}` : null;
        })
        .filter((file): file is string => file !== null);

      if (filesToDelete.length > 0) {
        await supabase.storage.from("gloo-images").remove(filesToDelete);
      }
    }

    await prisma.group.delete({
      where: { userId },
    });

    return { success: true };
  } catch (error) {
    console.error("Error deleting group:", error);
    return { error: "Failed to delete group" };
  }
}
