// Day-index arithmetic for the timeline. Every date becomes an integer count
// of days since the Unix epoch at the payload boundary, and all layout math is
// integer math — `new Date(isoString)` parsing never happens in the feature,
// so there is no UTC-midnight-shifts-a-day-west class of bug. Stored values
// are UTC-midnight timestamptz ISO strings (the DatePicker convention), so the
// calendar day is exactly the first 10 chars of the ISO string.

const MS_PER_DAY = 86_400_000;

/** 'YYYY-MM-DD' (or a UTC-midnight ISO datetime) → days since Unix epoch. */
export function toDayIndex(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (y === undefined || m === undefined || d === undefined)
    throw new Error(`bad day string: ${iso}`);
  return Math.floor(Date.UTC(y, m - 1, d) / MS_PER_DAY);
}

/** days since epoch → 'YYYY-MM-DD'. */
export function fromDayIndex(i: number): string {
  return new Date(i * MS_PER_DAY).toISOString().slice(0, 10);
}

/** days since epoch → the UTC-midnight ISO datetime the API stores. */
export function dayIndexToIso(i: number): string {
  return `${fromDayIndex(i)}T00:00:00.000Z`;
}

/** Today in the *user's* local calendar, as a day index. */
export function todayIndex(): number {
  const n = new Date();
  return Math.floor(
    Date.UTC(n.getFullYear(), n.getMonth(), n.getDate()) / MS_PER_DAY,
  );
}

/**
 * A Date whose getUTC* accessors read the given day — for axis labels only.
 * Never feed this back into layout math.
 */
export function dayToUtcDate(i: number): Date {
  return new Date(i * MS_PER_DAY);
}

/** 0 = Monday … 6 = Sunday (epoch day 0 was a Thursday). */
export function weekdayOf(i: number): number {
  return (((i + 3) % 7) + 7) % 7;
}

/** Snap back to the Monday of the week containing day i. */
export function mondayOf(i: number): number {
  return i - weekdayOf(i);
}

/** Snap forward to the Sunday of the week containing day i. */
export function sundayOf(i: number): number {
  return mondayOf(i) + 6;
}
