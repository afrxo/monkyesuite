import {
  PULSE_FILTERS,
  PULSE_SORTS,
  type PulseFilter,
  type PulseSort,
} from "@monkyesuite/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import PulseFeed from "../components/PulseFeed";
import { api } from "../lib/api";
import { adaptPulsePayload } from "../lib/pulse-adapter";

interface PulseSearch {
  filter?: PulseFilter;
  sort?: PulseSort;
}

function parseFilter(v: unknown): PulseFilter {
  return (PULSE_FILTERS as readonly string[]).includes(v as string)
    ? (v as PulseFilter)
    : "all";
}
function parseSort(v: unknown): PulseSort {
  return (PULSE_SORTS as readonly string[]).includes(v as string)
    ? (v as PulseSort)
    : "spike";
}

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): PulseSearch => {
    const out: PulseSearch = {};
    if (search.filter !== undefined) out.filter = parseFilter(search.filter);
    if (search.sort !== undefined) out.sort = parseSort(search.sort);
    return out;
  },
  component: PulseRoute,
});

function PulseRoute() {
  const search = Route.useSearch();
  const filter: PulseFilter = search.filter ?? "all";
  const sort: PulseSort = search.sort ?? "spike";
  const router = useRouter();

  // Pulled client-side (rather than in a route loader) because the API is
  // behind Better Auth's session cookie — SSR has no session forwarded, so a
  // loader would 401 on cold hydration. TanStack Query owns the freshness
  // dance: 30s stale time mirrors the pulse endpoint's s-maxage, and the
  // 60s router.invalidate() below tops it up on the client.
  const q = useQuery({
    queryKey: ["pulse", filter, sort],
    queryFn: () => api.pulse(filter, sort),
    staleTime: 30_000,
  });

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined" || !document.hidden) {
        router.invalidate();
      }
    }, 60_000);
    return () => clearInterval(id);
  }, [router]);

  if (q.isPending) {
    return (
      <div className="mt-24 text-center text-sm text-text-4">Waking pulse…</div>
    );
  }
  if (q.isError) {
    return (
      <div className="mt-24 text-center text-sm text-lifecycle-declining">
        Pulse unavailable: {(q.error as Error).message}
      </div>
    );
  }

  const payload = adaptPulsePayload(q.data);
  return <PulseFeed {...payload} />;
}
