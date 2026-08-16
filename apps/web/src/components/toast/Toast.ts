export type ToastVariant = "info" | "error" | "success";

export type ToastEntry = {
  id: number;
  message: string;
  variant: ToastVariant;
  duration: number;
};

let nextId = 0;
const listeners = new Set<(t: ToastEntry) => void>();

export function showToast(
  message: string,
  variant: ToastVariant = "info",
  duration?: number,
) {
  const defaultDuration = variant === "error" ? 6000 : variant === "success" ? 3000 : 1800;
  const entry: ToastEntry = {
    id: ++nextId,
    message,
    variant,
    duration: duration ?? defaultDuration,
  };
  for (const l of listeners) l(entry);
}

// Extracts message from ApiError or generic Error, then shows as error toast.
export function toastError(err: unknown, fallback = "Something went wrong.") {
  const msg = (err as { message?: string } | null)?.message || fallback;
  showToast(msg, "error");
}

export function subscribe(fn: (t: ToastEntry) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
