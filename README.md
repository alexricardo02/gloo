# GLOO 🎉

> **The best nights of your life.**

GLOO is a mobile-first social nightlife app that connects groups of people before and during a night out. Think of it as a Tinder-style discovery experience — but for groups, not individuals. Find other crews for a pre-party, discover events nearby, match with people who share your vibe, and break the ice with interactive party games.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
  - [Group Discovery & Matching](#group-discovery--matching)
  - [Real-Time Map & Pre-Parties](#real-time-map--pre-parties)
  - [Party Games](#party-games)
  - [Authentication & Security](#authentication--security)
  - [Internationalization (i18n)](#internationalization-i18n)
- [Local Development Setup & Installation Guide](#local-development-setup--installation-guide)
  - [Prerequisites](#1-prerequisites)
  - [Step-by-Step Installation](#2-step-by-step-installation)
- [Group Discovery](#group-discovery)
- [Email Flows](#email-flows)
- [Image Storage](#image-storage)
- [Deployment](#deployment)
  - [Environment Configuration & Twelve-Factor Compliance](#environment-configuration--twelve-factor-compliance)
  - [Required Environment Variables (`.env`)](#required-environment-variables-env)
- [License](#license)

---

## Overview

GLOO lets users create a group profile (with photos, description, age range, gender, and Instagram handles), then browse other nearby groups in a vertical snap-scroll carousel — similar to Instagram Stories meets TikTok. Each group card supports horizontal photo swiping. Users can like groups, send messages, and filter by distance and preferences.

The app supports a **guest mode** that lets anyone browse content without an account, with a contextual paywall that appears when they try to access restricted features.

---

## Core Features

###  Group Discovery & Matching
- Vertical snap-scroll carousel (TikTok/Reels style) with horizontal photo swiping.
- Mutual match system: A chat is only created when both groups like each other.
- Advanced filtering: Filter nearby groups by maximum distance (Haversine formula), age, and gender preferences.

###  Real-Time Map & Pre-Parties
- **Leaflet Integration:** Custom interactive map to explore the city's nightlife.
- **Venues:** See public bars and clubs, and check how many groups are attending tonight.
- **Live Pre-Parties:** Host a private pre-party. Other users can "Request Access".
- **Live updates (smart polling):** Chats, the unread badge, likes and the map refresh through authenticated API routes while the tab is visible. The browser has no database or Realtime access ([docs/realtime-security.md](docs/realtime-security.md)).

###  Party Games
- Built-in interactive games to break the ice: *Never Have I Ever*, *Most Likely To*, *Truth or Dare*, and *Busdriver*.
- Extensive, randomized content libraries for endless replayability.

###  Authentication & Security
- Custom Auth system (Bcrypt password hashing, secure HTTP-only cookies).
- Email verification and password recovery flows (currently suspended, see [Email Flows](#email-flows)).
- Change password while signed in (Account Settings); other devices are signed out.
- Guest Mode with limited access (Paywall integration).

###  Internationalization (i18n)
- Full multi-language support via `next-intl` (English, German, Spanish, French, Italian).
- Implemented using Next.js `proxy` routing conventions for robust localization.

---

## Local Development Setup & Installation Guide

Follow these step-by-step instructions to clone, configure, and execute the Gloo application environment locally on your machine.

### 1. Prerequisites
Ensure you have the following software architectures installed on your host system:
- **Node.js** (v18.x or v20.x LTS recommended)
- **npm** (comes bundled with Node.js)
- **Docker & Docker Compose** (Desktop client or daemon running)

---

### 2. Step-by-Step Installation

#### Step 2.1: Clone the Repository
Clone the project repository from the remote server and navigate into the root workspace directory:
```bash 
git clone https://github.com/alexricardo02/gloo-app.git
```
```bash 
cd gloo-app
```

#### Step 2.2: Install Package Dependencies
Install the required node modules and third-party dependencies declared in the package.json manifest:

```bash
npm install
```

#### Step 2.3: Environment Variables Configuration (.env)
The application relies on externalized parameters for connection orchestration. Duplicate the distributed template environment file to instantiate your local configuration:

```bash
cp .env.example .env
```

Open the newly created .env file in your preferred text editor and ensure the database connection strings are mapped to point to your local loopback address and the Docker mapped port (5433):

```bash
# Relational Database connection strings for local Docker environment
DATABASE_URL="postgresql://party_admin:party_password123@localhost:5433/gloo_db?schema=public"
DIRECT_URL="postgresql://party_admin:party_password123@localhost:5433/gloo_db?schema=public"

# Supabase project URL (server-side storage + public image URLs; dummy is fine locally)
NEXT_PUBLIC_SUPABASE_URL="https://dummy-project.supabase.co"

# Image uploads (see "Image Storage"). Use a SEPARATE dev bucket locally.
SUPABASE_SERVICE_ROLE_KEY=""
SUPABASE_STORAGE_BUCKET="gloo-images-dev"
```

#### Step 2.4: Spin Up the Containerized Database
Launch the isolated PostgreSQL server instance background service using Docker Compose:

```bash
docker-compose up -d
```

Step 2.5: Synchronize Relational Schema & Populate Seed Data
Apply the declarative database schema representations onto the active PostgreSQL container and execute the database seeder to pre-populate the tables with structured test profiles, groups, matches, and logs:

```bash
# Generate type-safe Prisma Client models
npx prisma generate
```
```bash
# Push the schema architecture into the Docker instance
npx prisma db push
```
```bash
# Populate database with mock data (Users, Groups, Messages)
npx prisma db seed
```

#### 3. Execution & Testing

##### Test database (required, one-time setup)
All test runners (Vitest and Playwright) use a **separate local test database** and never read `.env`. They load only `.env.test`, force `DATABASE_URL` / `DIRECT_URL` to `TEST_DATABASE_URL`, and **refuse to start** unless that URL's host is `localhost` / `127.0.0.1` / `::1` **and** the database name ends in `_test` (guard: `tests/assertSafeTestDb.ts`). They also abort if your shell exports a `DATABASE_URL` / `DIRECT_URL` that is not such a database. Your `gloo_db` dev data is never touched.

```bash
# 1. Create your test env file (gitignored)
cp .env.test.example .env.test

# 2. Create the gloo_test database inside the running gloo-db container
#    (equivalent: docker exec gloo-db createdb -U party_admin gloo_test)
npm run test:db:create

# 3. Sync the Prisma schema into the test database and apply the deny-all RLS
#    migration (re-run after schema changes)
npm run test:db:prepare
```

A brand-new Docker volume creates `gloo_test` (and `gloo_shadow`, used for `prisma migrate diff`) automatically via `docker/postgres-init/`. Existing volumes skip init scripts, so use step 2. The helper scripts need Node ≥ 22.18.

##### Unit & integration tests (Vitest)
```bash
npm run test          # watch mode
npm run test:ci       # single run
```
Integration tests (`tests/integration/`) write to and clean up `gloo_test`, so the container must be running.

Launching the Local Development Server
Boot up the Next.js compilation engine to serve the interactive web interface locally:

```Bash
npm run dev
```

Once initialized, open your web browser and navigate to:
http://localhost:3000

#### Running the End-to-End (E2E) Test Suite
The project includes a comprehensive suite of End-to-End tests powered by **Playwright** to simulate and verify real user flows (Authentication, Group Discovery, Match, Real-time Chat, and Map location).

Before running the E2E tests for the first time, ensure you install the required browser binaries:
```bash
npx playwright install
```

Playwright uses the same `.env.test` / `gloo_test` setup as above. Its global setup **wipes and recreates `gloo_test`** (`prisma db push --force-reset`) after re-checking the guard, and it starts its **own** dev server on port **3100** (override with `E2E_PORT`) connected to the test database, with `E2E_ENABLED=1` so the `/api/e2e` helper works. It never reuses an existing server, so **stop any `npm run dev` first** (Next 16 allows only one `next dev` per project). The `/api/e2e` helper returns 404 unless `NODE_ENV !== "production"`, `E2E_ENABLED=1`, the request comes from localhost, and the `x-e2e-secret` header matches `E2E_TEST_SECRET` (auto-generated per run if empty).

Execution Commands:

To execute the E2E tests in the background (headless mode), run:

```bash
npm run test:e2e      # same as: npx playwright test
```

To execute the E2E tests using the interactive UI (Highly recommended to visually inspect the automated browser interactions and state flows), run:

```bash
npx playwright test --ui
```


--- 

## Group Discovery

The discovery algorithm in `discoverGroups.ts`:

1. Reads the logged-in user's group (location + search preferences)
2. If the user has no group, returns a teaser preview (one random group, `hasNoGroup: true`)
3. Fetches candidates using a bounding box filter (`latitude ± distance/111`)
4. Refines with the **Haversine formula** in JavaScript for accurate circular radius
5. Applies age range filter (`group.ageMax >= searchAgeMin && group.ageMin <= searchAgeMax`)
6. Paginates in sets of 10

---

## Email Flows

Everything that depends on sending email sits behind one server-side flag, `EMAIL_FLOWS_ENABLED` (read in `lib/features.ts`). It is **off by default** (unset or anything other than `true` / `1`), because there is no email provider or verified sending domain yet.

While it is off:

- **Registration** creates the account (with `isVerified = false`; no verification token is created) and signs the user in straight away. An email or username that is already taken gets an "already registered" error.
- **Login** does not require a verified email. Password checks, rate limiting and sessions work as usual.
- **Email verification** is disabled: `/verify` redirects to the login page (or to the discovery feed when signed in).
- **Password recovery** is disabled: the "Forgot password?" link is hidden, `/forgotPassword` and `/resetPassword` show an "unavailable" notice, and the reset actions return `FEATURE_DISABLED` without creating a token.
- Nothing logs tokens, links or email addresses.
- Signed-in users can still **change their password** under Profile, Account Settings.

Setting `EMAIL_FLOWS_ENABLED=true` restores verification and password recovery unchanged (in development the links are printed to the terminal). Turning it on for real users requires an email provider and a verified sending domain, which is planned for later. Accounts created while the flag was off are still unverified, so they would need to verify (or be migrated) before login requires it again.

The flag is server-side only. Client components receive it as a prop from their server `page.tsx`; do not add a `NEXT_PUBLIC_` copy.

---

## Live Updates & Database Access

The browser never talks to the database or to Supabase Realtime. Reads go through authenticated `GET` route handlers (`app/api/chats`, `app/api/chats/[chatId]`, `app/api/chats/[chatId]/messages`, `app/api/unread`, `app/api/likes`, `app/api/map`) that check the session and chat participation on every request and return only the fields the UI shows. The client polls them with `lib/usePolling.ts`: paused while the tab is hidden, refetched on focus and after the user's own actions, no overlapping requests, back-off on errors. Writes stay server actions.

- **Unread counts:** `Chat.hostALastReadAt` / `hostBLastReadAt`. Messages not sent by me after my marker are unread; opening a chat moves the marker. The nav badge shows the number of chats with unread messages. The other participant's read state is never exposed.
- **Pagination:** messages are keyset-paginated on `(createdAt, id)` (50 per page, "load older" on scroll); the chat list is cursor-paginated.
- **Deny-all RLS:** migration `*_rls_deny_all` enables RLS on every `public` table with no policies and revokes all privileges from `anon` / `authenticated`, so the anon key grants no data access. Prisma connects as the table owner and is unaffected. The test DB scripts apply it after `db push`.

Design, env vars and post-deploy verification commands: [docs/realtime-security.md](docs/realtime-security.md).

## Image Storage

Group photos and profile images live in a **public-read** Supabase Storage bucket. Only the server writes to it.

- **One module.** `lib/storage.ts` (`server-only`) is the only app code that talks to Supabase Storage. It uses `SUPABASE_SERVICE_ROLE_KEY`, a full-access secret that exists only on the server. The browser has no Supabase client at all (see [Live Updates & Database Access](#live-updates--database-access)). The bucket has no insert/update/delete policies for `anon` or `authenticated` (see `docs/supabase-storage-policies.sql`).
- **Server-generated keys.** Uploads go to `groups/{groupId}/{uuid}.webp` and `users/{userId}/{uuid}.webp`. Nothing is derived from client input.
- **Validation and re-encoding.** Every upload passes the magic-byte check in `lib/validateImage.ts` (JPEG, PNG or WebP, max 5 MB; anything else, e.g. HEIC or GIF, gets a localized "unsupported type" error). `lib/imageProcessing.ts` then auto-rotates it, resizes it to at most 1600 px on the longest side, converts it to WebP (quality 80) and strips all metadata (EXIF incl. GPS, XMP, ICC). A group can have at most 6 photos.
- **The database stores object keys, not URLs.** `Group.photos` and `User.image` hold keys such as `groups/<id>/<uuid>.webp`. Actions turn them into public URLs on read (`toPublicUrl` / `withPhotoUrls` / `withImageUrl`), so the UI still receives full URLs. Values that are not keys (external URLs, `/images/...` assets) are passed through unchanged. Migration `20261111120000_storage_object_keys` converts existing public URLs of the `gloo-images` bucket to keys; preview it read-only with `docs/storage-object-keys-preview.sql`.
- **Ownership.** When a group is edited, the photos to keep are picked from the photos stored on the caller's own group; any other value sent by the client is ignored.
- **Deletion.** Photos that an edit removes or replaces, a replaced profile image, a deleted group's `groups/{groupId}/` folder, and all of a deleted account's objects are removed from storage **after** the database change succeeds. Storage failures never fail the action: they are logged with the exact keys that remain.

### Local development: use a separate bucket

Local dev and E2E must never touch production photos:

1. In the Supabase dashboard, create a **public** bucket named e.g. `gloo-images-dev`.
2. In your local `.env`, set `SUPABASE_STORAGE_BUCKET="gloo-images-dev"` and `SUPABASE_SERVICE_ROLE_KEY`.

If the bucket is left unset (the production default `gloo-images`) outside production, the server logs a warning on the first write. Unit/integration tests mock `lib/storage.ts`. The Playwright dev server is pinned to `SUPABASE_STORAGE_BUCKET=gloo-images-e2e` with an empty service-role key and the dummy Supabase URL from `.env.test`, so E2E runs cannot write to any real bucket.

### Orphaned objects

`scripts/storage-orphans.mjs` lists objects in the bucket that no `Group.photos` / `User.image` row references (it reads `DATABASE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_STORAGE_BUCKET` from the environment or `.env`):

```bash
node scripts/storage-orphans.mjs            # dry run (default): prints orphans, deletes nothing
node scripts/storage-orphans.mjs --delete   # deletes the listed orphans
```

- It refuses to run when `DATABASE_URL` is not `localhost` / `127.0.0.1` / `::1`, unless you pass `--i-know-this-is-production`.
- It refuses `--delete` when the database is local but the bucket is the production `gloo-images` (every production photo would look orphaned).
- It skips objects younger than one hour, since an upload may still be in flight.

---

## Deployment

Gloo is built as a highly available, decoupled Full-Stack Web Application optimized for mobile-first clients. The architecture follows modern cloud-native patterns split into three core layers:
- **Client/Server Layer:** Next.js 15 (App Router) serving as both the frontend user interface and the backend serverless execution environment (Server Actions).
- **Data Persistence Layer:** PostgreSQL database hosted on a managed Supabase instance for development/production, and containerized via Docker for local isolation and testing.
- **Live-Update Layer:** Authenticated `GET` route handlers under `app/api/` polled by the client (3 s for an open chat, 20 s for the chat list and unread badge, 60 s for the map and likes; paused while the tab is hidden). Supabase Realtime is not used; every `public` table has deny-all RLS. See [docs/realtime-security.md](docs/realtime-security.md).

### Environment Configuration & Twelve-Factor Compliance

In strict compliance with the **Twelve-Factor App methodology**, all environment-specific configurations are isolated from the application code and injected exclusively via environment variables.

### Required Environment Variables (`.env`)

To spin up the application infrastructure, the following variables must be defined in your root `.env` file:

| Variable Name | Description | Example Value / Context |
| :--- | :--- | :--- |
| `DATABASE_URL` | Connection pool URL used by Prisma Client for transactional runtime queries. | `postgresql://user:pass@host:6543/postgres` |
| `DIRECT_URL` | Direct connection URL bypassing connection poolers, strictly required for database schema migrations. | `postgresql://user:pass@host:5432/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL. Used server-side by `lib/storage.ts` and to build public image URLs. | `https://your-project.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret, server only.** Full-access key used by `lib/storage.ts` to upload and delete images. Never commit it or add a `NEXT_PUBLIC_` copy. See [Image Storage](#image-storage). | from Supabase → Project Settings → API Keys |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name. Defaults to `gloo-images` (production). Local dev must use a separate bucket. | `gloo-images-dev` |
| `EMAIL_FLOWS_ENABLED` | Optional. Enables email verification and password recovery; off when unset. See [Email Flows](#email-flows). | `false` |

---

## License

This project is proprietary. All rights reserved © GLOO 2026.

