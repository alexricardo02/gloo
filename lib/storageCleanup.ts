/**
 * Best-effort, awaited storage cleanup (B15).
 *
 * Callers run this AFTER the database change it belongs to has succeeded, so a
 * storage failure can never leave the DB pointing at deleted objects. It never
 * throws: failures are logged with the exact keys (or prefixes) that remain, so
 * they can be removed later (see scripts/storage-orphans.mjs).
 */

import { remove, removePrefix } from "@/lib/storage";
import { StorageError } from "@/lib/storageKeys";

export interface CleanupTarget {
  /** Folder prefixes to empty, e.g. "groups/{groupId}/". */
  prefixes?: string[];
  /** Individual object keys. */
  paths?: string[];
}

export async function cleanupStorage(
  target: CleanupTarget,
  context: string,
): Promise<{ remaining: string[] }> {
  const remaining: string[] = [];
  const errors: unknown[] = [];

  for (const prefix of target.prefixes ?? []) {
    try {
      await removePrefix(prefix);
    } catch (error) {
      errors.push(error);
      remaining.push(...(error instanceof StorageError && error.paths.length ? error.paths : [`${prefix}*`]));
    }
  }

  const paths = [...new Set(target.paths ?? [])];
  if (paths.length > 0) {
    try {
      await remove(paths);
    } catch (error) {
      errors.push(error);
      remaining.push(...(error instanceof StorageError && error.paths.length ? error.paths : paths));
    }
  }

  if (remaining.length > 0) {
    console.error(
      `[storage] ${context}: ${remaining.length} object(s) could not be deleted and remain in the bucket:`,
      remaining,
      errors,
    );
  }
  return { remaining };
}
