// Stable incident keys shared by the watch rules, the seed's watch labels and
// the evaluation (SPEC 7).

export const incidentKey = {
  paymentDrift: (debtorId: string) => `PAYMENT_DRIFT:${debtorId}`,
  fundedCreditNote: (fundingId: string) => `FUNDED_CREDIT_NOTE:${fundingId}`,
  overdueFunded: (fundingId: string) => `OVERDUE_FUNDED:${fundingId}`,
  concentrationCreep: (clientId: string, debtorId: string) =>
    `CONCENTRATION_CREEP:${clientId}:${debtorId}`,
  facilityUtilisation: (clientId: string) => `FACILITY_UTILISATION:${clientId}`,
};
