import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import ToastHost from "../components/toast/ToastHost";
import { TooltipProvider } from "../components/ui/tooltip";
import { ApiError } from "../lib/api";
import { useSession } from "../lib/auth";
import appCss from "../styles.css?url";

// Closed suite (specs/06 §6.6): the sign-in page is the only route that
// renders signed-out. The session lives client-side only (SSR has no session
// cookie to forward), so the gate runs as a post-hydration effect rather than
// a loader — an unauthenticated visitor briefly sees nothing, then redirects,
// never scoped data.
const SIGNED_OUT_OK = new Set(["/sign-in"]);

// Routes that render their own full-bleed chrome (e.g. Pulse renders its own
// topbar + hero). These skip the wrapper container + suite nav bar so the
// ported page keeps its own layout intact. /sign-in is here because it's the
// only signed-out route and the suite nav (with its own Sign in button + nav
// links) shouldn't chrome the login card.
const FULL_BLEED = new Set<string>(["/", "/sign-in"]);
// Workspace renders its own AppHeader (with breadcrumb + action slots) so it
// can merge suite chrome and project chrome into a single 56px bar instead
// of stacking two.
const FULL_BLEED_PREFIX = ["/projects/"];

function RootErrorComponent({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  const message =
    error instanceof Error ? error.message : "An unexpected error occurred.";

  if (status === 401) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-1 bg-surface-1 text-xl">
          🔒
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-text-1">Sign in required</p>
          <p className="text-sm text-text-4">
            Your session expired or you're not signed in.
          </p>
        </div>
        <Link
          to="/sign-in"
          className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (status === 403) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-1 bg-surface-1 text-xl">
          🚫
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-text-1">Access denied</p>
          <p className="text-sm text-text-4">
            You don't have permission to view this.
          </p>
        </div>
        <Link
          to="/projects"
          className="text-sm text-indigo-400 hover:underline"
        >
          ← back to your projects
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background px-4 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border-1 bg-surface-1 text-xl">
        ⚠
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-base font-semibold text-text-1">Something went wrong</p>
        <p className="max-w-sm text-sm text-text-4">{message}</p>
      </div>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-md bg-neutral-100 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
      >
        Reload
      </button>
    </div>
  );
}

export const Route = createRootRoute({
  errorComponent: RootErrorComponent,
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "monkyesuite — Pulse" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      // Preconnect the Roblox thumbnail CDNs pulse cards will start requesting
      // as soon as the payload lands. Shaves ~100ms off first thumb paint.
      {
        rel: "preconnect",
        href: "https://tr.rbxcdn.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preconnect",
        href: "https://t0.rbxcdn.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preconnect",
        href: "https://t1.rbxcdn.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preconnect",
        href: "https://t2.rbxcdn.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "preconnect",
        href: "https://t3.rbxcdn.com",
        crossOrigin: "anonymous",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  // Per-render QueryClient (SSR-safe): scoped data is fetched client-side only.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: false,
            // Perceived speed baseline. With staleTime 0 every remount
            // refetched and every pane flashed a loading state over data we
            // already had — remounting a modal or switching panes should
            // render from cache instantly and revalidate behind the paint.
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RootDocument>
          <AuthGate>
            <Layout />
          </AuthGate>
          <ToastHost />
        </RootDocument>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Layout() {
  const location = useLocation();
  const fullBleed =
    FULL_BLEED.has(location.pathname) ||
    FULL_BLEED_PREFIX.some((p) => location.pathname.startsWith(p));
  if (fullBleed) {
    // Full-bleed routes own their whole surface (Pulse renders its own topbar
    // + hero; workspace renders its own AppHeader with breadcrumb slots).
    return <Outlet />;
  }
  const activeRoute = location.pathname.startsWith("/projects")
    ? "projects"
    : location.pathname.startsWith("/discover")
      ? "discover"
      : undefined;
  return (
    <>
      <AppHeader activeRoute={activeRoute} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </div>
    </>
  );
}

// Redirects an unauthenticated visitor to /sign-in for every route except the
// sign-in page itself (specs/06 §6.6: nothing else is public). Runs
// client-side only, after the session query resolves.
function AuthGate({ children }: { children: ReactNode }) {
  const { user, isPending } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const exempt = SIGNED_OUT_OK.has(location.pathname);

  useEffect(() => {
    if (!isPending && !user && !exempt) {
      navigate({ to: "/sign-in", replace: true });
    }
  }, [isPending, user, exempt, navigate]);

  if (exempt) return <>{children}</>;
  if (isPending || !user) return null;
  return <>{children}</>;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
