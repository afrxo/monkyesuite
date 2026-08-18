import { toast } from "sonner";

export type ToastVariant = "info" | "error" | "success";

export function showToast(
  message: string,
  variant: ToastVariant = "info",
  duration?: number,
) {
  const defaultDuration =
    variant === "error" ? 6000 : variant === "success" ? 3000 : 1800;
  const opts = { duration: duration ?? defaultDuration };
  if (variant === "error") return toast.error(message, opts);
  if (variant === "success") return toast.success(message, opts);
  return toast(message, opts);
}

export function toastError(err: unknown, fallback = "Something went wrong.") {
  const msg = (err as { message?: string } | null)?.message || fallback;
  showToast(msg, "error");
}
