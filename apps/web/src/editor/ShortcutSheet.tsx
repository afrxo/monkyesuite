// Modal listing the editor's keyboard shortcuts. Opened via Cmd/Ctrl+/.

const rows: Array<[string, string]> = [
  ["Cmd/Ctrl+S", "Save now"],
  ["Cmd/Ctrl+/", "Toggle this sheet"],
  ["/", "Slash menu"],
  ["Cmd/Ctrl+B", "Bold"],
  ["Cmd/Ctrl+I", "Italic"],
  ["Cmd/Ctrl+E", "Inline code"],
  ["Cmd/Ctrl+Z", "Undo"],
  ["Cmd/Ctrl+Shift+Z", "Redo"],
];

export function ShortcutSheet({ onClose }: { onClose: () => void }) {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm"
    >
      <div
        // biome-ignore lint/a11y/noStaticElementInteractions: stop propagation
        onClick={(e) => e.stopPropagation()}
        className="w-[380px] rounded-lg border border-border-1 bg-surface-1 p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-1">Shortcuts</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-text-3 hover:text-text-1"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <ul className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs">
          {rows.map(([keys, label]) => (
            <li key={keys} className="contents">
              <kbd className="font-mono text-text-2">{keys}</kbd>
              <span className="text-text-3">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
