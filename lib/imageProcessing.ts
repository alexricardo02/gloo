import "server-only";

/**
 * Re-encodes a validated upload (REENCODE_IMAGES=yes).
 *
 * Runs after lib/validateImage.ts (magic bytes + size). Decoding and
 * re-encoding guarantees the stored object is a plain WebP image, whatever
 * else the original file carried:
 *  - auto-rotates from the EXIF orientation, then drops ALL metadata
 *    (EXIF incl. GPS, XMP, IPTC, ICC). Pixels are converted to sRGB, so no
 *    ICC profile is needed for correct colour.
 *  - longest side at most 1600 px, never upscaled.
 *  - WebP quality 80.
 */

import sharp from "sharp";
import { ImageValidationError, type ValidatedImage } from "@/lib/validateImage";

export const MAX_DIMENSION_PX = 1600;
export const WEBP_QUALITY = 80;
// Decompression-bomb guard: refuse inputs above ~64 MP (default is ~268 MP).
const MAX_INPUT_PIXELS = 64_000_000;

export interface ProcessedImage {
  buffer: Buffer;
  contentType: "image/webp";
  extension: "webp";
}

export async function processImage(image: Pick<ValidatedImage, "buffer">): Promise<ProcessedImage> {
  try {
    const buffer = await sharp(image.buffer, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate() // apply EXIF orientation before the metadata is dropped
      .resize({
        width: MAX_DIMENSION_PX,
        height: MAX_DIMENSION_PX,
        fit: "inside",
        withoutEnlargement: true,
      })
      .toColourspace("srgb")
      .webp({ quality: WEBP_QUALITY })
      // sharp writes no metadata unless withMetadata/keepExif/keepIccProfile
      // is called; none of them are, so EXIF/GPS/XMP/ICC are all stripped.
      .toBuffer();
    return { buffer, contentType: "image/webp", extension: "webp" };
  } catch (error) {
    console.error("[image] Failed to re-encode upload:", error);
    throw new ImageValidationError("IMAGE_INVALID");
  }
}
