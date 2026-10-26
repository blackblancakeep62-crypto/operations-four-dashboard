# Daily execution sync

The existing GitHub Actions workflow runs at `30 2 * * *` UTC (Beijing 10:30;
GitHub may queue scheduled runs). It calls the owner's Apps Script web app,
which directly parses only the execution tab of four fixed Drive XLSX files.
No source writes, conversion copies, Sheets permissions, service account or ERP.
The Google manifest requires only `drive.readonly`.

The endpoint accepts a POST with a dedicated random transport key, stored only
in Script Properties and the repository's `APPS_SCRIPT_SYNC_KEY` Actions secret.
The deployment URL is in `APPS_SCRIPT_EXECUTION_URL`. Responses are HMAC signed.
GET and unauthenticated POST return no source data. No Google or GitHub token is
stored in frontend assets. GitHub's built-in job token commits aggregates.

`apps_script_transport.py` reuses the accepted `sync_execution.py` status and
profit rules. Daily input is execution records only. The accepted candidate
queue baseline is reused from the existing cache (not rescanned/reselected),
with personal notes and proof URLs removed and AES-GCM encrypted in
`execution-queue-baseline.enc`. This is the existing weekly candidate snapshot,
not a claim that candidate selection is refreshed daily. A later weekly queue
publication must refresh that baseline alongside its accepted candidate data.

All four sources must pass signature, freshness and header validation before
replacing aggregates. Failure preserves the preceding successful values and
success timestamps, records a failed check, and republishes that visible status.
Only explicitly allowlisted static files enter the Pages artifact. Execution
details, original workbooks, baseline ciphertext and backend code are excluded.

The pricing view shows source-read time and the latest successful synchronization
in Beijing time; an empty execution sheet yields zero started/completed tests and
an unknown (not zero) verified increment. Theory remains separate. Manual records
are never written. Workflow dispatch exercises the same daily path immediately.

## Shared publication boundary

Business delivery owns only `targets.json` and `targets-data.js`; execution owns
only `execution.json` and `execution-data.js`. Both use `publication_guard.py`:
each non-force push overlays its two blobs on freshly fetched main, validates
all existing period/owner cutoffs and timestamps, and retries conflicts up to
three times with revalidation. It never rebases an old data commit blindly.

The sole Pages workflow keeps concurrency group `dashboard-pages`, checks out
main, and packages allowlisted blobs from the latest remote main after any
execution update. It compares data dates against the live last-good snapshots,
verifies JSON/embedded-JS parity, adds content hashes to all JS/CSS URLs, and
records source SHA and hashes in `publication.json`. If main changes after
packaging, deployment stops; the queued newer push publishes instead.

The browser retains each module's last-good public aggregate snapshot separately
and rejects older dates/timestamps on refresh or reload. No business/ERP metrics,
manual records or Apps Script read/authorization logic are changed. An explicit
manual backend rollback requires `--allow-rollback --reason ...`; scheduled
tasks never pass that option. Browser last-good storage also intentionally needs
an operator reset for an explicitly approved historical rollback.
