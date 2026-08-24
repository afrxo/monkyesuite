// Ledger tab (spec §7.2). Mirrors List view's grammar: month groups with
// roll-ups, right-aligned tabular figures, native-currency column muted mono.
// Capital and payout rows are excluded from a group's revenue/spend/net and
// get their own header line instead (spec: a month you funded yourself must
// not read as a good month).

import type {
  FinanceCategory,
  FinanceKind,
  FinanceTransaction,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toastError } from "../../components/Toast";
import { api } from "../../lib/api";
import { fmtRobux, fmtUsd, fmtUsdSigned } from "../../lib/format";
import { Money, MoneyCell } from "./Money";
import type { Period } from "./PeriodControl";

const KIND_FILTERS: { kind: FinanceKind | "all"; label: string }[] = [
  { kind: "all", label: "All" },
  { kind: "revenue", label: "Earned" },
  { kind: "expense", label: "Expense" },
  { kind: "cashout", label: "Cash-out" },
  { kind: "investment", label: "Capital" },
  { kind: "distribution", label: "Payout" },
];

const KIND_GLYPH: Record<FinanceKind, string> = {
  revenue: "↑",
  expense: "●",
  cashout: "⇄",
  investment: "◈",
  distribution: "◇",
};

// Short, human method labels — the raw enum ("robux_group_payout") is ugly and
// gets truncated in the column.
const METHOD_LABEL: Record<string, string> = {
  robux_gamepass: "Gamepass",
  robux_group_payout: "Group",
  paypal: "PayPal",
  wise: "Wise",
  bank: "Bank",
  devex: "DevEx",
};
function methodLabel(m: string | null): string {
  if (!m) return "—";
  return METHOD_LABEL[m] ?? m;
}

function monthOf(occurredOn: string): string {
  return occurredOn.slice(0, 7);
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, 1)));
}

export function LedgerView({
  projectId,
  categories,
  period: _period,
  onPay: _onPay,
}: {
  projectId: string;
  categories: FinanceCategory[];
  period: Period;
  onPay: (personId: string) => void;
}) {
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<FinanceKind | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const { data, isLoading } = useQuery({
    queryKey: ["finance-transactions", projectId],
    queryFn: () => api.financeTransactions(projectId, {}),
  });

  const settle = useMutation({
    mutationFn: (txId: string) =>
      api.patchFinanceTx(txId, {
        status: "paid",
        paidOn: new Date().toISOString().slice(0, 10),
      }),
    onMutate: async (txId) => {
      await qc.cancelQueries({ queryKey: ["finance-transactions", projectId] });
      const snapshot = qc.getQueryData(["finance-transactions", projectId]);
      qc.setQueryData<{ items: FinanceTransaction[] } | undefined>(
        ["finance-transactions", projectId],
        (old) =>
          old
            ? {
                ...old,
                items: old.items.map((t) =>
                  t.id === txId ? { ...t, status: "paid" as const } : t,
                ),
              }
            : old,
      );
      return { snapshot };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.snapshot)
        qc.setQueryData(["finance-transactions", projectId], ctx.snapshot);
      toastError(err, "Failed to mark paid.");
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["finance-transactions", projectId] });
      qc.invalidateQueries({ queryKey: ["finance-overview", projectId] });
    },
  });

  const filtered = useMemo(() => {
    const items = data?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((t) => {
      if (kindFilter !== "all" && t.kind !== kindFilter) return false;
      if (categoryFilter && t.category?.id !== categoryFilter) return false;
      if (q) {
        const hay =
          `${t.description} ${t.ref} ${t.person?.discordHandle ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [data, kindFilter, categoryFilter, query]);

  const groups = useMemo(() => {
    const by = new Map<string, FinanceTransaction[]>();
    for (const t of filtered) {
      const key = monthOf(t.occurredOn);
      const arr = by.get(key);
      if (arr) arr.push(t);
      else by.set(key, [t]);
    }
    return [...by.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="flex-1 space-y-2 ws-scroll overflow-y-auto p-5">
        <div className="h-8 animate-pulse rounded bg-white/[0.04]" />
        <div className="h-40 animate-pulse rounded bg-white/[0.04]" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      <TransactionsBody />
    </div>
  );

  function TransactionsBody() {
    return (
      <>
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border-1 bg-surface-0 px-5 py-2.5">
          {KIND_FILTERS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => setKindFilter(k.kind)}
              className={`rounded border px-2 py-1 text-[11px] transition-colors ${
                kindFilter === k.kind
                  ? "border-border-2 bg-white/[0.06] text-text-1"
                  : "border-transparent text-text-3 hover:text-text-1"
              }`}
            >
              {k.label}
            </button>
          ))}
          <div className="mx-1 h-4 w-px bg-border-2" />
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() =>
                setCategoryFilter((prev) => (prev === c.id ? null : c.id))
              }
              className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] transition-opacity ${
                categoryFilter === c.id ? "" : "opacity-60 hover:opacity-100"
              }`}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: c.color }}
              />
              {c.name}
            </button>
          ))}
          <div className="flex-1" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            className="w-40 rounded border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-1 outline-none placeholder:text-text-disabled focus:border-text-5"
          />
        </div>

        <LedgerColumnHeader />
        <div className="flex-1 ws-scroll overflow-y-auto">
          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-center text-sm text-text-disabled">
              No entries match these filters.
              {kindFilter !== "all" || categoryFilter || query ? (
                <button
                  type="button"
                  onClick={() => {
                    setKindFilter("all");
                    setCategoryFilter(null);
                    setQuery("");
                  }}
                  className="rounded border border-border-2 px-2.5 py-1 text-xs text-text-3 hover:text-text-1"
                >
                  Clear filters
                </button>
              ) : null}
            </div>
          ) : (
            groups.map(([month, rows]) => (
              <MonthGroup
                key={month}
                month={month}
                rows={rows}
                collapsed={collapsed.has(month)}
                onToggle={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(month)) next.delete(month);
                    else next.add(month);
                    return next;
                  })
                }
                onSettle={(id) => settle.mutate(id)}
              />
            ))
          )}
        </div>
      </>
    );
  }
}

function MonthGroup({
  month,
  rows,
  collapsed,
  onToggle,
  onSettle,
}: {
  month: string;
  rows: FinanceTransaction[];
  collapsed: boolean;
  onToggle: () => void;
  onSettle: (txId: string) => void;
}) {
  const revenueUsd = rows
    .filter((t) => t.kind === "revenue")
    .reduce((s, t) => s + t.amountUsd, 0);
  const spendUsd = rows
    .filter((t) => t.kind === "expense" && t.status === "paid")
    .reduce((s, t) => s + t.amountUsd, 0);
  const capitalUsd = rows
    .filter((t) => t.kind === "investment")
    .reduce((s, t) => s + t.amountUsd, 0);
  const payoutUsd = rows
    .filter((t) => t.kind === "distribution")
    .reduce((s, t) => s + t.amountUsd, 0);
  const netUsd = revenueUsd - spendUsd;

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 border-b border-border-1 bg-surface-1/40 px-5 py-2.5 text-left"
      >
        <span className="w-4 text-text-disabled">{collapsed ? "▸" : "▾"}</span>
        <span className="w-36 shrink-0 text-sm font-semibold tracking-[0.02em] text-text-1">
          {monthLabel(month)}
        </span>
        <span className="flex-1" />
        <div className="flex items-center gap-5">
          <HeaderStat
            label="earned"
            value={fmtUsdSigned(revenueUsd)}
            color="text-fin-positive"
          />
          <HeaderStat
            label="spent"
            value={fmtUsdSigned(-spendUsd)}
            color="text-fin-negative"
          />
          <HeaderStat
            label="net"
            value={fmtUsdSigned(netUsd)}
            color={netUsd >= 0 ? "text-fin-positive" : "text-fin-alert"}
            strong
          />
          {capitalUsd > 0 ? (
            <HeaderStat
              label="capital"
              value={`+${fmtUsd(capitalUsd)}`}
              color="text-fin-robux"
            />
          ) : null}
          {payoutUsd > 0 ? (
            <HeaderStat
              label="payouts"
              value={`−${fmtUsd(payoutUsd)}`}
              color="text-fin-robux"
            />
          ) : null}
        </div>
      </button>
      {!collapsed
        ? rows.map((t) => <Row key={t.id} tx={t} onSettle={onSettle} />)
        : null}
    </div>
  );
}

// One labelled figure in a month roll-up header: a muted caption over the
// signed value, right-aligned so the columns stack across month groups.
function HeaderStat({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: string;
  color: string;
  strong?: boolean;
}) {
  return (
    <span className="flex w-24 flex-col items-end leading-tight">
      <span className="text-[9px] uppercase tracking-[0.08em] text-text-disabled">
        {label}
      </span>
      <span
        className={`font-mono text-xs tabular-nums ${color} ${strong ? "font-semibold" : ""}`}
      >
        {value}
      </span>
    </span>
  );
}

function Row({
  tx,
  onSettle,
}: {
  tx: FinanceTransaction;
  onSettle: (txId: string) => void;
}) {
  const isMuted = tx.kind === "investment" || tx.kind === "distribution";
  const usdColor =
    tx.kind === "revenue"
      ? "text-fin-positive"
      : tx.kind === "expense"
        ? "text-fin-negative"
        : "text-fin-robux";
  const owed = tx.status === "owed";
  const sign = tx.kind === "revenue" ? "+" : tx.kind === "expense" ? "−" : "";
  const amountColor = owed
    ? "text-text-1"
    : isMuted
      ? "text-fin-robux"
      : usdColor;
  return (
    <div
      className={`group flex items-center gap-3 border-b border-border-1 px-5 py-2 text-xs ${
        owed
          ? "bg-fin-alert/[0.07] hover:bg-fin-alert/[0.11]"
          : "hover:bg-white/[0.02]"
      }`}
    >
      <span className="w-14 shrink-0 font-mono text-text-disabled">
        {tx.occurredOn.slice(5)}
      </span>
      <StatusGlyph tx={tx} />
      <span className="w-24 shrink-0 truncate text-text-2">
        {tx.person?.discordHandle ?? "—"}
      </span>
      <span className="flex-1 truncate text-text-1">{tx.description}</span>
      <span className="w-20 shrink-0 text-text-3">
        {methodLabel(tx.method)}
      </span>
      <span className="flex w-32 shrink-0 items-center gap-1.5">
        {tx.category ? (
          <>
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ backgroundColor: tx.category.color }}
            />
            <span className="truncate text-text-3">{tx.category.name}</span>
          </>
        ) : (
          <span className="text-text-disabled">—</span>
        )}
      </span>
      <MoneyCell className="w-28 shrink-0">
        {tx.currency === "robux" && tx.amountGross != null ? (
          <Money
            amount={
              (tx.kind === "expense" || tx.kind === "distribution" ? -1 : 1) *
              (tx.robuxOut ?? tx.costAmount ?? tx.amountGross)
            }
            currency="robux"
            signed
            tone={
              tx.kind === "revenue" || tx.kind === "investment"
                ? "positive"
                : "negative"
            }
            showRail={false}
          />
        ) : (
          <span className="text-text-disabled">—</span>
        )}
      </MoneyCell>
      <MoneyCell className="w-24 shrink-0">
        <Money
          amount={
            (isMuted
              ? tx.kind === "investment"
                ? 1
                : -1
              : sign === "+"
                ? 1
                : sign === "−"
                  ? -1
                  : 1) * tx.amountUsd
          }
          currency="usd"
          signed
          tone={
            owed
              ? "alert"
              : tx.kind === "revenue" || tx.kind === "investment"
                ? "positive"
                : tx.kind === "expense" || tx.kind === "distribution"
                  ? "negative"
                  : "default"
          }
          showRail={false}
          className={amountColor}
        />
      </MoneyCell>
      {/* running-balance cell: dims the rail this row did not move */}
      <span className="flex w-40 shrink-0 flex-col items-end leading-tight">
        <span
          className={`font-mono text-[11px] tabular-nums ${
            tx.runningBalanceRobux != null
              ? "text-fin-robux"
              : "text-text-disabled"
          }`}
        >
          {tx.runningBalanceRobux != null
            ? fmtRobux(tx.runningBalanceRobux)
            : "·"}
        </span>
        <span
          className={`font-mono text-[10px] tabular-nums ${
            tx.runningBalanceUsd != null
              ? "text-fin-positive"
              : "text-text-disabled"
          }`}
        >
          {tx.runningBalanceUsd != null ? fmtUsd(tx.runningBalanceUsd) : "·"}
        </span>
      </span>
      {/* action slot — reserved width so amounts stay aligned */}
      <span className="flex w-20 shrink-0 justify-end">
        {owed ? (
          <button
            type="button"
            onClick={() => onSettle(tx.id)}
            className="rounded border border-border-2 px-2 py-0.5 text-[11px] text-text-3 opacity-0 transition-colors transition-opacity hover:border-fin-positive/50 hover:text-fin-positive group-hover:opacity-100 focus:opacity-100"
          >
            Mark paid
          </button>
        ) : null}
      </span>
    </div>
  );
}

// Sticky column header row, matches the Row column widths below.
function LedgerColumnHeader() {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border-1 bg-surface-1/60 px-5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-text-disabled backdrop-blur">
      <span className="w-14 shrink-0">Date</span>
      <span className="w-4" />
      <span className="w-24 shrink-0">Person</span>
      <span className="flex-1">Description</span>
      <span className="w-20 shrink-0">Rail</span>
      <span className="w-32 shrink-0">Category</span>
      <span className="w-28 shrink-0 text-right">Robux</span>
      <span className="w-24 shrink-0 text-right">USD</span>
      <span className="w-40 shrink-0 text-right">Running balance</span>
      <span className="w-20 shrink-0" />
    </div>
  );
}

function StatusGlyph({ tx }: { tx: FinanceTransaction }) {
  if (tx.status === "owed") {
    return <span className="w-4 shrink-0 text-center text-fin-alert">○</span>;
  }
  return (
    <span className="w-4 shrink-0 text-center font-mono text-[11px] text-text-disabled">
      {KIND_GLYPH[tx.kind]}
    </span>
  );
}

// Owed nested view retired — owed lives in People now, one per person.
