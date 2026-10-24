import type { Book } from "./types";

/** Outstanding advance for a funding as of a date (advance minus adjustments). */
export function outstandingOn(
  f: Book["fundings"][number],
  date: string,
): number {
  if (f.fundedDate > date) return 0;
  return (
    f.advanceCents -
    f.adjustments
      .filter((a) => a.date <= date)
      .reduce((s, a) => s + a.amountCents, 0)
  );
}

/** A client's outstanding exposure by debtor on a date. */
export function exposureByDebtor(book: Book, clientId: string, date: string) {
  const byDebtor = new Map<string, number>();
  let total = 0;
  for (const f of book.fundings) {
    if (f.clientId !== clientId) continue;
    const cents = outstandingOn(f, date);
    if (cents <= 0) continue;
    byDebtor.set(f.debtorId, (byDebtor.get(f.debtorId) ?? 0) + cents);
    total += cents;
  }
  return { byDebtor, total };
}
