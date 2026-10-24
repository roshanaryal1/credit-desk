import { randomUUID } from "node:crypto";

import { asc, count, eq } from "drizzle-orm";

import { closeDb, getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { Rng } from "@/lib/seed/prng";
import { saveDecision } from "@/lib/trust/decide";
import { reviewState } from "@/lib/trust/review";

// Simulated past analyst decisions (SPEC 5, X22): run after precompute so each
// decision binds to the explanation it is compared with. Analyst choices are
// derived from the evaluation labels with seeded disagreement, so the
// agreement view has a history. They are always marked simulated.

const SEED = 4242;
const DISAGREE = 0.15;

async function main() {
  const db = await getDb();
  const [existing] = await db
    .select({ n: count() })
    .from(t.decisions)
    .where(eq(t.decisions.simulated, true));
  if ((existing?.n ?? 0) > 0) {
    console.log(
      `${existing!.n} simulated decisions already exist; reseed to regenerate.`,
    );
    return;
  }
  const rng = new Rng(SEED);
  const rows = await db
    .select({ invoice: t.invoices, batch: t.batches, label: t.labels })
    .from(t.invoices)
    .innerJoin(t.batches, eq(t.invoices.batchId, t.batches.id))
    .innerJoin(t.labels, eq(t.labels.invoiceId, t.invoices.id))
    .where(eq(t.batches.status, "REVIEWED"))
    .orderBy(asc(t.batches.submittedDate), asc(t.invoices.id));
  const HIGH = new Set([
    "DUP",
    "LEDGER_MISSING",
    "LEDGER_MISMATCH",
    "VOIDED",
    "ALREADY_PAID",
    "OVER_AGE",
    "FUTURE_DATED",
  ]);

  let made = 0;
  for (const { invoice, batch, label } of rows) {
    const labels = label.expectedCheckIds;
    let decision: "APPROVE" | "HOLD" | "REJECT" =
      labels.length === 0
        ? "APPROVE"
        : labels.some((l) => HIGH.has(l))
          ? "REJECT"
          : "HOLD";
    if (rng.next() < DISAGREE) {
      const others = (["APPROVE", "HOLD", "REJECT"] as const).filter(
        (d) => d !== decision,
      );
      decision = rng.pick(others);
    }
    // Decided the morning after submission, 10:00 NZDT (21:00 UTC the day of submission).
    const decidedAt = new Date(
      `${batch.submittedDate}T21:${String(rng.int(0, 59)).padStart(2, "0")}:00Z`,
    );
    const state = await reviewState(db, invoice.id);
    const res = await saveDecision(
      db,
      {
        invoiceId: invoice.id,
        decision,
        reason:
          decision === "APPROVE"
            ? ""
            : labels.length
              ? `Simulated: ${labels.join(", ").toLowerCase()}`
              : "Simulated: analyst judgement",
        reviewVersion: state.version,
        idempotencyKey: randomUUID(),
      },
      {
        sessionId: "simulated-history",
        displayName: "Simulated analyst",
        mode: "SHADOW",
      },
      { codeSha: "simulated", simulated: true, decidedAt },
    );
    if (res.ok) made++;
  }
  console.log(`Created ${made} simulated decisions with snapshots.`);
}

main()
  .then(() => closeDb())
  .catch(async (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    await closeDb();
    process.exitCode = 1;
  });
