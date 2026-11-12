/**
 * Map / pre-party settings shared by server and client (no imports, client-safe).
 */

/** MASK_RADIUS_METERS: radius of the area shown instead of a pre-party's exact point. */
export const MASK_RADIUS_METERS = 500;

/** DURATION_INPUT = hour-chips. The server accepts any whole hour 1..MAX. */
export const PREPARTY_DURATION_CHIPS = [1, 2, 3, 4, 6, 8] as const;
export const PREPARTY_MAX_HOURS = 8;
