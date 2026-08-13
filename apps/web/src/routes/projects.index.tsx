import type { CreateProjectInput, Project } from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { ScopedError } from "../components/scoped";
import { api } from "../lib/api";

export const Route = createFileRoute("/projects/")({
  component: ProjectsPage,
});

const STATUS_COLOR: Record<Project["status"], string> = {
  active: "text-emerald-300",
  paused: "text-amber-300",
  shipped: "text-sky-300",
  archived: "text-neutral-500",
};

function ProjectsPage() {
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => api.projects(),
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-neutral-200">Projects</h1>
      </div>

      {projects.isError ? (
        <ScopedError error={projects.error} />
      ) : projects.isPending ? (
        <p className="text-sm text-neutral-600">Loading…</p>
      ) : (
        <>
          <NewProject />
          {projects.data.length === 0 ? (
            <p className="text-sm text-neutral-600">
              No projects yet. Create one above.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.data.map((p) => (
                <li key={p.id}>
                  <Link
                    to="/projects/$id"
                    params={{ id: p.id }}
                    className="block rounded-xl border border-neutral-800 bg-neutral-900/50 p-4 transition hover:border-neutral-700 hover:bg-neutral-900"
                  >
                    <div className="flex items-center justify-between">
                      <h2 className="truncate font-semibold text-neutral-100">
                        {p.name}
                      </h2>
                      <span
                        className={`text-xs capitalize ${STATUS_COLOR[p.status]}`}
                      >
                        {p.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-neutral-500">
                      {p.description ?? `/${p.slug}`}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function NewProject() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: (input: CreateProjectInput) => api.createProject(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setName("");
      setOpen(false);
    },
  });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-fit rounded-md border border-dashed border-neutral-700 px-3 py-1.5 text-sm text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
      >
        + New project
      </button>
    );
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const slug = slugify(name);
    if (!slug) return;
    create.mutate({ name: name.trim(), slug });
  };

  return (
    <form
      onSubmit={onSubmit}
      className="flex flex-wrap items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: focus the field the user just opened
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Project name"
        className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-neutral-600"
      />
      {name.trim() ? (
        <span className="text-xs text-neutral-600">/{slugify(name)}</span>
      ) : null}
      <button
        type="submit"
        disabled={create.isPending || !name.trim()}
        className="rounded-md bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-50"
      >
        Create
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-sm text-neutral-500 hover:text-neutral-300"
      >
        Cancel
      </button>
      {create.isError ? (
        <p className="w-full text-sm text-rose-400">{create.error.message}</p>
      ) : null}
    </form>
  );
}
