// Fractional indexing for manual board ordering (specs/05 §5.2, CLAUDE.md
// "Fractional-index ordering"). A card's position in a lane is a text key; a
// reorder rewrites ONE row by computing a key that sorts strictly between its
// two named neighbours. Keys compare with plain lexicographic string ordering,
// so `ORDER BY order_key` on the DB and `<` in JS agree.
//
// This is the well-known base-62 fractional-index algorithm (an order key has a
// length-prefixed integer part + an arbitrary-precision fractional tail, so it
// can always subdivide). Adapted to strict TS (noUncheckedIndexedAccess): every
// string index is guarded rather than assumed present.

const DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const ZERO = "0"; // DIGITS[0]
const LAST = DIGITS[DIGITS.length - 1] as string; // "z"

// Index of a digit char, or throw — a malformed key is a bug, not a soft case.
function digitIndex(ch: string): number {
  const i = DIGITS.indexOf(ch);
  if (i < 0) throw new Error(`invalid order-key digit: ${ch}`);
  return i;
}

const charAt = (s: string, i: number): string => s[i] ?? "";

/**
 * A key strictly between `a` and `b`, exclusive, where each is a fractional
 * tail (no integer part). `a` may be "" (unbounded below), `b` may be null
 * (unbounded above). Precondition: a < b lexicographically.
 */
function midpoint(a: string, b: string | null): string {
  if (b !== null && a >= b) throw new Error(`${a} >= ${b}`);
  if (a.slice(-1) === ZERO || (b !== null && b.slice(-1) === ZERO)) {
    throw new Error("trailing zero in fractional part");
  }
  if (b !== null) {
    // Copy the longest common prefix through, recurse on the remainder.
    let n = 0;
    while (charAt(a, n) === charAt(b, n) && charAt(b, n) !== "") n++;
    if (n > 0) {
      return b.slice(0, n) + midpoint(a.slice(n), b.slice(n));
    }
  }
  const digitA = a !== "" ? digitIndex(charAt(a, 0)) : 0;
  const digitB = b !== null ? digitIndex(charAt(b, 0)) : DIGITS.length;
  if (digitB - digitA > 1) {
    const mid = Math.round(0.5 * (digitA + digitB));
    return DIGITS[mid] as string;
  }
  // Consecutive leading digits: keep b's if it has room, else descend into a.
  if (b !== null && b.length > 1) return b.slice(0, 1);
  return (DIGITS[digitA] as string) + midpoint(a.slice(1), null);
}

// The integer part of a key is length-prefixed by its head char: 'a'..'z' and
// 'A'..'Z' encode how many digits follow, so the boundary is self-describing.
function integerLength(head: string): number {
  if (head >= "a" && head <= "z") return head.charCodeAt(0) - 95; // 'a'->2
  if (head >= "A" && head <= "Z") return 90 - head.charCodeAt(0) + 2; // 'Z'->2
  throw new Error(`invalid order-key head: ${head}`);
}

function integerPart(key: string): string {
  const len = integerLength(charAt(key, 0));
  if (len > key.length) throw new Error(`invalid order key: ${key}`);
  return key.slice(0, len);
}

function validateInteger(int: string): void {
  if (int.length !== integerLength(charAt(int, 0))) {
    throw new Error(`invalid integer part of order key: ${int}`);
  }
}

function validateKey(key: string): void {
  if (key === `A${ZERO.repeat(26)}`)
    throw new Error(`invalid order key: ${key}`);
  const int = integerPart(key);
  const frac = key.slice(int.length);
  if (frac.slice(-1) === ZERO) throw new Error(`invalid order key: ${key}`);
}

function incrementInteger(x: string): string | null {
  validateInteger(x);
  const head = charAt(x, 0);
  const digs = x.slice(1).split("");
  let carry = true;
  for (let i = digs.length - 1; carry && i >= 0; i--) {
    const d = digitIndex(charAt(x, i + 1)) + 1;
    if (d === DIGITS.length) {
      digs[i] = ZERO;
    } else {
      digs[i] = DIGITS[d] as string;
      carry = false;
    }
  }
  if (carry) {
    if (head === "Z") return `a${ZERO}`;
    if (head === "z") return null;
    const h = String.fromCharCode(head.charCodeAt(0) + 1);
    if (h > "a") digs.push(ZERO);
    else digs.pop();
    return h + digs.join("");
  }
  return head + digs.join("");
}

function decrementInteger(x: string): string | null {
  validateInteger(x);
  const head = charAt(x, 0);
  const digs = x.slice(1).split("");
  let borrow = true;
  for (let i = digs.length - 1; borrow && i >= 0; i--) {
    const d = digitIndex(charAt(x, i + 1)) - 1;
    if (d === -1) {
      digs[i] = LAST;
    } else {
      digs[i] = DIGITS[d] as string;
      borrow = false;
    }
  }
  if (borrow) {
    if (head === "a") return `Z${LAST}`;
    if (head === "A") return null;
    const h = String.fromCharCode(head.charCodeAt(0) - 1);
    if (h < "Z") digs.push(LAST);
    else digs.pop();
    return h + digs.join("");
  }
  return head + digs.join("");
}

/**
 * Generate an order key strictly between `a` and `b`.
 *  - `generateKeyBetween(null, null)` → first key in an empty lane.
 *  - `generateKeyBetween(null, k)`    → a key before k (prepend).
 *  - `generateKeyBetween(k, null)`    → a key after k (append at lane end).
 *  - `generateKeyBetween(a, b)`       → a key midway between neighbours.
 *
 * Throws if `a >= b`. Result always sorts strictly between the inputs, so a
 * reorder only ever writes the single moved row.
 */
export function generateKeyBetween(a: string | null, b: string | null): string {
  if (a !== null) validateKey(a);
  if (b !== null) validateKey(b);
  if (a !== null && b !== null && a >= b) throw new Error(`${a} >= ${b}`);

  if (a === null) {
    if (b === null) return `a${ZERO}`;
    const ib = integerPart(b);
    const fb = b.slice(ib.length);
    if (ib === `A${ZERO.repeat(26)}`) return ib + midpoint("", fb);
    if (ib < b) return ib;
    const res = decrementInteger(ib);
    if (res === null) throw new Error("cannot decrement below the minimum key");
    return res;
  }

  if (b === null) {
    const ia = integerPart(a);
    const fa = a.slice(ia.length);
    const inc = incrementInteger(ia);
    return inc === null ? ia + midpoint(fa, null) : inc;
  }

  const ia = integerPart(a);
  const fa = a.slice(ia.length);
  const ib = integerPart(b);
  const fb = b.slice(ib.length);
  if (ia === ib) return ia + midpoint(fa, fb);
  const inc = incrementInteger(ia);
  if (inc === null) throw new Error("cannot increment above the maximum key");
  if (inc < b) return inc;
  return ia + midpoint(fa, null);
}

/**
 * `n` evenly-spread keys strictly between `a` and `b`. Used to seed or rebalance
 * a whole lane in one pass (the background renumber in specs/05 §5.2).
 */
export function generateNKeysBetween(
  a: string | null,
  b: string | null,
  n: number,
): string[] {
  if (n <= 0) return [];
  if (n === 1) return [generateKeyBetween(a, b)];
  if (b === null) {
    let prev = generateKeyBetween(a, null);
    const out = [prev];
    for (let i = 1; i < n; i++) {
      prev = generateKeyBetween(prev, null);
      out.push(prev);
    }
    return out;
  }
  if (a === null) {
    let next = generateKeyBetween(null, b);
    const out = [next];
    for (let i = 1; i < n; i++) {
      next = generateKeyBetween(null, next);
      out.push(next);
    }
    out.reverse();
    return out;
  }
  const mid = Math.floor(n / 2);
  const midKey = generateKeyBetween(a, b);
  return [
    ...generateNKeysBetween(a, midKey, mid),
    midKey,
    ...generateNKeysBetween(midKey, b, n - mid - 1),
  ];
}
