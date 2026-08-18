// Workspace chrome — rendered as the suite AppHeader with its breadcrumb +
// actions slots filled in, so the workspace lives under one bar (56px)
// instead of stacking suite nav + project sub-topbar. Members page is gone;
// invite lives in the avatar stack popover.

import type {
  MemberRole,
  Membership,
  ProjectDetail,
} from "@monkyesuite/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import AppHeader from "../components/AppHeader";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../components/ui/popover";
import { ApiError, api } from "../lib/api";

type Props = {
  project: ProjectDetail;
  members: Membership[];
  onQuickAdd: () => void;
};

export function Topbar({ project, members, onQuickAdd }: Props) {
  return (
    <AppHeader
      activeRoute="projects"
      breadcrumb={
        <>
          <Link
            to="/projects"
            className="text-text-3 text-link"
            aria-label="Back to projects"
          >
            Projects
          </Link>
          <span className="text-text-disabled">/</span>
          <span className="font-semibold tracking-[-0.01em] text-text-1">
            {project.name}
          </span>
        </>
      }
      actions={
        <>
          <AvatarStack
            members={members}
            ownRole={project.membership.role}
            projectId={project.id}
          />
          <button
            type="button"
            onClick={onQuickAdd}
            className="flex items-center gap-2 rounded border border-border-2 px-2.5 py-1 text-[11px] text-text-3 transition hover:border-text-5 hover:text-text-1"
          >
            Quick add <Kbd>N</Kbd>
          </button>
        </>
      }
    />
  );
}

function AvatarStack({
  members,
  ownRole,
  projectId,
}: {
  members: Membership[];
  ownRole: MemberRole;
  projectId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex items-center">
      <div className="flex">
        {members.map((m, i) => (
          <Avatar
            key={m.id}
            name={m.user.name ?? m.user.email}
            role={m.role}
            first={i === 0}
          />
        ))}
        {ownRole === "owner" ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                title="Invite collaborator"
                className={`-ml-1.5 grid h-[22px] w-[22px] place-items-center rounded-full border border-dashed border-border-2 bg-transparent text-[11px] text-text-disabled transition hover:text-text-1 ${
                  members.length === 0 ? "ml-0" : ""
                }`}
              >
                +
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-72 border-border-1 bg-surface-1 p-3"
            >
              <InviteForm projectId={projectId} onClose={() => setOpen(false)} />
            </PopoverContent>
          </Popover>
        ) : null}
      </div>
    </div>
  );
}

function Avatar({
  name,
  role,
  first,
}: {
  name: string;
  role: MemberRole;
  first: boolean;
}) {
  const initials = name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toLowerCase();
  const isOwner = role === "owner";
  return (
    <span
      title={`${name} (${role})`}
      className={`grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-surface-0 text-[10px] font-semibold text-text-1 ${
        first ? "" : "-ml-1.5"
      } ${
        isOwner
          ? "bg-gradient-to-br from-[#3a2a1a] to-accent-warm text-[#1a1000]"
          : "bg-white/[0.08]"
      }`}
    >
      {initials}
    </span>
  );
}

function InviteForm({
  projectId,
  onClose,
}: {
  projectId: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), []);

  const add = useMutation({
    mutationFn: (email: string) => api.addMember(projectId, email),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["members", projectId] });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      setValue("");
      onClose();
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) add.mutate(value.trim());
  };

  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-text-disabled">
        Invite collaborator
      </p>
      <form onSubmit={onSubmit} className="flex items-center gap-1.5">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Username"
          className="h-7 flex-1 border-border-1 bg-surface-0 px-2 py-1 text-xs shadow-none focus-visible:ring-0 focus-visible:border-text-5"
        />
        <Button
          type="submit"
          size="sm"
          disabled={add.isPending}
          className="h-7 rounded bg-neutral-100 px-2.5 text-xs font-medium text-neutral-900 hover:bg-white"
        >
          Add
        </Button>
      </form>
      {add.isError ? (
        <p className="mt-2 text-[11px] text-rose-400">
          {add.error instanceof ApiError ? add.error.message : "Failed"}
        </p>
      ) : null}
      <p className="mt-2 text-[10px] text-text-disabled">
        Up to 2 collaborators. Account must already exist.
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border-1 px-1.5 py-px font-mono text-[10px] text-text-disabled">
      {children}
    </span>
  );
}
