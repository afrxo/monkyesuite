import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { useSignUp } from "../lib/auth";
import { AuthShell, Field } from "./sign-in";

export const Route = createFileRoute("/sign-up")({
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const signUp = useSignUp();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    signUp.mutate(
      { name, email, password },
      { onSuccess: () => navigate({ to: "/projects" }) },
    );
  };

  return (
    <AuthShell title="Create account" subtitle="Start a build workspace.">
      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Field
          label="Name"
          type="text"
          value={name}
          onChange={setName}
          autoComplete="name"
        />
        <Field
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <Field
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
        {signUp.isError ? (
          <p className="text-sm text-rose-400">{signUp.error.message}</p>
        ) : null}
        <button
          type="submit"
          disabled={signUp.isPending}
          className="mt-1 rounded-md bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
        >
          {signUp.isPending ? "Creating…" : "Create account"}
        </button>
      </form>
      <p className="mt-4 text-sm text-neutral-500">
        Already have an account?{" "}
        <Link to="/sign-in" className="text-indigo-400 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
