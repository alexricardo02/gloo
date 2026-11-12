/**
 * DB helper for E2E global-setup.
 * Called via: npx tsx tests/e2e/helpers/db.ts <action> <arg1> <arg2>
 *
 * Loads ONLY .env.test and refuses to run unless TEST_DATABASE_URL is a local
 * "*_test" database (never falls back to .env).
 */
import { resolveTestEnv } from '../../testEnv';

Object.assign(process.env, resolveTestEnv());

// Imported after the env is guarded and pinned to the test database.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { prisma } = require('../../../lib/prisma') as typeof import('../../../lib/prisma');

async function main() {
  const args = process.argv.slice(2);
  const action = args[0];

  if (action === 'verify') {
    const email = args[1];
    if (!email) { console.error('Missing email'); process.exit(1); }
    await prisma.user.update({ where: { email }, data: { isVerified: true } });
    console.log(`[db-helper] Verified user: ${email}`);
  } else if (action === 'create-group') {
    const email = args[1];
    const label = args[2] || 'test';
    if (!email) { console.error('Missing email'); process.exit(1); }

    const user = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) { console.error(`User not found: ${email}`); process.exit(1); }

    await prisma.group.create({
      data: {
        userId: user.id,
        membersCount: 4,
        ageMin: 20,
        ageMax: 28,
        gender: 'MIXED',
        searchGender: 'MIXED',
        searchAgeMin: 18,
        searchAgeMax: 35,
        maxDistance: 20,
        publicProfile: true,
        latitude: 49.99,
        longitude: 8.25,
        photos: ['/images/bg-fallback.jpg'],
        instagram: [`@${label.toLowerCase()}_e2e`],
        description: `E2E test group for ${label}`,
      },
    });
    console.log(`[db-helper] Group created for ${label} (user: ${email})`);
  } else {
    console.error(`Unknown action: ${action}`);
    process.exit(1);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error('[db-helper] Error:', e);
  process.exit(1);
});
