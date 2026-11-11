/**
 * Server-side image validation utility (H-2 fix), the first gate for uploads.
 *
 * Root cause: `file.type` and `file.name` are client-controlled strings.
 * An attacker can send `file.type = "image/jpeg"` while the actual bytes
 * are HTML, JavaScript, or an executable. We must inspect the file's magic
 * bytes to determine the true MIME type.
 *
 * Only JPEG, PNG and WebP are accepted (ALLOWED_TYPES). Anything else
 * (GIF, HEIC, ...) is rejected with a typed `ImageValidationError` whose
 * `messageKey` is a key in the "ImageUpload" i18n namespace.
 * After this gate, uploads are re-encoded by lib/imageProcessing.ts.
 */

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImageValidationCode = "IMAGE_EMPTY" | "IMAGE_TOO_LARGE" | "IMAGE_UNSUPPORTED_TYPE" | "IMAGE_INVALID";

const MESSAGES: Record<ImageValidationCode, { messageKey: string; text: string }> = {
  IMAGE_EMPTY: { messageKey: "empty", text: "No image provided." },
  IMAGE_TOO_LARGE: { messageKey: "tooLarge", text: "Image exceeds the 5 MB size limit. Please upload a smaller file." },
  IMAGE_UNSUPPORTED_TYPE: {
    messageKey: "unsupportedType",
    text: "Unsupported image type. Only JPEG, PNG and WebP images are accepted.",
  },
  IMAGE_INVALID: { messageKey: "invalid", text: "The image could not be processed. Please try another file." },
};

/** Typed, user-safe validation error. `messageKey` lives in the "ImageUpload" namespace. */
export class ImageValidationError extends Error {
  readonly messageKey: string;
  constructor(readonly code: ImageValidationCode) {
    super(MESSAGES[code].text);
    this.name = "ImageValidationError";
    this.messageKey = MESSAGES[code].messageKey;
  }
}

type AllowedMime = "image/jpeg" | "image/png" | "image/webp";

// Signature bytes; `null` matches any byte (WebP: "RIFF" ???? "WEBP").
const MAGIC_BYTES: Record<AllowedMime, (number | null)[]> = {
  "image/jpeg": [0xff, 0xd8, 0xff],
  "image/png": [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  "image/webp": [0x52, 0x49, 0x46, 0x46, null, null, null, null, 0x57, 0x45, 0x42, 0x50],
};

const MIME_TO_EXT: Record<AllowedMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const ALLOWED_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"]);

function detectMime(buffer: Buffer): AllowedMime | null {
  for (const [mime, signature] of Object.entries(MAGIC_BYTES) as [AllowedMime, (number | null)[]][]) {
    if (buffer.length >= signature.length && signature.every((byte, i) => byte === null || buffer[i] === byte)) {
      return mime;
    }
  }
  return null;
}

export interface ValidatedImage {
  buffer: Buffer;
  mimeType: AllowedMime;
  /** Safe file extension derived from the detected MIME type, not the filename. */
  safeExtension: string;
}

/**
 * Validates an uploaded image File and returns a safe Buffer + mime type.
 *
 * @throws ImageValidationError on any validation failure.
 */
export async function validateImage(file: File): Promise<ValidatedImage> {
  if (!file || typeof file !== "object" || file.size === 0) {
    throw new ImageValidationError("IMAGE_EMPTY");
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new ImageValidationError("IMAGE_TOO_LARGE");
  }

  // Basic sanity check on the filename; only magic bytes are authoritative.
  const rawExt = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(rawExt)) {
    throw new ImageValidationError("IMAGE_UNSUPPORTED_TYPE");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  const detectedMime = detectMime(buffer);
  if (!detectedMime) {
    throw new ImageValidationError("IMAGE_UNSUPPORTED_TYPE");
  }

  return {
    buffer,
    mimeType: detectedMime,
    safeExtension: MIME_TO_EXT[detectedMime],
  };
}
