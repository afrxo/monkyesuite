import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useLocation,
  useNavigate,
} from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import AppHeader from "../components/AppHeader";
import { TooltipProvider } from "../components/ui/tooltip";
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

export const Route = createRootRoute({
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
        defaultOptions: { queries: { retry: false } },
      }),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <RootDocument>
          <AuthGate>
            <Layout />
          </AuthGate>
        </RootDocument>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

function Layout() {
  const location = useLocation();
  if (FULL_BLEED.has(location.pathname)) {
    // Pulse owns the whole surface: its own topbar (AppHeader / feed/Topbar)
    // + hero + rail. Wrapping it in the suite nav would double-chrome it.
    return <Outlet />;
  }
  const activeRoute =
    location.pathname.startsWith("/projects") ? "projects" : undefined;
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
