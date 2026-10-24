import {
  SourceNotConfiguredError,
  type BankFeedSource,
  type BankReceipt,
} from "./types";

/**
 * Akahu open-banking adapter (stub). Not connected in the prototype.
 *
 * TODO for production:
 * - Client consent and app/user tokens under Akahu's accreditation terms.
 * - GET /transactions for the client's receiving accounts in the date
 *   range; keep only credits; map description and reference fields.
 * - Amounts converted to integer cents; dates to YYYY-MM-DD in NZ time.
 * - Privacy Act 2020 review before any real bank data is stored.
 */
export class AkahuBankFeed implements BankFeedSource {
  readonly name = "akahu";

  async receipts(): Promise<BankReceipt[]> {
    throw new SourceNotConfiguredError("Akahu");
  }
}
