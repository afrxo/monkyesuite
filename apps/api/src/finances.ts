// Finances routes (spec: finances §5–§6). Owner-only: every handler resolves
// access with requireOwner, inside a withUser tx (ownerOf RLS backstop).
//
// Money invariants enforced here, not in the UI:
//  - MARKETPLACE_FEE never touches a revenue row (computeAmounts has no fee
//    path for kind = 'revenue').
//  - A distribution is never paid by gamepass (schema-level reject in shared,
//    re-checked here).
//  - Accruals are materialised in the same tx as the revenue row: written on
//    insert, deleted + rewritten on edit, cascaded on delete.
//  - amount_usd is computed on write with the row's snapshotted rate and never
//    recomputed on a rate change.

import {
  accrualNative,
  accrualUsd,
  breakeven,
  gamepassFromCost,
  gamepassFromNet,
  positionUsd,
  round2,
  runwayMonths,
  usdFromRobux,
} from "@monkyesuite/core";
import {
  financeBudgets,
  financeCategories,
  financeSettings,
  financeSplitAccruals,
  financeTransactions,
  people,
  projects,
  revenueSplits,
} from "@monkyesuite/database";
import {
  type CreateFinanceTxInput,
  type CurrencyAmount,
  createFinancePersonSchema,
  createFinanceSplitSchema,
  createFinanceTxSchema,
  FINANCE_DEFAULT_CATEGORIES,
  type FinanceBudget,
  type FinanceCategory,
  type FinanceCurrency,
  type FinanceOverview,
  type FinanceOwedRow,
  type FinancePerson,
  type FinancePersonDetail,
  type FinancePersonListRow,
  type FinancePersonRef,
  type FinancePosition,
  type FinanceSettings,
  type FinanceTransaction,
  type FinanceTransactionPage,
  financeMonthSchema,
  financePositionQuerySchema,
  financeTxQuerySchema,
  patchFinancePersonSchema,
  patchFinanceSplitSchema,
  patchFinanceTxSchema,
  putFinanceBudgetSchema,
  putFinanceSettingsSchema,
  type RevenueSplit,
  uuidSchema,
} from "@monkyesuite/shared";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { resolveItemAccess, resolveProjectAccess } from "./access.js";
import { isUniqueViolation, notFound, validationError } from "./errors.js";
import { type AppEnv, requireUser } from "./middleware.js";
import { isoReq } from "./serialize.js";
import { type Tx, withUser } from "./tx.js";

/* -------------------------------------------------------------------------- */
/*  small helpers                                                             */
/* -------------------------------------------------------------------------- */

type TxRow = typeof financeTransactions.$inferSelect;
type PersonRow = typeof people.$inferSelect;
type CategoryRow = typeof financeCategories.$inferSelect;

const PAGE_SIZE = 100;

// Narrow a maybe-undefined row (insert/update ... returning under strict mode).
function must<T>(x: T | undefined, what: string): T {
  if (x === undefined) throw new Error(`${what} returned no row`);
  return x;
}

function monthRange(month: string): { start: string; end: string } {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const start = `${month}-01`;
  const end =
    m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  return { start, end };
}

function monthOf(dateOnly: string): string {
  return dateOnly.slice(0, 7);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// Ref prefix mirrors the web's shortTaskId: first two alpha chars of the slug.
function refPrefix(slug: string): string {
  const alpha = slug
    .replace(/[^a-z]/gi, "")
    .slice(0, 2)
    .toUpperCase();
  return alpha.length === 2 ? alpha : "PR";
}

async function nextRef(tx: Tx, projectId: string): Promise<string> {
  const [proj] = await tx
    .select({ slug: projects.slug })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  const prefix = refPrefix(proj?.slug ?? "");
  const r = await tx.execute<{ n: number }>(sql`
    select coalesce(max((regexp_match(ref, '(\\d+)$'))[1]::int), 0) + 1 as n
    from finance_transactions where project_id = ${projectId}
  `);
  const n = Number(r.rows[0]?.n ?? 1);
  return `${prefix}-F${String(n).padStart(3, "0")}`;
}

/* -------------------------------------------------------------------------- */
/*  settings + categories (get-or-create)                                     */
/* -------------------------------------------------------------------------- */

type SettingsRow = typeof financeSettings.$inferSelect;

async function ensureSettings(tx: Tx, projectId: string): Promise<SettingsRow> {
  const [existing] = await tx
    .select()
    .from(financeSettings)
    .where(eq(financeSettings.projectId, projectId))
    .limit(1);
  if (existing) return existing;
  const [created] = await tx
    .insert(financeSettings)
    .values({ projectId })
    .onConflictDoNothing()
    .returning();
  // Seed default categories alongside the settings row (spec §5).
  await tx
    .insert(financeCategories)
    .values(
      FINANCE_DEFAULT_CATEGORIES.map((cat, i) => ({
        projectId,
        name: cat.name,
        color: cat.color,
        sort: i,
      })),
    )
    .onConflictDoNothing();
  if (created) return created;
  const [row] = await tx
    .select()
    .from(financeSettings)
    .where(eq(financeSettings.projectId, projectId))
    .limit(1);
  if (!row) throw new Error("finance settings row vanished");
  return row;
}

const mapSettings = (r: SettingsRow): FinanceSettings => ({
  projectId: r.projectId,
  devexRate: r.devexRate,
  displayCurrency: r.displayCurrency,
  openingUsd: r.openingUsd,
  openingRobux: r.openingRobux,
  openingSetOn: r.openingSetOn,
});

/* -------------------------------------------------------------------------- */
/*  mappers                                                                   */
/* -------------------------------------------------------------------------- */

const mapCategory = (r: CategoryRow): FinanceCategory => ({
  id: r.id,
  name: r.name,
  color: r.color,
  sort: r.sort,
});

const mapPersonRef = (r: PersonRow): FinancePersonRef => ({
  id: r.id,
  discordHandle: r.discordHandle,
  displayName: r.displayName,
  avatarUrl: r.avatarUrl,
});

const mapPerson = (r: PersonRow): FinancePerson => ({
  ...mapPersonRef(r),
  robloxUserId: r.robloxUserId,
  robloxUsername: r.robloxUsername,
  roles: r.roles,
  preferredMethod: r.preferredMethod,
  defaultRateUsd: r.defaultRateUsd,
  rating: r.rating,
  note: r.note,
  archived: r.archived,
  createdAt: isoReq(r.createdAt),
});

function mapTx(
  r: TxRow,
  categoriesById: Map<string, CategoryRow>,
  peopleById: Map<string, PersonRow>,
): FinanceTransaction {
  const cat = r.categoryId ? categoriesById.get(r.categoryId) : undefined;
  const person = r.personId ? peopleById.get(r.personId) : undefined;
  return {
    id: r.id,
    ref: r.ref,
    kind: r.kind,
    occurredOn: r.occurredOn,
    description: r.description,
    currency: r.currency,
    amountGross: r.amountGross,
    feeAmount: r.feeAmount,
    amountNet: r.amountNet,
    costAmount: r.costAmount,
    rateUsed: r.rateUsed,
    amountUsd: r.amountUsd,
    category: cat ? mapCategory(cat) : null,
    person: person ? mapPersonRef(person) : null,
    method: r.method,
    status: r.status,
    paidOn: r.paidOn,
    robuxOut: r.robuxOut,
    usdIn: r.usdIn,
    splitId: r.splitId,
    milestoneId: r.milestoneId,
    taskId: r.taskId,
    paymentRef: r.paymentRef,
    receiptUrl: r.receiptUrl,
    note: r.note,
    createdAt: isoReq(r.createdAt),
    updatedAt: isoReq(r.updatedAt),
  };
}

async function loadTxRefs(
  tx: Tx,
  projectId: string,
): Promise<{
  categoriesById: Map<string, CategoryRow>;
  peopleById: Map<string, PersonRow>;
}> {
  const cats = await tx
    .select()
    .from(financeCategories)
    .where(eq(financeCategories.projectId, projectId));
  const ppl = await tx
    .select()
    .from(people)
    .where(eq(people.projectId, projectId));
  return {
    categoriesById: new Map(cats.map((c) => [c.id, c])),
    peopleById: new Map(ppl.map((p) => [p.id, p])),
  };
}

/* -------------------------------------------------------------------------- */
/*  amount computation (§4.3–§4.5, §4.8.1)                                    */
/* -------------------------------------------------------------------------- */

interface Amounts {
  currency: FinanceCurrency | null;
  amountGross: number | null;
  feeAmount: number;
  amountNet: number | null;
  costAmount: number | null;
  amountUsd: number;
  robuxOut: number | null;
  usdIn: number | null;
}

// The only place row amounts are derived. Note the revenue branch: fee is 0
// by construction — there is no code path that applies MARKETPLACE_FEE to a
// revenue row (§4.3, asserted in tests).
function computeAmounts(
  input: Pick<
    CreateFinanceTxInput,
    | "kind"
    | "currency"
    | "amount"
    | "mode"
    | "fee"
    | "method"
    | "robuxOut"
    | "usdIn"
  >,
  rate: number,
): Amounts {
  const currency = input.currency ?? null;
  const toUsd = (n: number) =>
    currency === "robux" ? usdFromRobux(n, rate) : round2(n);

  switch (input.kind) {
    case "revenue": {
      const amount = input.amount ?? 0;
      return {
        currency,
        amountGross: amount,
        feeAmount: 0, // always, no exceptions
        amountNet: amount,
        costAmount: null,
        amountUsd: toUsd(amount),
        robuxOut: null,
        usdIn: null,
      };
    }
    case "expense": {
      if (currency === "robux") {
        const pay =
          input.method === "robux_gamepass"
            ? input.mode === "it_costs_me"
              ? gamepassFromCost(input.amount ?? 0)
              : gamepassFromNet(input.amount ?? 0)
            : {
                costRobux: input.amount ?? 0,
                netRobux: input.amount ?? 0,
                feeRobux: 0,
              };
        return {
          currency,
          amountGross: input.amount ?? 0,
          feeAmount: pay.feeRobux,
          amountNet: pay.netRobux,
          costAmount: pay.costRobux,
          amountUsd: usdFromRobux(pay.costRobux, rate),
          robuxOut: null,
          usdIn: null,
        };
      }
      const amount = input.amount ?? 0;
      const fee = input.fee ?? 0;
      return {
        currency,
        amountGross: amount,
        feeAmount: fee,
        amountNet: amount,
        costAmount: round2(amount + fee),
        amountUsd: round2(amount + fee),
        robuxOut: null,
        usdIn: null,
      };
    }
    case "cashout": {
      return {
        currency: null,
        amountGross: null,
        feeAmount: 0,
        amountNet: null,
        costAmount: null,
        amountUsd: round2(input.usdIn ?? 0),
        robuxOut: input.robuxOut ?? null,
        usdIn: round2(input.usdIn ?? 0),
      };
    }
    case "investment": {
      const amount = input.amount ?? 0;
      return {
        currency,
        amountGross: amount,
        feeAmount: 0,
        amountNet: amount,
        costAmount: null,
        amountUsd: toUsd(amount),
        robuxOut: null,
        usdIn: null,
      };
    }
    case "distribution": {
      const amount = input.amount ?? 0;
      if (currency === "robux") {
        // group payout only: 1:1, never grossed up (§4.8.1)
        return {
          currency,
          amountGross: amount,
          feeAmount: 0,
          amountNet: amount,
          costAmount: amount,
          amountUsd: usdFromRobux(amount, rate),
          robuxOut: null,
          usdIn: null,
        };
      }
      const fee = input.fee ?? 0;
      return {
        currency,
        amountGross: amount,
        feeAmount: fee,
        amountNet: amount,
        costAmount: round2(amount + fee),
        amountUsd: round2(amount),
        robuxOut: null,
        usdIn: null,
      };
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  accrual materialisation (§4.8)                                            */
/* -------------------------------------------------------------------------- */

async function rewriteAccruals(tx: Tx, revenue: TxRow): Promise<void> {
  await tx
    .delete(financeSplitAccruals)
    .where(eq(financeSplitAccruals.revenueTxId, revenue.id));
  if (revenue.kind !== "revenue" || revenue.currency == null) return;
  const currency = revenue.currency;
  const amountNet = revenue.amountNet ?? 0;
  if (amountNet <= 0) return;
  const active = await tx
    .select()
    .from(revenueSplits)
    .where(
      and(
        eq(revenueSplits.projectId, revenue.projectId),
        sql`${revenueSplits.effectiveFrom} <= ${revenue.occurredOn}`,
        or(
          sql`${revenueSplits.effectiveTo} is null`,
          sql`${revenueSplits.effectiveTo} >= ${revenue.occurredOn}`,
        ),
      ),
    );
  if (active.length === 0) return;
  await tx.insert(financeSplitAccruals).values(
    active.map((s) => {
      const native = accrualNative(amountNet, s.percent, currency);
      return {
        projectId: revenue.projectId,
        splitId: s.id,
        personId: s.personId,
        revenueTxId: revenue.id,
        occurredOn: revenue.occurredOn,
        currency,
        amountNative: native,
        amountUsd: accrualUsd(native, currency, revenue.rateUsed),
        rateUsed: revenue.rateUsed,
        percentUsed: s.percent,
      };
    }),
  );
}

// Splits changed (created/closed): rewrite accruals for every revenue row the
// change can touch.
async function rewriteAccrualsForProject(
  tx: Tx,
  projectId: string,
): Promise<void> {
  const rows = await tx
    .select()
    .from(financeTransactions)
    .where(
      and(
        eq(financeTransactions.projectId, projectId),
        eq(financeTransactions.kind, "revenue"),
      ),
    );
  for (const row of rows) await rewriteAccruals(tx, row);
}

/* -------------------------------------------------------------------------- */
/*  owed / accrual aggregates                                                 */
/* -------------------------------------------------------------------------- */

interface PersonOwed {
  personId: string;
  currency: FinanceCurrency;
  accrued: number;
  distributed: number;
  owed: number; // native
  rateLast: number;
}

// owed_to(person, currency) = Σ accrual_native − Σ distribution.amount_net,
// per currency, never summed across currencies (§4.8.1).
async function splitOwedByPerson(
  tx: Tx,
  projectId: string,
  asOf?: string,
): Promise<PersonOwed[]> {
  const dateCond = asOf ? sql` and occurred_on <= ${asOf}` : sql``;
  const r = await tx.execute<{
    person_id: string;
    currency: FinanceCurrency;
    accrued: string;
    distributed: string;
    rate_last: string;
  }>(sql`
    with acc as (
      select person_id, currency,
             sum(amount_native) as accrued,
             max(rate_used) as rate_last
      from finance_split_accruals
      where project_id = ${projectId}${dateCond}
      group by person_id, currency
    ),
    dist as (
      select person_id, currency, sum(amount_net) as distributed
      from finance_transactions
      where project_id = ${projectId} and kind = 'distribution'${dateCond}
      group by person_id, currency
    )
    select acc.person_id, acc.currency,
           acc.accrued::text, coalesce(dist.distributed, 0)::text as distributed,
           acc.rate_last::text
    from acc left join dist using (person_id, currency)
  `);
  return r.rows.map((row) => {
    const accrued = Number(row.accrued);
    const distributed = Number(row.distributed);
    return {
      personId: row.person_id,
      currency: row.currency,
      accrued,
      distributed,
      owed: round2(accrued - distributed),
      rateLast: Number(row.rate_last),
    };
  });
}

async function splitsWithTotals(
  tx: Tx,
  projectId: string,
  peopleById: Map<string, PersonRow>,
): Promise<RevenueSplit[]> {
  const splits = await tx
    .select()
    .from(revenueSplits)
    .where(eq(revenueSplits.projectId, projectId))
    .orderBy(
      desc(sql`${revenueSplits.effectiveTo} is null`),
      desc(revenueSplits.effectiveFrom),
    );
  const agg = await tx.execute<{
    split_id: string;
    currency: FinanceCurrency;
    native: string;
    usd: string;
  }>(sql`
    select split_id, currency, sum(amount_native)::text as native,
           sum(amount_usd)::text as usd
    from finance_split_accruals
    where project_id = ${projectId}
    group by split_id, currency
  `);
  const distAgg = await tx.execute<{
    split_id: string;
    currency: FinanceCurrency;
    native: string;
    usd: string;
  }>(sql`
    select split_id, currency, sum(amount_net)::text as native,
           sum(amount_usd)::text as usd
    from finance_transactions
    where project_id = ${projectId} and kind = 'distribution'
      and split_id is not null
    group by split_id, currency
  `);
  const accBySplit = new Map<string, CurrencyAmount[]>();
  for (const row of agg.rows) {
    const list = accBySplit.get(row.split_id) ?? [];
    list.push({
      currency: row.currency,
      native: Number(row.native),
      usd: round2(Number(row.usd)),
    });
    accBySplit.set(row.split_id, list);
  }
  const distBySplit = new Map<string, Map<FinanceCurrency, number>>();
  for (const row of distAgg.rows) {
    const m =
      distBySplit.get(row.split_id) ?? new Map<FinanceCurrency, number>();
    m.set(row.currency, Number(row.native));
    distBySplit.set(row.split_id, m);
  }
  return splits.flatMap((s) => {
    const person = peopleById.get(s.personId);
    if (!person) return [];
    const accrued = accBySplit.get(s.id) ?? [];
    const owed = accrued
      .map((a) => {
        const dist = distBySplit.get(s.id)?.get(a.currency) ?? 0;
        const native = round2(a.native - dist);
        return {
          currency: a.currency,
          native,
          usd: a.native > 0 ? round2((a.usd * native) / a.native) : 0,
        };
      })
      .filter((o) => o.native > 0);
    return [
      {
        id: s.id,
        person: mapPersonRef(person),
        percent: s.percent,
        effectiveFrom: s.effectiveFrom,
        effectiveTo: s.effectiveTo,
        note: s.note,
        accrued,
        owed,
      },
    ];
  });
}

/* -------------------------------------------------------------------------- */
/*  balances (§4.6)                                                            */
/* -------------------------------------------------------------------------- */

interface Balances {
  robux: number;
  usd: number;
}

async function balances(
  tx: Tx,
  projectId: string,
  settings: SettingsRow,
  asOf?: string,
): Promise<Balances> {
  const dateCond = asOf ? sql` and occurred_on <= ${asOf}` : sql``;
  const r = await tx.execute<{ k: string; v: string }>(sql`
    select k, sum(v)::text as v from (
      select 'robux_in' as k, amount_net as v from finance_transactions
        where project_id = ${projectId} and currency = 'robux'
          and kind in ('revenue', 'investment')${dateCond}
      union all
      select 'robux_out', cost_amount from finance_transactions
        where project_id = ${projectId} and currency = 'robux'
          and ((kind = 'expense' and status = 'paid') or kind = 'distribution')${dateCond}
      union all
      select 'robux_cashout', robux_out from finance_transactions
        where project_id = ${projectId} and kind = 'cashout'${dateCond}
      union all
      select 'usd_in', amount_net from finance_transactions
        where project_id = ${projectId} and currency = 'usd'
          and kind in ('revenue', 'investment')${dateCond}
      union all
      select 'usd_cashin', usd_in from finance_transactions
        where project_id = ${projectId} and kind = 'cashout'${dateCond}
      union all
      select 'usd_out', cost_amount from finance_transactions
        where project_id = ${projectId} and currency = 'usd'
          and ((kind = 'expense' and status = 'paid') or kind = 'distribution')${dateCond}
    ) t group by k
  `);
  const by = new Map(r.rows.map((row) => [row.k, Number(row.v)]));
  const robux =
    (settings.openingRobux ?? 0) +
    (by.get("robux_in") ?? 0) -
    (by.get("robux_out") ?? 0) -
    (by.get("robux_cashout") ?? 0);
  const usd = round2(
    (settings.openingUsd ?? 0) +
      (by.get("usd_in") ?? 0) +
      (by.get("usd_cashin") ?? 0) -
      (by.get("usd_out") ?? 0),
  );
  return { robux, usd };
}

/* -------------------------------------------------------------------------- */
/*  routes                                                                    */
/* -------------------------------------------------------------------------- */

export function financeRoutes(): Hono<AppEnv> {
  const r = new Hono<AppEnv>();

  /* ---- settings ---- */

  r.get("/projects/:id/finance/settings", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const out = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      return mapSettings(await ensureSettings(tx, projectId));
    });
    return c.json(out);
  });

  r.put("/projects/:id/finance/settings", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const body = putFinanceSettingsSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid settings.");
    const out = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      await ensureSettings(tx, projectId);
      const v = body.data;
      const [row] = await tx
        .update(financeSettings)
        .set({
          ...(v.devexRate !== undefined && { devexRate: v.devexRate }),
          ...(v.displayCurrency !== undefined && {
            displayCurrency: v.displayCurrency,
          }),
          ...(v.openingUsd !== undefined && { openingUsd: v.openingUsd }),
          ...(v.openingRobux !== undefined && { openingRobux: v.openingRobux }),
          ...(v.openingSetOn !== undefined && { openingSetOn: v.openingSetOn }),
          updatedAt: new Date(),
        })
        .where(eq(financeSettings.projectId, projectId))
        .returning();
      return mapSettings(must(row, "settings update"));
    });
    return c.json(out);
  });

  /* ---- budgets ---- */

  r.get("/projects/:id/finance/budgets/:month", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const month = financeMonthSchema.parse(c.req.param("month"));
    const out = await withUser(
      userId,
      async (tx): Promise<FinanceBudget | null> => {
        await resolveProjectAccess(tx, projectId, userId, {
          requireOwner: true,
        });
        const [row] = await tx
          .select()
          .from(financeBudgets)
          .where(
            and(
              eq(financeBudgets.projectId, projectId),
              eq(financeBudgets.month, `${month}-01`),
            ),
          )
          .limit(1);
        return row ? { month, amountUsd: row.amountUsd, note: row.note } : null;
      },
    );
    return c.json(out);
  });

  r.put("/projects/:id/finance/budgets/:month", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const month = financeMonthSchema.parse(c.req.param("month"));
    const body = putFinanceBudgetSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid budget.");
    const out = await withUser(userId, async (tx): Promise<FinanceBudget> => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      const [row] = await tx
        .insert(financeBudgets)
        .values({
          projectId,
          month: `${month}-01`,
          amountUsd: body.data.amountUsd,
          note: body.data.note ?? null,
        })
        .onConflictDoUpdate({
          target: [financeBudgets.projectId, financeBudgets.month],
          set: {
            amountUsd: body.data.amountUsd,
            ...(body.data.note !== undefined && { note: body.data.note }),
          },
        })
        .returning();
      const b = must(row, "budget upsert");
      return { month, amountUsd: b.amountUsd, note: b.note };
    });
    return c.json(out);
  });

  /* ---- categories ---- */

  r.get("/projects/:id/finance/categories", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const out = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      await ensureSettings(tx, projectId);
      const rows = await tx
        .select()
        .from(financeCategories)
        .where(eq(financeCategories.projectId, projectId))
        .orderBy(financeCategories.sort, financeCategories.name);
      return rows.map(mapCategory);
    });
    return c.json(out);
  });

  /* ---- transactions ---- */

  r.get("/projects/:id/finance/transactions", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const q = financeTxQuerySchema.safeParse(c.req.query());
    if (!q.success) throw validationError("Invalid transaction query.");
    const out = await withUser(
      userId,
      async (tx): Promise<FinanceTransactionPage> => {
        await resolveProjectAccess(tx, projectId, userId, {
          requireOwner: true,
        });
        const f = q.data;
        const conds = [eq(financeTransactions.projectId, projectId)];
        if (f.month) {
          const { start, end } = monthRange(f.month);
          conds.push(sql`${financeTransactions.occurredOn} >= ${start}`);
          conds.push(sql`${financeTransactions.occurredOn} < ${end}`);
        }
        if (f.kind) conds.push(eq(financeTransactions.kind, f.kind));
        if (f.category)
          conds.push(eq(financeTransactions.categoryId, f.category));
        if (f.method) conds.push(eq(financeTransactions.method, f.method));
        if (f.person) conds.push(eq(financeTransactions.personId, f.person));
        if (f.status) conds.push(eq(financeTransactions.status, f.status));
        if (f.milestone)
          conds.push(eq(financeTransactions.milestoneId, f.milestone));
        if (f.q)
          conds.push(
            sql`(${financeTransactions.description} ilike ${`%${f.q}%`} or ${financeTransactions.ref} ilike ${`%${f.q}%`})`,
          );
        if (f.cursor) {
          const [d, id] = f.cursor.split("_");
          if (d && id) {
            const cursorCond = or(
              lt(financeTransactions.occurredOn, d),
              and(
                eq(financeTransactions.occurredOn, d),
                lt(financeTransactions.id, id),
              ),
            );
            if (cursorCond) conds.push(cursorCond);
          }
        }
        const rows = await tx
          .select()
          .from(financeTransactions)
          .where(and(...conds))
          .orderBy(
            desc(financeTransactions.occurredOn),
            desc(financeTransactions.id),
          )
          .limit(PAGE_SIZE + 1);
        const page = rows.slice(0, PAGE_SIZE);
        const refs = await loadTxRefs(tx, projectId);
        const last = page[page.length - 1];
        return {
          items: page.map((row) =>
            mapTx(row, refs.categoriesById, refs.peopleById),
          ),
          nextCursor:
            rows.length > PAGE_SIZE && last
              ? `${last.occurredOn}_${last.id}`
              : null,
        };
      },
    );
    return c.json(out);
  });

  r.post("/projects/:id/finance/transactions", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const body = createFinanceTxSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success)
      throw validationError(
        body.error.issues[0]?.message ?? "Invalid transaction.",
      );
    const v = body.data;
    const out = await withUser(
      userId,
      async (tx): Promise<FinanceTransaction> => {
        await resolveProjectAccess(tx, projectId, userId, {
          requireOwner: true,
        });
        const settings = await ensureSettings(tx, projectId);
        const amounts = computeAmounts(v, settings.devexRate);
        const description =
          v.description ??
          (v.kind === "revenue"
            ? `Creator Dashboard — ${monthOf(v.occurredOn)}`
            : v.kind === "cashout"
              ? "DevEx"
              : v.kind === "investment"
                ? "Capital in"
                : "");
        const status = v.kind === "expense" ? (v.status ?? "paid") : "paid";
        // Retry ref generation once on a concurrent-insert collision.
        for (let attempt = 0; ; attempt++) {
          const ref = await nextRef(tx, projectId);
          try {
            const [row] = await tx
              .insert(financeTransactions)
              .values({
                projectId,
                ref,
                kind: v.kind,
                occurredOn: v.occurredOn,
                description,
                currency: amounts.currency,
                amountGross: amounts.amountGross,
                feeAmount: amounts.feeAmount,
                amountNet: amounts.amountNet,
                costAmount: amounts.costAmount,
                rateUsed: settings.devexRate,
                amountUsd: amounts.amountUsd,
                categoryId: v.categoryId ?? null,
                personId: v.personId ?? null,
                method: v.kind === "cashout" ? "devex" : (v.method ?? null),
                status,
                paidOn: status === "paid" ? (v.paidOn ?? v.occurredOn) : null,
                robuxOut: amounts.robuxOut,
                usdIn: amounts.usdIn,
                splitId: v.splitId ?? null,
                milestoneId: v.milestoneId ?? null,
                taskId: v.taskId ?? null,
                paymentRef: v.paymentRef ?? null,
                receiptUrl: v.receiptUrl ?? null,
                note: v.note ?? null,
              })
              .returning();
            const created = must(row, "transaction insert");
            if (created.kind === "revenue") await rewriteAccruals(tx, created);
            const refsMaps = await loadTxRefs(tx, projectId);
            return mapTx(created, refsMaps.categoriesById, refsMaps.peopleById);
          } catch (err) {
            if (isUniqueViolation(err) && attempt < 2) continue;
            throw err;
          }
        }
      },
    );
    return c.json(out, 201);
  });

  r.patch("/finance/transactions/:txId", async (c) => {
    const userId = requireUser(c);
    const txId = uuidSchema.parse(c.req.param("txId"));
    const body = patchFinanceTxSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid transaction patch.");
    const v = body.data;
    const out = await withUser(
      userId,
      async (tx): Promise<FinanceTransaction> => {
        const { projectId } = await resolveItemAccess(
          tx,
          "financeTx",
          txId,
          userId,
          {
            requireOwner: true,
          },
        );
        const [existing] = await tx
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.id, txId))
          .limit(1);
        if (!existing) throw notFound("No such transaction.");

        // Recompute amounts when any money input changed — with the row's
        // snapshotted rate, never the current project rate.
        const moneyTouched =
          v.amount !== undefined ||
          v.mode !== undefined ||
          v.fee !== undefined ||
          v.method !== undefined ||
          v.robuxOut !== undefined ||
          v.usdIn !== undefined;
        const amounts = moneyTouched
          ? computeAmounts(
              {
                kind: existing.kind,
                currency: existing.currency ?? undefined,
                amount: v.amount ?? existing.amountGross ?? undefined,
                mode: v.mode,
                fee: v.fee ?? undefined,
                method: (v.method ?? existing.method ?? undefined) as
                  | CreateFinanceTxInput["method"]
                  | undefined,
                robuxOut: v.robuxOut ?? existing.robuxOut ?? undefined,
                usdIn: v.usdIn ?? existing.usdIn ?? undefined,
              },
              existing.rateUsed,
            )
          : null;
        if (
          existing.kind === "distribution" &&
          (v.method === "robux_gamepass" ||
            (existing.currency === "robux" &&
              v.method !== undefined &&
              v.method !== "robux_group_payout"))
        ) {
          throw validationError(
            "A distribution is never paid by gamepass (spec §4.8.1).",
          );
        }

        const nextStatus = v.status ?? existing.status;
        const [row] = await tx
          .update(financeTransactions)
          .set({
            ...(v.occurredOn !== undefined && { occurredOn: v.occurredOn }),
            ...(v.description !== undefined && { description: v.description }),
            ...(amounts && {
              amountGross: amounts.amountGross,
              feeAmount: amounts.feeAmount,
              amountNet: amounts.amountNet,
              costAmount: amounts.costAmount,
              amountUsd: amounts.amountUsd,
              robuxOut: amounts.robuxOut,
              usdIn: amounts.usdIn,
            }),
            ...(v.method !== undefined && { method: v.method }),
            ...(v.categoryId !== undefined && { categoryId: v.categoryId }),
            ...(v.personId !== undefined && { personId: v.personId }),
            ...(v.status !== undefined && { status: v.status }),
            paidOn:
              nextStatus === "owed"
                ? null
                : (v.paidOn ??
                  existing.paidOn ??
                  (nextStatus === "paid" ? todayIso() : null)),
            ...(v.milestoneId !== undefined && { milestoneId: v.milestoneId }),
            ...(v.taskId !== undefined && { taskId: v.taskId }),
            ...(v.paymentRef !== undefined && { paymentRef: v.paymentRef }),
            ...(v.receiptUrl !== undefined && { receiptUrl: v.receiptUrl }),
            ...(v.note !== undefined && { note: v.note }),
            updatedAt: new Date(),
          })
          .where(eq(financeTransactions.id, txId))
          .returning();
        const updated = must(row, "transaction update");
        if (updated.kind === "revenue") await rewriteAccruals(tx, updated);
        const refs = await loadTxRefs(tx, projectId);
        return mapTx(updated, refs.categoriesById, refs.peopleById);
      },
    );
    return c.json(out);
  });

  r.delete("/finance/transactions/:txId", async (c) => {
    const userId = requireUser(c);
    const txId = uuidSchema.parse(c.req.param("txId"));
    await withUser(userId, async (tx) => {
      await resolveItemAccess(tx, "financeTx", txId, userId, {
        requireOwner: true,
      });
      // Accruals cascade with the row.
      await tx
        .delete(financeTransactions)
        .where(eq(financeTransactions.id, txId));
    });
    return c.body(null, 204);
  });

  /* ---- people ---- */

  r.get("/projects/:id/finance/people", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const out = await withUser(
      userId,
      async (tx): Promise<FinancePersonListRow[]> => {
        await resolveProjectAccess(tx, projectId, userId, {
          requireOwner: true,
        });
        const rows = await tx
          .select()
          .from(people)
          .where(eq(people.projectId, projectId))
          .orderBy(people.archived, people.discordHandle);
        const agg = await tx.execute<{
          person_id: string;
          tx_count: string;
          paid_robux: string;
          paid_usd: string;
          last_paid: string | null;
          has_capital: boolean;
        }>(sql`
        select p.id as person_id,
          count(t.id) filter (where t.kind in ('expense','distribution') and t.status = 'paid')::text as tx_count,
          coalesce(sum(t.cost_amount) filter (where t.currency = 'robux' and t.status = 'paid' and t.kind in ('expense','distribution')), 0)::text as paid_robux,
          coalesce(sum(t.cost_amount) filter (where t.currency = 'usd' and t.status = 'paid' and t.kind in ('expense','distribution')), 0)::text as paid_usd,
          max(coalesce(t.paid_on, t.occurred_on)) filter (where t.kind in ('expense','distribution') and t.status = 'paid')::text as last_paid,
          bool_or(t.kind = 'investment') as has_capital
        from people p
        left join finance_transactions t on t.person_id = p.id
        where p.project_id = ${projectId}
        group by p.id
      `);
        const aggById = new Map(agg.rows.map((a) => [a.person_id, a]));
        const activeSplits = await tx.execute<{
          person_id: string;
          percent: string;
        }>(sql`
        select person_id, sum(percent)::text as percent from revenue_splits
        where project_id = ${projectId} and effective_from <= current_date
          and (effective_to is null or effective_to >= current_date)
        group by person_id
      `);
        const pctById = new Map(
          activeSplits.rows.map((s) => [s.person_id, Number(s.percent)]),
        );
        return rows.map((p) => {
          const a = aggById.get(p.id);
          return {
            ...mapPerson(p),
            activePercent: pctById.get(p.id) ?? null,
            hasCapital: a?.has_capital ?? false,
            txCount: Number(a?.tx_count ?? 0),
            paidRobux: Number(a?.paid_robux ?? 0),
            paidUsd: round2(Number(a?.paid_usd ?? 0)),
            lastPaidOn: a?.last_paid ?? null,
          };
        });
      },
    );
    return c.json(out);
  });

  r.post("/projects/:id/finance/people", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const body = createFinancePersonSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid person.");
    const v = body.data;
    const out = await withUser(userId, async (tx): Promise<FinancePerson> => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      try {
        const [row] = await tx
          .insert(people)
          .values({
            projectId,
            discordHandle: v.discordHandle,
            displayName: v.displayName ?? null,
            robloxUserId: v.robloxUserId ?? null,
            robloxUsername: v.robloxUsername ?? null,
            avatarUrl: v.avatarUrl ?? null,
            roles: v.roles ?? [],
            preferredMethod: v.preferredMethod ?? null,
            defaultRateUsd: v.defaultRateUsd ?? null,
            rating: v.rating ?? null,
            note: v.note ?? null,
          })
          .returning();
        return mapPerson(must(row, "person insert"));
      } catch (err) {
        if (isUniqueViolation(err))
          throw validationError("That Discord handle already exists here.");
        throw err;
      }
    });
    return c.json(out, 201);
  });

  r.patch("/finance/people/:personId", async (c) => {
    const userId = requireUser(c);
    const personId = uuidSchema.parse(c.req.param("personId"));
    const body = patchFinancePersonSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid person patch.");
    const v = body.data;
    const out = await withUser(userId, async (tx): Promise<FinancePerson> => {
      await resolveItemAccess(tx, "financePerson", personId, userId, {
        requireOwner: true,
      });
      const [row] = await tx
        .update(people)
        .set({
          ...(v.discordHandle !== undefined && {
            discordHandle: v.discordHandle,
          }),
          ...(v.displayName !== undefined && { displayName: v.displayName }),
          ...(v.robloxUserId !== undefined && { robloxUserId: v.robloxUserId }),
          ...(v.robloxUsername !== undefined && {
            robloxUsername: v.robloxUsername,
          }),
          ...(v.avatarUrl !== undefined && { avatarUrl: v.avatarUrl }),
          ...(v.roles !== undefined && { roles: v.roles }),
          ...(v.preferredMethod !== undefined && {
            preferredMethod: v.preferredMethod,
          }),
          ...(v.defaultRateUsd !== undefined && {
            defaultRateUsd: v.defaultRateUsd,
          }),
          ...(v.rating !== undefined && { rating: v.rating }),
          ...(v.note !== undefined && { note: v.note }),
          ...(v.archived !== undefined && { archived: v.archived }),
        })
        .where(eq(people.id, personId))
        .returning();
      return mapPerson(must(row, "person update"));
    });
    return c.json(out);
  });

  r.get("/finance/people/:personId", async (c) => {
    const userId = requireUser(c);
    const personId = uuidSchema.parse(c.req.param("personId"));
    const out = await withUser(
      userId,
      async (tx): Promise<FinancePersonDetail> => {
        const { projectId } = await resolveItemAccess(
          tx,
          "financePerson",
          personId,
          userId,
          { requireOwner: true },
        );
        const [person] = await tx
          .select()
          .from(people)
          .where(eq(people.id, personId))
          .limit(1);
        if (!person) throw notFound("No such person.");
        const txRows = await tx
          .select()
          .from(financeTransactions)
          .where(eq(financeTransactions.personId, personId))
          .orderBy(
            desc(financeTransactions.occurredOn),
            desc(financeTransactions.id),
          );
        const refs = await loadTxRefs(tx, projectId);
        const allSplits = await splitsWithTotals(
          tx,
          projectId,
          refs.peopleById,
        );
        const owedRows = await splitOwedByPerson(tx, projectId);
        const settings = await ensureSettings(tx, projectId);

        const unpaid = new Map<
          FinanceCurrency,
          { native: number; usd: number }
        >();
        for (const t of txRows) {
          if (t.kind === "expense" && t.status === "owed" && t.currency) {
            const cur = unpaid.get(t.currency) ?? { native: 0, usd: 0 };
            cur.native = round2(cur.native + (t.costAmount ?? 0));
            cur.usd = round2(cur.usd + t.amountUsd);
            unpaid.set(t.currency, cur);
          }
        }
        for (const o of owedRows) {
          if (o.personId !== personId || o.owed <= 0) continue;
          const cur = unpaid.get(o.currency) ?? { native: 0, usd: 0 };
          cur.native = round2(cur.native + o.owed);
          cur.usd = round2(
            cur.usd +
              (o.currency === "robux"
                ? usdFromRobux(o.owed, settings.devexRate)
                : o.owed),
          );
          unpaid.set(o.currency, cur);
        }

        const capital = new Map<
          FinanceCurrency,
          { native: number; usd: number }
        >();
        for (const t of txRows) {
          if (t.kind !== "investment" || !t.currency) continue;
          const cur = capital.get(t.currency) ?? { native: 0, usd: 0 };
          cur.native = round2(cur.native + (t.amountNet ?? 0));
          cur.usd = round2(cur.usd + t.amountUsd);
          capital.set(t.currency, cur);
        }

        const toList = (
          m: Map<FinanceCurrency, { native: number; usd: number }>,
        ): CurrencyAmount[] =>
          [...m.entries()].map(([currency, v]) => ({
            currency,
            native: v.native,
            usd: v.usd,
          }));

        return {
          ...mapPerson(person),
          transactions: txRows.map((row) =>
            mapTx(row, refs.categoriesById, refs.peopleById),
          ),
          splits: allSplits.filter((s) => s.person.id === personId),
          capitalIn: toList(capital),
          owed: toList(unpaid),
        };
      },
    );
    return c.json(out);
  });

  /* ---- splits ---- */

  r.get("/projects/:id/finance/splits", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const out = await withUser(userId, async (tx) => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      const refs = await loadTxRefs(tx, projectId);
      return splitsWithTotals(tx, projectId, refs.peopleById);
    });
    return c.json(out);
  });

  r.post("/projects/:id/finance/splits", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const body = createFinanceSplitSchema.safeParse(
      await c.req.json().catch(() => ({})),
    );
    if (!body.success) throw validationError("Invalid split.");
    const v = body.data;
    const out = await withUser(userId, async (tx): Promise<RevenueSplit> => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.id, v.personId), eq(people.projectId, projectId)))
        .limit(1);
      if (!person) throw notFound("No such person in this project.");
      // Group payout is the only Robux rail; it needs group membership (§4.8).
      if (person.robloxUserId == null)
        throw validationError(
          "Link a Roblox profile first — group payouts need it.",
        );
      const [row] = await tx
        .insert(revenueSplits)
        .values({
          projectId,
          personId: v.personId,
          percent: v.percent,
          effectiveFrom: v.effectiveFrom,
          note: v.note ?? null,
        })
        .returning();
      const inserted = must(row, "split insert");
      // A back-dated split accrues against existing revenue.
      await rewriteAccrualsForProject(tx, projectId);
      const refs = await loadTxRefs(tx, projectId);
      const all = await splitsWithTotals(tx, projectId, refs.peopleById);
      const created = all.find((s) => s.id === inserted.id);
      if (!created) throw new Error("split vanished after insert");
      return created;
    });
    return c.json(out, 201);
  });

  // Accepts effective_to and note ONLY. A percent change is a 422: rewriting a
  // percentage silently rewrites history — close and reopen instead (§4.8).
  r.patch("/finance/splits/:splitId", async (c) => {
    const userId = requireUser(c);
    const splitId = uuidSchema.parse(c.req.param("splitId"));
    const raw = await c.req.json().catch(() => ({}));
    const body = patchFinanceSplitSchema.safeParse(raw);
    if (!body.success) {
      const offending = ["percent", "personId", "effectiveFrom"].find(
        (k) => typeof raw === "object" && raw != null && k in raw,
      );
      throw validationError(
        offending
          ? `A split's ${offending} is never edited (spec §4.8). Close this split with effectiveTo and open a new one.`
          : "Invalid split patch.",
      );
    }
    const v = body.data;
    const out = await withUser(userId, async (tx): Promise<RevenueSplit> => {
      const { projectId } = await resolveItemAccess(
        tx,
        "financeSplit",
        splitId,
        userId,
        { requireOwner: true },
      );
      const [row] = await tx
        .update(revenueSplits)
        .set({
          ...(v.effectiveTo !== undefined && { effectiveTo: v.effectiveTo }),
          ...(v.note !== undefined && { note: v.note }),
        })
        .where(eq(revenueSplits.id, splitId))
        .returning();
      if (!row) throw notFound("No such split.");
      if (v.effectiveTo !== undefined)
        await rewriteAccrualsForProject(tx, projectId);
      const refs = await loadTxRefs(tx, projectId);
      const all = await splitsWithTotals(tx, projectId, refs.peopleById);
      const updated = all.find((s) => s.id === splitId);
      if (!updated) throw notFound("No such split.");
      return updated;
    });
    return c.json(out);
  });

  /* ---- overview (§6): one round trip for everything above the fold ---- */

  r.get("/projects/:id/finance/overview", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const month = financeMonthSchema.parse(
      c.req.query("month") ?? new Date().toISOString().slice(0, 7),
    );
    const out = await withUser(userId, async (tx): Promise<FinanceOverview> => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      const settings = await ensureSettings(tx, projectId);
      const rate = settings.devexRate;
      const { start, end } = monthRange(month);

      const monthAgg = await tx.execute<{
        revenue_usd: string;
        revenue_robux: string;
        spend_usd: string;
        payout_fee_robux: string;
        prev_net: string | null;
        prev_rows: string;
      }>(sql`
        select
          coalesce(sum(amount_usd) filter (where kind = 'revenue' and occurred_on >= ${start} and occurred_on < ${end}), 0)::text as revenue_usd,
          coalesce(sum(amount_net) filter (where kind = 'revenue' and currency = 'robux' and occurred_on >= ${start} and occurred_on < ${end}), 0)::text as revenue_robux,
          coalesce(sum(amount_usd) filter (where kind = 'expense' and status = 'paid' and paid_on >= ${start} and paid_on < ${end}), 0)::text as spend_usd,
          coalesce(sum(fee_amount) filter (where kind = 'expense' and method = 'robux_gamepass' and occurred_on >= ${start} and occurred_on < ${end}), 0)::text as payout_fee_robux,
          (
            select (coalesce(sum(amount_usd) filter (where kind = 'revenue'), 0)
                  - coalesce(sum(amount_usd) filter (where kind = 'expense' and status = 'paid'), 0))::text
            from finance_transactions
            where project_id = ${projectId}
              and occurred_on >= (${start}::date - interval '1 month')
              and occurred_on < ${start}::date
              and kind in ('revenue', 'expense')
          ) as prev_net,
          (
            select count(*)::text from finance_transactions
            where project_id = ${projectId}
              and occurred_on >= (${start}::date - interval '1 month')
              and occurred_on < ${start}::date
              and kind in ('revenue', 'expense')
          ) as prev_rows
        from finance_transactions where project_id = ${projectId}
      `);
      const m = monthAgg.rows[0];
      const revenueUsd = round2(Number(m?.revenue_usd ?? 0));
      const spendUsd = round2(Number(m?.spend_usd ?? 0));
      const netUsd = round2(revenueUsd - spendUsd);
      const prevRows = Number(m?.prev_rows ?? 0);
      const prevNet = m?.prev_net != null ? Number(m.prev_net) : null;
      const netDeltaPct =
        prevRows > 0 && prevNet != null && prevNet !== 0
          ? round2((netUsd - prevNet) / Math.abs(prevNet))
          : null;

      const [budget] = await tx
        .select()
        .from(financeBudgets)
        .where(
          and(
            eq(financeBudgets.projectId, projectId),
            eq(financeBudgets.month, start),
          ),
        )
        .limit(1);

      const bal = await balances(tx, projectId, settings);
      const openingSet =
        settings.openingUsd != null || settings.openingRobux != null;
      const pos = positionUsd(bal.usd, bal.robux, rate);

      // Trailing burn: up to 3 complete months back from the CURRENT month,
      // clipped to project history (§4.6). Spend only — distributions and
      // capital are not burn.
      const burnAgg = await tx.execute<{ month: string; spend: string }>(sql`
        select to_char(date_trunc('month', paid_on), 'YYYY-MM') as month,
               sum(amount_usd)::text as spend
        from finance_transactions
        where project_id = ${projectId} and kind = 'expense' and status = 'paid'
          and paid_on is not null
        group by 1
      `);
      const firstAny = await tx.execute<{ first: string | null }>(sql`
        select min(occurred_on)::text as first from finance_transactions
        where project_id = ${projectId}
      `);
      const now = new Date();
      const currentMonth = now.toISOString().slice(0, 7);
      const spendByMonth = new Map(
        burnAgg.rows.map((row) => [row.month, Number(row.spend)]),
      );
      const firstMonth = firstAny.rows[0]?.first
        ? monthOf(firstAny.rows[0].first)
        : null;
      let avgBurn: number | null = null;
      if (firstMonth) {
        const months: string[] = [];
        const d = new Date(`${currentMonth}-01T00:00:00Z`);
        for (let i = 1; i <= 3; i++) {
          const mm = new Date(d);
          mm.setUTCMonth(mm.getUTCMonth() - i);
          const key = mm.toISOString().slice(0, 7);
          if (key >= firstMonth) months.push(key);
        }
        if (months.length > 0) {
          const total = months.reduce(
            (sum, key) => sum + (spendByMonth.get(key) ?? 0),
            0,
          );
          avgBurn = total / months.length;
        }
      }

      // Owed: unpaid expenses + outstanding split accruals (§4.8.1: split debt
      // joins the same tile, converted at the current rate for display only).
      const owedTx = await tx
        .select()
        .from(financeTransactions)
        .where(
          and(
            eq(financeTransactions.projectId, projectId),
            eq(financeTransactions.kind, "expense"),
            eq(financeTransactions.status, "owed"),
          ),
        )
        .orderBy(financeTransactions.occurredOn);
      const refs = await loadTxRefs(tx, projectId);
      const splitOwed = (await splitOwedByPerson(tx, projectId)).filter(
        (o) => o.owed > 0,
      );
      const owedRows: FinanceOwedRow[] = [
        ...owedTx.map((t): FinanceOwedRow => {
          const cat = t.categoryId
            ? refs.categoriesById.get(t.categoryId)
            : null;
          return {
            ref: t.ref,
            person: (() => {
              const person = t.personId
                ? refs.peopleById.get(t.personId)
                : undefined;
              return person ? mapPersonRef(person) : null;
            })(),
            description: t.description,
            amountUsd: t.amountUsd,
            currency: t.currency ?? "usd",
            amountNative:
              t.currency === "robux" ? (t.costAmount ?? 0) : t.amountUsd,
            occurredOn: t.occurredOn,
            isSplit: false,
            categoryColor: cat?.color ?? null,
          };
        }),
        ...splitOwed.map((o): FinanceOwedRow => {
          const person = refs.peopleById.get(o.personId);
          return {
            ref: "",
            person: person ? mapPersonRef(person) : null,
            description: person
              ? `${person.discordHandle} — revenue share`
              : "revenue share",
            amountUsd:
              o.currency === "robux" ? usdFromRobux(o.owed, rate) : o.owed,
            currency: o.currency,
            amountNative: o.owed,
            occurredOn: todayIso(),
            isSplit: true,
            categoryColor: null,
          };
        }),
      ];
      const owedUsd = round2(owedRows.reduce((s, o) => s + o.amountUsd, 0));
      const owedPeople = new Set(owedRows.map((o) => o.person?.id ?? o.ref));

      // 12-month series, oldest first.
      const seriesAgg = await tx.execute<{
        month: string;
        revenue_usd: string;
        spend_usd: string;
      }>(sql`
        select to_char(date_trunc('month', occurred_on), 'YYYY-MM') as month,
          coalesce(sum(amount_usd) filter (where kind = 'revenue'), 0)::text as revenue_usd,
          coalesce(sum(amount_usd) filter (where kind = 'expense' and status = 'paid'), 0)::text as spend_usd
        from finance_transactions
        where project_id = ${projectId}
          and occurred_on >= (${start}::date - interval '11 months')
          and occurred_on < ${end}
        group by 1
      `);
      const seriesByMonth = new Map(
        seriesAgg.rows.map((row) => [row.month, row]),
      );
      const series: FinanceOverview["series"] = [];
      for (let i = 11; i >= 0; i--) {
        const d = new Date(`${start}T00:00:00Z`);
        d.setUTCMonth(d.getUTCMonth() - i);
        const key = d.toISOString().slice(0, 7);
        const row = seriesByMonth.get(key);
        const rev = round2(Number(row?.revenue_usd ?? 0));
        const sp = round2(Number(row?.spend_usd ?? 0));
        series.push({
          month: key,
          revenueUsd: rev,
          spendUsd: sp,
          netUsd: round2(rev - sp),
        });
      }

      const catAgg = await tx.execute<{
        category_id: string | null;
        spend: string;
      }>(sql`
        select category_id, sum(amount_usd)::text as spend
        from finance_transactions
        where project_id = ${projectId} and kind = 'expense' and status = 'paid'
          and paid_on >= ${start} and paid_on < ${end}
        group by category_id
      `);
      const byCategory = catAgg.rows
        .map((row) => {
          const cat = row.category_id
            ? refs.categoriesById.get(row.category_id)
            : null;
          const spend = round2(Number(row.spend));
          return {
            id: cat?.id ?? "uncategorised",
            name: cat?.name ?? "Uncategorised",
            color: cat?.color ?? "#8A90A0",
            spendUsd: spend,
            pct: spendUsd > 0 ? round2(spend / spendUsd) : 0,
          };
        })
        .sort((a, b) => b.spendUsd - a.spendUsd);

      const lastCashout = await tx.execute<{ last: string | null }>(sql`
        select max(occurred_on)::text as last from finance_transactions
        where project_id = ${projectId} and kind = 'cashout'
      `);

      const recent = await tx
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.projectId, projectId))
        .orderBy(
          desc(financeTransactions.occurredOn),
          desc(financeTransactions.createdAt),
        )
        .limit(5);

      return {
        month,
        rate,
        displayCurrency: settings.displayCurrency,
        openingSet,
        tiles: {
          netUsd,
          netDeltaPct,
          revenueUsd,
          revenueRobux: Number(m?.revenue_robux ?? 0),
          spendUsd,
          budgetUsd: budget?.amountUsd ?? null,
          budgetPct:
            budget && budget.amountUsd > 0 ? spendUsd / budget.amountUsd : null,
          payoutFeeRobux: Number(m?.payout_fee_robux ?? 0),
          owedUsd,
          owedCount: owedPeople.size,
          robuxBalance: bal.robux,
          usdBalance: bal.usd,
          positionUsd: pos,
          runwayMonths: openingSet ? runwayMonths(pos, avgBurn) : null,
          devexProgress: bal.robux,
          lastCashoutOn: lastCashout.rows[0]?.last ?? null,
        },
        series,
        byCategory,
        owed: owedRows,
        recent: recent.map((row) =>
          mapTx(row, refs.categoriesById, refs.peopleById),
        ),
      };
    });
    return c.json(out);
  });

  /* ---- position (§6): the below-the-fold zone, its own request ---- */

  r.get("/projects/:id/finance/position", async (c) => {
    const userId = requireUser(c);
    const projectId = uuidSchema.parse(c.req.param("id"));
    const q = financePositionQuerySchema.safeParse(c.req.query());
    if (!q.success) throw validationError("Invalid period.");
    const period = q.data.period;
    const out = await withUser(userId, async (tx): Promise<FinancePosition> => {
      await resolveProjectAccess(tx, projectId, userId, { requireOwner: true });
      const settings = await ensureSettings(tx, projectId);
      const rate = settings.devexRate;
      const all = period === "all";
      const range = all ? null : monthRange(period);
      const periodCond = range
        ? sql` and occurred_on >= ${range.start} and occurred_on < ${range.end}`
        : sql``;

      /* P&L (§4.10.1) */
      const pnlAgg = await tx.execute<{
        revenue_usd: string;
        expenses_usd: string;
        distributed_usd: string;
      }>(sql`
        select
          coalesce(sum(amount_usd) filter (where kind = 'revenue'), 0)::text as revenue_usd,
          coalesce(sum(amount_usd) filter (where kind = 'expense' and status = 'paid'), 0)::text as expenses_usd,
          coalesce(sum(amount_usd) filter (where kind = 'distribution'), 0)::text as distributed_usd
        from finance_transactions
        where project_id = ${projectId}${periodCond}
      `);
      const allocAgg = await tx.execute<{ usd: string }>(sql`
        select coalesce(sum(amount_usd), 0)::text as usd
        from finance_split_accruals
        where project_id = ${projectId}${periodCond}
      `);
      const pnlCat = await tx.execute<{
        category_id: string | null;
        spend: string;
      }>(sql`
        select category_id, sum(amount_usd)::text as spend
        from finance_transactions
        where project_id = ${projectId} and kind = 'expense' and status = 'paid'${periodCond}
        group by category_id
      `);
      const refs = await loadTxRefs(tx, projectId);
      const p = pnlAgg.rows[0];
      const revenueUsd = round2(Number(p?.revenue_usd ?? 0));
      const expensesUsd = round2(Number(p?.expenses_usd ?? 0));
      const allocatedUsd = round2(Number(allocAgg.rows[0]?.usd ?? 0));

      /* splits table — accrual/owed lifetime per split */
      const splits = await splitsWithTotals(tx, projectId, refs.peopleById);
      const activePct = await tx.execute<{ pct: string }>(sql`
        select coalesce(sum(percent), 0)::text as pct from revenue_splits
        where project_id = ${projectId} and effective_from <= current_date
          and (effective_to is null or effective_to >= current_date)
      `);
      const totalActive = Number(activePct.rows[0]?.pct ?? 0);

      /* balance sheet (§4.10.2): Robux valued at the CURRENT rate on both
         sides so a rate change moves assets and liabilities together and the
         sheet still reconciles. Retained earnings is therefore also computed
         at the current rate (not from the snapshotted amount_usd), plus the
         two residual terms the identity needs: the realised cash-out
         difference and distribution fees. */
      const asOf = all
        ? todayIso()
        : (() => {
            const { end } = monthRange(period);
            const d = new Date(`${end}T00:00:00Z`);
            d.setUTCDate(d.getUTCDate() - 1);
            return d.toISOString().slice(0, 10);
          })();
      const asOfCond = sql` and occurred_on <= ${asOf}`;
      const bal = await balances(tx, projectId, settings, asOf);
      const sheetAgg = await tx.execute<{
        rev_usd: string;
        rev_robux: string;
        exp_usd_cost: string;
        exp_robux_cost: string;
        owed_usd_cost: string;
        owed_robux_cost: string;
        inv_usd: string;
        inv_robux: string;
        cashout_usd_in: string;
        cashout_robux_out: string;
        dist_fee_usd: string;
      }>(sql`
        select
          coalesce(sum(amount_net) filter (where kind = 'revenue' and currency = 'usd'), 0)::text as rev_usd,
          coalesce(sum(amount_net) filter (where kind = 'revenue' and currency = 'robux'), 0)::text as rev_robux,
          coalesce(sum(cost_amount) filter (where kind = 'expense' and currency = 'usd'), 0)::text as exp_usd_cost,
          coalesce(sum(cost_amount) filter (where kind = 'expense' and currency = 'robux'), 0)::text as exp_robux_cost,
          coalesce(sum(cost_amount) filter (where kind = 'expense' and currency = 'usd' and status = 'owed'), 0)::text as owed_usd_cost,
          coalesce(sum(cost_amount) filter (where kind = 'expense' and currency = 'robux' and status = 'owed'), 0)::text as owed_robux_cost,
          coalesce(sum(amount_net) filter (where kind = 'investment' and currency = 'usd'), 0)::text as inv_usd,
          coalesce(sum(amount_net) filter (where kind = 'investment' and currency = 'robux'), 0)::text as inv_robux,
          coalesce(sum(usd_in) filter (where kind = 'cashout'), 0)::text as cashout_usd_in,
          coalesce(sum(robux_out) filter (where kind = 'cashout'), 0)::text as cashout_robux_out,
          coalesce(sum(fee_amount) filter (where kind = 'distribution' and currency = 'usd'), 0)::text as dist_fee_usd
        from finance_transactions
        where project_id = ${projectId}${asOfCond}
      `);
      const s = must(sheetAgg.rows[0], "sheet aggregate");
      const num = (x: string | undefined) => Number(x ?? 0);
      const val = (usd: number, robux: number) => usd + robux * rate;

      const owedByPerson = await splitOwedByPerson(tx, projectId, asOf);
      const accruedOutUsd = round2(
        owedByPerson.reduce(
          (sum, o) =>
            sum +
            (o.owed > 0
              ? o.currency === "robux"
                ? o.owed * rate
                : o.owed
              : 0),
          0,
        ),
      );
      const unpaidExpensesUsd = round2(
        val(num(s.owed_usd_cost), num(s.owed_robux_cost)),
      );
      const assetsRobuxUsd = round2(bal.robux * rate);
      const totalAssets = round2(bal.usd + assetsRobuxUsd);
      const totalLiabilities = round2(unpaidExpensesUsd + accruedOutUsd);

      const capitalInUsd = round2(
        (settings.openingUsd ?? 0) +
          (settings.openingRobux ?? 0) * rate +
          val(num(s.inv_usd), num(s.inv_robux)),
      );
      // Outstanding-accrual valuation must match the liability side exactly,
      // so retained subtracts (total accruals − settled) the same way the
      // liability line values them, i.e. via accruedOutUsd + settled at rate.
      const settledUsd = round2(
        owedByPerson.reduce(
          (sum, o) =>
            sum +
            (o.currency === "robux" ? o.distributed * rate : o.distributed),
          0,
        ),
      );
      const retainedEarningsUsd = round2(
        val(num(s.rev_usd), num(s.rev_robux)) -
          val(num(s.exp_usd_cost), num(s.exp_robux_cost)) -
          (accruedOutUsd + settledUsd) +
          (num(s.cashout_usd_in) - num(s.cashout_robux_out) * rate) -
          num(s.dist_fee_usd),
      );
      const totalEquity = round2(capitalInUsd + retainedEarningsUsd);
      const reconciles =
        Math.abs(round2(totalAssets - totalLiabilities) - totalEquity) < 0.01;

      /* break-even (§4.9): distributions do not enter this formula */
      const lifetime = await tx.execute<{
        rev: string;
        exp: string;
        inv: string;
      }>(sql`
        select
          coalesce(sum(amount_usd) filter (where kind = 'revenue'), 0)::text as rev,
          coalesce(sum(amount_usd) filter (where kind = 'expense' and status = 'paid'), 0)::text as exp,
          coalesce(sum(amount_usd) filter (where kind = 'investment'), 0)::text as inv
        from finance_transactions where project_id = ${projectId}
      `);
      const lt = must(lifetime.rows[0], "lifetime aggregate");
      const be = breakeven(num(lt.inv), round2(num(lt.rev) - num(lt.exp)));

      return {
        period,
        rate,
        pnl: {
          revenueUsd,
          byCategory: pnlCat.rows
            .map((row) => {
              const cat = row.category_id
                ? refs.categoriesById.get(row.category_id)
                : null;
              return {
                name: cat?.name ?? "Uncategorised",
                color: cat?.color ?? "#8A90A0",
                spendUsd: round2(Number(row.spend)),
              };
            })
            .sort((x, y) => y.spendUsd - x.spendUsd),
          expensesUsd,
          netProfitUsd: round2(revenueUsd - expensesUsd),
          allocatedUsd,
          yourShareUsd: round2(revenueUsd - allocatedUsd),
          distributedUsd: round2(Number(p?.distributed_usd ?? 0)),
        },
        splits,
        yourPercent: round2(100 - totalActive),
        splitsOver100: totalActive > 100,
        balanceSheet: {
          asOf,
          assets: {
            usd: bal.usd,
            robux: bal.robux,
            robuxUsd: assetsRobuxUsd,
            total: totalAssets,
          },
          liabilities: {
            unpaidExpensesUsd,
            accruedSplitsUsd: accruedOutUsd,
            total: totalLiabilities,
          },
          equity: {
            capitalInUsd,
            retainedEarningsUsd,
            total: totalEquity,
          },
          reconciles,
        },
        breakeven: be,
      };
    });
    return c.json(out);
  });

  /* ---- Roblox user lookup (fail soft — never block on it) ---- */

  r.get("/roblox/user-lookup", async (c) => {
    requireUser(c);
    const username = (c.req.query("username") ?? "").trim();
    if (!username || username.length > 50)
      throw validationError("Username required.");
    try {
      const res = await fetch("https://users.roblox.com/v1/usernames/users", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "monkyesuite-api/1.0",
        },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: true,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) return c.json({ found: false });
      const data = (await res.json()) as {
        data?: Array<{ id: number; name: string; displayName: string }>;
      };
      const user = data.data?.[0];
      if (!user) return c.json({ found: false });
      let avatarUrl: string | null = null;
      try {
        const thumb = await fetch(
          `https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${user.id}&size=150x150&format=Png&isCircular=false`,
          {
            headers: { "user-agent": "monkyesuite-api/1.0" },
            signal: AbortSignal.timeout(5_000),
          },
        );
        if (thumb.ok) {
          const t = (await thumb.json()) as {
            data?: Array<{ imageUrl?: string }>;
          };
          avatarUrl = t.data?.[0]?.imageUrl ?? null;
        }
      } catch {
        // headshot is a nice-to-have
      }
      return c.json({
        found: true,
        id: user.id,
        username: user.name,
        displayName: user.displayName,
        avatarUrl,
      });
    } catch {
      return c.json({ found: false });
    }
  });

  return r;
}
