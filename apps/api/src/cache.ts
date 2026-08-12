// Short-TTL in-process cache for hot global reads (07-api.md §7.5). Deliberately
// tiny: one generic instance per resource, each a Map with per-entry expiry and
// a hard size cap. Global reads only — scoped/auth'd responses must never be
// cached across users.
//
// A per-resource generic (rather than a shared `unknown` Map) keeps the value
// type honest end to end, so no `as` cast is needed on read. This is a
// single-process memo, not a distributed cache; on Railway each API instance
// keeps its own. TTLs are short (seconds) so staleness stays bounded and the
// freshness timestamps in the payload stay honest.

interface Entry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache<T> {
  private readonly store = new Map<string, Entry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.expiresAt > now) return Promise.resolve(hit.value);
    if (hit) this.store.delete(key);
    return load().then((value) => {
      if (this.store.size >= this.maxEntries) {
        const oldest = this.store.keys().next().value;
        if (oldest !== undefined) this.store.delete(oldest);
      }
      this.store.set(key, { value, expiresAt: now + this.ttlMs });
      return value;
    });
  }

  clear(): void {
    this.store.clear();
  }
}

// TTLs, one place. Feed is the hottest read; detail sub-resources are colder.
export const TTL = {
  feed: 15_000,
  discover: 30_000,
  gameDetail: 20_000,
  timeseries: 30_000,
  tags: 60_000,
  notes: 10_000,
} as const;
