// Thin adapter over the shared DatePicker (workspace/DatePicker.tsx — the
// same control the card panel uses for due date) so Finances dates look and
// behave identically. Finance dates are YYYY-MM-DD and always required, so
// "Clear" falls back to today instead of null.

import { DatePicker } from "../DatePicker";

function toIso(dateOnly: string): string {
  const [y, m, d] = dateOnly.split("-").map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1)).toISOString();
}

function toDateOnly(iso: string): string {
  return iso.slice(0, 10);
}

export function FinanceDatePicker({
  value,
  onChange,
  title,
}: {
  value: string;
  onChange: (dateOnly: string) => void;
  title?: string;
}) {
  return (
    <DatePicker
      value={toIso(value)}
      onChange={(iso) => onChange(toDateOnly(iso ?? toIso(value)))}
      title={title}
    />
  );
}
