/**
 * Finances — money math (spec: finances §4). Pure functions, shared by the API
 * and the web composer's live math strip. Every formula here is unit-tested
 * with the exact values from §12.
 *
 * Units: Robux are integers everywhere. USD is a number rounded to 2 decimals.
 */

/* ---- constants (§4.1) ---- */

export const DEVEX_RATE_DEFAULT = 0.0038; // USD per earned Robux, project-editable
export const MARKETPLACE_FEE = 0.3; // Roblox cut — PAYOUTS ONLY, never revenue
export const DEVEX_MINIMUM = 30_000; // earned R$ required to cash out

/* ---- conversion (§4.2) ---- */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function usdFromRobux(robux: number, rate: number): number {
  return round2(robux * rate);
}

// ceil so you never under-fund a payment
export function robuxFromUsd(usd: number, rate: number): number {
  return Math.ceil(usd / rate);
}

/* ---- gamepass gross-up (§4.4) ---- */

export interface RobuxPayment {
  costRobux: number; // what actually leaves
  netRobux: number; // what they receive
  feeRobux: number; // Roblox's cut
}

// 1 − MARKETPLACE_FEE as an exact integer ratio: Robux math must be exact, and
// n / 0.7 picks up float noise at large values that ceil/floor then amplify.
const KEEP_NUM = 7;
const KEEP_DEN = 10;

// mode = "they receive": work backwards from the net figure
export function gamepassFromNet(netRobux: number): RobuxPayment {
  const costRobux = Math.ceil((netRobux * KEEP_DEN) / KEEP_NUM);
  return { costRobux, netRobux, feeRobux: costRobux - netRobux };
}

// mode = "it costs me": the entered figure is the gross cost
export function gamepassFromCost(costRobux: number): RobuxPayment {
  const netRobux = Math.floor((costRobux * KEEP_NUM) / KEEP_DEN);
  return { costRobux, netRobux, feeRobux: costRobux - netRobux };
}

// group payout: 1:1 out of group funds, no fee
export function groupPayout(robux: number): RobuxPayment {
  return { costRobux: robux, netRobux: robux, feeRobux: 0 };
}

/* ---- split accruals (§4.8) ---- */

export type FinanceCurrency = "usd" | "robux";

// Native accrual — floor on Robux so Σ accruals can never exceed the revenue
// row; the sub-Robux remainder falls to your share.
export function accrualNative(
  amountNet: number,
  percent: number,
  currency: FinanceCurrency,
): number {
  return currency === "robux"
    ? Math.floor((amountNet * percent) / 100)
    : round2((amountNet * percent) / 100);
}

export function accrualUsd(
  native: number,
  currency: FinanceCurrency,
  rateUsed: number,
): number {
  return currency === "robux" ? round2(native * rateUsed) : native;
}

/* ---- position, runway, break-even (§4.6, §4.9) ---- */

export function positionUsd(
  usdBalance: number,
  robuxBalance: number,
  currentRate: number,
): number {
  return round2(usdBalance + robuxBalance * currentRate);
}

// avg_burn > 0 → months of runway at current burn; otherwise unknowable
export function runwayMonths(
  position: number,
  avgBurn: number | null,
): number | null {
  if (avgBurn == null || avgBurn <= 0) return null;
  return position / avgBurn;
}

export interface Breakeven {
  investedUsd: number;
  returnedUsd: number;
  pct: number | null; // null when nothing invested → hide the bar
}

export function breakeven(
  investedUsd: number,
  lifetimeNetUsd: number,
): Breakeven {
  const returnedUsd = round2(
    Math.min(Math.max(lifetimeNetUsd, 0), investedUsd),
  );
  return {
    investedUsd: round2(investedUsd),
    returnedUsd,
    pct: investedUsd > 0 ? returnedUsd / investedUsd : null,
  };
}
