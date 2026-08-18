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
  DocFolder,
  Milestone,
  ProjectGame,
} from "@monkyesuite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { Icon } from "../components/Icon";
import { toastError } from "../components/Toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { api } from "../lib/api";
import { milestoneColor } from "./milestone-color";

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
    <aside className="no-scrollbar col-start-1 overflow-y-auto border-r border-border-1 px-3 py-4">
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
      <span className="grid h-4 w-4 shrink-0 place-items-center text-xs text-text-disabled">
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
  return (
    <div
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
        <span className="grid h-4 w-4 shrink-0 place-items-center text-xs text-text-disabled">
          {glyph}
        </span>
        <span className="truncate">{children}</span>
      </button>
      {count !== undefined && !open ? (
        <span className="font-mono text-[11px] text-text-disabled group-hover:hidden">
          {count}
        </span>
      ) : null}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          aria-label="Actions"
          className={`grid h-5 w-5 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors ${
            open ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          <Icon name="more" size={12} />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={4}
          className="w-32 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg"
        >
          <DropdownMenuItem
            onSelect={onDelete}
            className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05] transition-colors focus:bg-white/[0.05] focus:text-destructive"
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
              className={`inline-block h-1.5 w-1.5 rounded-full ${milestoneColor(m.id).dot}`}
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
  const qc = useQueryClient();
  const docs = useQuery({
    queryKey: ["docs", projectId],
    queryFn: () => api.docs(projectId),
  });
  const folders = useQuery({
    queryKey: ["doc-folders", projectId],
    queryFn: () => api.docFolders(projectId),
  });
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["docs", projectId] });
    qc.invalidateQueries({ queryKey: ["doc-folders", projectId] });
  };

  const [addOpen, setAddOpen] = useState<"none" | "menu" | "folder">("none");
  const [drag, setDrag] = useState<
    { kind: "doc" | "folder"; id: string } | null
  >(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    if (typeof window === "undefined") return {};
    try {
      return JSON.parse(
        localStorage.getItem(`docFolders:collapsed:${projectId}`) ?? "{}",
      ) as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(
      `docFolders:collapsed:${projectId}`,
      JSON.stringify(collapsed),
    );
  }, [collapsed, projectId]);

  const createFolder = useMutation({
    mutationFn: (name: string) => api.createDocFolder(projectId, { name }),
    onSuccess: () => {
      invalidate();
      setAddOpen("none");
    },
    onError: (err) => toastError(err),
  });
  const patchDoc = useMutation({
    mutationFn: (v: {
      id: string;
      folderId?: string | null;
      prevId?: string | null;
      nextId?: string | null;
    }) => {
      const { id, ...rest } = v;
      return api.patchDoc(id, rest);
    },
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["docs", projectId] });
      const prev = qc.getQueryData<Doc[]>(["docs", projectId]);
      if (!prev) return { prev };
      const moving = prev.find((d) => d.id === v.id);
      if (!moving) return { prev };
      const targetFolder =
        v.folderId === undefined ? moving.folderId : v.folderId;
      const others = prev.filter((d) => d.id !== v.id);
      const destSiblings = others.filter((d) => d.folderId === targetFolder);
      let insertAt: number;
      if (v.nextId) {
        const nextSibling = destSiblings.find((d) => d.id === v.nextId);
        insertAt = nextSibling
          ? others.indexOf(nextSibling)
          : others.length;
      } else if (v.prevId) {
        const prevSibling = destSiblings.find((d) => d.id === v.prevId);
        insertAt = prevSibling ? others.indexOf(prevSibling) + 1 : others.length;
      } else {
        // append to end of destination folder
        const lastInDest = destSiblings[destSiblings.length - 1];
        insertAt = lastInDest ? others.indexOf(lastInDest) + 1 : others.length;
      }
      const next = [...others];
      next.splice(insertAt, 0, { ...moving, folderId: targetFolder });
      qc.setQueryData<Doc[]>(["docs", projectId], next);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["docs", projectId], ctx.prev);
      invalidate();
      toastError(err);
    },
  });
  const renameDoc = useMutation({
    mutationFn: (v: { id: string; title: string }) =>
      api.patchDoc(v.id, { title: v.title }),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });
  const deleteDoc = useMutation({
    mutationFn: (id: string) => api.deleteDoc(id),
    onSuccess: (_, id) => {
      invalidate();
      if (activeId === id) onSelect(null);
    },
    onError: (err) => toastError(err),
  });
  const renameFolder = useMutation({
    mutationFn: (v: { id: string; name: string }) =>
      api.patchDocFolder(v.id, { name: v.name }),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });
  const moveFolder = useMutation({
    mutationFn: (v: { id: string; prevId: string | null; nextId: string | null }) =>
      api.patchDocFolder(v.id, { prevId: v.prevId, nextId: v.nextId }),
    onMutate: async (v) => {
      await qc.cancelQueries({ queryKey: ["doc-folders", projectId] });
      const prev = qc.getQueryData<DocFolder[]>(["doc-folders", projectId]);
      if (!prev) return { prev };
      const moving = prev.find((f) => f.id === v.id);
      if (!moving) return { prev };
      const others = prev.filter((f) => f.id !== v.id);
      let insertAt: number;
      if (v.nextId) {
        const i = others.findIndex((f) => f.id === v.nextId);
        insertAt = i < 0 ? others.length : i;
      } else if (v.prevId) {
        const i = others.findIndex((f) => f.id === v.prevId);
        insertAt = i < 0 ? others.length : i + 1;
      } else {
        insertAt = others.length;
      }
      const next = [...others];
      next.splice(insertAt, 0, moving);
      qc.setQueryData<DocFolder[]>(["doc-folders", projectId], next);
      return { prev };
    },
    onError: (err, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(["doc-folders", projectId], ctx.prev);
      invalidate();
      toastError(err);
    },
  });
  const deleteFolder = useMutation({
    mutationFn: (id: string) => api.deleteDocFolder(id),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });

  const allDocs: Doc[] = docs.data ?? [];
  const allFolders: DocFolder[] = folders.data ?? [];
  const docsByFolder = new Map<string | null, Doc[]>();
  for (const d of allDocs) {
    const k = d.folderId ?? null;
    const list = docsByFolder.get(k) ?? [];
    list.push(d);
    docsByFolder.set(k, list);
  }
  const rootDocs = docsByFolder.get(null) ?? [];

  const onDropInto = (
    folderId: string | null,
    beforeId: string | null,
  ) => {
    if (!drag || drag.kind !== "doc") return;
    const dest = (docsByFolder.get(folderId) ?? []).filter(
      (d) => d.id !== drag.id,
    );
    const idx = beforeId ? dest.findIndex((d) => d.id === beforeId) : dest.length;
    const prevId = idx > 0 ? (dest[idx - 1]?.id ?? null) : null;
    const nextId = idx < dest.length ? (dest[idx]?.id ?? null) : null;
    const current = allDocs.find((d) => d.id === drag.id);
    const currentFolder = current?.folderId ?? null;
    if (currentFolder === folderId) {
      patchDoc.mutate({ id: drag.id, prevId, nextId });
    } else {
      patchDoc.mutate({ id: drag.id, folderId, prevId, nextId });
    }
    setDrag(null);
  };

  const onDropFolderBefore = (beforeId: string | null) => {
    if (!drag || drag.kind !== "folder") return;
    const list = allFolders.filter((f) => f.id !== drag.id);
    const idx = beforeId ? list.findIndex((f) => f.id === beforeId) : list.length;
    const prevId = idx > 0 ? (list[idx - 1]?.id ?? null) : null;
    const nextId = idx < list.length ? (list[idx]?.id ?? null) : null;
    moveFolder.mutate({ id: drag.id, prevId, nextId });
    setDrag(null);
  };

  return (
    <section className="ws-section mb-5">
      <SectionHead label="Docs" onAdd={() => setAddOpen("menu")} />
      {addOpen === "menu" ? (
        <div className="mx-1.5 mb-1 flex gap-1 rounded border border-border-1 bg-surface-1 p-1">
          <button
            type="button"
            onClick={() => {
              setAddOpen("none");
              onCreate();
            }}
            className="flex-1 rounded px-2 py-1 text-left text-xs text-text-3 hover:bg-white/[0.05] hover:text-text-1"
          >
            + Doc
          </button>
          <button
            type="button"
            onClick={() => setAddOpen("folder")}
            className="flex-1 rounded px-2 py-1 text-left text-xs text-text-3 hover:bg-white/[0.05] hover:text-text-1"
          >
            + Folder
          </button>
        </div>
      ) : null}
      {addOpen === "folder" ? (
        <InlineForm
          placeholder="Folder name"
          onSubmit={(name) => createFolder.mutate(name)}
          onCancel={() => setAddOpen("none")}
        />
      ) : null}

      {allFolders.map((f) => {
        const folderDocs = docsByFolder.get(f.id) ?? [];
        const isCollapsed = !!collapsed[f.id];
        return (
          <FolderRow
            key={f.id}
            folder={f}
            collapsed={isCollapsed}
            docCount={folderDocs.length}
            dragKind={drag?.kind ?? null}
            onToggle={() =>
              setCollapsed((c) => ({ ...c, [f.id]: !c[f.id] }))
            }
            onRename={(name) => renameFolder.mutate({ id: f.id, name })}
            onDelete={() => {
              if (
                confirm(
                  `Delete folder "${f.name}"? Docs inside float back to the root.`,
                )
              )
                deleteFolder.mutate(f.id);
            }}
            onDropDoc={() => onDropInto(f.id, null)}
            onDragStart={() => setDrag({ kind: "folder", id: f.id })}
            onDropFolderBefore={() => onDropFolderBefore(f.id)}
          >
            {!isCollapsed &&
              folderDocs.map((d) => (
                <DocRow
                  key={d.id}
                  doc={d}
                  active={d.id === activeId}
                  indent
                  onClick={() =>
                    onSelect(d.id === activeId ? null : d.id)
                  }
                  onDragStart={() => setDrag({ kind: "doc", id: d.id })}
                  onDropBefore={() => onDropInto(f.id, d.id)}
                  onRename={(title) =>
                    renameDoc.mutate({ id: d.id, title })
                  }
                  onDelete={() => {
                    if (confirm(`Delete doc "${d.title}"?`))
                      deleteDoc.mutate(d.id);
                  }}
                />
              ))}
          </FolderRow>
        );
      })}

      {drag?.kind === "folder" && allFolders.length > 0 ? (
        <FolderTailDrop onDrop={() => onDropFolderBefore(null)} />
      ) : null}

      {/* Root-level docs (below folders). Doubles as a drop zone. */}
      <RootDropZone onDrop={() => onDropInto(null, null)}>
        {rootDocs.map((d) => (
          <DocRow
            key={d.id}
            doc={d}
            active={d.id === activeId}
            onClick={() => onSelect(d.id === activeId ? null : d.id)}
            onDragStart={() => setDrag({ kind: "doc", id: d.id })}
            onDropBefore={() => onDropInto(null, d.id)}
            onRename={(title) => renameDoc.mutate({ id: d.id, title })}
            onDelete={() => {
              if (confirm(`Delete doc "${d.title}"?`)) deleteDoc.mutate(d.id);
            }}
          />
        ))}
      </RootDropZone>
    </section>
  );
}

function FolderRow({
  folder,
  collapsed,
  docCount,
  dragKind,
  onToggle,
  onRename,
  onDelete,
  onDropDoc,
  onDragStart,
  onDropFolderBefore,
  children,
}: {
  folder: DocFolder;
  collapsed: boolean;
  docCount: number;
  dragKind: "doc" | "folder" | null;
  onToggle: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDropDoc: () => void;
  onDragStart: () => void;
  onDropFolderBefore: () => void;
  children?: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState<"none" | "doc" | "folder">("none");
  const draggedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    <div>
      <div
        ref={wrapRef}
        draggable={!editing}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          draggedRef.current = true;
          onDragStart();
        }}
        onDragEnd={() => {
          setTimeout(() => {
            draggedRef.current = false;
          }, 0);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (dragKind === "folder") {
            setOver("folder");
          } else if (dragKind === "doc") {
            setOver("doc");
          }
        }}
        onDragLeave={() => setOver("none")}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (over === "folder") onDropFolderBefore();
          else if (over === "doc") onDropDoc();
          setOver("none");
        }}
        className={`group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm text-text-3 transition-colors hover:bg-white/[0.04] hover:text-text-1 ${over === "doc" ? "ring-1 ring-inset ring-accent-warm" : ""} ${over === "folder" ? "border-t border-accent-warm" : ""}`}
      >
        {editing ? (
          <InlineForm
            placeholder={folder.name}
            onSubmit={(v) => {
              onRename(v);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                if (draggedRef.current) return;
                onToggle();
              }}
              className="flex flex-1 items-center gap-2 truncate text-left"
            >
              <span className="grid h-4 w-4 shrink-0 place-items-center text-text-disabled">
                <Icon
                  name="chevron-down"
                  size={10}
                  className={`transition-transform ${collapsed ? "-rotate-90" : ""}`}
                />
              </span>
              <span className="truncate font-medium">{folder.name}</span>
            </button>
            <span className="font-mono text-[11px] text-text-disabled group-hover:hidden">
              {docCount}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-label="Actions"
              className={`grid h-5 w-5 shrink-0 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors ${
                menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
              }`}
            >
              <Icon name="more" size={12} />
            </button>
          </>
        )}
        {menuOpen ? (
          <div className="absolute right-0 top-7 z-10 w-32 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setEditing(true);
              }}
              className="block w-full px-3 py-2 text-left text-xs text-text-3 hover:bg-white/[0.05]"
            >
              Rename
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05]"
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function DocRow({
  doc,
  active,
  indent,
  onClick,
  onDragStart,
  onDropBefore,
  onRename,
  onDelete,
}: {
  doc: Doc;
  active: boolean;
  indent?: boolean;
  onClick: () => void;
  onDragStart: () => void;
  onDropBefore: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [over, setOver] = useState(false);
  const draggedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: HTML5 draggable row
    <div
      ref={wrapRef}
      draggable={!editing}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        draggedRef.current = true;
        onDragStart();
      }}
      onDragEnd={() => {
        setTimeout(() => {
          draggedRef.current = false;
        }, 0);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        onDropBefore();
      }}
      className={`group relative flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors ${
        active
          ? "bg-white/[0.05] text-text-1"
          : "text-text-3 hover:bg-white/[0.04] hover:text-text-1"
      } ${over ? "border-t border-accent-warm" : ""} ${indent ? "pl-6" : ""}`}
    >
      {editing ? (
        <InlineForm
          placeholder={doc.title}
          onSubmit={(v) => {
            onRename(v);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <button
            type="button"
            onClick={() => {
              if (draggedRef.current) return;
              onClick();
            }}
            className="flex flex-1 items-center gap-2 truncate text-left"
          >
            <span className="grid h-4 w-4 shrink-0 place-items-center text-text-disabled">
              <Icon name="doc" size={13} />
            </span>
            <span className="truncate">{doc.title || "Untitled"}</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
            aria-label="Actions"
            className={`grid h-5 w-5 shrink-0 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors ${
              menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
            }`}
          >
            <Icon name="more" size={12} />
          </button>
        </>
      )}
      {menuOpen ? (
        <div className="absolute right-0 top-7 z-10 w-32 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              setEditing(true);
            }}
            className="block w-full px-3 py-2 text-left text-xs text-text-3 hover:bg-white/[0.05]"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onDelete();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05]"
          >
            Delete
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FolderTailDrop({ onDrop }: { onDrop: () => void }) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!over) return;
    const clear = () => setOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [over]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`mx-2 h-1.5 rounded ${over ? "bg-accent-warm/60" : ""}`}
    />
  );
}

function RootDropZone({
  onDrop,
  children,
}: {
  onDrop: () => void;
  children: React.ReactNode;
}) {
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!over) return;
    const clear = () => setOver(false);
    window.addEventListener("dragend", clear);
    window.addEventListener("drop", clear);
    return () => {
      window.removeEventListener("dragend", clear);
      window.removeEventListener("drop", clear);
    };
  }, [over]);
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drop target
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onDrop();
      }}
      className={`min-h-[8px] rounded ${over ? "bg-white/[0.03]" : ""}`}
    >
      {children}
    </div>
  );
}

function RefSection({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const games = useQuery({
    queryKey: ["project-games", projectId],
    queryFn: () => api.projectGames(projectId),
  });
  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["project-games", projectId] });
  const link = useMutation({
    mutationFn: (input: CreateProjectGameInput) =>
      api.linkGame(projectId, input),
    onSuccess: () => {
      invalidate();
      setOpen(false);
    },
    onError: (err) => toastError(err),
  });
  const unlink = useMutation({
    mutationFn: (universeId: number) => api.unlinkGame(projectId, universeId),
    onSuccess: invalidate,
    onError: (err) => toastError(err),
  });

  return (
    <section className="ws-section mb-5">
      <SectionHead label="Refs" onAdd={() => setOpen((v) => !v)} />
      {games.data?.map((g: ProjectGame) => (
        <RefRow
          key={g.universeId}
          game={g}
          onEditNote={(note) =>
            link.mutate({ universeId: g.universeId, note: note || undefined })
          }
          onUnlink={() => {
            if (confirm(`Unpin “${g.name}” from this project?`))
              unlink.mutate(g.universeId);
          }}
        />
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

function RefRow({
  game,
  onEditNote,
  onUnlink,
}: {
  game: ProjectGame;
  onEditNote: (note: string) => void;
  onUnlink: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setMenuOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);
  return (
    <div
      ref={wrapRef}
      className="group relative flex w-full items-start gap-2 rounded px-2 py-1.5 text-sm text-text-3 hover:bg-white/[0.04] hover:text-text-1 transition-colors"
    >
      <Link
        to="/games/$id"
        params={{ id: String(game.universeId) }}
        className="flex min-w-0 flex-1 items-start gap-2"
      >
        {game.iconUrl ? (
          <img
            src={game.iconUrl}
            alt=""
            className="mt-0.5 h-4 w-4 shrink-0 rounded-sm object-cover"
          />
        ) : (
          <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-sm bg-white/[0.06] text-[10px] font-bold text-text-1">
            {game.name.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{game.name}</span>
          {editing ? null : game.note ? (
            <span className="mt-0.5 line-clamp-2 text-[11px] leading-[1.35] text-text-disabled">
              {game.note}
            </span>
          ) : null}
        </span>
      </Link>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenuOpen((v) => !v);
        }}
        aria-label="Actions"
        className={`grid h-5 w-5 shrink-0 place-items-center rounded text-text-disabled hover:bg-white/[0.06] hover:text-text-1 transition-colors ${
          menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
        }`}
      >
        <Icon name="more" size={12} />
      </button>
      {menuOpen ? (
        <div className="absolute right-1 top-7 z-10 w-32 overflow-hidden rounded-md border border-border-1 bg-surface-1 py-1 shadow-lg">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              setEditing(true);
            }}
            className="block w-full px-3 py-2 text-left text-xs text-text-3 hover:bg-white/[0.05] transition-colors"
          >
            Edit note
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(false);
              onUnlink();
            }}
            className="block w-full px-3 py-2 text-left text-xs text-destructive hover:bg-white/[0.05] transition-colors"
          >
            Unpin
          </button>
        </div>
      ) : null}
      {editing ? (
        <div className="absolute inset-x-2 top-full z-10 mt-1">
          <RefNoteEditor
            initial={game.note ?? ""}
            onSubmit={(v) => {
              onEditNote(v);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        </div>
      ) : null}
    </div>
  );
}

function RefNoteEditor({
  initial,
  onSubmit,
  onCancel,
}: {
  initial: string;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [v, setV] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v.trim());
      }}
      className="flex flex-col gap-1 rounded-md border border-border-1 bg-surface-1 p-1.5 shadow-lg"
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: focus what user opened
        autoFocus
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onCancel()}
        placeholder="Why pinned"
        className="rounded border border-border-1 bg-surface-0 px-2 py-1 text-xs text-text-1 outline-none focus:border-text-5"
      />
      <div className="flex gap-1">
        <button
          type="submit"
          className="rounded bg-text-1 px-2 py-0.5 text-[10px] font-medium text-surface-0"
        >
          Save
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded px-2 py-0.5 text-[10px] text-text-3 hover:bg-white/[0.05]"
        >
          Cancel
        </button>
      </div>
    </form>
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
