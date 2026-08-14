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
import { useSession, useSignOut } from "../lib/auth";
import appCss from "../styles.css?url";

// Closed suite (specs/06 §6.6): the sign-in page is the only route that
// renders signed-out. The session lives client-side only (SSR has no session
// cookie to forward), so the gate runs as a post-hydration effect rather than
// a loader — an unauthenticated visitor briefly sees nothing, then redirects,
// never scoped data.
const SIGNED_OUT_OK = new Set(["/sign-in"]);

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "monkyesuite — Pulse" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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
      <RootDocument>
        <AuthGate>
          <div className="mx-auto max-w-6xl px-4 py-6">
            <header className="mb-8 flex items-center justify-between border-b border-neutral-800 pb-4">
              <nav className="flex items-baseline gap-5">
                <Link to="/" className="flex items-baseline gap-2">
                  <span className="text-xl font-bold tracking-tight text-neutral-100">
                    monkyesuite
                  </span>
                  <span className="text-sm text-neutral-500">Pulse</span>
                </Link>
                <Link
                  to="/projects"
                  className="text-sm text-neutral-400 hover:text-neutral-100 [&.active]:text-neutral-100"
                >
                  Projects
                </Link>
              </nav>
              <AuthNav />
            </header>
            <Outlet />
          </div>
        </AuthGate>
      </RootDocument>
    </QueryClientProvider>
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

// Sign-in link when signed out; email + sign-out when signed in.
function AuthNav() {
  const { user, isPending } = useSession();
  const signOut = useSignOut();
  if (isPending) return <span className="text-xs text-neutral-600">…</span>;
  if (!user) {
    return (
      <Link
        to="/sign-in"
        className="rounded-md bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-white"
      >
        Sign in
      </Link>
    );
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="text-neutral-400">{user.name ?? user.email}</span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        className="text-neutral-500 hover:text-neutral-200"
      >
        Sign out
      </button>
    </div>
  );
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
