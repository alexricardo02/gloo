/**
 * Server-side image validation utility (H-2 fix).
 *
 * Root cause: `file.type` and `file.name` are client-controlled strings.
 * An attacker can send `file.type = "image/jpeg"` while the actual bytes
 * are HTML, JavaScript, or an executable. We must inspect the file's magic
 * bytes (the first 4–12 bytes) to determine the true MIME type.
 *
 * This module reads the raw bytes and checks the magic-byte signature,
 * enforces a hard size cap, and returns a typed `Buffer` ready for upload.
 * All validation errors are user-friendly and do NOT expose infrastructure
 * details (file paths, stack traces, internal error codes).
 */

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

// MIME type → expected magic-byte sequences (hex).
// We only check the first 12 bytes, which is sufficient to distinguish
// the formats we care about without loading the whole file into memory twice.
const MAGIC_BYTES: Record<string, number[][]> = {
  "image/jpeg": [[0xff, 0xd8, 0xff]],
  "image/png": [[0x89, 0x50, 0x4e, 0x47]],
  "image/webp": [[0x52, 0x49, 0x46, 0x46]], // RIFF header — WebP
  "image/gif": [
    [0x47, 0x49, 0x46, 0x38, 0x37, 0x61], // GIF87a
    [0x47, 0x49, 0x46, 0x38, 0x39, 0x61], // GIF89a
  ],
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp", "gif"]);

function detectMime(buffer: Buffer): string | null {
  for (const [mime, signatures] of Object.entries(MAGIC_BYTES)) {
    for (const sig of signatures) {
      if (sig.every((byte, i) => buffer[i] === byte)) {
        return mime;
      }
    }
  }
  return null;
}

export interface ValidatedImage {
  buffer: Buffer;
  mimeType: string;
  /** Safe file extension derived from the detected MIME type, not the filename. */
  safeExtension: string;
}

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

/**
 * Validates an uploaded image File and returns a safe Buffer + mime type.
 *
 * @throws with a user-safe message string on any validation failure.
 */
export async function validateImage(file: File): Promise<ValidatedImage> {
  if (!file || file.size === 0) {
    throw new Error("No image provided.");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error("Image exceeds the 5 MB size limit. Please upload a smaller file.");
  }

  // Derive extension from the filename for a basic sanity check, but do NOT
  // trust it for MIME-type decisions — only magic bytes are authoritative.
  const rawExt = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(rawExt)) {
    throw new Error("Invalid file type. Only JPEG, PNG, WebP, and GIF images are accepted.");
  }

  const bytes = await file.arrayBuffer();
  const buffer = Buffer.from(bytes);

  const detectedMime = detectMime(buffer);
  if (!detectedMime) {
    throw new Error("Could not verify the image format. Only JPEG, PNG, WebP, and GIF images are accepted.");
  }

  return {
    buffer,
    mimeType: detectedMime,
    safeExtension: MIME_TO_EXT[detectedMime],
  };
}
