// Statements tab — the reconciling replacement for Overview. Structure:
//   1. Summary strip (Revenue / Costs / Owner earnings / Cash movement),
//      each labelled with its basis and carrying a prior-period delta.
//   2. Income statement — real statement rows, category expansion, %-of-rev.
//   3. Cash flow — two columns Robux / USD, DevEx as an arrow between them.
//   4. Balance sheet — assets / liabilities / equity, as-of period end.
//   5. Reconciliation — permanent row, expands into diagnostics on ≠ 0.
//   6. Cost attribution — ranked bars (no donut).
//   7. Recoup — a single sentence, not a full-width bar.
//
// Data: /finance/position for balance sheet + splits + break-even; /overview
// (period-narrowed by the tab shell) for month-scoped aggregates. Both are
// interim; a batched /finance/statements endpoint will replace both later.

import type { FinanceOverview, FinancePosition } from "@monkyesuite/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { fmtUsdN, Money, MoneyCell, MoneyPair } from "./Money";
import type { Period } from "./PeriodControl";

/* ------------------------------ interim shim ----------------------------- */
// Until /finance/statements exists, the tab derives period-scoped numbers
// from /overview (month keys) + /position (month or "all"). Quarter/year/
// custom fall back to the month containing `period.start`; a banner tells
// the user so a mismatch is never silent. Adding /finance/statements will
// remove this shim entirely.
function positionPeriod(p: Period): string {
  if (p.type === "all") return "all";
  return p.start.slice(0, 7);
}
function overviewMonth(p: Period): string {
  if (p.type === "all") return new Date().toISOString().slice(0, 7);
  return p.start.slice(0, 7);
}
function priorMonth(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function StatementsView({
  projectId,
  period,
}: {
  projectId: string;
  period: Period;
}) {
  const overviewKey = overviewMonth(period);
  const priorKey = priorMonth(overviewKey);
  const positionKey = positionPeriod(period);

  const overviewQ = useQuery({
    queryKey: ["finance-overview", projectId, overviewKey],
    queryFn: () => api.financeOverview(projectId, overviewKey),
    placeholderData: keepPreviousData,
  });
  const priorQ = useQuery({
    queryKey: ["finance-overview", projectId, priorKey],
    queryFn: () => api.financeOverview(projectId, priorKey),
    placeholderData: keepPreviousData,
  });
  const positionQ = useQuery({
    queryKey: ["finance-position", projectId, positionKey],
    queryFn: () => api.financePosition(projectId, positionKey),
    placeholderData: keepPreviousData,
  });

  const overview = overviewQ.data;
  const prior = priorQ.data;
  const position = positionQ.data;
  const stale =
    overviewQ.isFetching || positionQ.isFetching || priorQ.isFetching;

  if (!overview || !position) {
    return (
      <div className="flex-1 space-y-3 p-5">
        <div className="h-16 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-60 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-40 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  const rate = overview.rate;
  const nonMonth = period.type !== "month" && period.type !== "all";

  return (
    <div
      className={`flex-1 ws-scroll overflow-y-auto ${stale ? "opacity-70 transition-opacity" : "transition-opacity"}`}
    >
      {nonMonth ? (
        <div className="border-b border-border-1 bg-fin-alert/[0.08] px-5 py-2 text-[11px] text-text-3">
          {period.type === "custom" ? "Custom" : period.type} period rendering
          is a shim over the {overviewKey} month while /finance/statements is
          finalised. Numbers below reflect that month, not the full range.
        </div>
      ) : null}

      <SummaryStrip overview={overview} prior={prior} rate={rate} />
      <IncomeStatement overview={overview} position={position} rate={rate} />
      <CashFlow overview={overview} position={position} />
      <BalanceSheet position={position} />
      <ReconciliationRow position={position} />
      <CostAttribution overview={overview} />
      <Recoup position={position} />
    </div>
  );
}

/* ------------------------------ summary strip ---------------------------- */

function deltaPct(now: number, prev: number | undefined | null): number | null {
  if (prev == null || prev === 0 || !Number.isFinite(prev)) return null;
  return (now - prev) / Math.abs(prev);
}

function DeltaBadge({ pct }: { pct: number | null }) {
  if (pct == null || Math.abs(pct) < 0.005) {
    return (
      <span className="font-mono text-[10px] text-text-disabled">flat</span>
    );
  }
  const up = pct > 0;
  return (
    <span
      className={`font-mono text-[10px] tabular-nums ${up ? "text-fin-positive" : "text-fin-negative"}`}
    >
      {up ? "▲" : "▼"} {Math.abs(Math.round(pct * 100))}%
    </span>
  );
}

function BasisChip({ basis }: { basis: "accrual" | "cash" }) {
  return (
    <span
      title={
        basis === "accrual"
          ? "accrual basis — includes accrued but unpaid"
          : "cash basis — money actually moved"
      }
      className={`inline-block rounded border px-1 py-px text-[9px] uppercase tracking-[0.08em] ${
        basis === "accrual"
          ? "border-fin-robux/40 text-fin-robux"
          : "border-fin-positive/40 text-fin-positive"
      }`}
    >
      {basis}
    </span>
  );
}

function SummaryStrip({
  overview,
  prior,
  rate,
}: {
  overview: FinanceOverview;
  prior: FinanceOverview | undefined;
  rate: number;
}) {
  const t = overview.tiles;
  const p = prior?.tiles;
  const owed = overview.owed.reduce((s, o) => s + o.amountUsd, 0);
  const ownerEarnings = t.revenueUsd - t.spendUsd - owed; // spec: accrual net
  const priorOwner =
    p != null
      ? p.revenueUsd -
        p.spendUsd -
        (prior?.owed.reduce((s, o) => s + o.amountUsd, 0) ?? 0)
      : null;
  // Cash movement = revenue − paid expenses − paid distributions + capital in
  // ± cashout. The /overview endpoint doesn't isolate distributions today so
  // this is a first pass; refined once /finance/statements lands.
  const cashMovement = t.revenueUsd - t.spendUsd; // interim
  return (
    <div className="sticky top-0 z-10 grid grid-cols-1 gap-px border-b border-border-1 bg-border-1 md:grid-cols-4">
      <SummaryCell
        label="Revenue"
        basis="accrual"
        delta={deltaPct(t.revenueUsd, p?.revenueUsd)}
      >
        <MoneyPair
          robux={t.revenueRobux}
          usd={0}
          rate={rate}
          derivedUsdEquivalent
          size="lg"
        />
      </SummaryCell>

      <SummaryCell
        label="Costs"
        basis="accrual"
        delta={deltaPct(t.spendUsd + owed, (p?.spendUsd ?? 0) + 0)}
        sub={
          <>
            <span className="text-text-3">paid</span>{" "}
            <span className="font-mono tabular-nums text-text-1">
              {fmtUsdN(t.spendUsd)}
            </span>
            {owed > 0 ? (
              <>
                {" · "}
                <span className="text-fin-alert">unpaid</span>{" "}
                <span className="font-mono tabular-nums text-fin-alert">
                  {fmtUsdN(owed)}
                </span>
              </>
            ) : null}
          </>
        }
      >
        <Money
          amount={-(t.spendUsd + owed)}
          currency="usd"
          signed
          size="lg"
          tone="negative"
          showRail={false}
        />
      </SummaryCell>

      <SummaryCell
        label="Owner earnings"
        basis="accrual"
        delta={deltaPct(ownerEarnings, priorOwner)}
        sub={
          <span className="text-text-disabled">revenue − costs − splits</span>
        }
      >
        <Money
          amount={ownerEarnings}
          currency="usd"
          signed
          size="lg"
          tone={ownerEarnings >= 0 ? "positive" : "negative"}
          showRail={false}
        />
      </SummaryCell>

      <SummaryCell
        label="Cash movement"
        basis="cash"
        delta={deltaPct(
          cashMovement,
          (p?.revenueUsd ?? 0) - (p?.spendUsd ?? 0),
        )}
        sub={
          <span className="text-text-disabled">
            money in − money out (cash basis)
          </span>
        }
      >
        <Money
          amount={cashMovement}
          currency="usd"
          signed
          size="lg"
          tone={cashMovement >= 0 ? "positive" : "negative"}
          showRail={false}
        />
      </SummaryCell>
    </div>
  );
}

function SummaryCell({
  label,
  basis,
  delta,
  sub,
  children,
}: {
  label: string;
  basis: "accrual" | "cash";
  delta: number | null;
  sub?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 bg-surface-0 px-4 py-3">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          {label}
        </span>
        <BasisChip basis={basis} />
        <span className="flex-1" />
        <DeltaBadge pct={delta} />
      </div>
      <div>{children}</div>
      {sub ? <div className="text-[11px]">{sub}</div> : null}
    </div>
  );
}

/* ---------------------------- income statement --------------------------- */

function IncomeStatement({
  overview,
  position,
  rate,
}: {
  overview: FinanceOverview;
  position: FinancePosition;
  rate: number;
}) {
  const t = overview.tiles;
  const revenue = t.revenueUsd;
  const directCostsPaid = t.spendUsd;
  const unpaid = overview.owed
    .filter((o) => !o.isSplit)
    .reduce((s, o) => s + o.amountUsd, 0);
  const grossProfit = revenue - directCostsPaid - unpaid;
  const splitsAccrued = overview.owed
    .filter((o) => o.isSplit)
    .reduce((s, o) => s + o.amountUsd, 0);
  const ownerEarnings = grossProfit - splitsAccrued;
  const pct = (n: number) => (revenue > 0 ? n / revenue : null);

  return (
    <SectionShell title="Income statement">
      <StatementHeader />
      <StatementRow
        label="Revenue"
        robuxAmount={t.revenueRobux}
        usdAmount={revenue}
        rate={rate}
        pctOfRevenue={1}
      />
      <StatementRow
        label="Direct costs"
        usdAmount={-directCostsPaid}
        pctOfRevenue={pct(-directCostsPaid)}
        tone="negative"
        childrenRows={overview.byCategory.map((c) => ({
          label: c.name,
          color: c.color,
          usdAmount: -c.spendUsd,
          pctOfRevenue: pct(-c.spendUsd),
        }))}
      />
      {unpaid > 0 ? (
        <StatementRow
          label="Unpaid costs (accrued)"
          usdAmount={-unpaid}
          pctOfRevenue={pct(-unpaid)}
          tone="alert"
        />
      ) : null}
      <StatementDivider />
      <StatementRow
        label="Gross profit"
        usdAmount={grossProfit}
        pctOfRevenue={pct(grossProfit)}
        strong
        tone={grossProfit >= 0 ? "positive" : "negative"}
      />
      {splitsAccrued > 0 ? (
        <StatementRow
          label="Revenue splits accrued"
          usdAmount={-splitsAccrued}
          pctOfRevenue={pct(-splitsAccrued)}
          tone="negative"
          childrenRows={position.splits.map((s) => ({
            label: `${s.person.discordHandle} — ${s.percent}%`,
            usdAmount:
              -(s.owed.find((o) => o.currency === "usd")?.usd ?? 0) -
              (s.owed.find((o) => o.currency === "robux")?.usd ?? 0),
            pctOfRevenue: null,
          }))}
        />
      ) : null}
      <StatementDivider />
      <StatementRow
        label="Owner earnings"
        usdAmount={ownerEarnings}
        pctOfRevenue={pct(ownerEarnings)}
        strong
        tone={ownerEarnings >= 0 ? "positive" : "negative"}
      />
    </SectionShell>
  );
}

function StatementHeader() {
  return (
    <div className="flex items-center gap-3 border-b border-border-1 bg-surface-1/40 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
      <span className="w-4" />
      <span className="flex-1">Line</span>
      <span className="w-40 text-right">Robux</span>
      <span className="w-32 text-right">USD</span>
      <span className="w-14 text-right">% rev</span>
    </div>
  );
}

function StatementDivider() {
  return <div className="mx-5 border-t border-border-1" />;
}

function StatementRow({
  label,
  color,
  robuxAmount,
  usdAmount,
  rate,
  pctOfRevenue,
  tone = "default",
  strong = false,
  indent = false,
  childrenRows,
}: {
  label: string;
  color?: string;
  robuxAmount?: number;
  usdAmount: number;
  rate?: number;
  pctOfRevenue: number | null;
  tone?: "default" | "positive" | "negative" | "alert" | "muted";
  strong?: boolean;
  indent?: boolean;
  childrenRows?: Array<{
    label: string;
    color?: string;
    usdAmount: number;
    robuxAmount?: number;
    pctOfRevenue: number | null;
  }>;
}) {
  return (
    <>
      <div
        className={`flex items-center gap-3 px-5 py-1.5 text-xs ${strong ? "border-y border-border-1 bg-surface-1/30" : ""}`}
      >
        <span className="w-4 text-center text-text-disabled">
          {childrenRows && childrenRows.length > 0 ? "▸" : ""}
        </span>
        <span
          className={`flex flex-1 items-center gap-2 ${indent ? "pl-4" : ""} ${strong ? "font-semibold text-text-1" : "text-text-2"}`}
        >
          {color ? (
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: color }}
            />
          ) : null}
          {label}
        </span>
        <MoneyCell className="w-40">
          {robuxAmount != null && robuxAmount !== 0 ? (
            <Money
              amount={robuxAmount}
              currency="robux"
              rate={rate}
              showSecondary
              signed
              tone={tone}
            />
          ) : (
            <span className="text-text-disabled">—</span>
          )}
        </MoneyCell>
        <MoneyCell className="w-32">
          <Money
            amount={usdAmount}
            currency="usd"
            signed
            tone={tone}
            showRail={false}
          />
        </MoneyCell>
        <span className="w-14 text-right font-mono text-[11px] tabular-nums text-text-disabled">
          {pctOfRevenue != null ? `${Math.round(pctOfRevenue * 100)}%` : "—"}
        </span>
      </div>
      {childrenRows?.map((c) => (
        <div
          key={c.label}
          className="flex items-center gap-3 px-5 py-1 text-[11px]"
        >
          <span className="w-4" />
          <span className="flex flex-1 items-center gap-2 pl-6 text-text-3">
            {c.color ? (
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
            ) : null}
            {c.label}
          </span>
          <MoneyCell className="w-40">
            {c.robuxAmount != null ? (
              <Money
                amount={c.robuxAmount}
                currency="robux"
                signed
                tone="muted"
              />
            ) : (
              <span className="text-text-disabled">—</span>
            )}
          </MoneyCell>
          <MoneyCell className="w-32">
            <Money
              amount={c.usdAmount}
              currency="usd"
              signed
              tone="muted"
              showRail={false}
            />
          </MoneyCell>
          <span className="w-14 text-right font-mono text-[10px] tabular-nums text-text-disabled">
            {c.pctOfRevenue != null
              ? `${Math.round(c.pctOfRevenue * 100)}%`
              : "—"}
          </span>
        </div>
      ))}
    </>
  );
}

/* ------------------------------- cash flow ------------------------------- */
// Two-column column-per-rail view. DevEx is one arrow, not two ledger rows.

function CashFlow({
  overview,
  position,
}: {
  overview: FinanceOverview;
  position: FinancePosition;
}) {
  const b = position.balanceSheet;
  const bal = b.assets;
  // The cash flow shape is a first pass: opening = bal − net movement isn't
  // computed here yet (needs the /statements endpoint). For now, we render
  // closing balances by rail and let DevEx transfer connect the columns.
  const t = overview.tiles;
  const cashout = t.lastCashoutOn != null;
  return (
    <SectionShell title="Cash flow">
      <div className="grid grid-cols-1 gap-px bg-border-1 md:grid-cols-[1fr_auto_1fr]">
        <RailColumn
          title="Robux"
          rows={[
            {
              label: "+ Revenue received",
              amount: overview.tiles.revenueRobux,
              tone: "positive",
            },
            { label: "− Expenses paid", amount: null, tone: "negative" },
            { label: "− Distributions paid", amount: null, tone: "negative" },
            {
              label: "Closing balance",
              amount: bal.robux,
              strong: true,
              tone: bal.robux >= 0 ? "positive" : "negative",
            },
          ]}
          currency="robux"
        />
        <div className="hidden items-center justify-center bg-surface-0 px-3 md:flex">
          <div className="flex flex-col items-center gap-1 text-[10px] text-text-disabled">
            <span>DevEx</span>
            <span
              className="text-lg text-fin-robux"
              title={cashout ? `last cashout ${t.lastCashoutOn}` : "no cashout"}
            >
              →
            </span>
            <span>transfer</span>
          </div>
        </div>
        <RailColumn
          title="USD"
          rows={[
            { label: "+ Revenue received", amount: null, tone: "positive" },
            { label: "+ DevEx", amount: null, tone: "muted" },
            { label: "− Expenses paid", amount: t.spendUsd, tone: "negative" },
            { label: "− Distributions paid", amount: null, tone: "negative" },
            {
              label: "Closing balance",
              amount: bal.usd,
              strong: true,
              tone: bal.usd >= 0 ? "positive" : "negative",
            },
          ]}
          currency="usd"
        />
      </div>
      <div className="px-5 pt-2 text-[10px] text-text-disabled">
        Interim: exact per-line flows resolve once the /finance/statements
        endpoint ships. Closing balances are exact.
      </div>
    </SectionShell>
  );
}

function RailColumn({
  title,
  rows,
  currency,
}: {
  title: string;
  rows: Array<{
    label: string;
    amount: number | null;
    tone?: "default" | "positive" | "negative" | "muted";
    strong?: boolean;
  }>;
  currency: "robux" | "usd";
}) {
  return (
    <div className="bg-surface-0 px-4 py-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {title}
      </div>
      {rows.map((r) => (
        <div
          key={r.label}
          className={`flex items-center justify-between py-1 text-xs ${r.strong ? "border-t border-border-1 pt-2 font-semibold" : ""}`}
        >
          <span className={r.strong ? "text-text-1" : "text-text-3"}>
            {r.label}
          </span>
          <MoneyCell className="w-32">
            {r.amount != null ? (
              <Money
                amount={r.amount}
                currency={currency}
                signed={!r.strong}
                tone={r.tone ?? "default"}
                showRail={false}
              />
            ) : (
              <span className="text-text-disabled">—</span>
            )}
          </MoneyCell>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------ balance sheet ---------------------------- */

function BalanceSheet({ position }: { position: FinancePosition }) {
  const b = position.balanceSheet;
  const bars: Array<{ label: string; value: number; color: string }> = [
    {
      label: "Robux (@ rate)",
      value: b.assets.robuxUsd,
      color: "var(--fin-robux)",
    },
    { label: "USD cash", value: b.assets.usd, color: "var(--fin-positive)" },
  ];
  const liabBars = [
    {
      label: "Unpaid expenses",
      value: b.liabilities.unpaidExpensesUsd,
      color: "var(--fin-negative)",
    },
    {
      label: "Accrued splits",
      value: b.liabilities.accruedSplitsUsd,
      color: "var(--fin-alert)",
    },
  ];
  const equityBars = [
    {
      label: "Capital in",
      value: b.equity.capitalInUsd,
      color: "var(--fin-robux)",
    },
    {
      label: "Retained",
      value: b.equity.retainedEarningsUsd,
      color: "var(--fin-positive)",
    },
  ];
  return (
    <SectionShell title={`Balance sheet · as of ${b.asOf}`}>
      <div className="grid grid-cols-1 gap-px bg-border-1 md:grid-cols-3">
        <SheetColumn title="Assets" total={b.assets.total} rows={bars} />
        <SheetColumn
          title="Liabilities"
          total={b.liabilities.total}
          rows={liabBars}
        />
        <SheetColumn title="Equity" total={b.equity.total} rows={equityBars} />
      </div>
    </SectionShell>
  );
}

function SheetColumn({
  title,
  total,
  rows,
}: {
  title: string;
  total: number;
  rows: Array<{ label: string; value: number; color: string }>;
}) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col bg-surface-0 px-4 py-3">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          {title}
        </span>
        <span className="font-mono text-sm tabular-nums text-text-1">
          {fmtUsdN(total)}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {rows.map((r) => (
          <div key={r.label}>
            <div className="mb-0.5 flex items-baseline justify-between text-[11px]">
              <span className="text-text-3">{r.label}</span>
              <span className="font-mono tabular-nums text-text-2">
                {fmtUsdN(r.value)}
              </span>
            </div>
            <div className="h-1 rounded bg-white/[0.04]">
              <div
                className="h-full rounded"
                style={{
                  width: `${Math.min(100, (Math.abs(r.value) / max) * 100)}%`,
                  backgroundColor: r.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- reconciliation row -------------------------- */

function ReconciliationRow({ position }: { position: FinancePosition }) {
  const b = position.balanceSheet;
  const delta = b.assets.total - b.liabilities.total - b.equity.total;
  const ties = Math.abs(delta) < 0.01;
  return (
    <div
      className={`flex items-center gap-3 border-y border-border-1 px-5 py-3 text-xs ${
        ties ? "" : "bg-fin-alert/[0.08]"
      }`}
    >
      <span className="w-40 font-semibold uppercase tracking-[0.06em] text-text-1">
        Reconciliation
      </span>
      <span className="text-text-3">Computed closing</span>
      <span className="font-mono tabular-nums text-text-1">
        {fmtUsdN(b.assets.total)}
      </span>
      <span className="text-text-3">Recorded</span>
      <span className="font-mono tabular-nums text-text-1">
        {fmtUsdN(b.liabilities.total + b.equity.total)}
      </span>
      <span className="flex-1" />
      <span className="text-text-3">Delta</span>
      <span
        className={`font-mono tabular-nums ${ties ? "text-fin-positive" : "text-fin-alert"}`}
      >
        {fmtUsdN(delta, { signed: true })}
      </span>
      <span className={ties ? "text-fin-positive" : "text-fin-alert"}>
        {ties ? "✓ ties out" : "△ investigate"}
      </span>
    </div>
  );
}

/* ---------------------------- cost attribution --------------------------- */

function CostAttribution({ overview }: { overview: FinanceOverview }) {
  const total = overview.tiles.spendUsd;
  const bars = overview.byCategory.slice(0, 12);
  const max = Math.max(1, ...bars.map((b) => b.spendUsd));
  return (
    <SectionShell title="Cost attribution — by category">
      <div className="flex flex-col gap-1.5 px-5 py-3">
        {bars.length === 0 ? (
          <div className="text-xs text-text-disabled">
            Nothing spent in this period.
          </div>
        ) : null}
        {bars.map((b) => (
          <div key={b.id} className="flex items-center gap-3 text-xs">
            <span className="w-32 shrink-0 truncate text-text-2">{b.name}</span>
            <div className="flex-1">
              <div className="h-2 rounded bg-white/[0.04]">
                <div
                  className="h-full rounded"
                  style={{
                    width: `${(b.spendUsd / max) * 100}%`,
                    backgroundColor: b.color,
                  }}
                />
              </div>
            </div>
            <span className="w-24 text-right font-mono tabular-nums text-text-1">
              {fmtUsdN(b.spendUsd)}
            </span>
            <span className="w-10 text-right font-mono text-[10px] tabular-nums text-text-disabled">
              {total > 0 ? `${Math.round((b.spendUsd / total) * 100)}%` : "—"}
            </span>
          </div>
        ))}
      </div>
    </SectionShell>
  );
}

/* --------------------------------- recoup -------------------------------- */

function Recoup({ position }: { position: FinancePosition }) {
  const be = position.breakeven;
  if (be.investedUsd <= 0) return null;
  const fully = be.returnedUsd >= be.investedUsd;
  const surplus = fully ? be.returnedUsd - be.investedUsd : 0;
  return (
    <div className="border-t border-border-1 bg-surface-0 px-5 py-3 text-xs">
      <span className="mr-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        Recoup
      </span>
      <span className="text-text-3">Capital in</span>{" "}
      <span className="font-mono tabular-nums text-text-1">
        {fmtUsdN(be.investedUsd)}
      </span>
      <span className="mx-2 text-text-disabled">·</span>
      {fully ? (
        <>
          <span className="text-fin-positive">fully recouped</span>{" "}
          {surplus > 0 ? (
            <>
              <span className="text-text-3">surplus</span>{" "}
              <span className="font-mono tabular-nums text-fin-positive">
                {fmtUsdN(surplus)}
              </span>
            </>
          ) : null}
        </>
      ) : (
        <>
          <span className="text-text-3">returned</span>{" "}
          <span className="font-mono tabular-nums text-text-1">
            {fmtUsdN(be.returnedUsd)}
          </span>{" "}
          <span className="text-text-disabled">
            ({Math.round((be.pct ?? 0) * 100)}%)
          </span>
        </>
      )}
    </div>
  );
}

/* --------------------------------- shell --------------------------------- */

function SectionShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-b border-border-1">
      <div className="flex items-center gap-2 border-b border-border-1 bg-surface-0 px-5 py-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          {title}
        </span>
      </div>
      <div className="bg-surface-0">{children}</div>
    </div>
  );
}
