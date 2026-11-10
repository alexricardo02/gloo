/**
 * Birthdate handling (S10). A birthdate is a calendar date, not an instant:
 * "2008-03-15" must never shift to the 14th because of the server's timezone.
 * We parse the YYYY-MM-DD components directly and compare ages on components.
 */
export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Parses a strict "YYYY-MM-DD" string. Returns null for anything else or impossible dates (e.g. 2023-02-29). */
export function parseCalendarDate(raw: unknown): CalendarDate | null {
  if (typeof raw !== "string") return null;
  const match = ISO_DATE.exec(raw.trim());
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  // Date.UTC maps years 0-99 to 1900-1999, and nobody registering is older.
  if (year < 1900 || month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return { year, month, day };
}

/** Today's calendar date in UTC (deterministic regardless of server timezone). */
export function todayUtc(now: Date = new Date()): CalendarDate {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

/** Completed years between `birth` and `today`, computed purely from components. */
export function ageOn(birth: CalendarDate, today: CalendarDate): number {
  let age = today.year - birth.year;
  if (today.month < birth.month || (today.month === birth.month && today.day < birth.day)) {
    age--;
  }
  return age;
}

/**
 * A Feb 29 birthday counts as reached on Mar 1 in non-leap years, which the
 * component comparison above already does (Feb 28 < Feb 29).
 */
export function isAtLeastAge(birth: CalendarDate, minAge: number, now: Date = new Date()): boolean {
  return ageOn(birth, todayUtc(now)) >= minAge;
}

/** Stores the calendar date as midnight UTC so it reads back as the same Y-M-D. */
export function calendarDateToUtcDate({ year, month, day }: CalendarDate): Date {
  return new Date(Date.UTC(year, month - 1, day));
}
