# Client ledger integration — isolated CI verification

This branch exists solely to validate the latest code on draft PR #140 after a
connector-originated push did not enqueue a fresh workflow run. It does not
change the approved merge policy and must not be merged as a PR.

Source PR: #140. Target review candidate: #136. Review-gate issue: #135.

## Required checks

- Full lint/format/typecheck/test/build/eval and browser-secret guard on the
  exact corrected source commit, not the first failing PR attempt.
- Known synthetic client with ledger data: net collateral reconciles to dated
  debtor ageing; funded principal is kept separate.
- Unknown status and conflicting same-day status: fail closed as ineligible.
- Cross-client read isolation and invalid as-of date handling.
- Correct links from Client 360 and explicit NOT VERIFIED FOR DRAWING notices.

After verification, incorporate the source PR's code as a reviewed snapshot
into PR #136 and run the integrated CI again. **No merges to main.**
