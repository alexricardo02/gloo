import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Block lookups, shared by discovery, likes, chat creation, the chat list,
 * opening a chat and sending messages.
 *
 * A GroupBlock row means "user `blockerId` blocked group `blockedGroupId`".
 * Blocks are mutual in effect: if either side blocked the other, neither sees
 * or contacts the other. Chats belong to users (hosts), likes and discovery
 * to groups, so the helpers return both the group ids and the user ids of the
 * blocked counterparts.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export interface BlockSet {
  /** Groups the user blocked, plus the groups of users who blocked the user's group. */
  groupIds: Set<string>;
  /** Owners of those groups (hosts the user must not see or contact). */
  userIds: Set<string>;
}

/**
 * Everyone `userId` has blocked or been blocked by, in one query. A blocker
 * who has since deleted their group still appears in `userIds`.
 */
export async function getBlockSet(userId: string, db: Db = prisma): Promise<BlockSet> {
  const rows = await db.$queryRaw<{ groupId: string | null; userId: string }[]>`
    SELECT b."blockedGroupId" AS "groupId", g."userId" AS "userId"
      FROM "GroupBlock" b
      JOIN "Group" g ON g."id" = b."blockedGroupId"
     WHERE b."blockerId" = ${userId}
    UNION
    SELECT bg."id" AS "groupId", b."blockerId" AS "userId"
      FROM "GroupBlock" b
      JOIN "Group" mine ON mine."id" = b."blockedGroupId"
      LEFT JOIN "Group" bg ON bg."userId" = b."blockerId"
     WHERE mine."userId" = ${userId}
  `;

  const groupIds = new Set<string>();
  const userIds = new Set<string>();
  for (const row of rows) {
    if (row.groupId) groupIds.add(row.groupId);
    userIds.add(row.userId);
  }
  return { groupIds, userIds };
}

/** True if either user blocked the other user's group. One query. */
export async function isBlockedPair(userAId: string, userBId: string, db: Db = prisma): Promise<boolean> {
  const rows = await db.$queryRaw<{ blocked: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
        FROM "GroupBlock" b
        JOIN "Group" g ON g."id" = b."blockedGroupId"
       WHERE (b."blockerId" = ${userAId} AND g."userId" = ${userBId})
          OR (b."blockerId" = ${userBId} AND g."userId" = ${userAId})
    ) AS "blocked"
  `;
  return rows[0]?.blocked === true;
}
