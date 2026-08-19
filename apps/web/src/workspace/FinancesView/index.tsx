// Finances — top-level tab (spec §3, §7). Overview is "This month" (month
// nav, five tiles, 12-month chart) — the two-second read, never blocked by
// anything below it — plus the lazily-loaded Position zone. Ledger and
// People are sibling sub-tabs (?tab=). The composer (N) is mounted here so
// it's reachable from any sub-tab.

import type { FinanceKind, FinanceOverview } from "@monkyesuite/shared";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { fmtRobux, fmtUsd, fmtUsdSigned } from "../../lib/format";
import { Composer } from "./Composer";
import {
  ArcGauge,
  PieDonut,
  RevenueSpendChart,
  Sparkline,
  SplitBar,
} from "./charts";
import { LedgerView } from "./LedgerView";
import { PeopleView } from "./PeopleView";
import { PositionZone } from "./PositionZone";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

function monthLabel(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(d)
    .toUpperCase();
}

type FinTab = "overview" | "ledger" | "people";

export function FinancesView({ projectId }: { projectId: string }) {
  const [month, setMonth] = useState(currentMonth);
  const [tab, setTab] = useState<FinTab>("overview");
  const [ledgerMode, setLedgerMode] = useState<"transactions" | "owed">(
    "transactions",
  );
  const [composerOpen, setComposerOpen] = useState(false);
  const [lastKind, setLastKind] = useState<FinanceKind>("expense");
  const [composerPrefill, setComposerPrefill] = useState<{
    kind: FinanceKind;
    personId?: string | null;
  } | null>(null);

  const openComposer = (prefill?: {
    kind: FinanceKind;
    personId?: string | null;
  }) => {
    setComposerPrefill(prefill ?? null);
    setComposerOpen(true);
  };

  // keepPreviousData: month nav ([ / ]) and Overview↔tab switches make a new
  // query key each time; without this every switch dropped to a skeleton even
  // though we had the prior month on screen. Now the old numbers stay painted
  // and revalidate behind an isFetching shimmer — the "smooth" the page needs.
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["finance-overview", projectId, month],
    queryFn: () => api.financeOverview(projectId, month),
    placeholderData: keepPreviousData,
  });
  // Aux data (categories + people) is only needed by the composer and the
  // Ledger/People tabs — defer it so the Overview's one round trip isn't
  // racing two more on first paint. Warms as soon as anything needs it.
  const needAux = composerOpen || tab !== "overview";
  const { data: categories } = useQuery({
    queryKey: ["finance-categories", projectId],
    queryFn: () => api.financeCategories(projectId),
    enabled: needAux,
    staleTime: 5 * 60_000,
  });
  const { data: people } = useQuery({
    queryKey: ["finance-people", projectId],
    queryFn: () => api.financePeople(projectId),
    enabled: needAux,
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (composerOpen) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setComposerPrefill(null);
        setComposerOpen(true);
      } else if (e.key === "[") {
        setMonth((m) => shiftMonth(m, -1));
      } else if (e.key === "]") {
        setMonth((m) => shiftMonth(m, 1));
      } else if (e.key === "t" || e.key === "T") {
        setMonth(currentMonth());
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composerOpen]);

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-5 py-2.5">
        <div className="flex gap-0.5">
          <SubTab
            active={tab === "overview"}
            onClick={() => setTab("overview")}
          >
            Overview
          </SubTab>
          <SubTab active={tab === "ledger"} onClick={() => setTab("ledger")}>
            Ledger
          </SubTab>
          <SubTab active={tab === "people"} onClick={() => setTab("people")}>
            People
          </SubTab>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => openComposer()}
          className="rounded bg-accent-warm px-2.5 py-1 text-xs font-semibold text-[#1a1000] transition-colors hover:brightness-110"
        >
          Log <span className="ml-1 opacity-70">N</span>
        </button>
      </div>

      {tab === "overview" ? (
        <OverviewTab
          projectId={projectId}
          month={month}
          setMonth={setMonth}
          data={data}
          isLoading={isLoading}
          isFetching={isFetching}
          error={!!error}
          onGoToOwed={() => {
            setLedgerMode("owed");
            setTab("ledger");
          }}
        />
      ) : tab === "ledger" ? (
        <LedgerView
          projectId={projectId}
          categories={categories ?? []}
          mode={ledgerMode}
          onModeChange={setLedgerMode}
          onPay={(personId) => openComposer({ kind: "distribution", personId })}
        />
      ) : (
        <PeopleView projectId={projectId} />
      )}

      <Composer
        projectId={projectId}
        open={composerOpen}
        onOpenChange={setComposerOpen}
        categories={categories ?? []}
        people={people ?? []}
        lastKind={lastKind}
        onLastKind={setLastKind}
        prefill={composerPrefill}
      />
    </div>
  );
}

// Thin labeled band divider — pairs with the Position zone's own header so the
// page reads as two clear bands: "This month" vs "Position".
function BandHeader({ label }: { label: string }) {
  return (
    <div className="border-y border-border-1 bg-surface-0 px-5 py-2">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {label}
      </span>
    </div>
  );
}

function SubTab({
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
      className={`rounded px-2.5 py-1 text-xs transition-colors ${
        active ? "bg-white/[0.06] text-text-1" : "text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

function OverviewTab({
  month,
  setMonth,
  data,
  isLoading,
  isFetching,
  error,
  projectId,
  onGoToOwed,
}: {
  projectId: string;
  month: string;
  setMonth: (m: string) => void;
  data: FinanceOverview | undefined;
  isLoading: boolean;
  isFetching: boolean;
  error: boolean;
  onGoToOwed: () => void;
}) {
  // Only the very first load (no cached data at all) shows the skeleton.
  // Month nav keeps the prior data painted; the shimmer below signals refresh.
  if (isLoading && !data) {
    return (
      <div className="flex-1 ws-scroll overflow-y-auto p-5">
        <FinanceSkeleton />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex flex-1 items-center justify-center p-10 text-sm text-text-3">
        Couldn't load finances.
      </div>
    );
  }

  // Stale month data reads dimmed while the new month revalidates, so the page
  // never snaps between an empty skeleton and full data.
  const stale = isFetching && data.month !== month;
  return (
    <div className="flex-1 ws-scroll overflow-y-auto">
      <MonthNav month={month} setMonth={setMonth} loading={stale} />
      <div
        className={
          stale ? "opacity-60 transition-opacity" : "transition-opacity"
        }
      >
        <HeroBand data={data} />
        <ComboChart data={data} onSelectMonth={setMonth} />
        <BandHeader label="This month" />
        <div className="grid grid-cols-1 gap-px bg-border-1 md:grid-cols-3">
          <WhereItWent data={data} />
          <SplitsDonutCard projectId={projectId} />
          <BudgetRingCard data={data} />
        </div>
        <OwedFlag data={data} onGoToOwed={onGoToOwed} />
      </div>
      <PositionZone projectId={projectId} activeMonth={month} />
    </div>
  );
}

function MonthNav({
  month,
  setMonth,
  loading = false,
}: {
  month: string;
  setMonth: (m: string) => void;
  loading?: boolean;
}) {
  const isCurrent = month === currentMonth();
  return (
    <div className="flex items-center gap-3 border-b border-border-1 bg-surface-0 px-5 py-3">
      <button
        type="button"
        onClick={() => setMonth(shiftMonth(month, -1))}
        className="rounded px-1.5 py-1 text-text-3 hover:text-text-1"
        aria-label="Previous month"
      >
        ‹
      </button>
      <div className="text-sm font-semibold tracking-[0.06em] text-text-1">
        {monthLabel(month)}
      </div>
      <button
        type="button"
        onClick={() => setMonth(shiftMonth(month, 1))}
        className="rounded px-1.5 py-1 text-text-3 hover:text-text-1"
        aria-label="Next month"
      >
        ›
      </button>
      {loading ? (
        <span
          role="status"
          title="Loading"
          className="h-2.5 w-2.5 animate-spin rounded-full border border-text-disabled border-t-text-2"
        />
      ) : null}
      {!isCurrent ? (
        <button
          type="button"
          onClick={() => setMonth(currentMonth())}
          className="rounded border border-border-2 px-2 py-0.5 text-xs text-text-3 hover:text-text-1"
        >
          Today
        </button>
      ) : null}
    </div>
  );
}

// --- the two-second read: three graphical hero cards (spec §7.1) ---

function HeroCard({
  label,
  right,
  children,
}: {
  label: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1 border-r border-border-1 bg-surface-0 px-4 py-3 last:border-r-0">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
          {label}
        </span>
        {right}
      </div>
      {children}
    </div>
  );
}

function HeroBand({ data }: { data: FinanceOverview }) {
  const t = data.tiles;
  const netColor =
    t.netUsd > 0
      ? "text-fin-positive"
      : t.netUsd < 0
        ? "text-fin-negative"
        : "text-text-1";
  const netSeries = data.series.map((s) => s.netUsd);
  const sparkColor =
    t.netUsd >= 0 ? "var(--fin-positive)" : "var(--fin-negative)";

  // Runway gauge: fill a 24-month arc; beyond that reads "full".
  const runwayRatio = t.runwayMonths != null ? t.runwayMonths / 24 : 0;
  const runwayColor =
    t.runwayMonths == null
      ? "var(--fin-robux)"
      : t.runwayMonths >= 6
        ? "var(--fin-positive)"
        : t.runwayMonths >= 3
          ? "var(--fin-negative)"
          : "var(--fin-alert)";

  const robuxUsd = t.robuxBalance * data.rate;

  return (
    <div className="grid grid-cols-1 border-b border-border-1 md:grid-cols-3">
      {/* Net + trend */}
      <HeroCard
        label="Net"
        right={
          t.netDeltaPct != null ? (
            <span
              className={`font-mono text-[11px] ${t.netDeltaPct >= 0 ? "text-fin-positive" : "text-fin-negative"}`}
            >
              {t.netDeltaPct >= 0 ? "▲" : "▼"}{" "}
              {Math.abs(Math.round(t.netDeltaPct * 100))}%
            </span>
          ) : undefined
        }
      >
        <span className={`font-mono text-2xl tabular-nums ${netColor}`}>
          {fmtUsdSigned(t.netUsd)}
        </span>
        <div className="my-1">
          <Sparkline values={netSeries} color={sparkColor} height={30} />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-text-disabled">
          rev {fmtUsd(t.revenueUsd)} · spend {fmtUsd(t.spendUsd)}
        </span>
      </HeroCard>

      {/* Runway gauge */}
      <HeroCard label="Runway">
        {data.openingSet && t.runwayMonths != null ? (
          <div className="flex items-center gap-3">
            <ArcGauge
              ratio={runwayRatio}
              color={runwayColor}
              center={
                t.runwayMonths >= 24
                  ? "24+"
                  : String(Math.round(t.runwayMonths))
              }
              sub="months"
            />
            <div className="font-mono text-[11px] leading-relaxed text-text-3">
              <div className="text-text-1">at {fmtUsd(t.spendUsd)}/mo</div>
              <div className="text-text-disabled">trailing burn</div>
            </div>
          </div>
        ) : (
          <div className="flex h-[72px] items-center text-xs text-text-disabled">
            Set opening balances to see runway.
          </div>
        )}
      </HeroCard>

      {/* Position split */}
      <HeroCard label="Position">
        <span className="font-mono text-2xl tabular-nums text-text-1">
          {fmtUsd(t.positionUsd)}
        </span>
        <div className="my-2">
          <SplitBar
            segments={[
              { label: "robux", value: robuxUsd, color: "var(--fin-robux)" },
              {
                label: "cash",
                value: t.usdBalance,
                color: "var(--fin-positive)",
              },
            ]}
          />
        </div>
        <span className="font-mono text-[11px] tabular-nums text-text-disabled">
          <span className="text-fin-robux">■</span> {fmtRobux(t.robuxBalance)} ·{" "}
          <span className="text-fin-positive">■</span> {fmtUsd(t.usdBalance)}{" "}
          cash
        </span>
      </HeroCard>
    </div>
  );
}

// --- signature chart: revenue up / spend down bars + net line (spec §7.1) ---

function ComboChart({
  data,
  onSelectMonth,
}: {
  data: FinanceOverview;
  onSelectMonth: (m: string) => void;
}) {
  return (
    <div className="border-b border-border-1 bg-surface-0 px-5 py-4">
      <div className="mb-2 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        <span>Revenue vs spend</span>
        <span className="flex gap-3 normal-case tracking-normal">
          <span className="text-fin-positive">— revenue</span>
          <span className="text-fin-negative">— spend</span>
          <span className="text-fin-positive">▨ profit</span>
        </span>
      </div>
      <RevenueSpendChart
        series={data.series}
        activeMonth={data.month}
        onSelectMonth={onSelectMonth}
      />
    </div>
  );
}

// Short USD for donut centers, where a full "$4,976.73" overflows the hole.
function fmtUsdCompact(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `$${Math.round(n / 1_000)}k`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${Math.round(n)}`;
}

function CardShell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface-0 px-5 py-4">
      <div className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {title}
      </div>
      {children}
    </div>
  );
}

function WhereItWent({ data }: { data: FinanceOverview }) {
  const t = data.tiles;
  if (data.byCategory.length === 0) {
    return (
      <CardShell title="Where it went">
        <div className="flex h-[132px] items-center text-sm text-text-disabled">
          Nothing spent this month.
        </div>
      </CardShell>
    );
  }
  return (
    <CardShell title="Where it went">
      <div className="flex items-center gap-6">
        <PieDonut
          segments={data.byCategory.map((c) => ({
            label: c.name,
            value: c.spendUsd,
            color: c.color,
          }))}
          center={
            <>
              <span className="font-mono text-lg tabular-nums text-text-1">
                {fmtUsdCompact(t.spendUsd)}
              </span>
              <span className="mt-0.5 text-[10px] uppercase tracking-wide text-text-disabled">
                spent
              </span>
            </>
          }
        />
        <div className="flex flex-1 flex-col gap-1.5">
          {data.byCategory.slice(0, 6).map((c) => (
            <div key={c.id} className="flex items-center gap-2 text-[11px]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              <span className="flex-1 truncate text-text-3">{c.name}</span>
              <span className="font-mono tabular-nums text-text-1">
                {fmtUsd(c.spendUsd)}
              </span>
              <span className="w-8 text-right font-mono tabular-nums text-text-disabled">
                {Math.round(c.pct * 100)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

// Palette for split-owner segments — "you" is the muted robux grey; partners
// cycle through these. Kept in sync with the People/splits colouring.
const SPLIT_COLORS = [
  "#E5A83C",
  "#5B8DEF",
  "#B07CE8",
  "#3DD68C",
  "#E86A9B",
  "#4FC3D9",
];

// Revenue-splits allocation donut: your unallocated remainder + each ACTIVE
// split. Fetched separately from /overview (secondary viz, never blocks the
// two-second read). your% = 100 − Σ active percentages.
function SplitsDonutCard({ projectId }: { projectId: string }) {
  const { data: splits } = useQuery({
    queryKey: ["finance-splits", projectId],
    queryFn: () => api.financeSplits(projectId),
    staleTime: 60_000,
  });
  const active = (splits ?? []).filter((s) => s.effectiveTo == null);
  const allocated = active.reduce((sum, s) => sum + s.percent, 0);
  const yourPct = Math.max(0, 100 - allocated);

  if (!splits) {
    return (
      <CardShell title="Revenue splits">
        <div className="h-[132px] animate-pulse rounded bg-white/[0.04]" />
      </CardShell>
    );
  }
  if (active.length === 0) {
    return (
      <CardShell title="Revenue splits">
        <div className="flex h-[132px] items-center text-sm text-text-disabled">
          No active splits — everything you earn is yours.
        </div>
      </CardShell>
    );
  }
  const segments = [
    { label: "you", value: yourPct, color: "var(--fin-robux)" },
    ...active.map((s, i) => ({
      label: s.person.discordHandle,
      value: s.percent,
      color: SPLIT_COLORS[i % SPLIT_COLORS.length] as string,
    })),
  ];
  return (
    <CardShell title="Revenue splits">
      <div className="flex items-center gap-6">
        <PieDonut
          segments={segments}
          center={
            <>
              <span className="text-[10px] uppercase tracking-wide text-text-disabled">
                you
              </span>
              <span className="font-mono text-lg tabular-nums text-text-1">
                {Math.round(yourPct)}%
              </span>
            </>
          }
        />
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: "var(--fin-robux)" }}
            />
            <span className="flex-1 text-text-2">you</span>
            <span className="font-mono tabular-nums text-text-1">
              {Math.round(yourPct)}%
            </span>
          </div>
          {active.slice(0, 5).map((s, i) => (
            <div key={s.id} className="flex items-center gap-2 text-[11px]">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{
                  backgroundColor: SPLIT_COLORS[i % SPLIT_COLORS.length],
                }}
              />
              <span className="flex-1 truncate text-text-3">
                {s.person.discordHandle}
              </span>
              <span className="font-mono tabular-nums text-text-1">
                {s.percent}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

function BudgetRingCard({ data }: { data: FinanceOverview }) {
  const t = data.tiles;
  const pct = t.budgetPct;
  const color =
    pct == null
      ? "var(--fin-positive)"
      : pct >= 1
        ? "var(--fin-alert)"
        : pct >= 0.85
          ? "var(--fin-negative)"
          : "var(--fin-positive)";
  return (
    <CardShell title={`Budget · ${monthShort(data.month)}`}>
      {t.budgetUsd != null && pct != null ? (
        <div className="flex items-center gap-6">
          <PieDonut
            segments={
              pct >= 1
                ? [{ label: "spent", value: 1, color }]
                : [
                    { label: "spent", value: t.spendUsd, color },
                    {
                      label: "left",
                      value: Math.max(0, t.budgetUsd - t.spendUsd),
                      color: "rgba(255,255,255,0.06)",
                    },
                  ]
            }
            center={
              <span
                className={`font-mono text-xl tabular-nums ${pct >= 1 ? "text-fin-alert" : "text-text-1"}`}
              >
                {Math.round(pct * 100)}%
              </span>
            }
          />
          <div className="flex flex-1 flex-col gap-0.5 font-mono text-xs tabular-nums">
            <span className="text-sm text-text-1">{fmtUsd(t.spendUsd)}</span>
            <span className="text-[11px] text-text-disabled">
              of {fmtUsd(t.budgetUsd)}
            </span>
            {pct >= 1 ? (
              <span className="mt-1.5 text-[11px] text-fin-alert">
                over by {fmtUsd(t.spendUsd - t.budgetUsd)}
              </span>
            ) : (
              <span className="mt-1.5 text-[11px] text-text-3">
                {fmtUsd(t.budgetUsd - t.spendUsd)} left
              </span>
            )}
          </div>
        </div>
      ) : (
        <div className="flex h-[132px] items-center text-sm text-text-disabled">
          No budget set for this month.
        </div>
      )}
    </CardShell>
  );
}

function monthShort(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)));
}

// One-line owed flag: total + count, jumps to the Ledger's Owed view where the
// actionable per-person settlement list lives. Owed is a to-pay queue, not a
// dashboard metric, so the overview only surfaces the headline.
function OwedFlag({
  data,
  onGoToOwed,
}: {
  data: FinanceOverview;
  onGoToOwed: () => void;
}) {
  const people = new Set(data.owed.map((o) => o.person?.id ?? o.ref)).size;
  const total = data.owed.reduce((s, o) => s + o.amountUsd, 0);
  if (data.owed.length === 0) {
    return (
      <div className="border-t border-border-1 bg-surface-0 px-5 py-3 text-xs text-text-disabled">
        Nothing owed — you're all settled.
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onGoToOwed}
      className="group flex w-full items-center gap-3 border-t border-border-1 bg-fin-alert/[0.07] px-5 py-3 text-left transition-colors hover:bg-fin-alert/[0.11]"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-fin-alert" />
      <span className="font-mono text-sm tabular-nums text-text-1">
        {fmtUsd(total)}
      </span>
      <span className="text-xs text-text-3">
        owed to {people} {people === 1 ? "person" : "people"}
      </span>
      <span className="flex-1" />
      <span className="text-xs text-text-3 group-hover:text-text-1">
        Settle up →
      </span>
    </button>
  );
}

function FinanceSkeleton() {
  return (
    <div className="animate-pulse space-y-3">
      <div className="h-16 rounded bg-white/[0.04]" />
      <div className="h-40 rounded bg-white/[0.04]" />
      <div className="h-40 rounded bg-white/[0.04]" />
    </div>
  );
}
