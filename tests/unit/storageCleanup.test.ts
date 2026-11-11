import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanupStorage } from "@/lib/storageCleanup";
import { remove, removePrefix } from "@/lib/storage";
import { StorageError } from "@/lib/storageKeys";

vi.mock("@/lib/storage", () => ({
  remove: vi.fn(),
  removePrefix: vi.fn(),
}));

describe("cleanupStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("removes prefixes and paths and reports nothing remaining", async () => {
    vi.mocked(removePrefix).mockResolvedValue(["groups/g1/a.webp"]);
    vi.mocked(remove).mockResolvedValue();

    const result = await cleanupStorage({ prefixes: ["groups/g1/"], paths: ["groups/u1-group-a.jpg"] }, "test");

    expect(removePrefix).toHaveBeenCalledWith("groups/g1/");
    expect(remove).toHaveBeenCalledWith(["groups/u1-group-a.jpg"]);
    expect(result.remaining).toEqual([]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never throws and logs exactly which keys remain", async () => {
    vi.mocked(removePrefix).mockRejectedValue(new StorageError("Listing failed", ["users/u1/*"]));
    vi.mocked(remove).mockRejectedValue(new StorageError("Delete failed", ["groups/u1-group-a.jpg"]));

    const result = await cleanupStorage(
      { prefixes: ["users/u1/"], paths: ["groups/u1-group-a.jpg"] },
      "deleted account u1",
    );

    expect(result.remaining).toEqual(["users/u1/*", "groups/u1-group-a.jpg"]);
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("deleted account u1"),
      ["users/u1/*", "groups/u1-group-a.jpg"],
      expect.any(Array),
    );
  });
});
