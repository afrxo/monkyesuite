// Floating table of contents. Renders when the document has 3+ headings.
// Placement: fixed to the right side of the editor column. Fades in on scroll,
// out on inactivity — kept simple: opacity toggle via mouse+scroll listeners.

import { useEffect, useMemo, useState } from "react";

// Structural block shape — accepts any BlockNote schema variant, we only touch
// `type`, `id`, `props.level`, `content`, and `children`.
type AnyBlock = {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  content?: unknown;
  children?: AnyBlock[];
};

type Item = { id: string; text: string; level: number };

function inlineText(content: unknown): string {
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const n of content as { type?: string; text?: string; content?: unknown }[]) {
    if (n.type === "text" && typeof n.text === "string") out += n.text;
    else if (n.type === "link") out += inlineText(n.content);
  }
  return out;
}

export function DocOutline({ blocks }: { blocks: AnyBlock[] }) {
  const headings = useMemo<Item[]>(() => {
    const list: Item[] = [];
    const walk = (nodes: AnyBlock[]) => {
      for (const b of nodes) {
        if (b.type === "heading") {
          const level = ((b.props as { level?: number }).level ?? 1) as number;
          const text = inlineText(b.content);
          if (text.trim()) list.push({ id: b.id, text, level });
        }
        if (b.children?.length) walk(b.children as AnyBlock[]);
      }
    };
    walk(blocks);
    return list;
  }, [blocks]);

  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (headings.length < 3) return;
    const els = headings
      .map((h) => document.querySelector<HTMLElement>(`[data-id="${h.id}"]`))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = (e.target as HTMLElement).getAttribute("data-id");
            if (id) setActiveId(id);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
    );
    for (const el of els) obs.observe(el);
    return () => obs.disconnect();
  }, [headings]);

  if (headings.length < 3) return null;

  return (
    <nav
      aria-label="On this page"
      className="pointer-events-auto absolute right-6 top-16 hidden w-[180px] xl:block"
    >
      <ul className="flex flex-col gap-1 border-l border-border-1 py-1 pl-3 text-[11px]">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              onClick={(e) => {
                e.preventDefault();
                document
                  .querySelector(`[data-id="${h.id}"]`)
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
                setActiveId(h.id);
              }}
              className={`block truncate transition-colors ${
                activeId === h.id ? "text-text-1" : "text-text-3 hover:text-text-2"
              }`}
              style={{ paddingLeft: `${(h.level - 1) * 10}px` }}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
