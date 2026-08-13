// Membership + invites (specs/06). Owner-only actions (invite, revoke, remove)
// are gated in the UI by the caller's role AND enforced at the API — the UI gate
// is convenience, not security. The two-collaborator cap surfaces as a 409 the
// API returns, shown inline.

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
  const invites = useQuery({
    queryKey: ["invites", projectId],
    queryFn: () => api.invites(projectId),
    enabled: isOwner,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["members", projectId] });
    qc.invalidateQueries({ queryKey: ["invites", projectId] });
  };

  const invite = useMutation({
    mutationFn: (email: string) => api.createInvite(projectId, email),
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.revokeInvite(inviteId),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(projectId, userId),
    onSuccess: invalidate,
  });

  const [email, setEmail] = useState("");
  const onInvite = (e: FormEvent) => {
    e.preventDefault();
    if (email.trim())
      invite.mutate(email.trim(), { onSuccess: () => setEmail("") });
  };

  if (members.isError) return <ScopedError error={members.error} />;
  if (members.isPending)
    return <p className="text-sm text-neutral-600">Loading…</p>;

  const pending = (invites.data ?? []).filter((i) => i.status === "pending");

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
            Invites
          </h2>
          <form onSubmit={onInvite} className="mb-3 flex items-center gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="collaborator@email.com"
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
            />
            <button
              type="submit"
              disabled={invite.isPending}
              className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
            >
              Invite
            </button>
          </form>
          {invite.isError ? (
            <p className="mb-2 text-sm text-rose-400">{invite.error.message}</p>
          ) : null}
          <p className="mb-2 text-xs text-neutral-600">
            Up to two collaborators per project.
          </p>
          {pending.length === 0 ? (
            <p className="text-sm text-neutral-600">No pending invites.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {pending.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900/40 px-3 py-2 text-sm"
                >
                  <span className="text-neutral-300">{i.email}</span>
                  <button
                    type="button"
                    onClick={() => revoke.mutate(i.id)}
                    className="text-xs text-neutral-600 hover:text-rose-300"
                  >
                    revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
