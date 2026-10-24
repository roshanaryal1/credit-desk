# Client 360 synthetic activity history (#103 / #111)

This slice adds a client-scoped activity page with a business-as-of filter, linked evidence and stable pagination (15 per page). It consolidates batch submissions, recorded synthetic fundings, risk detections, decisions, incident actions and case events already present in the database.

Safeguards:
- Read events are scoped to the requested synthetic client before aggregation; absent clients return not found. No cross-client search or global audit disclosure.
- Action timestamps are filtered using the New Zealand business date of the recorded UTC instant, including daylight-saving changes. Backdated replay never shows actions performed on a later NZ-local date.
- Event links point to existing routes and stable source IDs; no source value is invented, no write path is exposed, and the result never claims a bank-verified timeline.
- Funding events are recorded historical synthetic advances, not current disbursement approvals.
- There is intentionally no claim that historic facility terms, source first-observed timestamp, or customer identity are fully versioned. The batch submission date is a synthetic business fact, not provider proof.

Remaining #103/#111: verified OIDC identity, tenant-scoped database access for real users, provider observation-time reconciliation, historic facility amendments, document metadata with safe retention, scale/backpressure review and independent client/privacy UAT. This PR cannot close those parent issues.
