import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useSession, useSignOut } from "../lib/auth";
import appCss from "../styles.css?url";

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
      </RootDocument>
    </QueryClientProvider>
  );
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
