// Directed empty states for scoped views (specs/08 §8.6). A 401 sends the user
// to sign-in; a 403 says "not a member" with a way out — never a blank screen.
// Wrap a query's error in <ScopedError> to get the right message per status.

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { ApiError } from "../lib/api";

export function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-1 bg-surface-1/40 p-10 text-center text-text-3">
      {children}
    </div>
  );
}

export function ScopedError({ error }: { error: unknown }) {
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 401) {
    return (
      <Panel>
        <p className="text-text-2">Sign in to see your projects.</p>
        <Link
          to="/sign-in"
          className="mt-2 inline-block rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white"
        >
          Sign in
        </Link>
      </Panel>
    );
  }
  if (status === 403) {
    return (
      <Panel>
        <p className="text-text-2">You’re not a member of this project.</p>
        <Link
          to="/projects"
          className="mt-2 inline-block text-sm text-indigo-400 hover:underline"
        >
          ← back to your projects
        </Link>
      </Panel>
    );
  }
  if (status === 404) {
    return (
      <Panel>
        <p className="text-text-2">Not found.</p>
        <Link
          to="/projects"
          className="mt-2 inline-block text-sm text-indigo-400 hover:underline"
        >
          ← back to your projects
        </Link>
      </Panel>
    );
  }
  const message = error instanceof Error ? error.message : "Something broke.";
  return (
    <Panel>
      <p className="text-rose-400">{message}</p>
    </Panel>
  );
}
