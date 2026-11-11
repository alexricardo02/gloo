import { describe, it, expect } from "vitest";
import { ImageValidationError, MAX_FILE_SIZE_BYTES, validateImage } from "@/lib/validateImage";

const file = (bytes: number[] | Uint8Array, name: string) => new File([new Uint8Array(bytes)], name);
const padded = (head: number[], size = 64) => [...head, ...new Array(Math.max(0, size - head.length)).fill(0)];
const ascii = (s: string) => [...Buffer.from(s, "latin1")];

async function expectCode(promise: Promise<unknown>, code: string, messageKey: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ImageValidationError);
  expect((error as ImageValidationError).code).toBe(code);
  expect((error as ImageValidationError).messageKey).toBe(messageKey);
}

describe("validateImage (ALLOWED_TYPES = jpeg, png, webp)", () => {
  it("accepts JPEG, PNG and WebP by magic bytes", async () => {
    await expect(validateImage(file(padded([0xff, 0xd8, 0xff, 0xe0]), "a.jpg"))).resolves.toMatchObject({
      mimeType: "image/jpeg",
      safeExtension: "jpg",
    });
    await expect(
      validateImage(file(padded([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "a.png")),
    ).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(
      validateImage(file(padded([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WEBPVP8 ")]), "a.webp")),
    ).resolves.toMatchObject({ mimeType: "image/webp" });
  });

  it("rejects HEIC with the typed unsupported-type error", async () => {
    const heic = padded([0, 0, 0, 0x18, ...ascii("ftypheic"), 0, 0, 0, 0, ...ascii("mif1heic")]);
    await expectCode(validateImage(file(heic, "IMG_0001.HEIC")), "IMAGE_UNSUPPORTED_TYPE", "unsupportedType");
    // Renamed to .jpg: the magic bytes still give it away.
    await expectCode(validateImage(file(heic, "IMG_0001.jpg")), "IMAGE_UNSUPPORTED_TYPE", "unsupportedType");
  });

  it("rejects GIF and non-WebP RIFF files (e.g. WAV)", async () => {
    await expectCode(validateImage(file(padded(ascii("GIF89a")), "a.gif")), "IMAGE_UNSUPPORTED_TYPE", "unsupportedType");
    await expectCode(
      validateImage(file(padded([...ascii("RIFF"), 1, 2, 3, 4, ...ascii("WAVEfmt ")]), "a.webp")),
      "IMAGE_UNSUPPORTED_TYPE",
      "unsupportedType",
    );
    await expectCode(validateImage(file(padded(ascii("<html>")), "a.png")), "IMAGE_UNSUPPORTED_TYPE", "unsupportedType");
  });

  it("rejects empty and oversized files", async () => {
    await expectCode(validateImage(file([], "a.jpg")), "IMAGE_EMPTY", "empty");
    const big = new Uint8Array(MAX_FILE_SIZE_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    await expectCode(validateImage(file(big, "a.jpg")), "IMAGE_TOO_LARGE", "tooLarge");
  });
});
