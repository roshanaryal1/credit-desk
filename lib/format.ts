// Display formatting. Money stays in integer cents everywhere else; this is
// the only place it becomes text (CLAUDE.md).

const nzd = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 2,
});

export function money(cents: number): string {
  return nzd.format(cents / 100);
}

const shortDate = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** Business date (YYYY-MM-DD) for display, e.g. "14 Oct 2026". */
export function businessDate(date: string): string {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

const instantFmt = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Pacific/Auckland",
});

/** UTC instant shown in NZ time. */
export function instant(at: Date): string {
  return instantFmt.format(at);
}

export function percent(fraction: number | null, digits = 0): string {
  return fraction === null ? "n/a" : `${(fraction * 100).toFixed(digits)}%`;
}

export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 2)}%`;
}
