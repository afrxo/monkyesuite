// Custom BlockNote block specs for callout + refEmbed.
//
// Callout: colored left border + tinted background, single inline-content
// stripe. Four variants (note/tip/warning/danger) chosen via slash menu; each
// variant has its own slash item so the menu reads "Note callout / Tip callout"
// etc. Nested block children are deferred — this is a single-line callout for
// Phase 2, matching the visual weight of a blockquote with more punch.
//
// RefEmbed: a rich card for a linked project_game. No content; the universeId
// prop drives a lookup against the project's linked games query already cached
// by the workspace shell. Users paste a roblox.com/games/:id URL and the paste
// interceptor in BlockEditor converts it to a refEmbed if the id is linked.

import { createReactBlockSpec } from "@blocknote/react";
import { Skeleton } from "../components/Skeleton";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

/* ---------------------------------- callout -------------------------------- */

const CALLOUT_VARIANTS = ["note", "tip", "warning", "danger"] as const;
type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

const CALLOUT_STYLES: Record<
  CalloutVariant,
  { border: string; bg: string; icon: string; label: string }
> = {
  note: {
    border: "#3b82f6",
    bg: "rgba(59, 130, 246, 0.08)",
    icon: "ℹ️",
    label: "Note",
  },
  tip: {
    border: "#22c55e",
    bg: "rgba(34, 197, 94, 0.08)",
    icon: "💡",
    label: "Tip",
  },
  warning: {
    border: "#f97316",
    bg: "rgba(249, 115, 22, 0.10)",
    icon: "⚠️",
    label: "Warning",
  },
  danger: {
    border: "#ef4444",
    bg: "rgba(239, 68, 68, 0.10)",
    icon: "⛔",
    label: "Danger",
  },
};

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      variant: { default: "note", values: [...CALLOUT_VARIANTS] },
    },
    content: "inline",
  },
  {
    render: ({ block, contentRef }) => {
      const variant = (block.props as { variant: CalloutVariant }).variant;
      const s = CALLOUT_STYLES[variant] ?? CALLOUT_STYLES.note;
      return (
        <div
          style={{
            borderLeft: `4px solid ${s.border}`,
            background: s.bg,
            padding: "8px 12px",
            borderRadius: 4,
            display: "flex",
            gap: 10,
            width: "100%",
          }}
        >
          <span aria-hidden style={{ lineHeight: 1.4 }}>
            {s.icon}
          </span>
          <div ref={contentRef} style={{ flex: 1, minWidth: 0 }} />
        </div>
      );
    },
  },
);

/* --------------------------------- refEmbed -------------------------------- */

export const refEmbedBlockSpec = createReactBlockSpec(
  {
    type: "refEmbed",
    propSchema: {
      universeId: { default: 0 },
      projectId: { default: "" },
    },
    content: "none",
  },
  {
    render: ({ block }) => {
      const universeId = (block.props as { universeId: number }).universeId;
      const projectId = (block.props as { projectId: string }).projectId;
      return <RefEmbedCard universeId={universeId} projectId={projectId} />;
    },
  },
);

function RefEmbedCard({
  universeId,
  projectId,
}: {
  universeId: number;
  projectId: string;
}) {
  const q = useQuery({
    queryKey: ["project-games", projectId],
    queryFn: () => api.projectGames(projectId),
    enabled: !!projectId,
  });
  const game =
    q.data?.find((g) => g.universeId === universeId) ?? null;
  if (!projectId || !universeId) {
    return (
      <div
        style={{
          border: "1px solid var(--border-1)",
          background: "var(--surface-1)",
          padding: 10,
          borderRadius: 6,
          color: "var(--text-disabled)",
          fontSize: 12,
        }}
      >
        Ref embed (missing universeId)
      </div>
    );
  }
  if (q.isPending) {
    return (
      <div
        style={{
          border: "1px solid var(--border-1)",
          background: "var(--surface-1)",
          padding: 10,
          borderRadius: 6,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <Skeleton w={34} h={34} className="rounded" />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <Skeleton w="46%" h={11} />
          <Skeleton w="28%" h={9} />
        </div>
      </div>
    );
  }
  if (!game) {
    return (
      <div
        style={{
          border: "1px solid var(--border-1)",
          background: "var(--surface-1)",
          padding: 10,
          borderRadius: 6,
          color: "var(--text-3)",
          fontSize: 12,
        }}
      >
        Universe {universeId} — not linked to this project.
      </div>
    );
  }
  return (
    <div
      style={{
        border: "1px solid var(--border-1)",
        background: "var(--surface-1)",
        padding: 10,
        borderRadius: 6,
        display: "flex",
        gap: 10,
        alignItems: "center",
        width: "100%",
      }}
    >
      {game.iconUrl ? (
        // biome-ignore lint/a11y/useAltText: decorative
        <img
          src={game.iconUrl}
          alt=""
          style={{ width: 32, height: 32, borderRadius: 4, flexShrink: 0 }}
        />
      ) : (
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 4,
            background: "var(--surface-2, rgba(255,255,255,0.06))",
            flexShrink: 0,
          }}
        />
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            color: "var(--text-1)",
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {game.name}
        </div>
        {game.note ? (
          <div
            style={{
              color: "var(--text-3)",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {game.note}
          </div>
        ) : null}
      </div>
      <a
        href={`https://www.roblox.com/games/${universeId}`}
        target="_blank"
        rel="noreferrer"
        style={{
          color: "var(--accent-warm)",
          fontSize: 11,
          textDecoration: "underline",
          flexShrink: 0,
        }}
      >
        open
      </a>
    </div>
  );
}

/* ---------------------------- roblox URL detection ------------------------- */

const ROBLOX_URL = /^https?:\/\/(?:www\.)?roblox\.com\/games\/(\d+)/i;
export function extractRobloxUniverseId(url: string): number | null {
  const m = url.trim().match(ROBLOX_URL);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}
