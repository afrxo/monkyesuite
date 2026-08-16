// Left rail: Milestones, Docs, Refs (pinned tracker games), Filter tags.
// Each section owns its data query so the sidebar can render independently of
// the center pane's state. Section "+" adds are revealed on hover / focus-within
// (via .ws-section in styles.css). Filter tags + Refs are display-only chips
// for this pass — refs render name + tooltip on hover; wiring their onClick to
// jump into /games/:id lives one level up (Link).

import type {
  CreateMilestoneInput,
  CreateProjectGameInput,
  Doc,
  Milestone,
  ProjectGame,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";
import { TAG_KEYS } from "./tag";

type Props = {
  projectId: string;
  activeDocId: string | null;
  activeMilestone: string | "all";
  onSelectDoc: (id: string | null) => void;
  onSelectMilestone: (id: string | "all") => void;
  onCreateDoc: () => void;
};

export function Sidebar({
  projectId,
  activeDocId,
  activeMilestone,
  onSelectDoc,
  onSelectMilestone,
  onCreateDoc,
}: Props) {
  return (
    <aside className="col-start-1 overflow-y-auto border-r border-border-1 px-3 py-4">
      <MilestoneSection
        projectId={projectId}
        active={activeMilestone}
        onSelect={onSelectMilestone}
      />
      <DocSection
        projectId={projectId}
        activeId={activeDocId}
        onSelect={onSelectDoc}
        onCreate={onCreateDoc}
      />
      <RefSection projectId={projectId} />
      <TagSection />
    </aside>
  );
}

function SectionHead({ label, onAdd }: { label: string; onAdd?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 py-1.5">
      <span className="text-xs font-semibold uppercase tracking-[0.08em] text-text-disabled">
        {label}
      </span>
      {onAdd ? (
        <button
          type="button"
          onClick={onAdd}
          aria-label={`Add ${label}`}
          className="ws-section-add grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors"
        >
          <Icon name="plus" size={12} />
        </button>
      ) : null}
    </div>
  );
}

function Item({
  active,
  onClick,
  glyph,
  children,
  count,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  glyph: React.ReactNode;
  children: React.ReactNode;
  count?: number | string;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
        active
          ? "bg-white/[0.05] text-text-1"
          : "text-text-3 hover:bg-white/[0.04] hover:text-text-1"
      }`}
    >
      <span className="grid h-4 w-4 place-items-center text-xs text-text-disabled">
        {glyph}
      </span>
      <span className="truncate">{children}</span>
      {count !== undefined ? (
        <span className="ml-auto font-mono text-[11px] text-text-disabled">
          {count}
        </span>
      ) : null}
    </button>
  );
}

// Sidebar item with a hover-visible ⋯ menu. Used for milestones (Delete);
// same pattern could serve docs/refs later.
function ItemWithMenu({
  active,
  onClick,
  glyph,
  children,
  count,
  onDelete,
}: {
  active?: boolean;
  onClick?: () => void;
  glyph: React.ReactNode;
  children: React.ReactNode;
  count?: number | string;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div
      ref={wrapRef}
      className={`group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/[0.05] text-text-1"
          : "text-text-3 hover:bg-white/[0.04] hover:text-text-1"
      }`}
    >
      <button
        type="button"
        onClick={onClick}
        className="flex flex-1 items-center gap-2 truncate text-left"
      >
        <span className="grid h-4 w-4 place-items-center text-xs text-text-disabled">
          {glyph}
        </span>
        <span className="truncate">{children}</span>
      </button>
      {count !== undefined && !open ? (
        <span className="font-mono text-[11px] text-text-disabled group-hover:hidden">
          {count}
        </span>
      ) : null}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="Actions"
        className={`grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors ${
          open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <Icon name="more" size={12} />
      </button>
      {open ? (
        <div className="absolute right-0 top-7 z-10 w-32 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05] transition-colors"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function MilestoneSection({
  projectId,
  active,
  onSelect,
}: {
  projectId: string;
  active: string | "all";
  onSelect: (v: string | "all") => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const board = useQuery({
    queryKey: ["board", projectId],
    queryFn: () => api.board(projectId),
  });

  const create = useMutation({
    mutationFn: (input: CreateMilestoneInput) =>
      api.createMilestone(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["board", projectId] });
      setOpen(false);
    },
    onError: (err) => toastError(err),
  });
  const del = useMutation({
    mutationFn: (milestoneId: string) => api.deleteMilestone(milestoneId),
    onSuccess: (_, milestoneId) => {
      qc.invalidateQueries({ queryKey: ["board", projectId] });
      if (active === milestoneId) onSelect("all");
    },
    onError: (err) => toastError(err),
  });

  const milestones: Milestone[] = board.data?.milestones ?? [];
  const total = board.data?.lanes.reduce((s, l) => s + l.tasks.length, 0) ?? 0;
  const countFor = (id: string) =>
    board.data?.lanes.reduce(
      (s, l) => s + l.tasks.filter((t) => t.milestoneId === id).length,
      0,
    ) ?? 0;

  return (
    <section className="ws-section mb-5">
      <SectionHead label="Milestones" onAdd={() => setOpen(true)} />
      <Item
        active={active === "all"}
        onClick={() => onSelect("all")}
        glyph={<Icon name="milestone" size={12} />}
        count={total}
      >
        All
      </Item>
      {milestones.map((m) => (
        <ItemWithMenu
          key={m.id}
          active={active === m.id}
          onClick={() => onSelect(active === m.id ? "all" : m.id)}
          glyph={
            <span
              className={`inline-block h-1.5 w-1.5 rounded-full ${active === m.id ? "bg-accent-warm" : "bg-text-disabled"}`}
            />
          }
          count={countFor(m.id)}
          onDelete={() => {
            if (
              confirm(
                `Delete milestone “${m.name}”? Cards keep existing but lose their milestone link.`,
              )
            )
              del.mutate(m.id);
          }}
        >
          {m.name}
        </ItemWithMenu>
      ))}
      {open ? (
        <InlineForm
          placeholder="Milestone name"
          onSubmit={(name) => create.mutate({ name })}
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function DocSection({
  projectId,
  activeId,
  onSelect,
  onCreate,
}: {
  projectId: string;
  activeId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
}) {
  const docs = useQuery({
    queryKey: ["docs", projectId],
    queryFn: () => api.docs(projectId),
  });
  return (
    <section className="ws-section mb-5">
      <SectionHead label="Docs" onAdd={onCreate} />
      {docs.data?.map((d: Doc) => (
        <Item
          key={d.id}
          active={d.id === activeId}
          onClick={() => onSelect(d.id === activeId ? null : d.id)}
          glyph={<Icon name="doc" size={14} />}
        >
          {d.title || "Untitled"}
        </Item>
      ))}
    </section>
  );
}

function RefSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const games = useQuery({
    queryKey: ["project-games", projectId],
    queryFn: () => api.projectGames(projectId),
  });
  const link = useMutation({
    mutationFn: (input: CreateProjectGameInput) =>
      api.linkGame(projectId, input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project-games", projectId] });
      setOpen(false);
    },
    onError: (err) => toastError(err),
  });

  return (
    <section className="ws-section mb-5">
      <SectionHead label="Refs" onAdd={() => setOpen((v) => !v)} />
      {games.data?.map((g: ProjectGame) => (
        <Link
          key={g.universeId}
          to="/games/$id"
          params={{ id: String(g.universeId) }}
          title={g.note ?? undefined}
          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-3 hover:bg-white/[0.04] hover:text-text-1 transition-colors"
        >
          {g.iconUrl ? (
            <img
              src={g.iconUrl}
              alt=""
              className="h-4 w-4 shrink-0 rounded-sm object-cover"
            />
          ) : (
            <span className="grid h-4 w-4 place-items-center rounded-sm bg-white/[0.06] text-[10px] font-bold text-text-1">
              {g.name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="truncate">{g.name}</span>
        </Link>
      ))}
      {open ? (
        <RefForm
          onSubmit={(universeId, note) =>
            link.mutate({ universeId, note: note || undefined })
          }
          onCancel={() => setOpen(false)}
        />
      ) : null}
    </section>
  );
}

function TagSection() {
  // Static chips for this pass — filter wiring is out of scope (mirrors the
  // disabled List/Timeline tabs in the board header). Kept visible so the
  // affordance is discoverable; hover tooltip explains.
  return (
    <section className="ws-section mb-5">
      <SectionHead label="Filter tags" />
      <div className="flex flex-wrap gap-1.5 px-2">
        <TagChip active>all</TagChip>
        {TAG_KEYS.map((k) => (
          <TagChip key={k} disabled title="tag filter coming soon">
            {k}
          </TagChip>
        ))}
      </div>
    </section>
  );
}

function TagChip({
  children,
  active,
  disabled,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`rounded-[10px] border px-2 py-0.5 font-mono text-xs ${
        active
          ? "border-text-1 bg-text-1 text-surface-0"
          : "border-border-2 text-text-3"
      } ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
    >
      {children}
    </span>
  );
}

function InlineForm({
  placeholder,
  onSubmit,
  onCancel,
}: {
  placeholder: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onSubmit(v.trim());
      }}
      className="mt-1 px-1.5"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what user opened
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={onCancel}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder={placeholder}
        className="w-full rounded border border-border-1 bg-surface-1 px-2.5 py-1.5 text-sm text-text-1 outline-none focus:border-text-5"
      />
    </form>
  );
}

function RefForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (universeId: number, note: string) => void;
  onCancel: () => void;
}) {
  const [uid, setUid] = useState("");
  const [note, setNote] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(uid.trim());
    if (Number.isInteger(n) && n > 0) onSubmit(n, note.trim());
  };
  return (
    <form onSubmit={submit} className="mt-1 flex flex-col gap-1 px-1.5">
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what user opened
        autoFocus
        value={uid}
        onChange={(e) => setUid(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Universe ID"
        inputMode="numeric"
        className="rounded border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-1 outline-none focus:border-text-5"
      />
      <input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why pinned (optional)"
        className="rounded border border-border-1 bg-surface-1 px-2 py-1 text-xs text-text-1 outline-none focus:border-text-5"
      />
    </form>
  );
}
