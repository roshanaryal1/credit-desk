import { daysBetween } from "@/lib/dates";

/** Business date of a UTC instant in Pacific/Auckland, including NZ DST. */
export function nzBusinessDateAt(instant: Date): string {
  if (!(instant instanceof Date) || !Number.isFinite(instant.getTime())) {
    throw new Error("Valid event instant required");
  }
  const fields = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Pacific/Auckland",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const field = (kind: "year" | "month" | "day") =>
    fields.find((part) => part.type === kind)?.value;
  return field("year") + "-" + field("month") + "-" + field("day");
}

/**
 * An as-of snapshot must not expose a future acknowledgement, resolution or
 * reopen event. Sorting a copy also prevents input ordering from rewriting
 * the apparent latest status.
 */
export function incidentEventsAsOf<T extends { id: string; occurredAt: Date }>(
  events: T[],
  asOf: string,
): T[] {
  daysBetween(asOf, asOf); // Strict YYYY-MM-DD and calendar validation.
  return events
    .filter((event) => nzBusinessDateAt(event.occurredAt) <= asOf)
    .sort(
      (a, b) =>
        a.occurredAt.getTime() - b.occurredAt.getTime() ||
        a.id.localeCompare(b.id),
    );
}
