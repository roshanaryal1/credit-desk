# Synthetic Portfolio Watch trends (#101 / #110)

This descriptive view aggregates recorded demo incident first-detected dates
and status history to show current unresolved/high counts, two consecutive
30-calendar-day detection windows, the last 14 days of new incidents,
and mean days to resolution for currently resolved cases only.

Action instants are assigned to Pacific/Auckland calendar dates before
historical filtering, including daylight saving; later resolutions/reopens do
not affect earlier snapshots. Missing resolution samples display explicitly
as unavailable, not zero days. Underlying incident IDs remain available in
the existing Watch workflow.

This view does **not** create configurable watch policies, agreed thresholds,
SLA timers, persisted incident assignments, notifications, live source health,
regulatory risk forecasts, or authenticated client/tenant permissions.
Those are still outstanding in #101, #105, #109 and #135.

No network or payment actions are performed.
