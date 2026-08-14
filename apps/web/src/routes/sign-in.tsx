import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useSignIn } from "../lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { email, password },
      { onSuccess: () => navigate({ to: "/projects" }) },
    );
  };

  return (
    <AuthShell title="Sign in" subtitle="Back to your build workspaces.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          label="Username"
          type="text"
          value={email}
          onChange={setEmail}
          autoComplete="username"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        {signIn.isError ? (
          <p className="text-sm text-rose-400">{signIn.error.message}</p>
        ) : null}
        <button
          type="submit"
          disabled={signIn.isPending}
          className="mt-1 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-4 text-sm text-neutral-500">
        Accounts are created by an administrator.
      </p>
    </AuthShell>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-sm">
      <h1 className="text-xl font-bold text-neutral-100">{title}</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-500">{subtitle}</p>
      {children}
    </div>
  );
}

export function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-neutral-400">{label}</span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-neutral-100 outline-none focus:border-neutral-600"
      />
    </label>
  );
}
