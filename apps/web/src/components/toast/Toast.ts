type ToastEntry = { id: number; message: string };

let nextId = 0;
const listeners = new Set<(t: ToastEntry) => void>();

export type { ToastEntry };

export function showToast(message: string) {
  const entry: ToastEntry = { id: ++nextId, message };
  for (const l of listeners) l(entry);
}

export function subscribe(fn: (t: ToastEntry) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
