// Membership (specs/06 §6.3). Owner-only actions (add, remove) are gated in
// the UI by the caller's role AND enforced at the API — the UI gate is
// convenience, not security. Adding a collaborator is a direct write against
// an EXISTING account by email — no invite/token flow, since the suite is
// closed and every user already has an account (admin-created). The
// two-collaborator cap surfaces as a 409 the API returns, shown inline.

import type { MemberRole } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";

export function MembersPanel({
  projectId,
  ownRole,
}: {
  projectId: string;
  ownRole: MemberRole;
}) {
  const qc = useQueryClient();
  const isOwner = ownRole === "owner";
  const members = useQuery({
    queryKey: ["members", projectId],
    queryFn: () => api.members(projectId),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["members", projectId] });
  };

  const addMember = useMutation({
    mutationFn: (email: string) => api.addMember(projectId, email),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: invalidate,
  });

  const [email, setEmail] = useState("");
  const onAddMember = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim())
      addMember.mutate(email.trim(), { onSuccess: () => setEmail("") });
  };

  if (members.isError) return <ScopedError error={members.error} />;
  if (members.isPending)
    return <p className="text-sm text-neutral-600">Loading…</p>;

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
          Members
        </h2>
        <ul className="flex flex-col gap-1">
          {members.data.map((m) => (
            <li
              key={m.id}
              className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm"
            >
              <span className="text-neutral-200">
                {m.user.name ?? m.user.email}
                <span className="ml-2 text-xs text-neutral-500">
                  {m.user.email}
                </span>
              </span>
              <span className="flex items-center gap-3">
                <span className="text-xs capitalize text-neutral-500">
                  {m.role}
                </span>
                {isOwner && m.role === "member" ? (
                  <button
                    type="button"
                    onClick={() => remove.mutate(m.userId)}
                    className="text-xs text-neutral-600 hover:text-rose-300"
                  >
                    remove
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {isOwner ? (
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-400">
            Add collaborator
          </h2>
          <form onSubmit={onAddMember} className="mb-3 flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="existing user's email"
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            />
            <button
              type="submit"
              disabled={addMember.isPending}
              className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              Add
            </button>
          </form>
          {addMember.isError ? (
            <p className="mb-2 text-sm text-rose-400">
              {addMember.error.message}
            </p>
          ) : null}
          <p className="text-xs text-neutral-600">
            Up to two collaborators per project. The user must already have an
            account — accounts are created by an administrator.
          </p>
        </section>
      ) : null}
    </div>
  );
}
