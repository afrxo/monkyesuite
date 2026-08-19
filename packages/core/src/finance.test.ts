import { describe, expect, it } from "vitest";
import {
  accrualNative,
  accrualUsd,
  breakeven,
  DEVEX_RATE_DEFAULT,
  gamepassFromCost,
  gamepassFromNet,
  groupPayout,
  positionUsd,
  robuxFromUsd,
  round2,
  runwayMonths,
  usdFromRobux,
} from "./finance.js";

const RATE = DEVEX_RATE_DEFAULT; // 0.0038

describe("conversion (§4.2)", () => {
  it("20,000 R$ at 0.0038 → $76.00", () => {
    expect(usdFromRobux(20_000, RATE)).toBe(76.0);
  });

  it("242,000 R$ → $919.60 (revenue example, no fee ever)", () => {
    expect(usdFromRobux(242_000, RATE)).toBe(919.6);
  });

  it("robuxFromUsd ceils so a payment is never under-funded", () => {
    expect(robuxFromUsd(76.0, RATE)).toBe(20_000);
    expect(robuxFromUsd(76.001, RATE)).toBe(20_001);
  });

  it("round2 handles float noise", () => {
    expect(round2(242_000 * 0.0038)).toBe(919.6);
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-2178.434)).toBe(-2178.43);
  });
});

describe("gamepass gross-up (§4.4)", () => {
  it("they receive 20,000 R$ → cost 28,572, fee 8,572, $108.57", () => {
    const p = gamepassFromNet(20_000);
    expect(p.costRobux).toBe(28_572);
    expect(p.feeRobux).toBe(8_572);
    expect(usdFromRobux(p.costRobux, RATE)).toBe(108.57);
  });

  it("it costs me 28,572 R$ → they receive 20,000 R$", () => {
    const p = gamepassFromCost(28_572);
    expect(p.netRobux).toBe(20_000);
    expect(p.feeRobux).toBe(8_572);
  });

  it("group payout 20,000 R$ → cost 20,000, fee 0", () => {
    const p = groupPayout(20_000);
    expect(p.costRobux).toBe(20_000);
    expect(p.netRobux).toBe(20_000);
    expect(p.feeRobux).toBe(0);
  });

  it("gross-up round-trips: net → cost → net is identity", () => {
    for (const net of [1, 7, 100, 20_000, 12_500, 999_999]) {
      expect(gamepassFromCost(gamepassFromNet(net).costRobux).netRobux).toBe(
        net,
      );
    }
  });

  it("integer Robux always", () => {
    for (const net of [1, 3, 10, 333, 12_345]) {
      const p = gamepassFromNet(net);
      expect(Number.isInteger(p.costRobux)).toBe(true);
      expect(Number.isInteger(p.feeRobux)).toBe(true);
    }
  });
});

describe("split accruals (§4.8)", () => {
  it("10% of 242,000 R$ → 24,200 R$ and $91.96", () => {
    const native = accrualNative(242_000, 10, "robux");
    expect(native).toBe(24_200);
    expect(Number.isInteger(native)).toBe(true);
    expect(accrualUsd(native, "robux", RATE)).toBe(91.96);
  });

  it("10/10/5% of 100,001 R$ → 10,000 / 10,000 / 5,000, your share 75,001", () => {
    const a = accrualNative(100_001, 10, "robux");
    const b = accrualNative(100_001, 10, "robux");
    const c = accrualNative(100_001, 5, "robux");
    expect([a, b, c]).toEqual([10_000, 10_000, 5_000]);
    expect(100_001 - a - b - c).toBe(75_001);
  });

  it("Σ accruals never exceeds the revenue row (floor direction)", () => {
    for (const amount of [1, 99, 101, 33_333, 242_000]) {
      const sum =
        accrualNative(amount, 33.33, "robux") +
        accrualNative(amount, 33.33, "robux") +
        accrualNative(amount, 33.33, "robux");
      expect(sum).toBeLessThanOrEqual(amount);
    }
  });

  it("USD accruals use round2, pass through accrualUsd unchanged", () => {
    const native = accrualNative(919.6, 10, "usd");
    expect(native).toBe(91.96);
    expect(accrualUsd(native, "usd", RATE)).toBe(91.96);
  });
});

describe("position, runway, break-even (§4.6, §4.9)", () => {
  it("position = usd + robux at current rate", () => {
    expect(positionUsd(240.15, 84_200, RATE)).toBe(560.11);
  });

  it("runway null when burn unknown or zero", () => {
    expect(runwayMonths(560.11, null)).toBeNull();
    expect(runwayMonths(560.11, 0)).toBeNull();
    expect(runwayMonths(560.11, 233.38)).toBeCloseTo(2.4, 1);
  });

  it("breakeven clamps returned to [0, invested]", () => {
    expect(breakeven(2_500, 1_040)).toEqual({
      investedUsd: 2_500,
      returnedUsd: 1_040,
      pct: 0.416,
    });
    expect(breakeven(2_500, -500).returnedUsd).toBe(0);
    expect(breakeven(2_500, 9_999).returnedUsd).toBe(2_500);
  });

  it("breakeven pct null when nothing invested → bar hidden", () => {
    expect(breakeven(0, 1_000).pct).toBeNull();
  });
});
