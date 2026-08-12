// Row → DTO serialization. The one job here: Drizzle returns `timestamp` columns
// as JS Date; the wire contract is ISO-8601 UTC strings (docs/api-contract.md
// "Encoding of schema types"). bigint columns are already JS numbers (mode:
// "number"). `game_metrics.raw` and internal ids are never mapped out.

export function iso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// Non-null variant for columns the contract guarantees present.
export function isoReq(d: Date): string {
  return d.toISOString();
}
