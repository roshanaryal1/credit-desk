import type { Db } from "@/lib/db/client";

export class ReviewTransactionConflict extends Error {}

/** Drizzle wraps driver failures in cause; only recognised transaction conflicts retry. */
function retryable(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error && typeof error === "object" && !seen.has(error)) {
    seen.add(error);
    const failure = error as {
      code?: string;
      constraint?: string;
      cause?: unknown;
    };
    if (failure.code === "40001" || failure.code === "40P01") return true;
    // A competing identical submission can commit after this transaction's MVCC
    // snapshot but before the chain lock is acquired. Retry to discover its key.
    if (
      failure.code === "23505" &&
      [
        "decisions_pkey",
        "decisions_idempotency_uq",
        "exposures_session_invoice_uq",
        "exposures_pkey",
      ].includes(failure.constraint ?? "")
    )
      return true;
    error = failure.cause;
  }
  return false;
}

/** Stable read/write snapshots; an aborted attempt publishes no partial history. */
export async function withSerializableRetry<T>(
  db: Db,
  work: (tx: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(work, { isolationLevel: "serializable" });
    } catch (error) {
      if (!retryable(error)) throw error;
      if (attempt >= 2)
        throw new ReviewTransactionConflict(
          "Review changed concurrently; reload before submitting",
        );
    }
  }
}
