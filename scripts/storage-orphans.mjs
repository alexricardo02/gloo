#!/usr/bin/env node
/**
 * Lists (and optionally deletes) Supabase Storage objects that no database row
 * references: orphans left behind by failed cleanups or by data written before
 * the storage lockdown.
 *
 *   node scripts/storage-orphans.mjs                 # dry run: print orphans only
 *   node scripts/storage-orphans.mjs --delete        # delete them
 *
 * Safety:
 *  - Dry run by default. Nothing is deleted without --delete.
 *  - Refuses to run when DATABASE_URL is not localhost/127.0.0.1/::1 unless
 *    --i-know-this-is-production is passed.
 *  - Refuses --delete when the database is local but the bucket is the
 *    production bucket ("gloo-images"): a local DB does not know production
 *    rows, so every production photo would look orphaned.
 *  - Skips objects younger than 1 hour (an upload may still be mid-request).
 *
 * Env (read from the process, then from .env if present):
 *   DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *   SUPABASE_STORAGE_BUCKET (default "gloo-images")
 *
 * This CLI is the only code besides lib/storage.ts that calls the Storage API.
 */
import fs from "node:fs";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_BUCKET = "gloo-images";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MIN_AGE_MS = 60 * 60 * 1000;
const PAGE_SIZE = 1000;
// Keep in sync with keyFromBucketPublicUrl() in lib/storageKeys.ts.
const BUCKET_URL =
  /^https:\/\/[a-z0-9]+\.supabase\.co\/storage\/v1\/object\/public\/([^/]+)\/((?:groups|profiles|users)\/.+)$/;

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((a) => !["--delete", "--i-know-this-is-production", "--help"].includes(a));
if (args.has("--help") || unknown.length > 0) {
  if (unknown.length) console.error(`Unknown argument(s): ${unknown.join(" ")}`);
  console.log("Usage: node scripts/storage-orphans.mjs [--delete] [--i-know-this-is-production]");
  process.exit(unknown.length ? 1 : 0);
}
const doDelete = args.has("--delete");
const productionOk = args.has("--i-know-this-is-production");

if (fs.existsSync(".env") && typeof process.loadEnvFile === "function") process.loadEnvFile(".env");

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`[storage-orphans] ${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const supabaseUrl = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || PRODUCTION_BUCKET;

let dbHost;
try {
  dbHost = new URL(databaseUrl).hostname;
} catch {
  console.error("[storage-orphans] DATABASE_URL is not a valid URL.");
  process.exit(1);
}
const localDb = LOCAL_HOSTS.has(dbHost);

if (!localDb && !productionOk) {
  console.error(
    `[storage-orphans] DATABASE_URL points at "${dbHost}", which is not local. ` +
      "Re-run with --i-know-this-is-production if this is intended.",
  );
  process.exit(1);
}
if (doDelete && localDb && bucket === PRODUCTION_BUCKET) {
  console.error(
    `[storage-orphans] Refusing --delete: the database is local but the bucket is the production bucket ` +
      `"${PRODUCTION_BUCKET}". Set SUPABASE_STORAGE_BUCKET to your dev bucket.`,
  );
  process.exit(1);
}

console.log(`[storage-orphans] database host: ${dbHost}${localDb ? " (local)" : " (REMOTE)"}`);
console.log(`[storage-orphans] bucket: ${bucket}`);
console.log(`[storage-orphans] mode: ${doDelete ? "DELETE" : "dry run"}`);

/** Stored value -> object key in this bucket, or null for external/local values. */
function toKey(value) {
  if (!value) return null;
  const match = BUCKET_URL.exec(value);
  if (match) return match[1] === bucket ? match[2] : null;
  return /^(groups|users|profiles)\//.test(value) ? value : null;
}

async function referencedKeys() {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const photos = await client.query('SELECT unnest("photos") AS v FROM "Group"');
    const images = await client.query('SELECT "image" AS v FROM "User" WHERE "image" IS NOT NULL');
    const keys = new Set();
    for (const row of [...photos.rows, ...images.rows]) {
      const key = toKey(row.v);
      if (key) keys.add(key);
    }
    return keys;
  } finally {
    await client.end();
  }
}

const storage = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
}).storage.from(bucket);

async function listAll(folder = "") {
  const objects = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await storage.list(folder, { limit: PAGE_SIZE, offset });
    if (error) throw error;
    for (const item of data ?? []) {
      const path = folder ? `${folder}/${item.name}` : item.name;
      if (item.id) objects.push({ path, createdAt: item.created_at ? Date.parse(item.created_at) : 0 });
      else objects.push(...(await listAll(path))); // folder placeholder
    }
    if (!data || data.length < PAGE_SIZE) break;
  }
  return objects;
}

const [referenced, objects] = await Promise.all([referencedKeys(), listAll()]);
const now = Date.now();
const orphans = objects.filter((o) => !referenced.has(o.path) && now - o.createdAt >= MIN_AGE_MS);
const tooNew = objects.filter((o) => !referenced.has(o.path) && now - o.createdAt < MIN_AGE_MS).length;

console.log(
  `[storage-orphans] ${objects.length} object(s) in bucket, ${referenced.size} referenced key(s) in DB, ` +
    `${orphans.length} orphan(s)${tooNew ? `, ${tooNew} recent unreferenced object(s) skipped` : ""}.`,
);
for (const o of orphans) console.log(`  ${o.path}`);

if (!doDelete) {
  if (orphans.length) console.log("[storage-orphans] Dry run: nothing deleted. Re-run with --delete to remove them.");
  process.exit(0);
}

let deleted = 0;
const paths = orphans.map((o) => o.path);
for (let i = 0; i < paths.length; i += 100) {
  const chunk = paths.slice(i, i + 100);
  const { error } = await storage.remove(chunk);
  if (error) {
    console.error(`[storage-orphans] Delete failed; these remain:`, paths.slice(i), error);
    process.exit(1);
  }
  deleted += chunk.length;
}
console.log(`[storage-orphans] Deleted ${deleted} orphan(s).`);
