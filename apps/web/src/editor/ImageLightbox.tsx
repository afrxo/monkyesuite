// Global click-delegated image lightbox for the block editor. Clicking any
// image inside a `.bn-block-content` opens a fullscreen overlay; click outside
// or press Escape closes. Kept as a standalone hook so it lives above the
// editor tree and never interferes with BlockNote's own image toolbars.

import { useEffect, useState } from "react";

export function useImageLightbox() {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const img = target.closest(
        ".bn-block-content img, .bn-editor img",
      ) as HTMLImageElement | null;
      if (!img) return;
      // Skip UI chrome images (BlockNote icons carry data-* markers on their
      // wrapper divs; the block-content images are the actual doc content).
      if (!img.closest(".bn-block-content")) return;
      e.preventDefault();
      setSrc(img.currentSrc || img.src);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSrc(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [src]);

  if (!src) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div
      onClick={() => setSrc(null)}
      className="fixed inset-0 z-50 grid place-items-center bg-black/85 backdrop-blur-sm"
    >
      <img
        src={src}
        alt=""
        className="max-h-[calc(var(--vh)*0.92)] max-w-[calc(var(--vw)*0.92)] object-contain shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>
  );
}
