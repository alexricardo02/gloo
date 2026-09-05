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

# Supabase Client Credentials (used as fallback mock placeholders for local runtime)
NEXT_PUBLIC_SUPABASE_URL="https://dummy-project.supabase.co"
NEXT_PUBLIC_SUPABASE_ANON_KEY="dummy-anon-key-for-local-compilation-and-testing-purposes"
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
Running the Automated Test Suite
To execute the comprehensive suite of over 60 automated unit and integration testing blocks via Vitest, run:

```Bash
npm run test
```

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

```bash
npx prisma db seed
```

Execution Commands:

To execute the E2E tests in the background (headless mode), run:

```bash
npx playwright test
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

---

## License

This project is proprietary. All rights reserved © GLOO 2026.

