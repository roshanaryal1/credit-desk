// Calendar-day arithmetic on YYYY-MM-DD business dates (SPEC 4.1).
const DAY_MS = 86_400_000;

function utcDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid business date: ${value}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.toISOString().slice(0, 10) !== value) {
    throw new Error(`Invalid business date: ${value}`);
  }
  return date;
}

// UTC parts count calendar days without Auckland daylight-saving transitions.
export function daysBetween(a: string, b: string): number {
  return (utcDate(b).getTime() - utcDate(a).getTime()) / DAY_MS;
}

export function addDays(date: string, days: number): string {
  if (!Number.isInteger(days)) throw new Error("Days must be an integer");
  const result = utcDate(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

export function minDate(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}
