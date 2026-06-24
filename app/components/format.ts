// Display formatters. All times are rendered in America/Los_Angeles.

export function fmtSeconds(sec: number | null | undefined): string {
  if (sec == null || Number.isNaN(sec)) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

// Single money renderer. Two call-site shapes, both preserved exactly:
//   • round: true  → dashboard KPI aggregates — `$1,234` (integer, no decimals)
//   • default      → customer prices — `$245` / `$12.50` (0 dp if whole, else 2 dp)
// null/NaN → "—" (only the dashboard path ever passes nullable; harmless for prices).
export function money(n: number | null | undefined, opts?: { round?: boolean }): string {
  if (n == null || Number.isNaN(n)) return "—";
  if (opts?.round) return `$${Math.round(n).toLocaleString("en-US")}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function fmtMoney(n: number | null | undefined): string {
  return money(n, { round: true });
}

export function fmtRange(r?: { low: number; high: number } | null): string | null {
  if (!r) return null;
  return `$${r.low}–$${r.high}/visit`;
}

const LA_DATETIME = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export function fmtLA(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return LA_DATETIME.format(d) + " PT";
}

export function relTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso).getTime();
  if (Number.isNaN(d)) return "";
  const diff = Math.max(0, (Date.now() - d) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function initials(name?: string, fallback?: string): string {
  if (name && name.trim().length > 0) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0]?.[0] ?? "";
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
    return (first + last).toUpperCase() || "·";
  }
  if (fallback && fallback.length > 0) {
    return fallback.slice(-2).toUpperCase();
  }
  return "·";
}
