import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { MAX_DIMENSION_PX, processImage } from "@/lib/imageProcessing";
import { ImageValidationError, MAX_FILE_SIZE_BYTES } from "@/lib/validateImage";

// JPEG with GPS EXIF; regenerate with: node tests/fixtures/make-gps-fixture.mjs
const FIXTURE = path.join(__dirname, "..", "fixtures", "gps-photo.jpg");

/** True when a raw EXIF block (as returned by sharp) has a GPS IFD pointer (tag 0x8825) in IFD0. */
function hasGpsIfd(exif: Buffer): boolean {
  const tiff = exif.subarray(0, 6).toString("latin1") === "Exif\0\0" ? exif.subarray(6) : exif;
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = u32(4);
  const count = u16(ifd0);
  for (let i = 0; i < count; i++) if (u16(ifd0 + 2 + i * 12) === 0x8825) return true;
  return false;
}

describe("processImage (REENCODE_IMAGES=yes)", () => {
  it("strips GPS and all other metadata and outputs WebP within the limits", async () => {
    const input = fs.readFileSync(FIXTURE);
    const before = await sharp(input).metadata();
    // Sanity check: the fixture really carries GPS data.
    expect(before.exif).toBeDefined();
    expect(hasGpsIfd(before.exif!)).toBe(true);

    const result = await processImage({ buffer: input });
    expect(result.contentType).toBe("image/webp");
    expect(result.extension).toBe("webp");

    const after = await sharp(result.buffer).metadata();
    expect(after.format).toBe("webp");
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(result.buffer.includes("GPS-MARKER-MODEL")).toBe(false);
    expect(result.buffer.includes("Exif")).toBe(false);

    // 2400x1200 -> longest side capped at 1600, aspect ratio kept.
    expect(after.width).toBe(MAX_DIMENSION_PX);
    expect(after.height).toBe(800);
    expect(result.buffer.length).toBeLessThanOrEqual(MAX_FILE_SIZE_BYTES);
  });

  it("never upscales small images", async () => {
    const small = await sharp({ create: { width: 300, height: 200, channels: 3, background: "#123456" } })
      .png()
      .toBuffer();
    const result = await processImage({ buffer: small });
    const after = await sharp(result.buffer).metadata();
    expect([after.width, after.height]).toEqual([300, 200]);
  });

  it("applies the EXIF orientation before dropping it", async () => {
    // Orientation 6 = rotate 90° clockwise to display.
    const rotated = await sharp({ create: { width: 400, height: 100, channels: 3, background: "#ffffff" } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const after = await sharp((await processImage({ buffer: rotated })).buffer).metadata();
    expect([after.width, after.height]).toEqual([100, 400]);
    expect(after.orientation).toBeUndefined();
  });

  it("rejects bytes that cannot be decoded with the typed error", async () => {
    const corrupt = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const error = await processImage({ buffer: corrupt }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ImageValidationError);
    expect((error as ImageValidationError).messageKey).toBe("invalid");
  });
});
