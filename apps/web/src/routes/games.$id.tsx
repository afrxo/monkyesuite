import type { GameMetric } from "@monkyesuite/shared";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { GameNotes } from "../components/GameNotes";
import { Estimate, LifecycleBadge, SortRank, Stat } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { fmtCompact, fmtFull, fmtPct, fmtSigned, relTime } from "../lib/format";

export const Route = createFileRoute("/games/$id")({
  loader: async ({ params }) => {
    const id = Number(params.id);
    if (!Number.isInteger(id) || id <= 0) throw notFound();
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
      ] = await Promise.all([
        api.game(id),
        api.metrics(id, "hour", 500),
        api.stats(id, 200),
        api.lifecycle(id),
        api.sorts(id),
        api.events(id),
        api.monetization(id),
        api.demand(id),
        api.gameTags(id),
        api.notes(id),
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
      };
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) throw notFound();
      throw err;
    }
  },
  component: GameDetailPage,
  notFoundComponent: () => (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-10 text-center">
      <p className="text-neutral-300">That game isn’t tracked.</p>
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
  } = Route.useLoaderData();
  const s = game.latestStats;
  const latest = metrics.items.at(-1);

  return (
    <div className="flex flex-col gap-8">
      <Link to="/" className="text-sm text-neutral-500 hover:text-neutral-300">
        ← Pulse
      </Link>

      {/* header */}
      <div className="flex flex-wrap items-start gap-4">
        {game.iconUrl ? (
          <img
            src={game.iconUrl}
            alt=""
            className="h-20 w-20 rounded-2xl bg-neutral-800 object-cover"
          />
        ) : (
          <div className="h-20 w-20 rounded-2xl bg-neutral-800" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold text-neutral-100">{game.name}</h1>
            <LifecycleBadge stage={s?.lifecycle ?? null} />
            <SortRank sort={game.currentSort} rank={game.currentSortRank} />
          </div>
          <p className="mt-1 text-sm text-neutral-500">
            {game.creator?.name ?? game.creator?.creatorId ?? "unknown creator"}
            {game.robloxGenre ? ` · ${game.robloxGenre}` : ""}
            {game.maxPlayers ? ` · ${game.maxPlayers}p servers` : ""}
          </p>
          {game.description ? (
            <p className="mt-2 max-w-2xl text-sm text-neutral-400">
              {game.description}
            </p>
          ) : null}
        </div>
      </div>

      {/* key signals */}
      <Section title="Signals" estimateAt={s?.computedAt ?? null}>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="CCU"
            value={fmtCompact(latest?.playing)}
            hint={relTime(latest?.capturedAt)}
          />
          <Stat label="Trend" value={s?.trendScore?.toFixed(1) ?? "—"} />
          <Stat label="Velocity" value={fmtSigned(s?.velocity)} hint="ccu/hr" />
          <Stat label="Spike z" value={s?.spikeScore?.toFixed(2) ?? "—"} />
          <Stat label="Like ratio" value={fmtPct(s?.likeRatio, 1)} />
          <Stat label="Genre pct" value={fmtPct(s?.genrePercentile)} />
        </div>
      </Section>

      {/* CCU history */}
      <Section title="CCU history" estimateAt={latest?.capturedAt ?? null}>
        {metrics.items.length > 1 ? (
          <Sparkline points={metrics.items} />
        ) : (
          <Empty>Not enough history yet.</Empty>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* sort-rank timeline */}
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
                    <span className="capitalize text-neutral-300">
                      {snap.sortName.replace(/-/g, " ")}
                    </span>
                    <span className="tabular-nums text-neutral-400">
                      #{snap.rank}
                    </span>
                    <span className="text-xs text-neutral-600">
                      {relTime(snap.capturedAt)}
                    </span>
                  </li>
                ))}
            </ul>
          ) : (
            <Empty>Not in any discovery sort.</Empty>
          )}
        </Section>

        {/* lifecycle events */}
        <Section title="Lifecycle events">
          {lifecycle.length ? (
            <ul className="flex flex-col gap-1.5 text-sm">
              {lifecycle.slice(0, 8).map((e) => (
                <li key={e.id} className="flex items-center gap-2">
                  <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-xs capitalize text-neutral-300">
                    {e.type.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-neutral-600">
                    {relTime(e.detectedAt)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No detected transitions.</Empty>
          )}
        </Section>
      </div>

      {/* tags */}
      <Section title="Tags">
        {tags.length ? (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span
                key={t.id}
                className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs text-neutral-300"
                title={t.description ?? undefined}
              >
                <span className="text-neutral-500">{t.axis}:</span> {t.label}
              </span>
            ))}
          </div>
        ) : (
          <Empty>Untagged.</Empty>
        )}
      </Section>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* monetization */}
        <Section title="Monetization">
          {monetization.passes.length || monetization.products.length ? (
            <div className="flex flex-col gap-3 text-sm">
              {monetization.passes.length ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                    Game passes
                  </div>
                  <ul className="flex flex-col gap-1">
                    {monetization.passes.map((p) => (
                      <li key={p.passId} className="flex justify-between">
                        <span className="text-neutral-300">
                          {p.name ?? `#${p.passId}`}
                        </span>
                        <span className="tabular-nums text-neutral-400">
                          R$ {fmtFull(p.priceRobux)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {monetization.products.length ? (
                <div>
                  <div className="mb-1 text-xs uppercase tracking-wide text-neutral-500">
                    Dev products
                  </div>
                  <ul className="flex flex-col gap-1">
                    {monetization.products.map((p) => (
                      <li key={p.productId} className="flex justify-between">
                        <span className="text-neutral-300">
                          {p.name ?? `#${p.productId}`}
                        </span>
                        <span className="tabular-nums text-neutral-400">
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

        {/* demand overlay */}
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
                    <span className="text-neutral-300">
                      {term.term}
                      <span className="ml-1 text-xs text-neutral-600">
                        ({term.kind})
                      </span>
                    </span>
                    <span className="tabular-nums text-neutral-400">
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

      {/* events */}
      {events.length ? (
        <Section title="Virtual events">
          <ul className="flex flex-col gap-2 text-sm">
            {events.map((e) => (
              <li
                key={e.eventId}
                className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
              >
                <div className="font-medium text-neutral-200">
                  {e.title ?? "Event"}
                </div>
                {e.subtitle ? (
                  <div className="text-xs text-neutral-500">{e.subtitle}</div>
                ) : null}
                {e.tagline ? (
                  <div className="mt-1 text-xs text-neutral-400">
                    {e.tagline}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {/* game notes — shared + own-private, with compose when signed in */}
      <Section title="Game notes">
        <GameNotes universeId={game.universeId} initial={notes} />
      </Section>

      {/* history depth footer */}
      <p className="text-xs text-neutral-700">
        {fmtFull(metrics.total)} raw snapshots · {fmtFull(stats.total)} derived
        stat rows. All numbers are estimates from public Roblox data.
      </p>
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
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-400">
          {title}
        </h2>
        {estimateAt !== undefined ? <Estimate at={estimateAt} /> : null}
        <div className="h-px flex-1 bg-neutral-800" />
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="text-sm text-neutral-600">{children}</div>;
}

// Minimal inline SVG sparkline of CCU over the returned window. No chart lib.
function Sparkline({ points }: { points: GameMetric[] }) {
  const values = points.map((p) => p.playing ?? 0);
  const w = 720;
  const h = 120;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const coords = values.map((v, i) => {
    const x = i * step;
    const y = h - ((v - min) / span) * (h - 8) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = coords.join(" ");
  const area = `0,${h} ${line} ${w},${h}`;

  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-950/50 p-3">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-32 w-full"
        preserveAspectRatio="none"
        role="img"
      >
        <title>CCU history</title>
        <polygon points={area} fill="url(#g)" opacity={0.25} />
        <polyline
          points={line}
          fill="none"
          stroke="#818cf8"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
        <defs>
          <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#818cf8" />
            <stop offset="100%" stopColor="#818cf8" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-neutral-600">
        <span>{relTime(points[0]?.capturedAt)}</span>
        <span>peak {fmtCompact(max)}</span>
        <span>now</span>
      </div>
    </div>
  );
}
