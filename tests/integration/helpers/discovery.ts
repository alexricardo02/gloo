import { getDiscoveryGroups } from "@/app/actions/discoverGroups";
import type { DiscoveryGroupDTO } from "@/lib/apiTypes";

/**
 * Discovery helpers for integration tests. The session comes from the mocked
 * next/headers cookies() (see ./session.ts).
 */

/** One feed page; fails the test if the action errors or returns the teaser. */
export async function discoveryPage(distance: number, cursor?: string) {
  const result = await getDiscoveryGroups({ distance, cursor });
  if (!result.ok) throw new Error(`getDiscoveryGroups failed: ${result.code} ${result.messageKey ?? ""}`);
  if (result.data.hasNoGroup) throw new Error("getDiscoveryGroups returned the teaser");
  return result.data;
}

/**
 * Follows nextCursor to the end. Other test files share the database (and
 * often the same coordinates), so a group may be on any page.
 */
export async function fullDiscoveryFeed(distance: number): Promise<DiscoveryGroupDTO[]> {
  const groups: DiscoveryGroupDTO[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 1000; pages += 1) {
    const page = await discoveryPage(distance, cursor);
    groups.push(...page.groups);
    if (!page.nextCursor) return groups;
    cursor = page.nextCursor;
  }
  throw new Error("Discovery feed did not end after 1000 pages");
}
