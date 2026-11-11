import "server-only";

/**
 * The ONLY module that talks to Supabase Storage (S7).
 *
 * Writes use the service-role key, which never leaves the server
 * (`server-only` makes importing this from a Client Component a build error).
 * The bucket allows no anon/authenticated writes; see
 * docs/supabase-storage-policies.sql.
 *
 * Env:
 *   NEXT_PUBLIC_SUPABASE_URL   project URL (also used for public object URLs)
 *   SUPABASE_SERVICE_ROLE_KEY  full-access secret, server only
 *   SUPABASE_STORAGE_BUCKET    bucket name, default "gloo-images" (production).
 *                              Local dev / E2E must use a separate bucket.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_BUCKET, StorageError, isStorageKey, isStoragePrefix } from "@/lib/storageKeys";

const CACHE_CONTROL_SECONDS = "3600";
// Supabase caps list() at 1000 entries per page and remove() per request.
const PAGE_SIZE = 1000;

let client: SupabaseClient | null = null;
let warnedAboutBucket = false;

export function bucketName(): string {
  return process.env.SUPABASE_STORAGE_BUCKET?.trim() || DEFAULT_BUCKET;
}

function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set");
  return url.replace(/\/+$/, "");
}

function bucket() {
  if (!client) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
    if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set; storage writes are disabled");
    client = createClient(supabaseUrl(), key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  const name = bucketName();
  if (process.env.NODE_ENV !== "production" && name === DEFAULT_BUCKET && !warnedAboutBucket) {
    warnedAboutBucket = true;
    console.warn(
      `[storage] Writing to the production bucket "${DEFAULT_BUCKET}" outside production. ` +
        `Set SUPABASE_STORAGE_BUCKET to a dev bucket (e.g. "gloo-images-dev").`,
    );
  }
  return client.storage.from(name);
}

/** Uploads a new object. Never overwrites (keys are server-generated UUIDs). */
export async function upload(path: string, body: Buffer, contentType: string): Promise<void> {
  if (!isStorageKey(path)) throw new StorageError("Refusing to upload to an invalid key", [path]);
  try {
    const { error } = await bucket().upload(path, body, {
      contentType,
      upsert: false,
      cacheControl: CACHE_CONTROL_SECONDS,
    });
    if (error) throw error;
  } catch (cause) {
    throw new StorageError("Upload failed", [path], cause);
  }
}

/** Deletes objects by key. Throws StorageError listing every key that may remain. */
export async function remove(paths: string[]): Promise<void> {
  const keys = [...new Set(paths)];
  const invalid = keys.filter((p) => !isStorageKey(p));
  if (invalid.length > 0) throw new StorageError("Refusing to delete invalid keys", invalid);

  for (let i = 0; i < keys.length; i += PAGE_SIZE) {
    const chunk = keys.slice(i, i + PAGE_SIZE);
    try {
      const { error } = await bucket().remove(chunk);
      if (error) throw error;
    } catch (cause) {
      throw new StorageError("Delete failed", keys.slice(i), cause);
    }
  }
}

/**
 * Deletes every object directly under `prefix` ("groups/{id}/" or
 * "users/{id}/"; anything broader is refused). Returns the deleted keys.
 */
export async function removePrefix(prefix: string): Promise<string[]> {
  if (!isStoragePrefix(prefix)) throw new StorageError("Refusing to delete an invalid prefix", [prefix]);

  const keys: string[] = [];
  try {
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error } = await bucket().list(prefix.slice(0, -1), { limit: PAGE_SIZE, offset });
      if (error) throw error;
      // Folder placeholders have no id; our layout has no nested folders.
      for (const item of data ?? []) if (item.id) keys.push(`${prefix}${item.name}`);
      if (!data || data.length < PAGE_SIZE) break;
    }
  } catch (cause) {
    throw new StorageError("Listing failed", [`${prefix}*`], cause);
  }

  if (keys.length > 0) await remove(keys);
  return keys;
}

/** Public URL for an object key (the bucket is public-read). */
export function publicUrl(path: string): string {
  return `${supabaseUrl()}/storage/v1/object/public/${bucketName()}/${path}`;
}

/**
 * The single read-side helper: turns a stored value into something the UI can
 * render. Object keys become public URLs; anything else (legacy external URLs,
 * local "/images/..." assets) is returned unchanged.
 */
export function toPublicUrl(stored: string): string;
export function toPublicUrl(stored: string | null): string | null;
export function toPublicUrl(stored: string | null): string | null {
  if (stored == null) return null;
  return isStorageKey(stored) ? publicUrl(stored) : stored;
}

export function toPublicUrls(stored: readonly string[] | null | undefined): string[] {
  return (stored ?? []).map((s) => toPublicUrl(s));
}

/** Returns a copy of `group` with `photos` mapped to URLs. */
export function withPhotoUrls<T extends { photos: string[] }>(group: T): T;
export function withPhotoUrls<T extends { photos: string[] }>(group: T | null): T | null;
export function withPhotoUrls<T extends { photos: string[] }>(group: T | null): T | null {
  return group ? { ...group, photos: toPublicUrls(group.photos) } : null;
}

/** Returns a copy of `user` with `image` mapped to a URL. */
export function withImageUrl<T extends { image: string | null }>(user: T): T;
export function withImageUrl<T extends { image: string | null }>(user: T | null): T | null;
export function withImageUrl<T extends { image: string | null }>(user: T | null): T | null {
  return user ? { ...user, image: toPublicUrl(user.image) } : null;
}
