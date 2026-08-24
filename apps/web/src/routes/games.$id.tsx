import type {
  AudienceRhythm,
  CohortSummary,
  CreatorPortfolio,
  GameEvent,
  GameMetric,
  LifecycleEvent,
  LifecycleEventType,
  MoverCard,
  PortfolioGame,
} from "@monkyesuite/shared";
import type { LifecycleStage as SharedLifecycleStage } from "@monkyesuite/shared";
import {
  createFileRoute,
  Link,
  notFound,
  useNavigate,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import ConvergenceChart, {
  buildEventFlags,
} from "../components/ConvergenceChart";
import { GameNotes } from "../components/GameNotes";
import LifecycleBadge from "../components/LifecycleBadge";
import { accelerationWord } from "../components/PulseCardParts";
import Thumb from "../components/shared/Thumb";
import VerifiedBadge from "../components/shared/VerifiedBadge";
import { Estimate, SortRank } from "../components/ui";
import { ApiError, api } from "../lib/api";
import {
  deltaColorVar,
  fmtCCU,
  fmtCCUCompact,
  fmtFull,
  fmtPct,
  fmtTrendPct,
  fmtVelocity,
  relTime,
} from "../lib/format";
import { LIFECYCLE } from "../lib/lifecycle";
import type { LifecycleStage } from "../lib/types";
import {
  buildCallLine,
  buildVerdict,
  type LifecycleTransition,
} from "../lib/verdict";

type CcuRange = "7d" | "all";

interface GameSearch {
  ccuRange?: CcuRange;
}

// Shared lifecycle (7-stage analytical) → pulse lifecycle (4-stage UI) mapping.
// The hero LifecycleBadge + colored chart lines all speak the 4-stage taxonomy
// (specs/02-signals §4). This adapter is the ONE place that owns the projection
// — every hero surface reads through it.
const STAGE_MAP: Record<SharedLifecycleStage, LifecycleStage> = {
  launching: "new",
  growing: "growing",
  stable: "growing",
  cooling: "peaking",
  declining: "declining",
  dormant: "declining",
  revived: "growing",
};

const DEFAULT_TRANSITION_REASON: Record<LifecycleStage, string> = {
  new: "First indexed",
  growing: "Sustained climb",
  peaking: "Crossed into peaking",
  declining: "Cooled off recent baseline",
};

const EVENT_REASON: Record<LifecycleEventType, string> = {
  launch: "First indexed",
  spike: "Big CCU jump",
  cooldown: "Off recent peak",
  decline: "Sustained drop",
  revival: "Back from dormancy",
  death: "Long silent",
  sort_appearance: "Entered a Roblox sort",
  sort_exit: "Left a Roblox sort",
  update_shipped: "New update pushed",
};

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

export const Route = createFileRoute("/games/$id")({
  validateSearch: (search: Record<string, unknown>): GameSearch => {
    const out: GameSearch = {};
    if (search.ccuRange === "all") out.ccuRange = "all";
    return out;
  },
  loaderDeps: ({ search }) => ({ ccuRange: search.ccuRange ?? "7d" }),
  loader: async ({ params, deps }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound();
    // 7d @ hour granularity = 168; "all" pulls the max the API returns (500)
    const metricsLimit = deps.ccuRange === "all" ? 500 : 168;
    try {
      const [
        game,
        metrics,
        stats,
        lifecycle,
        sorts,
        events,
        monetization,
        demand,
        tags,
        notes,
        creator,
        movers,
        cohort,
        rhythm,
      ] = await Promise.all([
        api.game(id),
        api.metrics(id, "hour", metricsLimit),
        api.stats(id, 200),
        api.lifecycle(id),
        api.sorts(id),
        api.events(id),
        api.monetization(id),
        api.demand(id),
        api.gameTags(id),
        api.notes(id),
        api.creator(id),
        api.movers(id),
        api.cohort(id),
        api.rhythm(id),
      ]);
      return {
        game,
        metrics,
        stats,
        lifecycle,
        sorts,
        events,
        monetization,
        demand,
        tags,
        notes,
        creator,
        movers,
        cohort,
        rhythm,
        ccuRange: deps.ccuRange as CcuRange,
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw notFound();
      throw err;
    }
  },
  component: GameDetailPage,
  notFoundComponent: () => (
    <div className="rounded-lg border border-border-1 bg-surface-1/40 p-10 text-center">
      <p className="text-text-2">That game isn’t tracked.</p>
      <Link
        to="/"
        className="mt-2 inline-block text-sm text-indigo-400 hover:underline"
      >
        ← back to Pulse
      </Link>
    </div>
  ),
});

function GameDetailPage() {
  const {
    game,
    metrics,
    stats,
    lifecycle,
    sorts,
    events,
    monetization,
    demand,
    tags,
    notes,
    creator,
    movers,
    cohort,
    rhythm,
    ccuRange,
  } = Route.useLoaderData();
  const navigate = useNavigate({ from: "/games/$id" });
  const isAllTime = ccuRange === "all";

  const s = game.latestStats;
  const items = metrics.items;
  const latest = items.at(-1);
  const nowMs = latest ? Date.parse(latest.capturedAt) : Date.now();
  const firstSeenMs = Date.parse(game.firstSeenAt);
  const daysTracked = Math.max(
    0,
    Math.floor((Date.now() - firstSeenMs) / DAY_MS),
  );

  // 24h delta — find the metric closest to 24h before latest capture.
  const ago24hIdx = findClosestMetric(items, nowMs - 24 * HOUR_MS);
  const ccuNow = latest?.playing ?? 0;
  const ccu24hAgo = ago24hIdx >= 0 ? (items[ago24hIdx]?.playing ?? null) : null;
  const trendDelta = ccu24hAgo != null ? ccuNow - ccu24hAgo : null;
  const trendPct =
    ccu24hAgo != null && ccu24hAgo > 0 ? (ccuNow - ccu24hAgo) / ccu24hAgo : null;
  const deltaColor = deltaColorVar(trendPct);

  // velocity change: latest stat vs stat closest to 24h ago
  const sItems = stats.items;
  const latestVelocity = sItems.at(-1)?.velocity ?? null;
  const stat24hAgoIdx = findClosestStat(sItems, nowMs - 24 * HOUR_MS);
  const priorVelocity =
    stat24hAgoIdx >= 0 ? (sItems[stat24hAgoIdx]?.velocity ?? null) : null;
  const velocityChange24hPct =
    latestVelocity != null && priorVelocity != null && priorVelocity !== 0
      ? ((latestVelocity - priorVelocity) / Math.abs(priorVelocity)) * 100
      : null;
  const accWord = accelerationWord(velocityChange24hPct, trendPct);

  const pulseStage: LifecycleStage = s?.lifecycle
    ? STAGE_MAP[s.lifecycle]
    : "growing";
  const reason = DEFAULT_TRANSITION_REASON[pulseStage];
  const lifeColor = LIFECYCLE[pulseStage].color;

  const trackedPhrase = fmtTrackedPhrase(daysTracked, items.length);
  const windowHours = isAllTime
    ? Math.max(24, Math.floor((nowMs - firstSeenMs) / HOUR_MS))
    : 168;

  // Engagement derives — computed client-side over the 24h tail of metrics.
  // Trend-pulse computes these server-side into an EngagementSnapshot; we
  // approximate off the raw metric window until a server derive lands.
  const glance = deriveGlance(items, nowMs);
  const sentiment = deriveSentiment(latest);

  // Verdict + call-line — synthesize a transition timeline from the API's
  // lifecycle events (which are event-typed, not stage-typed), then run the
  // shape-matching heuristics against the CCU history + tracking depth.
  const transitions = deriveTransitions(lifecycle);
  const historyValues = items.map((m) => m.playing ?? 0);
  const trackedHours = Math.floor((Date.now() - firstSeenMs) / HOUR_MS);
  const verdict = buildVerdict({
    history: historyValues,
    transitions,
    daysTracked,
    trackedHours,
    lifecycle: pulseStage,
  });
  const callLine = buildCallLine({
    lifecycle: pulseStage,
    cohortPct: cohort?.velocityPctInCohort ?? null,
    history: historyValues,
    daysTracked,
  });

  return (
    <div className="-mx-6 flex flex-col text-text-2 lg:-mx-10">
      <div className="px-6 pt-2 pb-4 lg:px-10">
        <Link
          to="/"
          className="text-xs uppercase tracking-[0.14em] text-text-4 hover:text-text-2"
        >
          ← Pulse
        </Link>
      </div>

      {/* ─── hero ─────────────────────────────────────────────────────── */}
      <section
        className="border-b border-border-1 px-6 pb-8 lg:px-10"
        style={{ borderColor: "var(--border-1)" }}
      >
        <div className="flex flex-wrap items-start gap-6">
          <Thumb name={game.name} src={game.iconUrl} size={96} radius={20} />
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <LifecycleBadge
                stage={pulseStage}
                reason={reason}
                trackingDays={daysTracked}
                reasonSize={14}
              />
              <SortRank sort={game.currentSort} rank={game.currentSortRank} />
            </div>
            <h1
              className="text-3xl font-semibold leading-tight text-text-1"
              style={{ letterSpacing: "-0.02em" }}
            >
              {game.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-sm text-text-3">
              <span>
                {game.creator?.name ??
                  game.creator?.creatorId ??
                  "Unknown studio"}
              </span>
              {game.creator?.hasVerifiedBadge ? (
                <span
                  title="Verified by Roblox"
                  className="inline-flex translate-y-[2px] items-center"
                >
                  <VerifiedBadge />
                </span>
              ) : null}
              {game.robloxGenre ? (
                <span className="text-text-4">· {game.robloxGenre}</span>
              ) : null}
              {game.maxPlayers ? (
                <span className="text-text-4">
                  · {game.maxPlayers}p servers
                </span>
              ) : null}
            </div>
            <div className="mt-2 text-xs text-text-4">{trackedPhrase}</div>
            {callLine ? (
              <div
                className="mt-3 max-w-2xl italic text-text-2"
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: 17,
                  lineHeight: 1.4,
                }}
              >
                {callLine}
              </div>
            ) : null}
            {game.description ? (
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-3">
                {game.description}
              </p>
            ) : null}
          </div>
          <div className="flex min-w-[200px] flex-col items-end">
            <div className="text-[10px] uppercase tracking-[0.14em] text-text-4">
              Concurrent now
            </div>
            <div
              className="mt-1 tabular-nums text-text-1"
              style={{
                fontSize: 48,
                lineHeight: 1,
                fontWeight: 600,
                letterSpacing: "-0.03em",
              }}
            >
              {fmtCCU(ccuNow)}
            </div>
            {trendPct != null && trendDelta != null ? (
              <div className="mt-2 flex items-baseline gap-2 text-xs">
                <span
                  className="font-semibold tabular-nums"
                  style={{ color: deltaColor }}
                >
                  {fmtTrendPct(trendPct)}
                </span>
                <span className="text-text-4 tabular-nums">
                  {fmtVelocity(trendDelta)} vs 24h ago
                </span>
              </div>
            ) : (
              <div className="mt-2 text-xs text-text-5">
                not enough history yet
              </div>
            )}
            {accWord ? (
              <div className="mt-1 text-xs italic text-text-4">
                <span style={{ fontFamily: "var(--font-serif)" }}>
                  {accWord}
                </span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {verdict ? (
        <section
          className="border-b border-border-1 px-6 py-4 lg:px-10"
          style={{
            background:
              "linear-gradient(180deg, var(--surface-hover) 0%, transparent 100%)",
          }}
        >
          <div className="flex items-baseline gap-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
              Verdict
            </span>
            <span
              className="text-sm italic text-text-1"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {verdict.text}
            </span>
            <span className="text-[10px] uppercase tracking-wide text-text-5">
              · {verdict.shape}
            </span>
          </div>
        </section>
      ) : null}

      {/* ─── chart section ─────────────────────────────────────────────── */}
      {items.length > 1 ? (
        <section className="border-b border-border-1 px-6 py-6 lg:px-10">
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-3.5">
              <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-text-4">
                Concurrent players
              </span>
              <span className="text-xs text-text-5">
                hourly snapshots · last {windowHours}h
              </span>
            </div>
            <div className="flex items-center gap-1">
              <RangeTab active={false} disabled label="24H" />
              <RangeTab
                active={!isAllTime}
                label="7D"
                onClick={() =>
                  isAllTime ? navigate({ search: {} }) : undefined
                }
              />
              <RangeTab
                active={isAllTime}
                label="All"
                onClick={() =>
                  isAllTime ? undefined : navigate({ search: { ccuRange: "all" } })
                }
              />
            </div>
          </div>
          <ConvergenceChart
            points={items}
            flags={buildEventFlags(lifecycle, sorts)}
            lineColor={lifeColor}
            windowHours={windowHours}
          />
        </section>
      ) : null}

      {/* ─── at a glance ─────────────────────────────────────────────── */}
      <section className="border-b border-border-1 px-6 py-6 lg:px-10">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <div className="flex items-baseline gap-3.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
              At a glance
            </span>
            <span className="text-xs text-text-5">Last 24h</span>
          </div>
          {sentiment ? (
            <div
              className="text-xs tabular-nums"
              style={{ color: sentiment.color }}
            >
              {sentiment.text}
            </div>
          ) : null}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Tile
            label="Peak · 24h"
            value={
              glance.peakCcu != null ? fmtCCUCompact(glance.peakCcu) : "—"
            }
            valueSuffix={glance.peakCcu != null ? "CCU" : undefined}
            meta={
              glance.peakAt != null
                ? relTime(new Date(glance.peakAt).toISOString())
                : "not enough history"
            }
          />
          <Tile
            label="Volatility · 24h"
            value={
              glance.volatilityPct != null
                ? `±${Math.round(glance.volatilityPct * 100)}%`
                : "—"
            }
            meta="MAD / mean"
          />
          <Tile
            label="Lifetime visits"
            value={
              latest?.visits != null ? fmtVisitsHuman(latest.visits) : "—"
            }
          />
          <Tile label="Trend" value={s?.trendScore?.toFixed(1) ?? "—"} />
          <Tile label="Spike z" value={s?.spikeScore?.toFixed(2) ?? "—"} />
          <Tile label="Genre pct" value={fmtPct(s?.genrePercentile)} />
        </div>
      </section>

      {cohort ? (
        <CohortRow cohort={cohort} genre={game.robloxGenre} />
      ) : null}

      {rhythm ? <AudienceRhythmSection rhythm={rhythm} /> : null}

      {creator && creator.games.length > 0 ? (
        <CreatorContext data={creator} />
      ) : null}

      {movers.length > 0 ? <WhatElseMoving games={movers} /> : null}

      {/* ─── body grid ─────────────────────────────────────────────────── */}
      <div className="grid gap-8 px-6 py-8 lg:grid-cols-2 lg:px-10">
        <Section title="Signals" estimateAt={s?.computedAt ?? null}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Tile
              label="Velocity"
              value={fmtSigned(s?.velocity)}
              meta="ccu/hr"
            />
            <Tile label="Like ratio" value={fmtPct(s?.likeRatio, 1)} />
            <Tile
              label="Fav/visit"
              value={fmtPct(s?.favoritesPerVisit, 2)}
            />
            <Tile
              label="Updates 28d"
              value={
                s?.updatesPer28d != null ? String(s.updatesPer28d) : "—"
              }
              meta={
                s?.daysSinceUpdate != null
                  ? `last ${s.daysSinceUpdate}d ago`
                  : undefined
              }
            />
            <Tile
              label="7d slope"
              value={fmtSigned(s?.ccuSlope7d)}
              meta="ccu/day"
            />
            <Tile
              label="28d slope"
              value={fmtSigned(s?.ccuSlope28d)}
              meta="ccu/day"
            />
          </div>
        </Section>

        <Section title="Discovery sort rank">
          {sorts.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {sorts
                .slice(-8)
                .reverse()
                .map((snap) => (
                  <li
                    key={`${snap.sortName}-${snap.capturedAt}`}
                    className="flex items-center justify-between"
                  >
                    <span className="capitalize text-text-2">
                      {snap.sortName.replace(/-/g, " ")}
                    </span>
                    <span className="tabular-nums text-text-3">
                      #{snap.rank}
                    </span>
                    <span className="text-xs text-text-5">
                      {relTime(snap.capturedAt)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>Not in any discovery sort.</Empty>
          )}
        </Section>

        <Section title="Lifecycle history">
          {lifecycle.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {lifecycle.slice(0, 12).map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-3 border-b border-border-1/50 pb-2 last:border-b-0 last:pb-0"
                >
                  <span className="mt-0.5 rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-text-3">
                    {e.type.replace(/_/g, " ")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div
                      className="text-sm italic text-text-2"
                      style={{ fontFamily: "var(--font-serif)" }}
                    >
                      {EVENT_REASON[e.type] ?? "Transition"}
                    </div>
                    <div className="text-[11px] text-text-5">
                      {relTime(e.detectedAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No detected transitions.</Empty>
          )}
        </Section>

        <Section title="Tags">
          {tags.length ? (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span
                  key={t.id}
                  className="rounded-md bg-white/[0.04] px-2 py-0.5 text-xs text-text-2"
                  title={t.description ?? undefined}
                >
                  <span className="text-text-4">{t.axis}:</span> {t.label}
                </span>
              ))}
            </div>
          ) : (
            <Empty>Untagged.</Empty>
          )}
        </Section>

        <Section title="Monetization">
          {monetization.passes.length || monetization.products.length ? (
            <div className="flex flex-col gap-3 text-sm">
              {monetization.passes.length ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-4">
                    Game passes
                  </div>
                  <ul className="flex flex-col gap-1">
                    {monetization.passes.map((p) => (
                      <li key={p.passId} className="flex justify-between">
                        <span className="text-text-2">
                          {p.name ?? `#${p.passId}`}
                        </span>
                        <span className="tabular-nums text-text-3">
                          R$ {fmtFull(p.priceRobux)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {monetization.products.length ? (
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-text-4">
                    Dev products
                  </div>
                  <ul className="flex flex-col gap-1">
                    {monetization.products.map((p) => (
                      <li key={p.productId} className="flex justify-between">
                        <span className="text-text-2">
                          {p.name ?? `#${p.productId}`}
                        </span>
                        <span className="tabular-nums text-text-3">
                          R$ {fmtFull(p.priceRobux)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <Empty>No monetization data.</Empty>
          )}
        </Section>

        <Section title="Off-platform demand">
          {demand.terms.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {demand.terms.map((term) => {
                const last = term.snapshots.at(-1);
                return (
                  <li
                    key={`${term.term}-${term.kind}`}
                    className="flex items-center justify-between"
                  >
                    <span className="text-text-2">
                      {term.term}
                      <span className="ml-1 text-xs text-text-5">
                        ({term.kind})
                      </span>
                      {term.heating ? (
                        <span
                          className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-400"
                          title="External interest rising while on-platform CCU is flat or falling — estimate, not yet reflected on-platform"
                        >
                          heating
                        </span>
                      ) : null}
                    </span>
                    <span className="tabular-nums text-text-3">
                      trends {last?.trendsScore ?? "—"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No demand terms mapped.</Empty>
          )}
        </Section>
      </div>

      <UpdateCadence events={events} lifecycle={lifecycle} />


      <section className="border-t border-border-1 px-6 py-8 lg:px-10">
        <SectionHead title="Game notes" />
        <GameNotes universeId={game.universeId} initial={notes} />
      </section>

      <p className="border-t border-border-1 px-6 py-6 text-xs text-text-disabled lg:px-10">
        {fmtFull(metrics.total)} raw snapshots · {fmtFull(stats.total)} derived
        stat rows. All numbers are estimates from public Roblox data.
      </p>
    </div>
  );
}

function findClosest<T>(
  items: T[],
  targetMs: number,
  getTime: (item: T) => number,
): number {
  let bestIdx = -1;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item === undefined) continue;
    const dist = Math.abs(getTime(item) - targetMs);
    if (dist < bestDist) {
      bestDist = dist;
      bestIdx = i;
    }
  }
  return bestIdx;
}

const findClosestMetric = (items: GameMetric[], t: number) =>
  findClosest(items, t, (m) => Date.parse(m.capturedAt));
const findClosestStat = (items: { computedAt: string }[], t: number) =>
  findClosest(items, t, (m) => Date.parse(m.computedAt));

function fmtTrackedPhrase(days: number, snapshots: number): string {
  if (days < 1) return `Tracked · ${snapshots} snapshot${snapshots === 1 ? "" : "s"}`;
  if (days < 7) return `Tracked ${days} day${days === 1 ? "" : "s"}`;
  if (days < 30) return `Tracked ${Math.floor(days / 7)}w`;
  if (days < 365) return `Tracked ${Math.floor(days / 30)}mo`;
  return `Tracked ${(days / 365).toFixed(1)}y`;
}

function fmtSigned(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v === 0) return "0";
  const sign = v > 0 ? "+" : "−";
  return sign + Math.abs(Math.round(v));
}

function RangeTab({
  active,
  label,
  onClick,
  disabled,
}: {
  active: boolean;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? "Coming later" : undefined}
      className="rounded-md px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide transition"
      style={{
        color: disabled
          ? "var(--text-disabled)"
          : active
            ? "var(--text-1)"
            : "var(--text-4)",
        background: active ? "var(--surface-hover)" : "transparent",
        cursor: disabled ? "not-allowed" : active ? "default" : "pointer",
      }}
    >
      {label}
    </button>
  );
}

function SectionHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="mb-3 flex items-baseline gap-3.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
        {title}
      </span>
      {meta ? <span className="text-xs text-text-5">{meta}</span> : null}
    </div>
  );
}

function Section({
  title,
  children,
  estimateAt,
}: {
  title: string;
  children: ReactNode;
  estimateAt?: string | null;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          {title}
        </span>
        {estimateAt !== undefined ? <Estimate at={estimateAt} /> : null}
        <div className="h-px flex-1 bg-border-1" />
      </div>
      {children}
    </section>
  );
}

function Tile({
  label,
  value,
  valueSuffix,
  meta,
}: {
  label: string;
  value: ReactNode;
  valueSuffix?: string;
  meta?: string;
}) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border-1 bg-surface-1/40 p-3"
      style={{ borderColor: "var(--border-1)" }}
    >
      <span className="text-[10px] uppercase tracking-[0.14em] text-text-4">
        {label}
      </span>
      <span
        className="tabular-nums text-text-1"
        style={{
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1.1,
        }}
      >
        {value}
        {valueSuffix ? (
          <span
            className="ml-1.5 text-[11px] font-normal text-text-4"
            style={{ letterSpacing: 0 }}
          >
            {valueSuffix}
          </span>
        ) : null}
      </span>
      {meta ? (
        <span className="text-[11px] text-text-4">{meta}</span>
      ) : null}
    </div>
  );
}

type GlanceDerive = {
  peakCcu: number | null;
  peakAt: number | null;
  volatilityPct: number | null;
};

function deriveGlance(items: GameMetric[], nowMs: number): GlanceDerive {
  const cutoff = nowMs - 24 * HOUR_MS;
  const window: GameMetric[] = [];
  for (const m of items) {
    if (Date.parse(m.capturedAt) >= cutoff) window.push(m);
  }
  if (window.length === 0) {
    return { peakCcu: null, peakAt: null, volatilityPct: null };
  }
  let peakCcu = 0;
  let peakAt = 0;
  let sum = 0;
  let n = 0;
  for (const m of window) {
    const v = m.playing ?? 0;
    sum += v;
    n++;
    if (v > peakCcu) {
      peakCcu = v;
      peakAt = Date.parse(m.capturedAt);
    }
  }
  const mean = n > 0 ? sum / n : 0;
  let mad = 0;
  if (mean > 0) {
    for (const m of window) mad += Math.abs((m.playing ?? 0) - mean);
    mad /= n;
  }
  const volatilityPct = mean > 0 ? mad / mean : null;
  return {
    peakCcu: peakCcu > 0 ? peakCcu : null,
    peakAt: peakAt > 0 ? peakAt : null,
    volatilityPct,
  };
}

function deriveSentiment(
  latest: GameMetric | undefined,
): { text: string; color: string } | null {
  if (!latest) return null;
  const up = latest.upVotes ?? 0;
  const down = latest.downVotes ?? 0;
  const total = up + down;
  if (total < 100) return null;
  const positive = up / total;
  const pct = Math.round(positive * 100);
  const color =
    positive >= 0.9
      ? "var(--lifecycle-growing)"
      : positive < 0.7
        ? "var(--lifecycle-declining)"
        : "var(--text-2)";
  return { text: `${pct}% liked · ${fmtVotes(total)} votes`, color };
}

// Maps the API's LifecycleEventType (event-typed) to the 4-stage transition
// stream the verdict/call-line heuristics want. The mapping is best-effort:
// each event kind slots into the stage it MOVES the game into.
const EVENT_TO_STAGE: Partial<
  Record<LifecycleEventType, LifecycleStage>
> = {
  launch: "new",
  spike: "peaking",
  cooldown: "peaking",
  decline: "declining",
  revival: "growing",
  death: "declining",
};

function deriveTransitions(
  events: readonly { type: LifecycleEventType; detectedAt: string }[],
): LifecycleTransition[] {
  const out: LifecycleTransition[] = [];
  for (const e of events) {
    const stage = EVENT_TO_STAGE[e.type];
    if (!stage) continue;
    out.push({
      kind: "lifecycle_transition",
      stage,
      occurredAt: Date.parse(e.detectedAt),
    });
  }
  // Newest first — verdict heuristics read transitions[0] as most recent.
  out.sort((a, b) => b.occurredAt - a.occurredAt);
  return out;
}

function fmtVisitsHuman(n: number): string {
  if (n >= 1_000_000_000)
    return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000)
    return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}
const fmtVotes = fmtVisitsHuman;

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-text-5">{children}</div>;
}

function CohortRow({
  cohort,
  genre,
}: {
  cohort: CohortSummary;
  genre: string | null;
}) {
  const pct = cohort.velocityPctInCohort;
  if (pct == null) return null;
  const basisLabel =
    cohort.cohortBasis === "genre"
      ? genre
        ? `${genre} peers`
        : "genre peers"
      : "global peers";
  return (
    <section
      className="border-b border-border-1 px-6 py-4 lg:px-10"
      style={{ borderColor: "var(--border-1)" }}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          Cohort
        </span>
        <span className="text-sm text-text-2">
          <span className="tabular-nums font-semibold text-text-1">
            {Math.round(pct)}
          </span>
          <span className="ml-1 text-text-4">
            th pct velocity · {cohort.cohortSize} {basisLabel}
          </span>
        </span>
      </div>
    </section>
  );
}

function CreatorContext({ data }: { data: CreatorPortfolio }) {
  const name = data.creator?.name ?? "Creator";
  return (
    <section className="border-b border-border-1 px-6 py-6 lg:px-10">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          More from {name}
        </span>
        {data.creator?.hasVerifiedBadge ? (
          <span className="inline-flex items-center">
            <VerifiedBadge />
          </span>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {data.games.map((g) => (
          <PortfolioTile key={g.universeId} game={g} />
        ))}
      </ul>
    </section>
  );
}

function PortfolioTile({ game }: { game: PortfolioGame }) {
  const body = (
    <div className="flex items-center gap-3">
      <Thumb name={game.name ?? "·"} src={game.iconUrl} size={44} radius={10} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-text-2">
          {game.name ?? `#${game.universeId}`}
        </div>
        <div className="text-[11px] text-text-4 tabular-nums">
          {game.latestCcu != null
            ? `${fmtCCUCompact(game.latestCcu)} CCU`
            : game.visits != null
              ? `${fmtVisitsHuman(game.visits)} visits`
              : "not tracked"}
          {game.pulseStage ? (
            <span
              className="ml-1.5 rounded px-1 py-px text-[9px] uppercase tracking-wide"
              style={{
                background: "var(--surface-hover)",
                color: `var(--lifecycle-${game.pulseStage})`,
              }}
            >
              {game.pulseStage}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
  const cls =
    "rounded-lg border border-border-1 bg-surface-1/40 p-3 transition hover:bg-surface-hover";
  if (game.isTracked) {
    return (
      <li>
        <Link
          to="/games/$id"
          params={{ id: String(game.universeId) }}
          className={cls}
        >
          {body}
        </Link>
      </li>
    );
  }
  return <li className={cls}>{body}</li>;
}

function WhatElseMoving({ games }: { games: MoverCard[] }) {
  return (
    <section className="border-b border-border-1 px-6 py-6 lg:px-10">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          What else is moving
        </span>
        <span className="text-xs text-text-5">Same genre · pulse-ranked</span>
      </div>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {games.map((g) => (
          <li key={g.universeId}>
            <Link
              to="/games/$id"
              params={{ id: String(g.universeId) }}
              className="flex flex-col gap-1.5 rounded-lg border border-border-1 bg-surface-1/40 p-2.5 transition hover:bg-surface-hover"
            >
              <div className="flex items-center gap-2">
                <Thumb
                  name={g.name}
                  src={g.iconUrl}
                  size={32}
                  radius={8}
                />
                <div className="min-w-0 flex-1 truncate text-[13px] text-text-2">
                  {g.name}
                </div>
              </div>
              <MoverSpark spark={g.spark} stage={g.pulseStage} />
              <div className="flex items-baseline justify-between text-[11px] tabular-nums">
                <span className="text-text-3">
                  {fmtCCUCompact(g.latestCcu)}
                </span>
                {g.delta24hPct != null ? (
                  <span
                    className="font-semibold"
                    style={{ color: deltaColorVar(g.delta24hPct / 100) }}
                  >
                    {g.delta24hPct > 0 ? "+" : ""}
                    {Math.round(g.delta24hPct)}%
                  </span>
                ) : null}
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

const DOW_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function AudienceRhythmSection({ rhythm }: { rhythm: AudienceRhythm }) {
  const cells = rhythm.cells;
  let max = 0;
  for (const v of cells) if (v > max) max = v;
  if (max <= 0) return null;
  const peakLabel = `${DOW_LABELS[rhythm.peak.dow] ?? "?"} ${String(
    rhythm.peak.hour,
  ).padStart(2, "0")}:00 UTC`;
  return (
    <section className="border-b border-border-1 px-6 py-6 lg:px-10">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          Audience rhythm
        </span>
        <span className="text-xs text-text-5">
          {rhythm.windowDays}d avg · peak {peakLabel} · {fmtCCUCompact(rhythm.peak.ccu)}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex text-[9px] uppercase tracking-wide text-text-5">
          <div className="w-10" />
          {Array.from({ length: 24 }).map((_, h) => (
            <div key={h} className="flex-1 text-center">
              {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
            </div>
          ))}
        </div>
        {DOW_LABELS.map((day, dow) => (
          <div key={day} className="flex items-center gap-1">
            <div className="w-10 text-[10px] uppercase tracking-wide text-text-4">
              {day}
            </div>
            {Array.from({ length: 24 }).map((_, hour) => {
              const v = cells[dow * 24 + hour] ?? 0;
              const intensity = v > 0 ? v / max : 0;
              return (
                <div
                  key={hour}
                  className="flex-1"
                  title={`${day} ${String(hour).padStart(2, "0")}:00 · ${fmtCCUCompact(v)} avg`}
                  style={{
                    height: 20,
                    borderRadius: 3,
                    background:
                      intensity > 0
                        ? `color-mix(in oklab, var(--lifecycle-growing) ${Math.round(
                            intensity * 100,
                          )}%, var(--surface-1))`
                        : "var(--surface-1)",
                    opacity: intensity > 0 ? 0.5 + intensity * 0.5 : 0.4,
                  }}
                />
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}

function UpdateCadence({
  events,
  lifecycle,
}: {
  events: GameEvent[];
  lifecycle: LifecycleEvent[];
}) {
  const upcoming = events
    .filter((e) => e.startUtc && Date.parse(e.startUtc) > Date.now())
    .sort((a, b) => Date.parse(a.startUtc ?? "") - Date.parse(b.startUtc ?? ""));
  const updates = lifecycle
    .filter((e) => e.type === "update_shipped")
    .sort((a, b) => Date.parse(b.detectedAt) - Date.parse(a.detectedAt));

  // Mean days between the ~last 8 shipped updates, if we have at least two.
  let cadenceLine: string | null = null;
  if (updates.length >= 2) {
    const recent = updates.slice(0, 8);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < recent.length - 1; i++) {
      const a = Date.parse(recent[i]?.detectedAt ?? "");
      const b = Date.parse(recent[i + 1]?.detectedAt ?? "");
      if (a && b && a > b) {
        sum += a - b;
        n++;
      }
    }
    if (n > 0) {
      const meanDays = sum / n / DAY_MS;
      cadenceLine = `Updates every ${meanDays.toFixed(1)}d avg`;
    }
  }
  if (upcoming.length === 0 && updates.length === 0) return null;
  return (
    <section className="border-b border-border-1 px-6 py-6 lg:px-10">
      <div className="mb-3 flex items-baseline gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-4">
          Update cadence
        </span>
        {cadenceLine ? (
          <span className="text-xs text-text-5">{cadenceLine}</span>
        ) : null}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-text-4">
            Upcoming
          </div>
          {upcoming.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {upcoming.slice(0, 4).map((e) => {
                const start = e.startUtc ? Date.parse(e.startUtc) : 0;
                const diff = start - Date.now();
                const days = Math.floor(diff / DAY_MS);
                const hours = Math.floor((diff % DAY_MS) / HOUR_MS);
                const when =
                  days > 0
                    ? `${days}d ${hours}h`
                    : hours > 0
                      ? `${hours}h`
                      : "soon";
                return (
                  <li
                    key={e.eventId}
                    className="rounded-lg border border-border-1 bg-surface-1/40 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="font-medium text-text-2">
                        {e.title ?? "Event"}
                      </div>
                      <div className="text-[11px] text-text-4 tabular-nums">
                        in {when}
                      </div>
                    </div>
                    {e.subtitle ? (
                      <div className="text-xs text-text-4">{e.subtitle}</div>
                    ) : null}
                    {e.tagline ? (
                      <div className="mt-1 text-xs text-text-3">
                        {e.tagline}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty>No scheduled events.</Empty>
          )}
        </div>
        <div>
          <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-text-4">
            Recent updates
          </div>
          {updates.length ? (
            <ul className="flex flex-col gap-1 text-sm">
              {updates.slice(0, 8).map((u) => (
                <li
                  key={u.id}
                  className="flex items-baseline justify-between text-text-3"
                >
                  <span className="text-text-2">Update shipped</span>
                  <span className="text-[11px] text-text-5">
                    {relTime(u.detectedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No recorded updates.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function MoverSpark({
  spark,
  stage,
}: {
  spark: number[] | null;
  stage: string | null;
}) {
  if (!spark || spark.length < 2) {
    return <div className="h-6" />;
  }
  const w = 100;
  const h = 24;
  const min = Math.min(...spark);
  const max = Math.max(...spark);
  const span = max - min || 1;
  const step = w / (spark.length - 1);
  const line = spark
    .map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`)
    .join(" ");
  const color =
    stage === "declining"
      ? "var(--lifecycle-declining)"
      : stage === "peaking"
        ? "var(--lifecycle-peaking)"
        : stage === "new"
          ? "var(--lifecycle-new)"
          : "var(--lifecycle-growing)";
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      className="h-6 w-full"
      preserveAspectRatio="none"
      role="img"
    >
      <title>Recent CCU trend</title>
      <polyline
        points={line}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

