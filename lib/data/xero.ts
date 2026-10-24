import {
  SourceNotConfiguredError,
  type LedgerInvoice,
  type LedgerSource,
} from "./types";

/**
 * Xero accounting adapter (stub). Not connected in the prototype.
 *
 * TODO for production:
 * - OAuth 2.0 connection per client tenant, tokens in a secrets store.
 * - GET /Invoices (Type=ACCREC) with If-Modified-Since paging; map Status
 *   (AUTHORISED, PAID, VOIDED), CreditNotes and InvoiceNumber.
 * - Amounts converted to integer cents; dates to YYYY-MM-DD in NZ time.
 * - Respect Xero rate limits and record when each record was first seen,
 *   so the as-of view can be reconstructed.
 */
export class XeroLedger implements LedgerSource {
  readonly name = "xero";

  async invoices(): Promise<LedgerInvoice[]> {
    throw new SourceNotConfiguredError("Xero");
  }
}
