// The ONLY data source for the web app: the Railway API over HTTP. Nothing here
// touches Postgres (specs/08-web.md "Data access"). Types come from the shared
// contract package so producer and consumer agree.

import type {
  DemandOverlay,
  FeedItem,
  FeedSort,
  GameDetail,
  GameEvent,
  GameMetric,
  GameNote,
  GameStat,
  LifecycleEvent,
  LifecycleStage,
  Monetization,
  Paged,
  SortSnapshot,
  Tag,
} from "@monkyesuite/shared";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787/v1";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    let code = "error";
    let message = res.statusText;
    try {
      const body: unknown = await res.json();
      if (
        body &&
        typeof body === "object" &&
        "error" in body &&
        body.error &&
        typeof body.error === "object"
      ) {
        const e = body.error as { code?: string; message?: string };
        code = e.code ?? code;
        message = e.message ?? message;
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, code, message);
  }
  return res.json() as Promise<T>;
}

function qs(params: Record<string, string | number | undefined>): string {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") s.set(k, String(v));
  }
  const str = s.toString();
  return str ? `?${str}` : "";
}

export interface FeedParams {
  page?: number;
  pageSize?: number;
  sort?: FeedSort;
  lifecycle?: LifecycleStage;
  genre?: string;
}

export const api = {
  feed: (p: FeedParams = {}) => get<Paged<FeedItem>>(`/feed${qs({ ...p })}`),
  game: (id: number) => get<GameDetail>(`/games/${id}`),
  metrics: (
    id: number,
    interval: "raw" | "hour" | "day" = "hour",
    pageSize = 500,
  ) =>
    get<Paged<GameMetric>>(`/games/${id}/metrics${qs({ interval, pageSize })}`),
  stats: (id: number, pageSize = 500) =>
    get<Paged<GameStat>>(`/games/${id}/stats${qs({ pageSize })}`),
  lifecycle: (id: number) => get<LifecycleEvent[]>(`/games/${id}/lifecycle`),
  sorts: (id: number) => get<SortSnapshot[]>(`/games/${id}/sorts`),
  events: (id: number) => get<GameEvent[]>(`/games/${id}/events`),
  monetization: (id: number) => get<Monetization>(`/games/${id}/monetization`),
  demand: (id: number) => get<DemandOverlay>(`/games/${id}/demand`),
  gameTags: (id: number) => get<Tag[]>(`/games/${id}/tags`),
  notes: (id: number) => get<GameNote[]>(`/games/${id}/notes`),
};
