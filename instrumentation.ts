/**
 * Runs once when a Next.js server instance starts (not during `next build`).
 * Fails startup in production if required security infrastructure is missing.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertRateLimitConfig } = await import("./lib/rateLimit");
    assertRateLimitConfig();
  }
}
