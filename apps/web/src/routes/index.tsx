import {
  FEED_SORTS,
  type FeedItem,
  type FeedSort,
  LIFECYCLE_STAGES,
  type LifecycleStage,
} from "@monkyesuite/shared";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Estimate, LifecycleBadge, SortRank } from "../components/ui";
import { api } from "../lib/api";
import { fmtCompact, fmtSigned } from "../lib/format";

// Fields optional in the type so links elsewhere (header, back buttons) can
// point at "/" without restating search; validateSearch always fills defaults.
interface FeedSearch {
  sort?: FeedSort;
  lifecycle?: LifecycleStage;
  page?: number;
}

const SORT_LABELS: Record<FeedSort, string> = {
  trend: "Trending",
  spike: "Spiking",
  ccu: "Players",
  velocity: "Velocity",
  newest: "Newest",
};

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): FeedSearch => {
    const sort = FEED_SORTS.find((s) => s === search.sort) ?? "trend";
    const lifecycle = LIFECYCLE_STAGES.find((l) => l === search.lifecycle);
    const page = Math.max(1, Number(search.page) || 1);
    return { sort, lifecycle, page };
  },
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => api.feed(deps),
  component: FeedPage,
});

function FeedPage() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const activeSort: FeedSort = search.sort ?? "trend";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <h1 className="mr-2 text-lg font-semibold text-neutral-200">
          Pulse feed
        </h1>
        <div className="flex flex-wrap gap-1">
          {FEED_SORTS.map((s) => (
            <Link
              key={s}
              to="/"
              search={(prev) => ({ ...prev, sort: s, page: 1 })}
              className={`rounded-md px-2.5 py-1 text-sm ring-1 transition ${
                activeSort === s
                  ? "bg-neutral-100 text-neutral-900 ring-neutral-100"
                  : "bg-neutral-900 text-neutral-400 ring-neutral-800 hover:text-neutral-200"
              }`}
            >
              {SORT_LABELS[s]}
            </Link>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-1">
          <Link
            to="/"
            search={(prev) => ({ ...prev, lifecycle: undefined, page: 1 })}
            className={`rounded-md px-2 py-1 text-xs ring-1 ${
              !search.lifecycle
                ? "bg-neutral-800 text-neutral-100 ring-neutral-700"
                : "bg-neutral-900 text-neutral-500 ring-neutral-800 hover:text-neutral-300"
            }`}
          >
            all
          </Link>
          {LIFECYCLE_STAGES.map((l) => (
            <Link
              key={l}
              to="/"
              search={(prev) => ({ ...prev, lifecycle: l, page: 1 })}
              className={`rounded-md px-2 py-1 text-xs capitalize ring-1 ${
                search.lifecycle === l
                  ? "bg-neutral-800 text-neutral-100 ring-neutral-700"
                  : "bg-neutral-900 text-neutral-500 ring-neutral-800 hover:text-neutral-300"
              }`}
            >
              {l}
            </Link>
          ))}
        </div>
      </div>

      <p className="mb-4 text-xs text-neutral-600">
        {data.total} tracked {data.total === 1 ? "game" : "games"}
        {search.lifecycle ? ` · ${search.lifecycle}` : ""} · sorted by{" "}
        {SORT_LABELS[activeSort].toLowerCase()}
      </p>

      {data.items.length === 0 ? (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900/40 p-10 text-center text-neutral-500">
          No games match this filter.
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <FeedCard key={item.universeId} item={item} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedCard({ item }: { item: FeedItem }) {
  const stats = item.latestStats;
  const metric = item.latestMetric;
  return (
    <li className="group rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700 hover:bg-neutral-900">
      <Link
        to="/games/$id"
        params={{ id: String(item.universeId) }}
        className="block"
      >
        <div className="flex items-start gap-3">
          {item.iconUrl ? (
            <img
              src={item.iconUrl}
              alt=""
              className="h-12 w-12 shrink-0 rounded-lg bg-neutral-800 object-cover"
            />
          ) : (
            <div className="h-12 w-12 shrink-0 rounded-lg bg-neutral-800" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h2 className="truncate font-semibold text-neutral-100 group-hover:text-white">
                {item.name}
              </h2>
              <LifecycleBadge stage={stats?.lifecycle ?? null} />
            </div>
            <p className="truncate text-xs text-neutral-500">
              {item.creatorName ?? "unknown creator"}
              {item.robloxGenre ? ` · ${item.robloxGenre}` : ""}
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Metric label="CCU" value={fmtCompact(metric?.playing)} />
          <Metric
            label="Velocity"
            value={fmtSigned(stats?.velocity)}
            hint="ccu/hr"
          />
          <Metric
            label="Trend"
            value={
              stats?.trendScore !== null && stats?.trendScore !== undefined
                ? stats.trendScore.toFixed(1)
                : "—"
            }
          />
        </div>

        <div className="mt-3 flex items-center justify-between">
          <SortRank sort={item.currentSort} rank={item.currentSortRank} />
          <Estimate at={stats?.computedAt ?? metric?.capturedAt ?? null} />
        </div>
      </Link>
    </li>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-neutral-950/50 px-2.5 py-2">
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">
        {label}
      </div>
      <div className="text-sm font-semibold tabular-nums text-neutral-100">
        {value}
      </div>
      {hint ? <div className="text-[10px] text-neutral-600">{hint}</div> : null}
    </div>
  );
}
