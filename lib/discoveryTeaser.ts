import type { DiscoveryTeaserCardDTO } from "@/lib/apiTypes";

/**
 * D5 / GUEST_TEASER = static-placeholders: what guests and signed-in users
 * without a group see behind the blur and paywall. Entirely invented: no
 * query, no photos, names come from SearchGroups.teaserNames.
 */
export const DISCOVERY_TEASER: readonly DiscoveryTeaserCardDTO[] = [
  { id: "teaser-a", nameKey: "a", tone: 0, membersCount: 4, gender: "MIXED", ageMin: 21, ageMax: 26, distanceKm: 2 },
  { id: "teaser-b", nameKey: "b", tone: 1, membersCount: 3, gender: "FEMALE", ageMin: 23, ageMax: 28, distanceKm: 4 },
  { id: "teaser-c", nameKey: "c", tone: 2, membersCount: 5, gender: "MALE", ageMin: 20, ageMax: 25, distanceKm: 7 },
  { id: "teaser-d", nameKey: "d", tone: 3, membersCount: 2, gender: "MIXED", ageMin: 24, ageMax: 30, distanceKm: 0 },
];
