// Regenerates tests/fixtures/gps-photo.jpg: a 2400x1200 JPEG carrying GPS EXIF
// (IFD3), a camera make/model and an orientation tag. Used by
// tests/unit/imageProcessing.test.ts to prove re-encoding strips metadata.
//   node tests/fixtures/make-gps-fixture.mjs
import sharp from "sharp";
import { fileURLToPath } from "node:url";

const out = fileURLToPath(new URL("./gps-photo.jpg", import.meta.url));

await sharp({
  create: { width: 2400, height: 1200, channels: 3, background: { r: 200, g: 60, b: 90 } },
})
  .jpeg({ quality: 70 })
  .withExif({
    IFD0: { Make: "GlooFixtureCam", Model: "GPS-MARKER-MODEL" },
    IFD3: {
      GPSLatitudeRef: "N",
      GPSLatitude: "49/1 59/1 34/1",
      GPSLongitudeRef: "E",
      GPSLongitude: "8/1 14/1 50/1",
    },
  })
  .toFile(out);

console.log(`wrote ${out}`);
