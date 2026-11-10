import { describe, it, expect } from "vitest";
import {
  ageOn,
  calendarDateToUtcDate,
  isAtLeastAge,
  parseCalendarDate,
} from "@/lib/birthdate";

const at = (iso: string) => new Date(iso);

describe("birthdate parsing and 18+ check (S10)", () => {
  it("parses YYYY-MM-DD into components without any timezone shift", () => {
    expect(parseCalendarDate("2008-03-15")).toEqual({ year: 2008, month: 3, day: 15 });
    // Stored as midnight UTC → reads back as the same calendar day.
    expect(calendarDateToUtcDate({ year: 2008, month: 3, day: 15 }).toISOString()).toBe(
      "2008-03-15T00:00:00.000Z",
    );
  });

  it.each(["", "15.03.2008", "2008-3-15", "2008-02-30", "2023-02-29", "2008-13-01", "2008-00-10", "1899-12-31", "2008-03-15T00:00:00Z"])(
    "rejects invalid input %j",
    (raw) => {
      expect(parseCalendarDate(raw)).toBeNull();
    },
  );

  it("accepts Feb 29 in leap years", () => {
    expect(parseCalendarDate("2004-02-29")).toEqual({ year: 2004, month: 2, day: 29 });
  });

  it("is exactly 18 on the 18th birthday and 17 the day before", () => {
    const birth = parseCalendarDate("2008-03-15")!;
    expect(isAtLeastAge(birth, 18, at("2026-03-15T00:00:00Z"))).toBe(true);
    expect(isAtLeastAge(birth, 18, at("2026-03-14T23:59:59Z"))).toBe(false);
  });

  it("does not depend on the server's local timezone (the old new Date(raw) bug)", () => {
    // new Date("2008-03-15") is midnight UTC; in any UTC-negative timezone its
    // local getDate() is the 14th, which made people 18 a day early/late.
    const birth = parseCalendarDate("2008-03-15")!;
    expect(ageOn(birth, { year: 2026, month: 3, day: 14 })).toBe(17);
    expect(ageOn(birth, { year: 2026, month: 3, day: 15 })).toBe(18);
  });

  it("handles month boundaries (birthday later this year)", () => {
    const birth = parseCalendarDate("2008-12-31")!;
    expect(isAtLeastAge(birth, 18, at("2026-12-30T12:00:00Z"))).toBe(false);
    expect(isAtLeastAge(birth, 18, at("2026-12-31T12:00:00Z"))).toBe(true);
  });

  it("treats a Feb 29 birthday as reached on Mar 1 in non-leap years", () => {
    const birth = parseCalendarDate("2008-02-29")!;
    expect(isAtLeastAge(birth, 18, at("2026-02-28T12:00:00Z"))).toBe(false);
    expect(isAtLeastAge(birth, 18, at("2026-03-01T00:00:00Z"))).toBe(true);
  });

  it("rejects future dates", () => {
    const birth = parseCalendarDate("2030-01-01")!;
    expect(isAtLeastAge(birth, 18, at("2026-11-10T00:00:00Z"))).toBe(false);
  });
});
