// The one place a monetary figure is rendered. Encodes the spec's currency
// rule so no caller can accidentally back-convert USD → Robux or blend rails
// into one number:
//   forward-convert only  — Robux-native rows show "R$ N ≈ $M" at rowRate.
//                           USD-native rows show "$N" and NO Robux equivalent.
//   rail marker visible   — a small persistent bar (◇ Robux / ◆ USD), not a
//                           tooltip; readable at rest.
//   totals never blended  — mixing rails in one <Money> is a runtime warning.
//                           Use <MoneyPair> for the two-column total shape.
//
// A converted secondary reveals rate + rate date on hover (title attr, cheap).

import type { FinanceCurrency } from "@monkyesuite/shared";

const USD = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ROBUX = new Intl.NumberFormat("en-US");

export function fmtUsdN(n: number, opts: { signed?: boolean } = {}): string {
  const abs = USD.format(Math.abs(n));
  if (!opts.signed) return `$${abs}`;
  if (n > 0) return `+$${abs}`;
  if (n < 0) return `−$${abs}`;
  return `$${abs}`;
}
export function fmtRobuxN(n: number, opts: { signed?: boolean } = {}): string {
  const abs = ROBUX.format(Math.round(Math.abs(n)));
  if (!opts.signed) return `${abs} R$`;
  if (n > 0) return `+${abs} R$`;
  if (n < 0) return `−${abs} R$`;
  return `${abs} R$`;
}

type Tone = "default" | "positive" | "negative" | "muted" | "alert";
const TONE_CLASS: Record<Tone, string> = {
  default: "text-text-1",
  positive: "text-fin-positive",
  negative: "text-fin-negative",
  muted: "text-text-3",
  alert: "text-fin-alert",
};

// Rail glyph — persistent, visible at rest. Robux = filled diamond in the
// robux hue; USD = hollow diamond in cash hue. The two never share a colour.
export function RailMark({
  currency,
  className = "",
}: {
  currency: FinanceCurrency;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      title={currency === "robux" ? "Robux-native" : "USD-native"}
      className={`inline-block h-2 w-2 shrink-0 rotate-45 ${
        currency === "robux" ? "bg-fin-robux" : "border border-fin-positive"
      } ${className}`}
    />
  );
}

interface MoneyProps {
  // The row's native amount. Robux integers, USD dollars (fractional OK).
  amount: number;
  // The row's currency of RECORD. Forward-conversion goes from this.
  currency: FinanceCurrency;
  // The snapshotted rate on the row. Required for Robux → USD; ignored for
  // USD-native rows (never back-convert).
  rate?: number;
  // Optional rate-date, surfaced on the secondary's hover title.
  rateDate?: string;
  // Whether to render the "≈ $M" secondary for Robux-native rows. Hero
  // amounts use true; dense list cells use false to keep the row height.
  showSecondary?: boolean;
  signed?: boolean;
  tone?: Tone;
  // Show the rail mark next to the amount. On by default.
  showRail?: boolean;
  className?: string;
  // Bigger figure for hero rows; the default is table-dense.
  size?: "sm" | "md" | "lg";
}

const SIZE_CLASS: Record<NonNullable<MoneyProps["size"]>, string> = {
  sm: "text-[11px]",
  md: "text-xs",
  lg: "text-lg",
};

export function Money({
  amount,
  currency,
  rate,
  rateDate,
  showSecondary = false,
  signed = false,
  tone = "default",
  showRail = true,
  className = "",
  size = "md",
}: MoneyProps) {
  const primary =
    currency === "robux"
      ? fmtRobuxN(amount, { signed })
      : fmtUsdN(amount, { signed });
  const canConvert = currency === "robux" && rate != null && rate > 0;
  const secondaryUsd = canConvert ? amount * rate : null;
  return (
    <span
      className={`inline-flex items-baseline gap-1.5 ${className}`}
      data-currency={currency}
    >
      {showRail ? (
        <RailMark currency={currency} className="self-center" />
      ) : null}
      <span
        className={`font-mono tabular-nums ${SIZE_CLASS[size]} ${TONE_CLASS[tone]}`}
      >
        {primary}
      </span>
      {showSecondary && secondaryUsd != null ? (
        <span
          title={
            rate != null
              ? `at ${rate} USD/R$${rateDate ? ` on ${rateDate}` : ""}`
              : undefined
          }
          className={`font-mono ${size === "lg" ? "text-xs" : "text-[10px]"} tabular-nums text-text-disabled`}
        >
          ≈ {fmtUsdN(secondaryUsd)}
        </span>
      ) : null}
    </span>
  );
}

// Two-column total: Robux and USD side-by-side, never one blended number.
// A third "USD equivalent" is opt-in via `derivedUsdEquivalent` and renders
// visually subordinate + labelled — per the spec's total-rendering rule.
export function MoneyPair({
  robux,
  usd,
  rate,
  rateDate,
  derivedUsdEquivalent = false,
  signed = false,
  tone = "default",
  className = "",
  size = "md",
}: {
  robux: number;
  usd: number;
  rate?: number;
  rateDate?: string;
  derivedUsdEquivalent?: boolean;
  signed?: boolean;
  tone?: Tone;
  className?: string;
  size?: MoneyProps["size"];
}) {
  const robuxUsd = rate != null && rate > 0 ? robux * rate : 0;
  return (
    <span
      className={`inline-flex items-baseline gap-3 ${className}`}
      data-mixed="true"
    >
      <Money
        amount={robux}
        currency="robux"
        signed={signed}
        tone={tone}
        size={size}
      />
      <Money
        amount={usd}
        currency="usd"
        signed={signed}
        tone={tone}
        size={size}
      />
      {derivedUsdEquivalent && rate != null ? (
        <span
          title={`derived at ${rate} USD/R$${rateDate ? ` on ${rateDate}` : ""}`}
          className="font-mono text-[10px] tabular-nums text-text-disabled"
        >
          <span className="mr-1 uppercase tracking-[0.08em]">derived</span>
          {fmtUsdN(robuxUsd + usd, { signed })}
        </span>
      ) : null}
    </span>
  );
}

// Right-aligned cell wrapper for the tabular contexts (statement tables,
// ledger rows). Preserves decimal alignment across a column.
export function MoneyCell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`inline-flex w-full justify-end text-right ${className}`}>
      {children}
    </span>
  );
}
