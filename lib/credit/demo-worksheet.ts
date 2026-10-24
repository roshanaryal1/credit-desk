import {
  borrowingBase,
  type BorrowingPolicy,
  type Receivable,
} from "./borrowing-base";

export const WORKSHEET_DATE = "2026-10-24";
const invoices: Receivable[] = [
  { invoiceId:"INV-101",debtorId:"Harbour Distribution",faceCents:10000,receivedCents:2000,creditNoteCents:0,ineligibleReasons:[] },
  { invoiceId:"INV-102",debtorId:"Harbour Distribution",faceCents:5000,receivedCents:0,creditNoteCents:1000,ineligibleReasons:[] },
  { invoiceId:"INV-103",debtorId:"Southern Retail",faceCents:20000,receivedCents:0,creditNoteCents:0,ineligibleReasons:[] },
  { invoiceId:"INV-104",debtorId:"Kauri Ventures",faceCents:10000,receivedCents:0,creditNoteCents:0,ineligibleReasons:["DISPUTED"] },
];
const policy: BorrowingPolicy = {
  version:"DEMO-2026-10",advanceRateBps:7500,maximumDebtorShareBps:5000,
  facilityLimitCents:50000,drawnCents:35000,reservesCents:1000,sublimitCents:40000,
};

export function demonstrationWorksheet(scenario: "baseline" | "low-draw") {
  const selected = scenario === "low-draw" ? {...policy,drawnCents:2000} : policy;
  return borrowingBase(WORKSHEET_DATE, selected, invoices);
}
