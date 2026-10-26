/** Validate frozen cash evidence without substituting present-day source rows. */
export function validateCapturedReceipt(
  record: Record<string, unknown>,
  clientId: string,
  asOf: string,
): void {
  const invalid = () => {
    throw new Error("Invalid captured receipt allocation");
  };
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return invalid();
    return value as Record<string, unknown>;
  };
  const day = (value: unknown): value is string =>
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value + "T00:00:00Z")) &&
    new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
  const money = (value: unknown): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
      return invalid();
    const cents = Math.round(value * 100);
    if (!Number.isSafeInteger(cents) || value !== cents / 100) return invalid();
    return cents;
  };
  const amount = money(record.amount);
  if (
    record.clientId !== clientId ||
    !day(record.date) ||
    record.date > asOf ||
    !Array.isArray(record.allocations)
  )
    invalid();
  const seen = new Set<string>();
  let total = 0;
  for (const value of record.allocations as unknown[]) {
    const allocation = object(value);
    const ledger = object(allocation.ledger);
    if (
      typeof allocation.ledgerEntryId !== "string" ||
      seen.has(allocation.ledgerEntryId) ||
      ledger.id !== allocation.ledgerEntryId ||
      ledger.clientId !== clientId ||
      ledger.debtorClientId !== clientId ||
      !day(ledger.issueDate) ||
      !day(ledger.recordedDate) ||
      ledger.issueDate > asOf ||
      ledger.recordedDate > asOf
    )
      invalid();
    seen.add(allocation.ledgerEntryId as string);
    total += money(allocation.amount);
    if (!Number.isSafeInteger(total) || total > amount) invalid();
  }
  // Older empty-allocation captures contain no nested relationship to prove.
  const allocated = record.allocatedCents ?? (total === 0 ? 0 : undefined);
  if (
    typeof allocated !== "number" ||
    !Number.isSafeInteger(allocated) ||
    allocated !== total ||
    allocated > amount
  )
    invalid();
}
