// Adapter for the tlw pulse components' <BetterAuthHeader/>. Delegates to
// the existing apps/web auth surface (Better Auth wired in lib/auth) — the
// component tree in the ported pulse feed expects a component with this
// import path, and reimplementing it here keeps that tree unmodified.

import { Link } from "@tanstack/react-router";
import { useSession, useSignOut } from "#/lib/auth";

export default function BetterAuthHeader() {
  const { user, isPending } = useSession();
  const signOut = useSignOut();

  if (isPending) {
    return (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: "50%",
          background: "var(--surface-1)",
        }}
      />
    );
  }

  if (!user) {
    return (
      <Link
        to="/sign-in"
        style={{
          fontSize: 12,
          color: "var(--text-1)",
          textDecoration: "none",
          padding: "6px 12px",
          border: "1px solid var(--border-1)",
          borderRadius: 999,
        }}
      >
        Sign in
      </Link>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span
        style={{
          fontSize: 12,
          color: "var(--text-3)",
          fontVariantNumeric: "tabular-nums",
        }}
        title={user.email ?? undefined}
      >
        {user.name ?? user.email}
      </span>
      <button
        type="button"
        onClick={() => signOut.mutate()}
        style={{
          fontSize: 11,
          color: "var(--text-4)",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Sign out
      </button>
    </div>
  );
}
