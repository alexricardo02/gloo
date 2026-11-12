/**
 * VENUE_NIGHT_BOUNDARY = 06:00 Europe/Berlin (B10).
 *
 * A "night" runs from 06:00 to 06:00 the next day, Berlin wall-clock time
 * (DST is handled by the time zone database). It is identified by the date it
 * STARTED on: Saturday 23:00 and Sunday 05:59 both belong to Saturday's
 * night; Sunday 06:00 starts Sunday's night. "Tonight" on the map is the
 * night containing `now`, so venue counts reset at 06:00 every morning.
 *
 * The returned Date is UTC midnight of that date, which Prisma stores as-is
 * in the `VenueAttendance.night` DATE column. The migration backfills
 * existing rows with the same rule in SQL.
 */

export const NIGHT_TIME_ZONE = "Europe/Berlin";
export const NIGHT_BOUNDARY_HOUR = 6;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: NIGHT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
});

export function nightOf(instant: Date = new Date()): Date {
  const parts = Object.fromEntries(formatter.formatToParts(instant).map((p) => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour);
  // Before 06:00 the night started on the previous calendar day.
  return new Date(Date.UTC(year, month - 1, hour < NIGHT_BOUNDARY_HOUR ? day - 1 : day));
}
