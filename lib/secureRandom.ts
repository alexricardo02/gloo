import "server-only";

import { randomBytes } from "node:crypto";

const TWO_POW_53 = 2 ** 53;

/**
 * Unbiased float in [0, 1) from the OS CSPRNG.
 *
 * Why it's unbiased: 8 random bytes are a uniform 64-bit integer; the right
 * shift by 11 keeps the top 53 bits, a uniform integer k in [0, 2^53) (a
 * shift discards bits, it never folds a range the way `%` does). Every
 * integer below 2^53 is exactly representable as a double, and dividing by
 * 2^53 (a power of two) only changes the exponent, so k / 2^53 hits each of
 * the 2^53 evenly spaced values in [0, 1) with equal probability and can
 * never round up to 1.
 */
export function secureRandomUnit(): number {
  const k = randomBytes(8).readBigUInt64BE(0) >> BigInt(11);
  return Number(k) / TWO_POW_53;
}
