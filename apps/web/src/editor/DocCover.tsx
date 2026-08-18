// Cover-image banner above the doc title. Click empty state → file picker →
// presigned PUT to R2 → doc meta patch. When set: hover reveals Replace / Remove.

import { useRef, useState } from "react";
import { toastError } from "../components/Toast";
import { api } from "../lib/api";

const MAX_BYTES = 10 * 1024 * 1024;

export function DocCover({
  docId,
  url,
  onChange,
}: {
  docId: string;
  url: string | null;
  onChange: (next: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const pickFile = () => inputRef.current?.click();

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toastError(new Error("Cover image must be under 10MB."));
      return;
    }
    setUploading(true);
    try {
      const { uploadUrl, publicUrl } = await api.docMediaUpload(docId, {
        fileName: file.name,
        mimeType: file.type,
      });
      const put = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type },
        body: file,
      });
      if (!put.ok) throw new Error(`Upload failed: ${put.status}`);
      onChange(publicUrl);
    } catch (err) {
      toastError(err, "Cover upload failed.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mb-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = "";
        }}
      />
      {url ? (
        <div className="group relative -mx-6 h-[200px] overflow-hidden md:-mx-12">
          <img
            src={url}
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
          />
          <div className="absolute right-3 top-3 flex gap-1 opacity-0 transition group-hover:opacity-100">
            <button
              type="button"
              onClick={pickFile}
              className="rounded bg-black/60 px-2 py-1 text-[11px] text-white backdrop-blur hover:bg-black/80"
            >
              {uploading ? "…" : "Replace"}
            </button>
            <button
              type="button"
              onClick={() => onChange(null)}
              className="rounded bg-black/60 px-2 py-1 text-[11px] text-white backdrop-blur hover:bg-black/80"
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={pickFile}
          className="rounded px-1.5 py-0.5 text-[11px] text-text-disabled hover:bg-white/[0.05] hover:text-text-1"
        >
          {uploading ? "uploading…" : "+ cover"}
        </button>
      )}
    </div>
  );
}
