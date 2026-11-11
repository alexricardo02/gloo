import { describe, it, expect } from "vitest";
import {
  groupPrefix,
  isOwnedGroupPhotoKey,
  isOwnedUserImageKey,
  isStorageKey,
  isStoragePrefix,
  keyFromBucketPublicUrl,
  newGroupPhotoKey,
  newUserImageKey,
  userPrefix,
} from "@/lib/storageKeys";

const UUID = "0b9d3c1e-5f0a-4c7b-9a51-6f3a8e2d1c4b";

describe("storage keys", () => {
  it("generates server-side keys under the owner's prefix", () => {
    expect(newGroupPhotoKey("grp_1")).toMatch(/^groups\/grp_1\/[0-9a-f-]{36}\.webp$/);
    expect(newUserImageKey("usr_1")).toMatch(/^users\/usr_1\/[0-9a-f-]{36}\.webp$/);
    expect(groupPrefix("grp_1")).toBe("groups/grp_1/");
    expect(userPrefix("usr_1")).toBe("users/usr_1/");
  });

  it("refuses ids that could escape the prefix", () => {
    expect(() => groupPrefix("../x")).toThrow();
    expect(() => userPrefix("a/b")).toThrow();
    expect(() => groupPrefix("")).toThrow();
  });

  it("accepts only well-formed keys", () => {
    expect(isStorageKey(`groups/grp_1/${UUID}.webp`)).toBe(true);
    expect(isStorageKey(`users/usr_1/${UUID}.webp`)).toBe(true);
    expect(isStorageKey("groups/usr_1-group-abc.jpg")).toBe(true); // legacy
    expect(isStorageKey("profiles/usr_1-1700000000000.png")).toBe(true); // legacy

    for (const bad of [
      "https://evil.example/x.jpg",
      "/images/bg-fallback.jpg",
      "groups/../users/x/y.webp",
      "groups/a/b/c.webp",
      "users/x.webp",
      "groups/grp_1/x.svg",
      "",
    ]) {
      expect(isStorageKey(bad), bad).toBe(false);
    }
  });

  it("only allows narrow folder prefixes", () => {
    expect(isStoragePrefix("groups/grp_1/")).toBe(true);
    expect(isStoragePrefix("groups/")).toBe(false);
    expect(isStoragePrefix("")).toBe(false);
    expect(isStoragePrefix("profiles/x/")).toBe(false);
  });

  it("decides group photo ownership from the prefix or the legacy owner id", () => {
    expect(isOwnedGroupPhotoKey(`groups/grp_1/${UUID}.webp`, "grp_1", "usr_1")).toBe(true);
    expect(isOwnedGroupPhotoKey("groups/usr_1-group-abc.jpg", "grp_1", "usr_1")).toBe(true);
    // Another group's photo, copied into this group's row before S6 was fixed.
    expect(isOwnedGroupPhotoKey(`groups/grp_2/${UUID}.webp`, "grp_1", "usr_1")).toBe(false);
    expect(isOwnedGroupPhotoKey("groups/usr_2-group-abc.jpg", "grp_1", "usr_1")).toBe(false);
    expect(isOwnedGroupPhotoKey("https://images.unsplash.com/x.jpg", "grp_1", "usr_1")).toBe(false);
  });

  it("decides profile image ownership", () => {
    expect(isOwnedUserImageKey(`users/usr_1/${UUID}.webp`, "usr_1")).toBe(true);
    expect(isOwnedUserImageKey("profiles/usr_1-1700000000000.png", "usr_1")).toBe(true);
    expect(isOwnedUserImageKey(`users/usr_2/${UUID}.webp`, "usr_1")).toBe(false);
    expect(isOwnedUserImageKey("profiles/usr_2-1700000000000.png", "usr_1")).toBe(false);
  });

  it("parses only public URLs of our bucket", () => {
    const base = "https://abcdefghijklmnopqrst.supabase.co/storage/v1/object/public";
    expect(keyFromBucketPublicUrl(`${base}/gloo-images/groups/u1-group-x.jpg`)).toBe("groups/u1-group-x.jpg");
    expect(keyFromBucketPublicUrl(`${base}/gloo-images/profiles/u1-17.png`)).toBe("profiles/u1-17.png");
    expect(keyFromBucketPublicUrl(`${base}/other-bucket/groups/u1-group-x.jpg`)).toBeNull();
    expect(keyFromBucketPublicUrl(`${base}/gloo-images/groups/u1-group-x.jpg?download=1`)).toBeNull();
    expect(keyFromBucketPublicUrl("https://evil.example/storage/v1/object/public/gloo-images/groups/a.jpg")).toBeNull();
    expect(keyFromBucketPublicUrl("https://images.unsplash.com/photo-1?q=80")).toBeNull();
  });
});
