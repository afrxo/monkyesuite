import { describe, expect, it } from "vitest";
import {
  dayIndexToIso,
  dayToUtcDate,
  fromDayIndex,
  mondayOf,
  sundayOf,
  toDayIndex,
  weekdayOf,
} from "./day";

describe("day-index arithmetic", () => {
  it("round-trips ISO days", () => {
    expect(fromDayIndex(toDayIndex("2026-08-19"))).toBe("2026-08-19");
    expect(fromDayIndex(toDayIndex("1970-01-01"))).toBe("1970-01-01");
    expect(fromDayIndex(toDayIndex("2029-12-31"))).toBe("2029-12-31");
  });

  it("accepts UTC-midnight ISO datetimes (the stored dueAt shape)", () => {
    expect(toDayIndex("2026-08-19T00:00:00.000Z")).toBe(
      toDayIndex("2026-08-19"),
    );
  });

  it("is timezone-free: consecutive days differ by exactly 1", () => {
    expect(toDayIndex("2026-08-20") - toDayIndex("2026-08-19")).toBe(1);
    // DST boundaries don't exist in day-index space.
    expect(toDayIndex("2026-03-30") - toDayIndex("2026-03-29")).toBe(1);
    expect(toDayIndex("2026-10-26") - toDayIndex("2026-10-25")).toBe(1);
  });

  it("writes back the UTC-midnight ISO the API stores", () => {
    expect(dayIndexToIso(toDayIndex("2026-08-19"))).toBe(
      "2026-08-19T00:00:00.000Z",
    );
  });

  it("knows weekdays (2026-08-19 is a Wednesday)", () => {
    expect(weekdayOf(toDayIndex("2026-08-19"))).toBe(2); // Mon=0
    expect(weekdayOf(toDayIndex("2026-08-17"))).toBe(0);
    expect(weekdayOf(toDayIndex("2026-08-23"))).toBe(6);
  });

  it("snaps to Monday and Sunday of the containing week", () => {
    const wed = toDayIndex("2026-08-19");
    expect(fromDayIndex(mondayOf(wed))).toBe("2026-08-17");
    expect(fromDayIndex(sundayOf(wed))).toBe("2026-08-23");
    // idempotent at the boundary
    expect(mondayOf(toDayIndex("2026-08-17"))).toBe(toDayIndex("2026-08-17"));
    expect(sundayOf(toDayIndex("2026-08-23"))).toBe(toDayIndex("2026-08-23"));
  });

  it("axis dates read via getUTC* accessors only", () => {
    const d = dayToUtcDate(toDayIndex("2026-08-01"));
    expect(d.getUTCDate()).toBe(1);
    expect(d.getUTCMonth()).toBe(7);
    expect(d.getUTCFullYear()).toBe(2026);
  });
});
