/**
 * Pure helpers for Supabase Storage object keys (no I/O, no secrets).
 *
 * The database stores object KEYS (e.g. "groups/<groupId>/<uuid>.webp"), never
 * URLs. Keys are only ever generated on the server by the builders below;
 * nothing here derives a key from client input.
 *
 * Key layouts:
 *   groups/{groupId}/{uuid}.webp   group photos (current)
 *   users/{userId}/{uuid}.webp     profile image (current)
 *   groups/{userId}-group-{uuid}.{ext}   legacy flat group photo
 *   profiles/{userId}-{timestamp}.{ext}  legacy flat profile image
 */

/** Default bucket name when SUPABASE_STORAGE_BUCKET is unset (production). */
export const DEFAULT_BUCKET = "gloo-images";

// One path segment: ids (cuid / uuid) and generated filenames only.
const SEGMENT = "[A-Za-z0-9_-]+";
const FILENAME = "[A-Za-z0-9_-]+\\.(?:webp|jpe?g|png|gif)";

const CURRENT_KEY = new RegExp(`^(?:groups|users)/${SEGMENT}/${FILENAME}$`);
const LEGACY_KEY = new RegExp(`^(?:groups|profiles)/${FILENAME}$`);
const PREFIX = new RegExp(`^(?:groups|users)/${SEGMENT}/$`);

/** True when `value` is a well-formed object key in one of the known layouts. */
export function isStorageKey(value: unknown): value is string {
  return typeof value === "string" && (CURRENT_KEY.test(value) || LEGACY_KEY.test(value));
}

/** True for a deletable folder prefix: "groups/{id}/" or "users/{id}/". */
export function isStoragePrefix(value: unknown): value is string {
  return typeof value === "string" && PREFIX.test(value);
}

function assertId(id: string, label: string): void {
  if (!new RegExp(`^${SEGMENT}$`).test(id)) throw new Error(`Invalid ${label} for a storage path`);
}

export function groupPrefix(groupId: string): string {
  assertId(groupId, "groupId");
  return `groups/${groupId}/`;
}

export function userPrefix(userId: string): string {
  assertId(userId, "userId");
  return `users/${userId}/`;
}

export function newGroupPhotoKey(groupId: string, ext = "webp"): string {
  return `${groupPrefix(groupId)}${crypto.randomUUID()}.${ext}`;
}

export function newUserImageKey(userId: string, ext = "webp"): string {
  return `${userPrefix(userId)}${crypto.randomUUID()}.${ext}`;
}

/**
 * True when `key` is a group photo this group/owner may delete: anything under
 * the group's own prefix, or a legacy flat key the owner uploaded
 * ("groups/{userId}-group-*"). Values copied from other groups (possible
 * before S6 was fixed) are rejected, so cleanup can never delete them.
 */
export function isOwnedGroupPhotoKey(key: string, groupId: string, userId: string): boolean {
  if (!isStorageKey(key)) return false;
  if (key.startsWith(`groups/${groupId}/`)) return true;
  return LEGACY_KEY.test(key) && key.startsWith(`groups/${userId}-group-`);
}

/** True when `key` is a profile image owned by `userId` (current or legacy layout). */
export function isOwnedUserImageKey(key: string, userId: string): boolean {
  if (!isStorageKey(key)) return false;
  if (key.startsWith(`users/${userId}/`)) return true;
  return LEGACY_KEY.test(key) && key.startsWith(`profiles/${userId}-`);
}

/**
 * Strict parser: returns the object key when `url` is a public object URL of
 * `bucket` on a supabase.co project, else null. Mirrors the regex used by the
 * storage_object_keys data migration (keep both in sync).
 */
export function keyFromBucketPublicUrl(url: string, bucket: string = DEFAULT_BUCKET): string | null {
  const escapedBucket = bucket.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(
    `^https://[a-z0-9]+\\.supabase\\.co/storage/v1/object/public/${escapedBucket}/(.+)$`,
  ).exec(url);
  const key = match?.[1];
  return key && isStorageKey(key) ? key : null;
}

/** Thrown by lib/storage.ts; `paths` lists the objects the operation did not complete. */
export class StorageError extends Error {
  constructor(
    message: string,
    readonly paths: string[],
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
