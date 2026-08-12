import {
  createRootRoute,
  HeadContent,
  Link,
  Outlet,
  Scripts,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
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
  return (
    <RootDocument>
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-8 flex items-baseline justify-between border-b border-neutral-800 pb-4">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-xl font-bold tracking-tight text-neutral-100">
              monkyesuite
            </span>
            <span className="text-sm text-neutral-500">Pulse</span>
          </Link>
          <span className="text-xs text-neutral-600">
            signals are estimates from public Roblox data
          </span>
        </header>
        <Outlet />
      </div>
    </RootDocument>
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
