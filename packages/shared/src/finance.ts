// Finances — wire types + Zod schemas (spec: finances §5–§6).
// Enum arrays mirror the pgEnums in packages/database/src/schema.ts by hand,
// same as enums.ts, so web never pulls in Drizzle.

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Enums                                                                     */
/* -------------------------------------------------------------------------- */

export const FINANCE_CURRENCIES = ["usd", "robux"] as const;
export type FinanceCurrency = (typeof FINANCE_CURRENCIES)[number];

export const FINANCE_DISPLAY_CURRENCIES = ["usd", "robux", "both"] as const;
export type FinanceDisplayCurrency =
  (typeof FINANCE_DISPLAY_CURRENCIES)[number];

export const FINANCE_KINDS = [
  "revenue",
  "expense",
  "cashout",
  "investment",
  "distribution",
] as const;
export type FinanceKind = (typeof FINANCE_KINDS)[number];

export const FINANCE_EXPENSE_STATUSES = ["paid", "owed"] as const;
export type FinanceExpenseStatus = (typeof FINANCE_EXPENSE_STATUSES)[number];

export const FINANCE_PERSON_RATINGS = ["good", "mixed", "avoid"] as const;
export type FinancePersonRating = (typeof FINANCE_PERSON_RATINGS)[number];

// Payment rails for expenses. Distributions are a strict subset — never
// robux_gamepass (§4.8.1: paying a revenue share by gamepass burns 30% on
// money that is already theirs).
export const FINANCE_METHODS = [
  "robux_gamepass",
  "robux_group_payout",
  "paypal",
  "wise",
  "bank",
] as const;
export type FinanceMethod = (typeof FINANCE_METHODS)[number];

export const DISTRIBUTION_METHODS = [
  "robux_group_payout",
  "wise",
  "paypal",
  "bank",
] as const;
export type DistributionMethod = (typeof DISTRIBUTION_METHODS)[number];

/* -------------------------------------------------------------------------- */
/*  DTOs                                                                      */
/* -------------------------------------------------------------------------- */

export interface FinanceSettings {
  projectId: string;
  devexRate: number;
  displayCurrency: FinanceDisplayCurrency;
  openingUsd: number | null;
  openingRobux: number | null;
  openingSetOn: string | null; // YYYY-MM-DD
}

export interface FinanceBudget {
  month: string; // YYYY-MM
  amountUsd: number;
  note: string | null;
}

export interface FinanceCategory {
  id: string;
  name: string;
  color: string;
  sort: number;
}

export interface FinancePersonRef {
  id: string;
  discordHandle: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface FinancePerson extends FinancePersonRef {
  robloxUserId: number | null;
  robloxUsername: string | null;
  roles: string[];
  preferredMethod: string | null;
  defaultRateUsd: number | null;
  rating: FinancePersonRating | null;
  note: string | null;
  archived: boolean;
  createdAt: string;
}

// People tab list row: person + the scannable aggregates (§7.3).
export interface FinancePersonListRow extends FinancePerson {
  activePercent: number | null; // Σ active split %; null when none
  hasCapital: boolean; // ◈ — has put money in
  txCount: number; // paid expense rows
  paidRobux: number;
  paidUsd: number;
  lastPaidOn: string | null;
}

export interface CurrencyAmount {
  currency: FinanceCurrency;
  native: number;
  usd: number;
}

export interface RevenueSplit {
  id: string;
  person: FinancePersonRef;
  percent: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  note: string | null;
  accrued: CurrencyAmount[];
  owed: CurrencyAmount[];
}

export interface FinanceTransaction {
  id: string;
  ref: string; // 'SO-F001'
  kind: FinanceKind;
  occurredOn: string; // YYYY-MM-DD
  description: string;
  currency: FinanceCurrency | null;
  amountGross: number | null;
  feeAmount: number;
  amountNet: number | null;
  costAmount: number | null;
  rateUsed: number;
  amountUsd: number;
  category: FinanceCategory | null;
  person: FinancePersonRef | null;
  method: string | null;
  status: FinanceExpenseStatus;
  paidOn: string | null;
  robuxOut: number | null;
  usdIn: number | null;
  splitId: string | null;
  milestoneId: string | null;
  taskId: string | null;
  paymentRef: string | null;
  receiptUrl: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FinancePersonDetail extends FinancePerson {
  transactions: FinanceTransaction[];
  splits: RevenueSplit[];
  capitalIn: CurrencyAmount[]; // totals of investment rows naming this person
  owed: CurrencyAmount[]; // unpaid expenses + unsettled accruals, per currency
}

/* ---- /overview (§6): everything the top of the page needs, one request ---- */

export interface FinanceOwedRow {
  ref: string;
  person: FinancePersonRef | null;
  description: string;
  amountUsd: number;
  currency: FinanceCurrency;
  amountNative: number;
  occurredOn: string;
  isSplit: boolean; // split debt carries a % glyph; expense its category dot
  categoryColor: string | null;
}

export interface FinanceOverview {
  month: string; // YYYY-MM
  rate: number;
  displayCurrency: FinanceDisplayCurrency;
  openingSet: boolean;
  tiles: {
    netUsd: number;
    netDeltaPct: number | null; // vs previous month, null if no history
    revenueUsd: number;
    revenueRobux: number;
    spendUsd: number;
    budgetUsd: number | null;
    budgetPct: number | null;
    payoutFeeRobux: number; // marketplace fee lost on gamepass payouts
    owedUsd: number;
    owedCount: number;
    robuxBalance: number;
    usdBalance: number;
    positionUsd: number;
    runwayMonths: number | null;
    devexProgress: number; // vs DEVEX_MINIMUM
    lastCashoutOn: string | null;
  };
  series: Array<{
    month: string;
    revenueUsd: number;
    spendUsd: number;
    netUsd: number;
  }>;
  byCategory: Array<{
    id: string;
    name: string;
    color: string;
    spendUsd: number;
    pct: number;
  }>;
  owed: FinanceOwedRow[];
  recent: FinanceTransaction[];
}

/* ---- /position (§6): the below-the-fold zone, fetched lazily ---- */

export interface FinancePosition {
  period: string; // YYYY-MM or "all"
  rate: number;
  pnl: {
    revenueUsd: number;
    byCategory: Array<{ name: string; color: string; spendUsd: number }>;
    expensesUsd: number;
    netProfitUsd: number;
    allocatedUsd: number; // memo, below the line
    yourShareUsd: number;
    distributedUsd: number;
  };
  splits: RevenueSplit[];
  yourPercent: number; // 100 − Σ active; may be negative, show it
  splitsOver100: boolean;
  balanceSheet: {
    asOf: string;
    assets: { usd: number; robux: number; robuxUsd: number; total: number };
    liabilities: {
      unpaidExpensesUsd: number;
      accruedSplitsUsd: number;
      total: number;
    };
    equity: {
      capitalInUsd: number;
      retainedEarningsUsd: number;
      total: number;
    };
    reconciles: boolean; // assets − liabilities === equity
  };
  breakeven: {
    investedUsd: number;
    returnedUsd: number;
    pct: number | null; // null when investedUsd = 0 → hide the bar
  };
}

export interface FinanceTransactionPage {
  items: FinanceTransaction[];
  nextCursor: string | null;
}

/* -------------------------------------------------------------------------- */
/*  Zod schemas                                                               */
/* -------------------------------------------------------------------------- */

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD");
export const financeMonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "YYYY-MM");

const financeUuid = z.string().uuid();

export const financeTxQuerySchema = z.object({
  month: financeMonthSchema.optional(),
  kind: z.enum(FINANCE_KINDS).optional(),
  category: financeUuid.optional(),
  method: z.enum(FINANCE_METHODS).optional(),
  person: financeUuid.optional(),
  status: z.enum(FINANCE_EXPENSE_STATUSES).optional(),
  milestone: financeUuid.optional(),
  q: z.string().max(200).optional(),
  cursor: z.string().max(200).optional(),
});
export type FinanceTxQuery = z.infer<typeof financeTxQuerySchema>;

// One create schema for all five kinds; kind-specific requirements are
// enforced in superRefine (§5: application layer, not check constraints).
// The server computes fee/net/cost/amount_usd — the client sends what was
// typed (`amount`) plus, on a gamepass rail, which way to read it.
export const createFinanceTxSchema = z
  .object({
    kind: z.enum(FINANCE_KINDS),
    occurredOn: dateOnly,
    description: z.string().max(500).optional(),
    currency: z.enum(FINANCE_CURRENCIES).optional(),
    amount: z.number().positive().optional(),
    mode: z.enum(["they_receive", "it_costs_me"]).optional(), // gamepass only
    fee: z.number().nonnegative().optional(), // USD rails, manual
    method: z.enum(FINANCE_METHODS).optional(),
    categoryId: financeUuid.nullable().optional(),
    personId: financeUuid.nullable().optional(),
    status: z.enum(FINANCE_EXPENSE_STATUSES).optional(),
    paidOn: dateOnly.nullable().optional(),
    robuxOut: z.number().int().positive().optional(),
    usdIn: z.number().positive().optional(),
    splitId: financeUuid.nullable().optional(),
    milestoneId: financeUuid.nullable().optional(),
    taskId: financeUuid.nullable().optional(),
    paymentRef: z.string().max(200).nullable().optional(),
    receiptUrl: z.string().max(1000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const need = (cond: boolean, path: string, message: string) => {
      if (!cond)
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    };
    switch (v.kind) {
      case "revenue":
        need(v.amount != null, "amount", "Earned amount required.");
        need(v.currency != null, "currency", "Currency required.");
        break;
      case "expense":
        need(v.amount != null, "amount", "Amount required.");
        need(v.currency != null, "currency", "Currency required.");
        need(v.method != null, "method", "Rail required.");
        need(!!v.description, "description", "Description required.");
        break;
      case "cashout":
        need(v.robuxOut != null, "robuxOut", "Robux out required.");
        need(v.usdIn != null, "usdIn", "USD in required.");
        break;
      case "investment":
        need(v.amount != null, "amount", "Amount required.");
        need(v.currency != null, "currency", "Currency required.");
        break;
      case "distribution":
        need(v.amount != null, "amount", "Amount required.");
        need(v.currency != null, "currency", "Currency required.");
        need(
          v.personId != null,
          "personId",
          "Distributions always name a person.",
        );
        need(v.method != null, "method", "Rail required.");
        if (v.method === "robux_gamepass") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["method"],
            message:
              "A distribution is never paid by gamepass (spec §4.8.1). Use group payout.",
          });
        }
        if (
          v.currency === "robux" &&
          v.method &&
          v.method !== "robux_group_payout"
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["method"],
            message: "Robux distributions settle by group payout only.",
          });
        }
        if (v.currency === "usd" && v.method === "robux_group_payout") {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["method"],
            message: "USD distributions settle by Wise / PayPal / bank.",
          });
        }
        break;
    }
    if (
      v.currency === "robux" &&
      v.amount != null &&
      !Number.isInteger(v.amount)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["amount"],
        message: "Robux are integers.",
      });
    }
  });
export type CreateFinanceTxInput = z.infer<typeof createFinanceTxSchema>;

export const patchFinanceTxSchema = z
  .object({
    occurredOn: dateOnly.optional(),
    description: z.string().max(500).optional(),
    amount: z.number().positive().optional(),
    mode: z.enum(["they_receive", "it_costs_me"]).optional(),
    fee: z.number().nonnegative().optional(),
    method: z.enum(FINANCE_METHODS).optional(),
    categoryId: financeUuid.nullable().optional(),
    personId: financeUuid.nullable().optional(),
    status: z.enum(FINANCE_EXPENSE_STATUSES).optional(),
    paidOn: dateOnly.nullable().optional(),
    robuxOut: z.number().int().positive().optional(),
    usdIn: z.number().positive().optional(),
    milestoneId: financeUuid.nullable().optional(),
    taskId: financeUuid.nullable().optional(),
    paymentRef: z.string().max(200).nullable().optional(),
    receiptUrl: z.string().max(1000).nullable().optional(),
    note: z.string().max(2000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchFinanceTxInput = z.infer<typeof patchFinanceTxSchema>;

export const createFinancePersonSchema = z.object({
  discordHandle: z.string().min(1).max(100),
  displayName: z.string().max(200).nullable().optional(),
  robloxUserId: z.number().int().positive().nullable().optional(),
  robloxUsername: z.string().max(100).nullable().optional(),
  avatarUrl: z.string().max(1000).nullable().optional(),
  roles: z.array(z.string().min(1).max(50)).max(10).optional(),
  preferredMethod: z.enum(FINANCE_METHODS).nullable().optional(),
  defaultRateUsd: z.number().positive().nullable().optional(),
  rating: z.enum(FINANCE_PERSON_RATINGS).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type CreateFinancePersonInput = z.infer<
  typeof createFinancePersonSchema
>;

export const patchFinancePersonSchema = createFinancePersonSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchFinancePersonInput = z.infer<typeof patchFinancePersonSchema>;

export const createFinanceSplitSchema = z.object({
  personId: financeUuid,
  percent: z.number().gt(0).max(100),
  effectiveFrom: dateOnly,
  note: z.string().max(500).nullable().optional(),
});
export type CreateFinanceSplitInput = z.infer<typeof createFinanceSplitSchema>;

// Closing a deal means setting effective_to — never editing percent (§4.8).
// strict() so a percent/person/effective_from key is a 422, not silently dropped.
export const patchFinanceSplitSchema = z
  .object({
    effectiveTo: dateOnly.nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PatchFinanceSplitInput = z.infer<typeof patchFinanceSplitSchema>;

export const putFinanceBudgetSchema = z.object({
  amountUsd: z.number().nonnegative(),
  note: z.string().max(500).nullable().optional(),
});
export type PutFinanceBudgetInput = z.infer<typeof putFinanceBudgetSchema>;

export const putFinanceSettingsSchema = z
  .object({
    devexRate: z.number().gt(0).lt(1).optional(),
    displayCurrency: z.enum(FINANCE_DISPLAY_CURRENCIES).optional(),
    openingUsd: z.number().nullable().optional(),
    openingRobux: z.number().int().nullable().optional(),
    openingSetOn: dateOnly.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "no fields to update");
export type PutFinanceSettingsInput = z.infer<typeof putFinanceSettingsSchema>;

export const financePositionQuerySchema = z.object({
  period: z.union([financeMonthSchema, z.literal("all")]).default("all"),
});
export type FinancePositionQuery = z.infer<typeof financePositionQuerySchema>;

// Default per-project category seed (§5) — by contractor discipline.
export const FINANCE_DEFAULT_CATEGORIES: ReadonlyArray<{
  name: string;
  color: string;
}> = [
  { name: "UI/UX", color: "#5B8DEF" },
  { name: "SFX", color: "#3DD68C" },
  { name: "Illustration", color: "#E86A9B" },
  { name: "Programming", color: "#E5A83C" },
  { name: "VFX", color: "#B07CE8" },
  { name: "Modelling", color: "#4FC3D9" },
  { name: "Building", color: "#C97B4A" },
  { name: "Design", color: "#8A90A0" },
  { name: "GFX", color: "#D95BAE" },
];
