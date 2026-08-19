// @monkyesuite/core — shared TS domain logic consumed by apps/api (and, for
// pure helpers, apps/web). Fractional-index ordering lives here so the board's
// single-row reorder math has one home (specs/05 §5.2).

export { generateKeyBetween, generateNKeysBetween } from "./order-key.js";
export * from "./finance.js";
