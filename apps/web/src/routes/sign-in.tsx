import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui/button";
import { useSignIn } from "../lib/auth";

export const Route = createFileRoute("/sign-in")({
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const signIn = useSignIn();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    signIn.mutate(
      { username, password },
      { onSuccess: () => navigate({ to: "/projects" }) },
    );
  };

  return (
    <AuthShell eyebrow="monkyesuite" title="Sign in">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          label="Username"
          type="text"
          value={username}
          onChange={setUsername}
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
          <p className="text-sm text-lifecycle-declining">
            {signIn.error.message}
          </p>
        ) : null}
        <Button type="submit" disabled={signIn.isPending} className="mt-2 h-10">
          {signIn.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthShell>
  );
}

export function AuthShell({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-sm items-center">
      <div className="w-full rounded-2xl border border-border-1 bg-surface-1 px-8 py-9 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]">
        {eyebrow ? (
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-5">
            {eyebrow}
          </div>
        ) : null}
        <h1 className="mb-7 font-serif text-3xl italic leading-tight text-text-1">
          {title}
        </h1>
        {children}
      </div>
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
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-5">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-border-1 bg-transparent px-3 py-2 text-sm text-text-1 transition-colors outline-none focus:border-text-4 focus:bg-white/[0.02]"
      />
    </label>
  );
}
