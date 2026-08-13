import { describe, expect, it } from "vitest";
import { generateKeyBetween, generateNKeysBetween } from "./order-key.js";

describe("generateKeyBetween", () => {
  it("seeds an empty lane and appends after it", () => {
    const first = generateKeyBetween(null, null);
    expect(first).toBe("a0");
    const second = generateKeyBetween(first, null);
    expect(second > first).toBe(true);
  });

  it("prepends before the first key", () => {
    const first = generateKeyBetween(null, null);
    const before = generateKeyBetween(null, first);
    expect(before < first).toBe(true);
  });

  it("produces a key strictly between two neighbours", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const mid = generateKeyBetween(a, b);
    expect(a < mid && mid < b).toBe(true);
  });

  it("rejects a >= b", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    expect(() => generateKeyBetween(b, a)).toThrow();
    expect(() => generateKeyBetween(a, a)).toThrow();
  });

  it("survives many repeated midpoint inserts and stays ordered", () => {
    let lo = generateKeyBetween(null, null);
    let hi = generateKeyBetween(lo, null);
    for (let i = 0; i < 500; i++) {
      const mid = generateKeyBetween(lo, hi);
      expect(lo < mid && mid < hi).toBe(true);
      // Alternately shrink toward each side to stress both branches.
      if (i % 2 === 0) hi = mid;
      else lo = mid;
    }
  });

  it("keeps a full lane sorted under random reinserts", () => {
    // Build a lane, then repeatedly pull a card and drop it elsewhere,
    // asserting the array stays strictly increasing by key.
    const keys = generateNKeysBetween(null, null, 20);
    const lane = keys.map((orderKey, i) => ({ id: i, orderKey }));
    const isSorted = (rows: { orderKey: string }[]): boolean =>
      rows.every((c, i) => {
        const prev = rows[i - 1];
        return i === 0 || (prev !== undefined && prev.orderKey < c.orderKey);
      });

    let seed = 12345;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed % n;
    };
    for (let step = 0; step < 300; step++) {
      const from = rand(lane.length);
      const card = lane.splice(from, 1)[0];
      if (card === undefined) throw new Error("empty lane");
      const to = rand(lane.length + 1);
      const prev = lane[to - 1]?.orderKey ?? null;
      const next = lane[to]?.orderKey ?? null;
      card.orderKey = generateKeyBetween(prev, next);
      lane.splice(to, 0, card);
      expect(isSorted(lane)).toBe(true);
    }
  });
});

// Assert an array of keys is strictly increasing, without non-null assertions.
function assertStrictlyIncreasing(keys: string[]): void {
  for (let i = 1; i < keys.length; i++) {
    const prev = keys[i - 1];
    const cur = keys[i];
    expect(prev !== undefined && cur !== undefined && prev < cur).toBe(true);
  }
}

describe("generateNKeysBetween", () => {
  it("returns n strictly-increasing keys", () => {
    const keys = generateNKeysBetween(null, null, 10);
    expect(keys).toHaveLength(10);
    assertStrictlyIncreasing(keys);
  });

  it("fits keys between two existing neighbours", () => {
    const a = generateKeyBetween(null, null);
    const b = generateKeyBetween(a, null);
    const keys = generateNKeysBetween(a, b, 5);
    assertStrictlyIncreasing([a, ...keys, b]);
  });
});
