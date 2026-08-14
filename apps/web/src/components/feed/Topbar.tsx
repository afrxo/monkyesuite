import AppHeader from "#/components/AppHeader";
import type { JobHealthRecord } from "#/lib/system-health";

export default function Topbar({
  liveSince,
  now,
  jobHealth,
  onSearchOpen,
}: {
  liveSince: number;
  now: number;
  jobHealth: Record<string, JobHealthRecord>;
  onSearchOpen: () => void;
}) {
  return (
    <AppHeader
      activeRoute="pulse"
      onSearchOpen={onSearchOpen}
      live={{ liveSince, now, jobHealth }}
    />
  );
}
