# Live updates and database access (Pack 5)

## TL;DR

- The browser never talks to the database or to Supabase Realtime. There is no
  client-side Supabase client any more (`lib/supabase.ts` was deleted).
- Live data comes from **authenticated GET route handlers** that the browser
  polls (`LIVE_UPDATES = smart-polling`).
- Every table in the `public` schema has **Row Level Security enabled with no
  policies**, and the `anon` / `authenticated` roles have **no privileges** on
  any of them (`RLS = deny-all`, migration `*_rls_deny_all`).
- So the public anon key (which is still embedded in nothing the app ships,
  and may still exist in your Supabase project) grants **no data access**:
  not over the REST API (PostgREST), not over Realtime.

## Why this was needed (S2)

Before Pack 5 the browser created a Supabase client with
`NEXT_PUBLIC_SUPABASE_ANON_KEY` and subscribed to **unfiltered**
`postgres_changes` on `Message`, `Event`, `EventAttendance`, `GroupLike` and
`GroupBlock`. That only works if the `anon` role can `SELECT` those tables, and
no migration ever enabled RLS. Anyone who copied the anon key out of the
JavaScript bundle could therefore read every chat message (and every other
table) through `https://<project>.supabase.co/rest/v1/...` or subscribe to all
changes over the Realtime websocket.

## Final design

### Reads: authenticated route handlers

| Route | Used by | Poll interval |
| --- | --- | --- |
| `GET /api/chats?cursor=&limit=` | chat list | 20 s (`LIST_POLL_MS`) |
| `GET /api/chats/[chatId]` | open chat header | once |
| `GET /api/chats/[chatId]/messages` (`?after=<id>` / `?before=<id>`) | open chat | 3 s (`CHAT_POLL_MS`) |
| `GET /api/unread` | navigation badge | 20 s (`LIST_POLL_MS`) |
| `GET /api/likes` | "liked me" tab | 60 s (`SLOW_POLL_MS`) |
| `GET /api/map` | map | 60 s (`SLOW_POLL_MS`) |

Every handler resolves the session server-side (`requireUserId`, hashed
session token, see `lib/session.ts`), checks chat participation and blocks
(`getAccessibleChat`, Pack 4), and returns **explicit selects only**: no other
user's id, no read markers of the other participant, no private fields.
Missing, foreign and blocked chats all answer `404` (no existence oracle);
no session answers `401`. Responses are `Cache-Control: private, no-store`.
`/api/map` also serves signed-out guests, but only the venues.

Polling (`lib/poller.ts`, `lib/usePolling.ts`):

- pauses while `document.visibilityState === "hidden"`, refetches immediately
  on `visibilitychange` → visible and on window `focus`;
- never overlaps requests (next run is scheduled after the previous finished);
- exponential back-off on errors (capped at 5 min), stops on `401`;
- aborts the in-flight request and stops on unmount;
- refetches immediately after the user's own actions (send, like, RSVP, …).

Messages use keyset pagination on `(createdAt, id)` (index
`Message(chatId, createdAt DESC)`), 50 per page; the open chat only asks for
messages newer than the newest one it shows.

Writes stay server actions (`sendMessage`, `markChatRead`, `toggleLike`, map
actions), which Next.js protects against CSRF.

### Database: deny-all RLS

Migration `prisma/migrations/*_rls_deny_all/migration.sql`:

1. `ENABLE ROW LEVEL SECURITY` on every table in `public` (including
   `_prisma_migrations`) and drops every existing policy there.
2. `REVOKE ALL` on all tables and sequences in `public` from `anon` and
   `authenticated`.
3. `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES / SEQUENCES
   FROM anon, authenticated`, so tables created later by the migration role
   are not exposed automatically.
4. Removes all `public` tables from the `supabase_realtime` publication.

Role- and publication-specific steps are wrapped in `DO` blocks that check the
role/publication exists, so the migration also runs on plain local Postgres.
The `storage` and `realtime` schemas are not touched (bucket policies: Pack 3,
`docs/supabase-storage-policies.sql`).

**Prisma keeps working**: it connects as the owner of the tables (the
`postgres` role on Supabase, `party_admin` locally). Table owners bypass RLS
unless `FORCE ROW LEVEL SECURITY` is set, which this migration does not do.
If you ever point `DATABASE_URL` at a different, non-owner role, it will see
no rows: give that role `BYPASSRLS` or ownership instead of adding policies.

Caveats:

- Default privileges only cover objects created by the role that ran the
  migration. A table created by another role (e.g. in the Supabase dashboard
  table editor, which uses `supabase_admin`) gets Supabase's default grants.
  Create tables through Prisma migrations only, or rerun the migration.
- Functions in `public` are not covered (there are none today). If you add
  one, `REVOKE EXECUTE ... FROM anon, authenticated` in the same migration.

### Test databases

`prisma db push` (used for the test DBs) does not run raw-SQL migrations, so
`npm run test:db:prepare` and Playwright's global setup apply the RLS
migration afterwards (`tests/applyRlsLockdown.ts`). All tests run with RLS on.
`tests/integration/rlsMigration.test.ts` simulates Supabase's roles and
default grants inside a rolled-back transaction and checks that the migration
removes all of it.

## Environment variables

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: **no longer used** by the app. Remove it
  from Vercel / your hosting env and from local `.env` files.
- `NEXT_PUBLIC_SUPABASE_URL`: still needed (server-side storage and public
  image URLs, `lib/storage.ts`).
- `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_STORAGE_BUCKET`: unchanged (server
  only).

## Manual verification after deploying

Run these **after** the migration is deployed, from your own machine. Use the
**anon** key (Dashboard → Project Settings → API Keys → `anon` / publishable),
never the service-role key.

```bash
export SUPABASE_URL="https://<project-ref>.supabase.co"
export ANON_KEY="<anon key>"
```

### 1. REST API (PostgREST) must not return rows

```bash
for table in User Message Chat Session GroupLike Event EventAttendance GroupBlock; do
  printf '%-16s ' "$table"
  curl -s -o /dev/null -w '%{http_code}\n' \
    "$SUPABASE_URL/rest/v1/$table?select=*&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
done
```

Expected: `401` or `403` (permission denied) for every table, never `200`.
To see the body of one:

```bash
curl -s "$SUPABASE_URL/rest/v1/Message?select=*&limit=1" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"
# → {"code":"42501", ... "message":"permission denied for table Message"}
```

A `200` with `[]` would mean RLS is on but the grant is still there; a `200`
with rows means the migration did not run.

### 2. Realtime must not deliver changes

Save as `realtime-check.mjs` in an empty folder (`npm i @supabase/supabase-js`
there, not in the app) and run `node realtime-check.mjs`:

```js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL, process.env.ANON_KEY);
let received = 0;

supabase
  .channel("rls-check")
  .on("postgres_changes", { event: "*", schema: "public", table: "Message" }, () => received++)
  .on("postgres_changes", { event: "*", schema: "public", table: "GroupLike" }, () => received++)
  .subscribe((status, err) => console.log("status:", status, err?.message ?? ""));

console.log("Listening for 60 s: now send a chat message and like a group in the app...");
setTimeout(() => {
  console.log(received === 0 ? "OK: no changes received" : `FAIL: received ${received} changes`);
  process.exit(received === 0 ? 0 : 1);
}, 60_000);
```

While it runs, send a message between two test accounts in the deployed app.
Expected: `OK: no changes received` (the subscription may also report an
error, which is fine).

### 3. SQL checks (Supabase SQL editor)

```sql
-- every public table has RLS on (expect no rows)
select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;

-- no policies in public (expect no rows)
select * from pg_policies where schemaname = 'public';

-- no grants to anon/authenticated (expect no rows)
select grantee, table_name, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and grantee in ('anon', 'authenticated');

-- no public table in the realtime publication (expect no rows)
select * from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public';
```

### 4. In the Supabase dashboard

- Database → Publications → `supabase_realtime`: no `public` tables listed.
- Table editor: every table shows "RLS enabled" with 0 policies.
