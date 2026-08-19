// The below-the-fold zone (spec §7.1 "Position zone"): P&L, balance sheet,
// break-even. Fetched only once it scrolls into view, on its own request —
// never blocks the tiles/chart above it. (Split allocation lives in the
// overview donut; split settlement lives in the Ledger's Owed view.)

import type { FinancePosition } from "@monkyesuite/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { fmtRobux, fmtUsd, fmtUsdSigned } from "../../lib/format";

export function PositionZone({
  projectId,
  activeMonth,
}: {
  projectId: string;
  activeMonth: string;
}) {
  const [visible, setVisible] = useState(false);
  const [periodMode, setPeriodMode] = useState<"month" | "all">("month");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setVisible(true);
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  const period = periodMode === "all" ? "all" : activeMonth;
  const { data, isLoading } = useQuery({
    queryKey: ["finance-position", projectId, period],
    queryFn: () => api.financePosition(projectId, period),
    enabled: visible,
    placeholderData: keepPreviousData,
  });

  return (
    <div ref={ref} className="border-t border-border-1 bg-surface-0">
      <div className="flex items-center gap-3 px-5 py-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          Position
        </span>
        <div className="flex-1" />
        <div className="flex gap-0.5">
          <PeriodTab
            active={periodMode === "month"}
            onClick={() => setPeriodMode("month")}
          >
            As of {activeMonth}
          </PeriodTab>
          <PeriodTab
            active={periodMode === "all"}
            onClick={() => setPeriodMode("all")}
          >
            All time
          </PeriodTab>
        </div>
      </div>

      {!visible || isLoading ? (
        <div className="animate-pulse space-y-3 px-5 pb-5">
          <div className="h-32 rounded bg-white/[0.04]" />
          <div className="h-32 rounded bg-white/[0.04]" />
        </div>
      ) : data ? (
        <div className="flex flex-col gap-px bg-border-1 pb-5">
          <PnlSection data={data} />
          <BalanceSheetSection data={data} />
          <BreakevenSection data={data} />
        </div>
      ) : (
        <div className="px-5 pb-5 text-sm text-text-disabled">
          Couldn't load position.
        </div>
      )}
    </div>
  );
}

function PeriodTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-2.5 py-1 text-[11px] transition-colors ${
        active
          ? "border-border-2 bg-white/[0.06] text-text-1"
          : "border-transparent text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

// P&L as a horizontal bar breakdown: revenue is the full track; each expense
// category eats into it from the left; the remainder is net profit (green) or,
// if expenses exceed revenue, a red loss overhang past the revenue marker.
function PnlSection({ data }: { data: FinancePosition }) {
  const p = data.pnl;
  const base = Math.max(1, p.revenueUsd, p.expensesUsd);
  const w = (v: number) => `${(Math.max(0, v) / base) * 100}%`;
  const netPositive = p.netProfitUsd >= 0;
  const revenueMarker = (p.revenueUsd / base) * 100;

  return (
    <div className="bg-surface-0 px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          P&L
        </span>
        <span className="font-mono text-[11px] text-text-disabled">
          {data.period === "all" ? "ALL TIME" : data.period}
        </span>
      </div>

      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-text-3">Revenue</span>
        <span className="font-mono text-sm tabular-nums text-fin-positive">
          {fmtUsd(p.revenueUsd)}
        </span>
      </div>

      {/* the bar */}
      <div className="relative mb-2 flex h-5 w-full overflow-hidden rounded bg-white/[0.04]">
        {p.byCategory.map((c) => (
          <div
            key={c.name}
            title={`${c.name} · ${fmtUsd(c.spendUsd)}`}
            style={{ width: w(c.spendUsd), backgroundColor: c.color }}
            className="h-full"
          />
        ))}
        {netPositive ? (
          <div
            title={`Net profit · ${fmtUsd(p.netProfitUsd)}`}
            style={{ width: w(p.netProfitUsd) }}
            className="h-full bg-fin-positive/30"
          />
        ) : (
          <div
            title={`Net loss · ${fmtUsd(-p.netProfitUsd)}`}
            style={{ width: w(-p.netProfitUsd) }}
            className="h-full bg-fin-alert/40"
          />
        )}
        {/* revenue marker line when spending overshoots */}
        {!netPositive ? (
          <div
            className="absolute top-0 h-full w-px bg-text-1"
            style={{ left: `${revenueMarker}%` }}
          />
        ) : null}
      </div>

      {/* category legend */}
      <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1">
        {p.byCategory.map((c) => (
          <span
            key={c.name}
            className="flex items-center gap-1.5 text-[11px] text-text-3"
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            {c.name}{" "}
            <span className="font-mono tabular-nums text-text-disabled">
              {fmtUsd(c.spendUsd)}
            </span>
          </span>
        ))}
      </div>

      <div className="flex items-center justify-between border-t border-border-2 pt-2">
        <span className="text-sm font-semibold text-text-1">Net profit</span>
        <span
          className={`font-mono text-sm font-semibold tabular-nums ${netPositive ? "text-fin-positive" : "text-fin-alert"}`}
        >
          {fmtUsdSigned(p.netProfitUsd)}
        </span>
      </div>

      {/* memo — below the net-profit line, never subtracted from it (§4.10.1) */}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-disabled">
        <span>
          allocated to splits{" "}
          <span className="font-mono">−{fmtUsd(p.allocatedUsd)}</span>
        </span>
        <span>
          your share <span className="font-mono">{fmtUsd(p.yourShareUsd)}</span>
        </span>
        {p.distributedUsd > 0 ? (
          <span>
            distributed{" "}
            <span className="font-mono">−{fmtUsd(p.distributedUsd)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

// Balance sheet as a horizontal mirror: the Assets bar sits directly above the
// Liabilities+Equity bar on a shared scale. Equal width IS the accounting
// identity (A = L + E) — a drift shows as a visible length mismatch.
function MirrorBar({
  total,
  scale,
  segments,
}: {
  total: number;
  scale: number;
  segments: { label: string; value: number; color: string }[];
}) {
  return (
    <div
      className="flex h-6 overflow-hidden rounded"
      style={{ width: `${(total / scale) * 100}%` }}
    >
      {segments.map((s) => (
        <div
          key={s.label}
          title={`${s.label} · ${fmtUsd(s.value)}`}
          style={{
            width: `${(Math.max(0, s.value) / Math.max(1, total)) * 100}%`,
            backgroundColor: s.color,
          }}
          className="h-full"
        />
      ))}
    </div>
  );
}

function BalanceSheetSection({ data }: { data: FinancePosition }) {
  const b = data.balanceSheet;
  const rightTotal = b.liabilities.total + b.equity.total;
  const scale = Math.max(1, b.assets.total, rightTotal);
  const equityBar = Math.max(0, b.equity.total);

  return (
    <div className="bg-surface-0 px-5 py-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          Balance sheet
        </span>
        <span className="font-mono text-[11px] text-text-disabled">
          {b.asOf}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.06em] text-text-disabled">
            Assets
          </span>
          <div className="flex-1">
            <MirrorBar
              total={b.assets.total}
              scale={scale}
              segments={[
                {
                  label: "Cash",
                  value: b.assets.usd,
                  color: "var(--fin-positive)",
                },
                {
                  label: `Robux ${fmtRobux(b.assets.robux)}`,
                  value: b.assets.robuxUsd,
                  color: "var(--fin-robux)",
                },
              ]}
            />
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-text-1">
            {fmtUsd(b.assets.total)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="w-16 shrink-0 text-[10px] uppercase tracking-[0.06em] text-text-disabled">
            Liab+Eq
          </span>
          <div className="flex-1">
            <MirrorBar
              total={rightTotal}
              scale={scale}
              segments={[
                {
                  label: "Unpaid expenses",
                  value: b.liabilities.unpaidExpensesUsd,
                  color: "var(--fin-alert)",
                },
                {
                  label: "Accrued splits",
                  value: b.liabilities.accruedSplitsUsd,
                  color: "var(--fin-negative)",
                },
                { label: "Equity", value: equityBar, color: "#5B8DEF" },
              ]}
            />
          </div>
          <span className="w-24 shrink-0 text-right font-mono text-xs tabular-nums text-text-1">
            {fmtUsd(rightTotal)}
          </span>
        </div>
      </div>

      {/* legend */}
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <LegendChip
          color="var(--fin-positive)"
          label="Cash"
          value={fmtUsd(b.assets.usd)}
        />
        <LegendChip
          color="var(--fin-robux)"
          label="Robux"
          value={fmtUsd(b.assets.robuxUsd)}
        />
        <LegendChip
          color="var(--fin-alert)"
          label="Unpaid exp."
          value={fmtUsd(b.liabilities.unpaidExpensesUsd)}
        />
        <LegendChip
          color="var(--fin-negative)"
          label="Accrued splits"
          value={fmtUsd(b.liabilities.accruedSplitsUsd)}
        />
        <LegendChip
          color="#5B8DEF"
          label="Equity"
          value={fmtUsdSigned(b.equity.total)}
        />
      </div>

      <div
        className={`mt-2 text-[11px] ${b.reconciles ? "text-text-disabled" : "text-fin-alert"}`}
      >
        {b.reconciles
          ? "assets = liabilities + equity ✓ — bars line up"
          : `Off by ${fmtUsd(Math.abs(b.assets.total - rightTotal))}. Something's wrong upstream — check recent edits.`}
      </div>
    </div>
  );
}

function LegendChip({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: string;
}) {
  return (
    <span className="flex items-center gap-1.5 text-text-3">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      {label}{" "}
      <span className="font-mono tabular-nums text-text-1">{value}</span>
    </span>
  );
}

// Break-even as a compact strip: one thin progress bar + plain-language status.
function BreakevenSection({ data }: { data: FinancePosition }) {
  const be = data.breakeven;
  if (be.pct == null) return null; // no capital in → hide entirely (§4.9)
  const pct = Math.round(be.pct * 100);
  const done = pct >= 100;
  const remaining = Math.max(0, be.investedUsd - be.returnedUsd);
  return (
    <div className="bg-surface-0 px-5 py-4">
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          Break-even
        </span>
        <span
          className={`font-mono text-[11px] tabular-nums ${done ? "text-fin-positive" : "text-text-3"}`}
        >
          {pct}%
        </span>
      </div>
      <div className="mb-2 h-2.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div
          className={`h-full rounded-full ${done ? "bg-fin-positive" : "bg-fin-positive/70"}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-[11px] text-text-3">
        {done ? (
          <>
            Fully recouped — every dollar of the{" "}
            <span className="font-mono text-text-1">
              {fmtUsd(be.investedUsd)}
            </span>{" "}
            put in has come back.
          </>
        ) : (
          <>
            <span className="font-mono text-text-1">
              {fmtUsd(be.returnedUsd)}
            </span>{" "}
            of {fmtUsd(be.investedUsd)} recouped ·{" "}
            <span className="text-fin-negative">{fmtUsd(remaining)} to go</span>
          </>
        )}
      </div>
    </div>
  );
}
