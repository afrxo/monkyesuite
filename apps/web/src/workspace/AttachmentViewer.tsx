// Modal-over-modal viewer for card attachments. Renders inline by mime type:
// image (zoom + pan), video/audio (native controls), code/text/markdown, pdf
// (iframe), everything else → badge + download. Fetch is lazy; large files gate
// on user consent. `←`/`→` cycles through the card's other attachments.

import type { TaskAttachment } from "@monkyesuite/shared";
import { marked } from "marked";
import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogOverlay,
  DialogPortal,
} from "../components/ui/dialog";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Skeleton } from "../components/Skeleton";
import { api } from "../lib/api";

type Props = {
  attachments: TaskAttachment[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
};

const LARGE_IMAGE = 15 * 1024 * 1024;
const LARGE_VIDEO = 50 * 1024 * 1024;
const LARGE_CODE = 500 * 1024;

export function AttachmentViewer({
  attachments,
  index,
  onIndex,
  onClose,
}: Props) {
  const current = attachments[index];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" && attachments.length > 1) {
        onIndex((index - 1 + attachments.length) % attachments.length);
      }
      if (e.key === "ArrowRight" && attachments.length > 1) {
        onIndex((index + 1) % attachments.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [attachments.length, index, onIndex]);

  if (!current) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPortal>
        <DialogOverlay className="z-[60] bg-black/80" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed top-[50%] left-[50%] z-[60] flex max-h-[90vh] w-full max-w-[90vw] translate-x-[-50%] translate-y-[-50%] flex-col overflow-hidden rounded-lg border border-border-2 bg-surface-0 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <DialogPrimitive.Title className="sr-only">
            {current.fileName}
          </DialogPrimitive.Title>
          <ViewerHeader
            attachment={current}
            onClose={onClose}
            hasNav={attachments.length > 1}
          />
          <div className="grid flex-1 place-items-center overflow-auto bg-black/40">
            <Renderer attachment={current} />
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

function ViewerHeader({
  attachment,
  onClose,
  hasNav,
}: {
  attachment: TaskAttachment;
  onClose: () => void;
  hasNav: boolean;
}) {
  const download = async () => {
    const t = await api.attachmentViewUrl(attachment.id);
    // Open in new tab so download attributes on cross-origin R2 work; the
    // presigned URL includes content-disposition that R2 doesn't force, so
    // this is the safest cross-browser path.
    window.open(t.url, "_blank");
  };
  return (
    <div className="flex items-center gap-2 border-b border-border-1 px-4 py-2.5">
      <span className="font-mono text-[12px] text-text-1">
        {attachment.fileName}
      </span>
      <span className="font-mono text-[10px] text-text-disabled">
        · {fmtBytes(attachment.sizeBytes)}
      </span>
      {hasNav ? (
        <span className="font-mono text-[10px] text-text-disabled">
          · ← → to cycle
        </span>
      ) : null}
      <div className="flex-1" />
      <button
        type="button"
        onClick={download}
        className="rounded-[3px] border border-border-2 px-2 py-1 text-[11px] text-text-3 hover:text-text-1"
      >
        Download
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close viewer"
        className="rounded-[3px] px-1.5 py-1 text-[13px] leading-none text-text-disabled hover:bg-surface-hover hover:text-text-1"
      >
        ✕
      </button>
    </div>
  );
}

function Renderer({ attachment }: { attachment: TaskAttachment }) {
  const kind = kindOf(attachment.mimeType, attachment.fileName);
  const gate = largeGate(kind, attachment.sizeBytes);
  const [allowed, setAllowed] = useState(!gate);
  const [urlState, setUrlState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; url: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [showRendered, setShowRendered] = useState(true);
  const [textBody, setTextBody] = useState<string | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let cancelled = false;
    setUrlState({ status: "loading" });
    (async () => {
      try {
        const t = await api.attachmentViewUrl(attachment.id);
        if (cancelled) return;
        setUrlState({ status: "ready", url: t.url });
        if (kind === "code" || kind === "markdown") {
          const res = await fetch(t.url);
          if (!res.ok) throw new Error(`Fetch ${res.status}`);
          const body = await res.text();
          if (!cancelled) setTextBody(body);
        }
      } catch (err) {
        if (!cancelled)
          setUrlState({
            status: "error",
            message: err instanceof Error ? err.message : "Load failed.",
          });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attachment.id, allowed, kind]);

  if (!allowed) {
    return (
      <div className="grid place-items-center gap-3 p-10 text-center">
        <div className="text-[12px] text-text-3">
          Large file — {fmtBytes(attachment.sizeBytes)}. Load anyway?
        </div>
        <button
          type="button"
          onClick={() => setAllowed(true)}
          className="rounded border border-border-2 px-3 py-1 text-[11px] text-text-1 hover:bg-surface-hover"
        >
          Load {attachment.fileName}
        </button>
      </div>
    );
  }

  if (urlState.status === "loading" || urlState.status === "idle") {
    // The viewer frame is already open at this point — a shaped block keeps
    // its box the same size the media will occupy instead of collapsing it.
    return (
      <div className="grid place-items-center p-10">
        <Skeleton w="min(560px, 100%)" h={320} className="rounded-md" />
      </div>
    );
  }
  if (urlState.status === "error") {
    return (
      <div className="grid place-items-center gap-2 p-10 text-center">
        <div className="text-[12px] text-destructive">
          Couldn't load {attachment.fileName}
        </div>
        <div className="font-mono text-[10px] text-text-disabled">
          {urlState.message}
        </div>
        <button
          type="button"
          onClick={() => {
            setAllowed(false);
            setAllowed(true);
          }}
          className="mt-1 rounded border border-border-2 px-2 py-1 text-[11px] text-text-3"
        >
          Retry
        </button>
      </div>
    );
  }

  const url = urlState.url;

  if (kind === "image") {
    return <ZoomImage url={url} name={attachment.fileName} />;
  }
  if (kind === "video") {
    return (
      // biome-ignore lint/a11y/useMediaCaption: user uploaded, no captions available
      <video src={url} controls className="max-h-[80vh] max-w-full" />
    );
  }
  if (kind === "audio") {
    return (
      <div className="p-8">
        {/* biome-ignore lint/a11y/useMediaCaption: user uploaded, no captions available */}
        <audio src={url} controls />
      </div>
    );
  }
  if (kind === "pdf") {
    return (
      <iframe
        src={url}
        title={attachment.fileName}
        className="h-[80vh] w-[80vw] bg-white"
      />
    );
  }
  if (kind === "markdown") {
    return (
      <MarkdownView
        body={textBody ?? ""}
        showRendered={showRendered}
        onToggle={() => setShowRendered((v) => !v)}
      />
    );
  }
  if (kind === "code") {
    return (
      <pre className="max-h-[80vh] w-[80vw] overflow-auto bg-surface-0 p-4 font-mono text-[12px] leading-[1.55] text-text-2">
        <code>{textBody ?? ""}</code>
      </pre>
    );
  }
  return <FallbackDownload url={url} attachment={attachment} />;
}

function ZoomImage({ url, name }: { url: string; name: string }) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.max(0.25, Math.min(6, zoom + (e.deltaY < 0 ? 0.2 : -0.2)));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: image pan/zoom viewport
    <div
      onWheel={onWheel}
      onMouseDown={(e) =>
        zoom > 1 ? setDrag({ x: e.clientX - pan.x, y: e.clientY - pan.y }) : null
      }
      onMouseMove={(e) =>
        drag ? setPan({ x: e.clientX - drag.x, y: e.clientY - drag.y }) : null
      }
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
      onDoubleClick={() => {
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }}
      className="grid h-full w-full place-items-center overflow-hidden"
      style={{ cursor: zoom > 1 ? (drag ? "grabbing" : "grab") : "zoom-in" }}
    >
      <img
        src={url}
        alt={name}
        draggable={false}
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transition: drag ? "none" : "transform 120ms ease",
        }}
        className="max-h-[80vh] max-w-[80vw] object-contain select-none"
      />
    </div>
  );
}

function MarkdownView({
  body,
  showRendered,
  onToggle,
}: {
  body: string;
  showRendered: boolean;
  onToggle: () => void;
}) {
  const html = useMemo(() => marked.parse(body) as string, [body]);
  return (
    <div className="flex h-[80vh] w-[80vw] flex-col">
      <div className="flex items-center justify-end border-b border-border-1 px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          className="rounded-[3px] border border-border-2 px-2 py-0.5 text-[10px] text-text-3"
        >
          {showRendered ? "Show source" : "Show rendered"}
        </button>
      </div>
      {showRendered ? (
        <div
          className="prose-invert flex-1 overflow-auto p-6 text-[13px] text-text-2"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: same-origin markdown
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="flex-1 overflow-auto bg-surface-0 p-4 font-mono text-[12px] text-text-2">
          <code>{body}</code>
        </pre>
      )}
    </div>
  );
}

function FallbackDownload({
  url,
  attachment,
}: {
  url: string;
  attachment: TaskAttachment;
}) {
  return (
    <div className="grid place-items-center gap-3 p-10 text-center">
      <div className="grid h-16 w-16 place-items-center rounded bg-surface-hover font-mono text-[14px] font-semibold text-text-3">
        {mimeExt(attachment.fileName)}
      </div>
      <div className="text-[13px] text-text-1">{attachment.fileName}</div>
      <div className="font-mono text-[11px] text-text-disabled">
        {fmtBytes(attachment.sizeBytes)}
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="rounded border border-border-2 bg-surface-1 px-3 py-1 text-[11px] text-text-1 hover:bg-surface-hover"
      >
        Download
      </a>
    </div>
  );
}

/* --------------------------------- helpers -------------------------------- */

type Kind =
  | "image"
  | "video"
  | "audio"
  | "pdf"
  | "code"
  | "markdown"
  | "other";

function kindOf(mime: string, name: string): Kind {
  const ext = mimeExt(name).toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (["md", "markdown"].includes(ext)) return "markdown";
  if (
    [
      "lua",
      "luau",
      "js",
      "jsx",
      "ts",
      "tsx",
      "json",
      "txt",
      "yml",
      "yaml",
      "toml",
      "css",
      "html",
      "sh",
    ].includes(ext)
  )
    return "code";
  return "other";
}

function largeGate(kind: Kind, bytes: number): boolean {
  if (kind === "image") return bytes > LARGE_IMAGE;
  if (kind === "video") return bytes > LARGE_VIDEO;
  if (kind === "code" || kind === "markdown") return bytes > LARGE_CODE;
  return false;
}

function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function mimeExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1) : "FILE";
}
