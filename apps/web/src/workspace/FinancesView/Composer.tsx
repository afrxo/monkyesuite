// Composer (spec §7.4). One modal, segmented control switches kind, "More ⌄"
// holds Capital in / Payout. All Robux payouts settle 1:1 through the group —
// no gamepass rail, no marketplace-fee gross-up.

import { DEVEX_RATE_DEFAULT } from "@monkyesuite/core";
import type {
  CreateFinanceTxInput,
  FinanceCategory,
  FinanceCurrency,
  FinanceKind,
  FinanceMethod,
  FinancePersonListRow,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useEffect, useState } from "react";
import { toastError } from "../../components/Toast";
import { Dialog, DialogContent } from "../../components/ui/dialog";
import { api } from "../../lib/api";
import { fmtRobux, fmtUsd } from "../../lib/format";
import { FinanceDatePicker } from "./FinanceDatePicker";
import { FinanceMonthPicker } from "./FinanceMonthPicker";

type ComposerKind = FinanceKind;

const PRIMARY_KINDS: { kind: ComposerKind; label: string }[] = [
  { kind: "expense", label: "Expense" },
  { kind: "revenue", label: "Earned" },
  { kind: "cashout", label: "Cash-out" },
];
const MORE_KINDS: { kind: ComposerKind; label: string }[] = [
  { kind: "investment", label: "Capital in" },
  { kind: "distribution", label: "Payout" },
];

const METHOD_LABEL: Record<FinanceMethod, string> = {
  robux_gamepass: "Gamepass",
  robux_group_payout: "Group payout",
  paypal: "PayPal",
  wise: "Wise",
  bank: "Bank",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseAmount(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/,/g, "");
  if (!s) return null;
  const isDollar = s.startsWith("$");
  const body = isDollar ? s.slice(1) : s;
  const m = body.match(/^([\d.]+)(k)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (Number.isNaN(n)) return null;
  return m[2] ? n * 1000 : n;
}

export function Composer({
  projectId,
  open,
  onOpenChange,
  categories,
  people,
  lastKind,
  onLastKind,
  prefill,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  categories: FinanceCategory[];
  people: FinancePersonListRow[];
  lastKind: ComposerKind;
  onLastKind: (k: ComposerKind) => void;
  // Set when opened from a "Pay" action so the composer lands on the right kind
  // with the person preselected (e.g. settling someone's owed balance).
  prefill?: { kind: ComposerKind; personId?: string | null } | null;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<ComposerKind>(lastKind);
  const [amountRaw, setAmountRaw] = useState("");
  const [currency, setCurrency] = useState<FinanceCurrency>("robux");
  const [description, setDescription] = useState("");
  const [personId, setPersonId] = useState<string | null>(null);
  const [newPersonHandle, setNewPersonHandle] = useState("");
  const [method, setMethod] = useState<FinanceMethod>("robux_group_payout");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [occurredOn, setOccurredOn] = useState(todayIso());
  const [status, setStatus] = useState<"paid" | "owed">("paid");
  const [note, setNote] = useState("");
  const [month, setMonth] = useState(() => todayIso().slice(0, 7));

  useEffect(() => {
    if (open) {
      setKind(prefill?.kind ?? lastKind);
      setAmountRaw("");
      setDescription("");
      setPersonId(prefill?.personId ?? null);
      setNewPersonHandle("");
      setCategoryId(null);
      setOccurredOn(todayIso());
      setMonth(todayIso().slice(0, 7));
      setStatus("paid");
      setNote("");
      setCurrency("robux");
      setMethod("robux_group_payout");
    }
  }, [open, lastKind, prefill]);

  const { data: settings } = useQuery({
    queryKey: ["finance-settings", projectId],
    queryFn: () => api.financeSettings(projectId),
    enabled: open,
  });
  const rate = settings?.devexRate ?? DEVEX_RATE_DEFAULT;

  const { data: existingRevenue } = useQuery({
    queryKey: ["finance-tx-month-revenue", projectId, month],
    queryFn: () =>
      api.financeTransactions(projectId, { month, kind: "revenue" }),
    enabled: open && kind === "revenue",
  });

  const amount = parseAmount(amountRaw);

  // Keep the rail consistent with the currency: Robux always settles by group
  // payout (1:1, no fee); USD defaults to Wise. Only nudge when the current
  // method belongs to the other currency's rail set.
  useEffect(() => {
    if (currency === "robux" && method !== "robux_group_payout") {
      setMethod("robux_group_payout");
    } else if (
      currency === "usd" &&
      (method === "robux_group_payout" || method === "robux_gamepass")
    ) {
      setMethod("wise");
    }
  }, [currency, method]);

  const create = useMutation({
    mutationFn: (input: CreateFinanceTxInput) =>
      api.createFinanceTx(projectId, input),
    onSuccess: () => {
      onLastKind(kind);
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: ["finance-overview", projectId] });
      qc.invalidateQueries({ queryKey: ["finance-position", projectId] });
      qc.invalidateQueries({ queryKey: ["finance-transactions", projectId] });
      qc.invalidateQueries({ queryKey: ["finance-people", projectId] });
    },
    onError: (err) => toastError(err, "Failed to log entry."),
  });

  const ensurePerson = useMutation({
    mutationFn: (discordHandle: string) =>
      api.createFinancePerson(projectId, { discordHandle }),
  });

  async function resolvePersonId(): Promise<string | null> {
    if (personId) return personId;
    if (newPersonHandle.trim()) {
      const created = await ensurePerson.mutateAsync(newPersonHandle.trim());
      qc.invalidateQueries({ queryKey: ["finance-people", projectId] });
      return created.id;
    }
    return null;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;

    if (kind === "revenue") {
      create.mutate({
        kind: "revenue",
        occurredOn: `${month}-01`,
        currency,
        amount: amount ?? undefined,
        note: note || undefined,
      });
      return;
    }

    if (kind === "cashout") {
      const robuxOut = amount != null ? Math.round(amount) : undefined;
      const usdIn =
        robuxOut != null ? Math.round(robuxOut * rate * 100) / 100 : undefined;
      create.mutate({
        kind: "cashout",
        occurredOn,
        robuxOut,
        usdIn,
        note: note || undefined,
      });
      return;
    }

    if (kind === "investment") {
      const pid = await resolvePersonId();
      create.mutate({
        kind: "investment",
        occurredOn,
        currency,
        amount: amount ?? undefined,
        personId: pid,
        description: description || "Capital in",
        note: note || undefined,
      });
      return;
    }

    if (kind === "distribution") {
      const pid = await resolvePersonId();
      create.mutate({
        kind: "distribution",
        occurredOn,
        currency,
        amount: amount ?? undefined,
        personId: pid,
        method,
        description: description || undefined,
        note: note || undefined,
      });
      return;
    }

    // expense
    const pid = await resolvePersonId();
    create.mutate({
      kind: "expense",
      occurredOn,
      currency,
      amount: amount ?? undefined,
      method,
      categoryId,
      personId: pid,
      description: description || undefined,
      status,
      paidOn: status === "paid" ? occurredOn : null,
      note: note || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 border-border-1 bg-surface-1 p-0 text-text-1">
        <div className="border-b border-border-1 px-5 py-3">
          <div className="mb-3 flex items-center gap-1">
            <span className="mr-2 text-sm font-semibold text-text-1">Log</span>
            {PRIMARY_KINDS.map((k) => (
              <SegButton
                key={k.kind}
                active={kind === k.kind}
                onClick={() => setKind(k.kind)}
              >
                {k.label}
              </SegButton>
            ))}
            <MoreMenu
              active={MORE_KINDS.some((k) => k.kind === kind)}
              current={kind}
              onSelect={setKind}
            />
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-3 px-5 py-4">
          {kind === "revenue" ? (
            <RevenueForm
              month={month}
              setMonth={setMonth}
              amountRaw={amountRaw}
              setAmountRaw={setAmountRaw}
              currency={currency}
              setCurrency={setCurrency}
              note={note}
              setNote={setNote}
              rate={rate}
              existingCount={existingRevenue?.items.length ?? 0}
              existingTotal={
                existingRevenue?.items.reduce(
                  (s, t) => s + (t.amountGross ?? 0),
                  0,
                ) ?? 0
              }
              existingCurrency={existingRevenue?.items[0]?.currency ?? "robux"}
            />
          ) : kind === "cashout" ? (
            <CashoutForm
              occurredOn={occurredOn}
              setOccurredOn={setOccurredOn}
              amountRaw={amountRaw}
              setAmountRaw={setAmountRaw}
              rate={rate}
              note={note}
              setNote={setNote}
            />
          ) : kind === "investment" ? (
            <CapitalForm
              amountRaw={amountRaw}
              setAmountRaw={setAmountRaw}
              currency={currency}
              setCurrency={setCurrency}
              people={people}
              personId={personId}
              setPersonId={setPersonId}
              newPersonHandle={newPersonHandle}
              setNewPersonHandle={setNewPersonHandle}
              occurredOn={occurredOn}
              setOccurredOn={setOccurredOn}
              note={note}
              setNote={setNote}
            />
          ) : kind === "distribution" ? (
            <PayoutForm
              people={people}
              personId={personId}
              setPersonId={setPersonId}
              amountRaw={amountRaw}
              setAmountRaw={setAmountRaw}
              currency={currency}
              setCurrency={setCurrency}
              method={method}
              setMethod={setMethod}
              occurredOn={occurredOn}
              setOccurredOn={setOccurredOn}
              rate={rate}
            />
          ) : (
            <ExpenseForm
              people={people}
              personId={personId}
              setPersonId={setPersonId}
              newPersonHandle={newPersonHandle}
              setNewPersonHandle={setNewPersonHandle}
              description={description}
              setDescription={setDescription}
              amountRaw={amountRaw}
              setAmountRaw={setAmountRaw}
              currency={currency}
              setCurrency={setCurrency}
              method={method}
              setMethod={setMethod}
              categories={categories}
              categoryId={categoryId}
              setCategoryId={setCategoryId}
              occurredOn={occurredOn}
              setOccurredOn={setOccurredOn}
              status={status}
              setStatus={setStatus}
            />
          )}

          <div className="mt-1 flex items-center justify-end gap-2 border-t border-border-1 pt-3">
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded px-3 py-1.5 text-xs text-text-3 hover:text-text-1"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={create.isPending}
              className="rounded bg-accent-warm px-3.5 py-1.5 text-xs font-semibold text-[#1a1000] transition-colors hover:brightness-110 disabled:opacity-50"
            >
              Log it ⏎
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function SegButton({
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
        active ? "bg-white/[0.08] text-text-1" : "text-text-3 hover:text-text-1"
      }`}
    >
      {children}
    </button>
  );
}

// Two-way segmented toggle for mode/status pickers — replaces native radio
// buttons with the same pill chrome as SegButton/kind selector.
function SegToggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex w-fit gap-0.5 rounded-md border border-border-1 bg-surface-0 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            value === o.value
              ? "bg-white/[0.09] text-text-1 shadow-sm"
              : "text-text-3 hover:text-text-1"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function MoreMenu({
  active,
  current,
  onSelect,
}: {
  active: boolean;
  current: ComposerKind;
  onSelect: (k: ComposerKind) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded px-2.5 py-1 text-xs transition-colors ${
          active
            ? "bg-white/[0.08] text-text-1"
            : "text-text-3 hover:text-text-1"
        }`}
      >
        {active
          ? (MORE_KINDS.find((k) => k.kind === current)?.label ?? "More")
          : "More"}{" "}
        ⌄
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-10 mt-1 w-36 overflow-hidden rounded border border-border-2 bg-surface-1 py-1 shadow-lg">
          {MORE_KINDS.map((k) => (
            <button
              key={k.kind}
              type="button"
              onClick={() => {
                onSelect(k.kind);
                setOpen(false);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-text-2 hover:bg-white/[0.05]"
            >
              {k.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: children is always a form control
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-text-3">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "rounded border border-border-1 bg-surface-1 px-2.5 py-1.5 text-sm text-text-1 outline-none focus:border-text-5";

function RevenueForm({
  month,
  setMonth,
  amountRaw,
  setAmountRaw,
  currency,
  setCurrency,
  note,
  setNote,
  rate,
  existingCount,
  existingTotal,
  existingCurrency,
}: {
  month: string;
  setMonth: (v: string) => void;
  amountRaw: string;
  setAmountRaw: (v: string) => void;
  currency: FinanceCurrency;
  setCurrency: (v: FinanceCurrency) => void;
  note: string;
  setNote: (v: string) => void;
  rate: number;
  existingCount: number;
  existingTotal: number;
  existingCurrency: FinanceCurrency;
}) {
  const amount = parseAmount(amountRaw);
  const usdApprox =
    amount != null
      ? currency === "robux"
        ? Math.round(amount * rate * 100) / 100
        : amount
      : null;
  return (
    <>
      {existingCount > 0 ? (
        <div className="rounded border border-fin-negative/30 bg-fin-negative/10 px-2.5 py-1.5 text-[11px] text-fin-negative">
          {monthLabelShort(month)} already has{" "}
          {existingCurrency === "robux"
            ? fmtRobux(existingTotal)
            : fmtUsd(existingTotal)}{" "}
          logged.
        </div>
      ) : null}
      <Field label="Month">
        <FinanceMonthPicker value={month} onChange={setMonth} />
      </Field>
      <Field label="Earned">
        <div className="flex gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: focus what user opened
            autoFocus
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder="242000"
            className={`${inputClass} flex-1 font-mono tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
            className={inputClass}
          >
            <option value="robux">R$</option>
            <option value="usd">USD</option>
          </select>
          {usdApprox != null ? (
            <span className="flex items-center whitespace-nowrap font-mono text-xs text-text-3">
              ≈ {fmtUsd(usdApprox)}
            </span>
          ) : null}
        </div>
        <span className="text-[11px] text-text-disabled">
          ↳ the Earned figure on the Creator Dashboard. Roblox's 30% is already
          out of it.
        </span>
      </Field>
      <Field label="Note (optional)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
        />
      </Field>
    </>
  );
}

function CashoutForm({
  occurredOn,
  setOccurredOn,
  amountRaw,
  setAmountRaw,
  rate,
  note,
  setNote,
}: {
  occurredOn: string;
  setOccurredOn: (v: string) => void;
  amountRaw: string;
  setAmountRaw: (v: string) => void;
  rate: number;
  note: string;
  setNote: (v: string) => void;
}) {
  const amount = parseAmount(amountRaw);
  const usdIn = amount != null ? Math.round(amount * rate * 100) / 100 : null;
  return (
    <>
      <Field label="Robux out">
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={amountRaw}
          onChange={(e) => setAmountRaw(e.target.value)}
          placeholder="30000"
          className={`${inputClass} font-mono tabular-nums`}
        />
      </Field>
      <Field label="USD in">
        <div className="flex items-center gap-2">
          <span
            className={`${inputClass} flex-1 font-mono tabular-nums text-text-3`}
          >
            {usdIn != null ? fmtUsd(usdIn) : "—"}
          </span>
        </div>
        <span className="text-[11px] text-text-disabled">
          ↳ what Roblox actually paid, pre-filled at the current rate.
        </span>
      </Field>
      <Field label="Date">
        <FinanceDatePicker value={occurredOn} onChange={setOccurredOn} />
      </Field>
      <Field label="Note (optional)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className={inputClass}
        />
      </Field>
    </>
  );
}

function CapitalForm({
  amountRaw,
  setAmountRaw,
  currency,
  setCurrency,
  people,
  personId,
  setPersonId,
  newPersonHandle,
  setNewPersonHandle,
  occurredOn,
  setOccurredOn,
  note,
  setNote,
}: {
  amountRaw: string;
  setAmountRaw: (v: string) => void;
  currency: FinanceCurrency;
  setCurrency: (v: FinanceCurrency) => void;
  people: FinancePersonListRow[];
  personId: string | null;
  setPersonId: (v: string | null) => void;
  newPersonHandle: string;
  setNewPersonHandle: (v: string) => void;
  occurredOn: string;
  setOccurredOn: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
}) {
  return (
    <>
      <Field label="Amount">
        <div className="flex gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: focus what user opened
            autoFocus
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder="500"
            className={`${inputClass} flex-1 font-mono tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
            className={inputClass}
          >
            <option value="usd">USD</option>
            <option value="robux">R$</option>
          </select>
        </div>
      </Field>
      <PersonPicker
        label="From"
        allowMe
        people={people}
        personId={personId}
        setPersonId={setPersonId}
        newHandle={newPersonHandle}
        setNewHandle={setNewPersonHandle}
      />
      <Field label="Date">
        <FinanceDatePicker value={occurredOn} onChange={setOccurredOn} />
      </Field>
      <Field label="Note (optional)">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="ad budget for the closed test"
          className={inputClass}
        />
      </Field>
      <span className="text-[11px] text-text-disabled">
        ↳ doesn't count as revenue, spend, or budget.
      </span>
    </>
  );
}

function PayoutForm({
  people,
  personId,
  setPersonId,
  amountRaw,
  setAmountRaw,
  currency,
  setCurrency,
  method,
  setMethod,
  occurredOn,
  setOccurredOn,
  rate,
}: {
  people: FinancePersonListRow[];
  personId: string | null;
  setPersonId: (v: string | null) => void;
  amountRaw: string;
  setAmountRaw: (v: string) => void;
  currency: FinanceCurrency;
  setCurrency: (v: FinanceCurrency) => void;
  method: FinanceMethod;
  setMethod: (v: FinanceMethod) => void;
  occurredOn: string;
  setOccurredOn: (v: string) => void;
  rate: number;
}) {
  const { data: detail } = useQuery({
    queryKey: ["finance-person-detail", personId],
    queryFn: () => (personId ? api.financePerson(personId) : null),
    enabled: !!personId,
  });
  const owedForCurrency = detail?.owed.find((o) => o.currency === currency);

  useEffect(() => {
    setMethod(currency === "robux" ? "robux_group_payout" : "wise");
  }, [currency, setMethod]);

  const amount = parseAmount(amountRaw);
  const usdApprox =
    amount != null && currency === "robux"
      ? Math.round(amount * rate * 100) / 100
      : null;

  return (
    <>
      <PersonPicker
        label="To"
        people={people}
        personId={personId}
        setPersonId={setPersonId}
        newHandle=""
        setNewHandle={() => {}}
      />
      {owedForCurrency ? (
        <div className="flex items-center justify-between text-[11px] text-text-disabled">
          <span>
            owed{" "}
            {owedForCurrency.currency === "robux"
              ? fmtRobux(owedForCurrency.native)
              : fmtUsd(owedForCurrency.native)}
          </span>
          <button
            type="button"
            onClick={() => setAmountRaw(String(owedForCurrency.native))}
            className="rounded border border-border-2 px-1.5 py-0.5 text-text-3 hover:text-text-1"
          >
            pay all
          </button>
        </div>
      ) : null}
      <Field label="Amount">
        <div className="flex gap-2">
          <input
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            className={`${inputClass} flex-1 font-mono tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
            className={inputClass}
          >
            <option value="robux">R$</option>
            <option value="usd">USD</option>
          </select>
          {usdApprox != null ? (
            <span className="flex items-center whitespace-nowrap font-mono text-xs text-text-3">
              ≈ {fmtUsd(usdApprox)}
            </span>
          ) : null}
        </div>
      </Field>
      <Field label="Rail">
        {currency === "robux" ? (
          <span className={`${inputClass} text-text-3`}>Group payout</span>
        ) : (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as FinanceMethod)}
            className={inputClass}
          >
            <option value="wise">Wise</option>
            <option value="paypal">PayPal</option>
            <option value="bank">Bank</option>
          </select>
        )}
      </Field>
      <Field label="Date">
        <FinanceDatePicker value={occurredOn} onChange={setOccurredOn} />
      </Field>
    </>
  );
}

function ExpenseForm({
  people,
  personId,
  setPersonId,
  newPersonHandle,
  setNewPersonHandle,
  description,
  setDescription,
  amountRaw,
  setAmountRaw,
  currency,
  setCurrency,
  method,
  setMethod,
  categories,
  categoryId,
  setCategoryId,
  occurredOn,
  setOccurredOn,
  status,
  setStatus,
}: {
  people: FinancePersonListRow[];
  personId: string | null;
  setPersonId: (v: string | null) => void;
  newPersonHandle: string;
  setNewPersonHandle: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  amountRaw: string;
  setAmountRaw: (v: string) => void;
  currency: FinanceCurrency;
  setCurrency: (v: FinanceCurrency) => void;
  method: FinanceMethod;
  setMethod: (v: FinanceMethod) => void;
  categories: FinanceCategory[];
  categoryId: string | null;
  setCategoryId: (v: string | null) => void;
  occurredOn: string;
  setOccurredOn: (v: string) => void;
  status: "paid" | "owed";
  setStatus: (v: "paid" | "owed") => void;
}) {
  return (
    <>
      <PersonPicker
        label="Who"
        people={people}
        personId={personId}
        setPersonId={setPersonId}
        newHandle={newPersonHandle}
        setNewHandle={setNewPersonHandle}
      />
      <Field label="For">
        <input
          // biome-ignore lint/a11y/noAutofocus: focus what user opened
          autoFocus
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Amount">
        <div className="flex gap-2">
          <input
            value={amountRaw}
            onChange={(e) => setAmountRaw(e.target.value)}
            placeholder="12500"
            className={`${inputClass} flex-1 font-mono tabular-nums`}
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as FinanceCurrency)}
            className={inputClass}
          >
            <option value="robux">R$</option>
            <option value="usd">USD</option>
          </select>
        </div>
      </Field>
      <Field label="Rail">
        {currency === "robux" ? (
          <span className={`${inputClass} text-text-3`}>Group payout</span>
        ) : (
          <select
            value={method}
            onChange={(e) => setMethod(e.target.value as FinanceMethod)}
            className={inputClass}
          >
            {(["paypal", "wise", "bank"] as const).map((m) => (
              <option key={m} value={m}>
                {METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Category">
          <select
            value={categoryId ?? ""}
            onChange={(e) => setCategoryId(e.target.value || null)}
            className={inputClass}
          >
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Date">
          <FinanceDatePicker value={occurredOn} onChange={setOccurredOn} />
        </Field>
      </div>
      <Field label="Status">
        <SegToggle
          value={status}
          onChange={setStatus}
          options={[
            { value: "paid", label: "Paid" },
            { value: "owed", label: "Owed" },
          ]}
        />
      </Field>
    </>
  );
}

function PersonPicker({
  label,
  allowMe,
  people,
  personId,
  setPersonId,
  newHandle,
  setNewHandle,
}: {
  label: string;
  allowMe?: boolean;
  people: FinancePersonListRow[];
  personId: string | null;
  setPersonId: (v: string | null) => void;
  newHandle: string;
  setNewHandle: (v: string) => void;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <Field label={label}>
      {creating ? (
        <div className="flex gap-2">
          <input
            // biome-ignore lint/a11y/noAutofocus: focus what user opened
            autoFocus
            value={newHandle}
            onChange={(e) => setNewHandle(e.target.value)}
            placeholder="discord handle"
            className={`${inputClass} flex-1`}
          />
          <button
            type="button"
            onClick={() => {
              setCreating(false);
              setNewHandle("");
            }}
            className="text-xs text-text-3 hover:text-text-1"
          >
            cancel
          </button>
        </div>
      ) : (
        <select
          value={personId ?? (allowMe ? "me" : "")}
          onChange={(e) => {
            if (e.target.value === "__new__") {
              setCreating(true);
              setPersonId(null);
            } else if (e.target.value === "me") {
              setPersonId(null);
            } else {
              setPersonId(e.target.value);
            }
          }}
          className={inputClass}
        >
          {allowMe ? (
            <option value="me">me</option>
          ) : (
            <option value="">—</option>
          )}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.discordHandle}
            </option>
          ))}
          <option value="__new__">+ new person…</option>
        </select>
      )}
    </Field>
  );
}

function monthLabelShort(month: string): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const d = new Date(Date.UTC(y, m - 1, 1));
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(d);
}
