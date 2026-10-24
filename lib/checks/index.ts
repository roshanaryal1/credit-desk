import { alreadyPaid } from "@/lib/checks/alreadyPaid";
import { concentration } from "@/lib/checks/concentration";
import { creditNote } from "@/lib/checks/creditNote";
import { dup } from "@/lib/checks/dup";
import { futureDated } from "@/lib/checks/futureDated";
import { ledgerMismatch } from "@/lib/checks/ledgerMismatch";
import { ledgerMissing } from "@/lib/checks/ledgerMissing";
import { newDebtor } from "@/lib/checks/newDebtor";
import { overAge } from "@/lib/checks/overAge";
import { slowPayer } from "@/lib/checks/slowPayer";
import type {
  Check,
  CheckContext,
  CheckId,
  Finding,
  Invoice,
} from "@/lib/checks/types";
import { voided } from "@/lib/checks/voided";

export const ALL_CHECKS = {
  DUP: dup,
  LEDGER_MISSING: ledgerMissing,
  LEDGER_MISMATCH: ledgerMismatch,
  VOIDED: voided,
  CREDIT_NOTE: creditNote,
  ALREADY_PAID: alreadyPaid,
  NEW_DEBTOR: newDebtor,
  SLOW_PAYER: slowPayer,
  OVER_AGE: overAge,
  FUTURE_DATED: futureDated,
  CONCENTRATION: concentration,
} satisfies Record<CheckId, Check>;

export function runChecks(invoice: Invoice, ctx: CheckContext): Finding[] {
  return Object.values(ALL_CHECKS).flatMap((check) => {
    const finding = check(invoice, ctx);
    return finding ? [finding] : [];
  });
}

export function statusFor(
  findings: Finding[],
): "CLEAR" | "FLAGGED" | "HIGH_RISK" {
  if (findings.some((finding) => finding.severity === "HIGH"))
    return "HIGH_RISK";
  return findings.length === 0 ? "CLEAR" : "FLAGGED";
}
