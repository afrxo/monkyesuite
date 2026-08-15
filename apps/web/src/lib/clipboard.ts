import { showToast } from "#/components/Toast";

export async function copyLink(url: string) {
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied");
  } catch {
    showToast("Copy failed");
  }
}

export async function copyGameLink(id: number) {
  const url = `${window.location.origin}/games/${id}`;
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied");
  } catch {
    showToast("Copy failed");
  }
}
