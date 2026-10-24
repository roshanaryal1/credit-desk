# Provider contract fixtures — NOT a live Xero/Akahu connection

Issue #106; source journal #100, security #109.

This PR adds deterministic offline contract fixtures that exercise the existing `LedgerSource` and `BankFeedSource` interfaces with Xero-shaped invoice versions and Akahu-shaped bank credit records. Currency input is a strict decimal string parsed to integer cents; effective-date versions, credit-note cutoffs and tenant scoping have reproducible tests.

**Not covered:** provider-native response schemas verified against current Xero/Akahu sandbox APIs, OAuth or consent screens, tenant mapping, refresh token rotation, webhook signatures, bank account encryption, rate limits, provider pagination, credit memo extraction, production data retention or lawful access. Real Xero/Akahu implementations remain disabled stubs. Do not use these fixtures to claim that external integrations are connected. Connections can be implemented after separate user and provider authorization.
