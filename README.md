# GLOO 🎉

> **The best nights of your life.**

GLOO is a mobile-first social nightlife app that connects groups of people before and during a night out. Think of it as a Tinder-style discovery experience — but for groups, not individuals. Find other crews for a pre-party, discover events nearby, match with people who share your vibe, and break the ice with interactive party games.

---

## Overview

GLOO allows users to create a group profile (with photos, descriptions, age ranges, genders, and Instagram handles), then browse other nearby groups in a vertical snap-scroll carousel. Users can like groups, send messages upon a mutual match, and filter by distance using geobased queries.

Beyond discovery, GLOO features a **Real-Time Interactive Map** where groups can broadcast their private "Pre-Parties" (Vorglühen) or RSVP to public venues (Bars/Clubs). It also includes a suite of integrated **Party Games** to play with your group or new matches.

The app supports a **Guest Mode** that lets anyone browse content without an account, utilizing a contextual paywall for restricted features.

---

## Table of Contents

- [Overview](#overview)
- [Core Features](#core-features)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Incoming Features](#incoming-features)
- [Internationalization](#internationalization)
- [Authentication](#authentication)
- [Group Discovery](#group-discovery)
- [Deployment](#deployment)
- [Local Infrastructure (Docker)](#local-infrastructure-containerization-docker)
- [Continuous Integration Pipeline](#4-continuous-integration-pipeline-github--gitlab-ci)
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
- **Supabase WebSockets:** Real-time updates for event requests and map markers without reloading the page.

###  Party Games
- Built-in interactive games to break the ice: *Never Have I Ever*, *Most Likely To*, *Truth or Dare*, and *Busdriver*.
- Extensive, randomized content libraries for endless replayability.

###  Authentication & Security
- Custom Auth system (Bcrypt password hashing, secure HTTP-only cookies).
- Email verification flow.
- Guest Mode with limited access (Paywall integration).

###  Internationalization (i18n)
- Full multi-language support via `next-intl` (English, German, Spanish, French, Italian).
- Implemented using Next.js `proxy` routing conventions for robust localization.

---

## Tech Stack

- **Frontend:** Next.js (App Router), React, Tailwind CSS, Lucide Icons.
- **Backend:** Next.js Server Actions.
- **Database:** PostgreSQL hosted on Supabase.
- **ORM:** Prisma.
- **Real-time:** Supabase WebSockets (Postgres Changes).
- **Mapping:** Leaflet & React-Leaflet.
- **Testing:** Vitest (Unit & Integration tests).
- **CI/CD:** GitHub Actions (Schema validation, automated testing, build checks).

---

## Project Structure

```
gloo-app/
├── app/
│   ├── [locale]/           # i18n routing pages (UI)
│   ├── actions/            # Next.js Server Actions (Backend logic)
│   ├── components/         # Reusable React components (Map, Cards, Navigation)
│   └── globals.css         # Tailwind directives & global styles
├── lib/                    # Prisma and Supabase client instances
├── messages/               # Translation JSON files (en, de, es, fr, it)
├── prisma/                 # Database schema, migrations, and seed scripts
├── public/                 # Static assets, images, icons
├── tests/                  # Vitest suite (unit and integration tests)
├── i18n.ts                 # Next-intl configuration
├── middleware.ts           # Route protection and locale proxy
└── .github/workflows/ci.yml# GitHub Actions CI pipeline
```

---

## Incoming Features

- Account & Group Deletion: As a user, I want to be able to permanently delete my account, group, and associated data for privacy reasons. (Requires UI in preferences and a cascading delete Server Action).

- Admin & Moderation Dashboard: As an administrator, I need to be able to view reports and delete inappropriate groups or events to keep the community safe.

- Gamification UI: As a user, I want to see my party game scores and compare them on a leaderboard. (Backend schema GameScore exists, UI pending).

- Push Notifications: As a user, I want to be notified on my phone when another group matches with me or accepts my pre-party request.

### Technical Debt
- Migrate Image Storage: Currently, profile photos are converted to Base64 strings and stored directly in the PostgreSQL database. This needs to be migrated to Supabase Storage Buckets to improve database performance and reduce payload sizes.

---

## Internationalization

GLOO supports 5 languages out of the box, selectable from the welcome screen:

| Code | Language |
|---|---|
| `en` | English |
| `de` | Deutsch (German) |
| `es` | Español (Spanish) |
| `fr` | Français (French) |
| `it` | Italiano (Italian) |

---

## Authentication

Authentication uses **custom cookie-based sessions** with no external providers.

### Flow

1. **Register** → password hashed with bcrypt (10 rounds) → `gloo_user_id` cookie set
2. **Login** → credentials verified → `gloo_user_id` cookie set
3. **Guest** → `gloo_is_guest=true` + `gloo_guest_id=<uuid>` cookies set (24h expiry)
4. **Logout** → `gloo_user_id` deleted → new guest session created → redirect to login

All cookies are `httpOnly` and `secure` in production. Session is read server-side in Server Actions via `cookies()` from `next/headers`.

### Guest restrictions

| Feature | Guest | Registered |
|---|---|---|
| Browse dashboard | ✅ | ✅ |
| Play games | ✅ | ✅ |
| View pre-party feed | ❌ | ✅ |
| Like groups | ❌ | ✅ |
| Send messages | ❌ | ✅ |
| View map | ❌ | ✅ |
| Create group profile | ❌ | ✅ |

When a guest taps a restricted feature, a **bottom sheet** slides up with "Create free account" and "Sign in" options — keeping the user in context rather than redirecting them away.

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

## Deployment

Gloo is built as a highly available, decoupled Full-Stack Web Application optimized for mobile-first clients. The architecture follows modern cloud-native patterns split into three core layers:
- **Client/Server Layer:** Next.js 15 (App Router) serving as both the frontend user interface and the backend serverless execution environment (Server Actions).
- **Data Persistence Layer:** PostgreSQL database hosted on a managed Supabase instance for development/production, and containerized via Docker for local isolation and testing.
- **Real-Time Communication Layer:** Supabase Realtime Engine managing asynchronous WebSocket connections for instant group matching, messaging notifications, and live map updates.

### Environment Configuration & Twelve-Factor Compliance

In strict compliance with the **Twelve-Factor App methodology**, all environment-specific configurations are isolated from the application code and injected exclusively via environment variables.

### Required Environment Variables (`.env`)

To spin up the application infrastructure, the following variables must be defined in your root `.env` file:

| Variable Name | Description | Example Value / Context |
| :--- | :--- | :--- |
| `DATABASE_URL` | Connection pool URL used by Prisma Client for transactional runtime queries. | `postgresql://user:pass@host:6543/postgres` |
| `DIRECT_URL` | Direct connection URL bypassing connection poolers, strictly required for database schema migrations. | `postgresql://user:pass@host:5432/postgres` |
| `NEXT_PUBLIC_SUPABASE_URL` | Public API gateway endpoint for the Supabase project instance. | `https://your-project.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anonymous client-side cryptographic key for initializing real-time WebSocket listeners. | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |


### Local Infrastructure Containerization (Docker)

To eliminate the "it works on my machine" anti-pattern, the local development database is fully containerized. A multi-container declarative configuration is defined using Docker Compose to orchestrate an isolated PostgreSQL server instance.

#### Local Database Configuration (`docker-compose.yml`)
- **Image:** `postgres:15-alpine` (lightweight, production-vetted Linux distribution)
- **Local Port Mapping:** `5433:5432` (avoids port collisions with default host database installations)
- **Database Name:** `gloo_db`
- **User Credentials:** `party_admin` / `party_password123`

#### Commands for Local Initialization
1. **Boot up the containerized database infra (detached mode):**
   ```bash docker-compose up -d```
   
1. **Synchronize and push the relational schema declarative definitions to the container:**
   ```npx prisma db push```
   
1. **Boot up the containerized database infra (detached mode):**
   ```bash docker-compose up -d```

---

## 4. Continuous Integration Pipeline (GitHub / GitLab CI)

The project incorporates an automated Continuous Integration pipeline (`ci.yml`) executed on every code push or pull request. This ensures code correctness, verification of database constraints, licensing compliance, and security scanning before any build artifact is approved.

### Automated Testing Lifecycle Steps:

1. **Infrastructure Service Spin-up:** GitHub Actions provisions an ephemeral, isolated Docker container running `postgres:15-alpine`.
2. **Security & Auth Trust-Mode:** The service is configured with `POSTGRES_HOST_AUTH_METHOD: trust` to permit secure loopback connections inside the CI virtual network.
3. **Deterministic Synchronization (Race Condition Prevention):** The pipeline utilizes standard `pg_isready` diagnostic checks to stall execution loops until the database engine is explicitly healthy and ready to accept raw TCP connections.
4. **Prisma Generation & Migration Execution:**
   - `npx prisma generate` builds the type-safe data access layer models.
   - `npx prisma db push` instantiates a clean relational schema inside the ephemeral container database.

5. **License & Security Auditing:**
   - Blocks copyleft dependencies (GPL/AGPL) to enforce compliant dependency trees.
   - Executes structural privacy/security scans via Bearer.

6. **Execution of Automated Test Suite:** Vitest fires all unit and integration test blocks against the isolated database container, ensuring complete functionality protection without polluting cloud production databases.

---

## License

This project is proprietary. All rights reserved © GLOO 2026.

