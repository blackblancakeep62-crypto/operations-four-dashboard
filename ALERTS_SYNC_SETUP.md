# Operations alerts: read-only first release

The first snapshot was read from the original native Google Sheet using the
connected Sheets read action and independently read back before publication.
The source was never copied, edited, converted or shared. There were no ERP calls.
Source formulas run in Google; `build_alerts.py` only maps their computed values.

`alerts.json` and `alerts-data.js` are the sole alert snapshots. They are isolated
from summary, targets, execution, Feishu and inventory/pricing data. The existing
Pages workflow packages the allowlisted frontend files. Raw connector receipts,
full weekly data and backend files are not included in the Pages artifact.

## Weekly synchronization gap (not enabled)

The current Apps Script endpoint supports only `read_execution` for four fixed
XLSX files, with a Drive read-only manifest. It cannot read this native Google
Sheet. No new scopes, copied sheets, public source sharing or new credentials
have been created for this release.

To enable weekly sync, add an independent authenticated native Sheets result
reader (read-only values access to this source), verify its access and signed
response, then add an isolated weekly gate to the existing Actions workflow.
Prefer Monday at Beijing 10:30, reusing the existing daily run and performing
only the alerts read once per week. Keep execution's daily schedule unchanged.
Never dispatch an alert action through `read_execution` or parse a native Sheet
with the XLSX reader. No automatic alerts refresh is claimed until this gap is
resolved and a real weekly-path run succeeds.

The reader must capture source version before/after reading and reject a change
during the read. Return named bounded sheet values to the normalizer, not
formulas. A weekly failure must retain all prior rows, cutoffs and success time,
updating only checked_at, status=read_failed and an error code; publish those two
alert files through `publication_guard.py publish --module alerts`. Failure must
not stop the existing execution or Pages steps. Do not add error details or
credentials to public snapshots. Publication guards reject older alert dates
and timestamps independently of other modules; the browser keeps its own last
good alerts cache and shows expiry after seven days or a failed refresh.

For a verified manual connector refresh, keep its receipt outside this checkout,
run `python build_alerts.py <private-input.json>`, review the result and publish
only the two owned snapshots through the same guard. Never commit raw input.

First validation: 15 unique parents, 9 risk / 6 growth, 378 actions. Business
cutoff 2026-10-24, state snapshot 2026-10-26, latest action 2026-10-21. Two
historical owner cells contain #N/A; one current warning has conflicting owner
sources. Both are shown explicitly and source rules are preserved.
