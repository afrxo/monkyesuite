// /discover — the intel dashboard (specs/10-intel.md). Deliberately text-first:
// ranked rows, the headline sentence IS the product, no decorative charts.
// Every number here is an estimate synthesized from proxies and is labeled so.

import type {
  MovementInsight,
  TrendConfidenceInsight,
  WatchInsight,
} from "@monkyesuite/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import { fmtRelative } from "../lib/format";

export const Route = createFileRoute("/discover")({
  component: DiscoverRoute,
});

function DiscoverRoute() {
  const q = useQuery({
    queryKey: ["intel"],
    queryFn: () => api.intel(),
    staleTime: 60_000,
  });

  if (q.isPending) {
    return (
      <p className="py-16 text-center text-sm text-text-4">Loading intel…</p>
    );
  }
  if (q.isError) {
    return (
      <p className="py-16 text-center text-sm text-text-4">
        Intel unavailable right now — the API answered with an error. Retry in a
        minute.
      </p>
    );
  }

  const intel = q.data;
  const empty =
    intel.trendConfidence.length === 0 &&
    intel.movements.length === 0 &&
    intel.watchlist.length === 0;

  return (
    <div className="flex flex-col gap-10 pb-24">
      <header className="flex flex-col gap-1 pt-2">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-lg font-semibold tracking-tight text-text-1">
            Discover
          </h1>
          {intel.computedAt && (
            <span className="text-xs text-text-4">
              computed{" "}
              {fmtRelative(new Date(intel.computedAt).getTime(), Date.now())}
            </span>
          )}
        </div>
        <p className="text-sm text-text-4">
          Ranked reads on where the platform is moving. All scores are estimates
          derived from proxy signals (CCU, votes, sort ranks) — treat them as
          direction, not fact.
        </p>
      </header>

      {(empty || intel.computedAt === null) && (
        <div className="rounded-md border border-border-1 bg-surface-1 px-4 py-3 text-sm text-text-3">
          {intel.computedAt === null
            ? "No intel run has landed yet — the batch service runs every 30 minutes. First insights appear after the next run."
            : "The latest run produced no insights — usually thin scrape history. Sections fill in as data accumulates."}
        </div>
      )}

      <Section
        title="Trend signal"
        sub="Tag directions with multiple rising carriers, scored against every other tag. Confirmation rule applies: one spiking game never makes a trend."
      >
        {intel.trendConfidence.length === 0 ? (
          <EmptyRow label="No confirmed directions yet." />
        ) : (
          intel.trendConfidence.map((t) => <TrendRow key={t.subjectKey} item={t} />)
        )}
      </Section>

      <Section
        title="Movers, explained"
        sub="The biggest 24h moves, attributed to what co-occurred — an update, a live event, a discovery placement. “Unexplained” means exactly that."
      >
        {intel.movements.length === 0 ? (
          <EmptyRow label="No notable movements in the latest run." />
        ) : (
          intel.movements.map((m) => <MovementRow key={m.subjectKey} item={m} />)
        )}
      </Section>

      <Section
        title="Watchlist"
        sub="Early-stage games with cohort-relative acceleration — ranked for lead time, so small-but-fast beats big-but-drifting."
      >
        {intel.watchlist.length === 0 ? (
          <EmptyRow label="No early-stage candidates in the latest run." />
        ) : (
          intel.watchlist.map((w) => <WatchRow key={w.subjectKey} item={w} />)
        )}
      </Section>
    </div>
  );
}

/* ------------------------------ scaffolding ------------------------------- */

function Section({
  title,
  sub,
  children,
}: {
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-sm font-semibold text-text-1">{title}</h2>
        <p className="text-xs text-text-4">{sub}</p>
      </div>
      <div className="divide-y divide-border-1 rounded-md border border-border-1">
        {children}
      </div>
    </section>
  );
}

function EmptyRow({ label }: { label: string }) {
  return <p className="px-4 py-6 text-center text-xs text-text-4">{label}</p>;
}

function Rank({ n }: { n: number }) {
  return (
    <span className="w-6 shrink-0 pt-0.5 text-right text-xs tabular-nums text-text-4">
      {n}
    </span>
  );
}

function ScorePct({ value, label }: { value: number; label: string }) {
  return (
    <span
      className="shrink-0 text-xs tabular-nums text-text-3"
      title={`${label} — estimate, 0–100`}
    >
      {Math.round(value * 100)}
      <span className="text-text-4">%</span>
    </span>
  );
}

function GameIcon({ url, name }: { url: string | null; name: string }) {
  return url ? (
    <img
      src={url}
      alt=""
      title={name}
      className="h-8 w-8 shrink-0 rounded bg-surface-1 object-cover"
      loading="lazy"
    />
  ) : (
    <div className="h-8 w-8 shrink-0 rounded bg-surface-1" />
  );
}

/* --------------------------------- rows ----------------------------------- */

function TrendRow({ item }: { item: TrendConfidenceInsight }) {
  const e = item.evidence;
  const [axis] = item.subjectKey.split(":");
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Rank n={item.rank} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-text-1">{item.headline}</p>
        <p className="text-xs text-text-4">
          <span className="uppercase tracking-wide">{axis}</span>
          {" · "}
          {e.risingCarriers}/{e.carriers} carriers rising · avg velocity{" "}
          {e.avgVelocity >= 0 ? "+" : ""}
          {e.avgVelocity.toFixed(2)} · spike {e.avgSpike.toFixed(2)}
        </p>
      </div>
      <ScorePct value={item.score} label="trend confidence" />
    </div>
  );
}

function MovementRow({ item }: { item: MovementInsight }) {
  const e = item.evidence;
  const delta = e.deltaPct;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Rank n={item.rank} />
      <GameIcon url={e.iconUrl} name={e.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-text-1">
          <span className="font-medium">{e.name}</span>
          {delta !== null && (
            <span
              className={
                delta >= 0 ? "text-lifecycle-growing" : "text-lifecycle-declining"
              }
            >
              {" "}
              {delta >= 0 ? "+" : ""}
              {Math.round(delta * 100)}% / 24h
            </span>
          )}
          <span className="text-text-4"> · {e.latestCcu.toLocaleString()} CCU</span>
        </p>
        <p className="text-xs text-text-3">
          {e.factors.map((f) => f.detail).join(" · ")}
        </p>
      </div>
    </div>
  );
}

function WatchRow({ item }: { item: WatchInsight }) {
  const e = item.evidence;
  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <Rank n={item.rank} />
      <GameIcon url={e.iconUrl} name={e.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-sm text-text-1">
          <span className="font-medium">{e.name}</span>
          <span className="text-text-4">
            {" "}
            · {e.lifecycle ?? "—"} · {e.latestCcu.toLocaleString()} CCU
          </span>
        </p>
        <p className="text-xs text-text-3">{e.reasons.join(" · ")}</p>
      </div>
      <ScorePct value={item.score} label="watch score" />
    </div>
  );
}
