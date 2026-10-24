# Borrowing-base demonstration worksheet

Issue #112; depends on #116.

The page `/borrowing-base` displays the *pure deterministic* borrowing-base waterfall and invoice treatment table for a documented four-invoice synthetic example. A second low-utilisation scenario changes only the already-drawn amount, demonstrating how availability differs without modifying source facts or policy.

This is explicitly **not** a real client's line availability. It does not connect the bank ledger, source freshness, signed facility policies or verified permissions. It is meant for credit-domain review of semantics, finance math and visual hierarchy. Do not use it to decide a drawdown. Input amounts remain hand-prepared fixtures validated by golden tests.

Production integration depends on reconciled source events #100, approved finance policy #102, client facilities #103, authenticated roles #109 and actual user testing. The first UI should preserve all the evidence links when those dependencies are ready.
