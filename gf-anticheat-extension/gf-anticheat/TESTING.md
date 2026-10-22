# Verification

## Automated checks

```powershell
npm run check
npm run build
```

The 41 tests exercise the pure event processor, the actual background script in a mocked Chrome/storage/network harness, dashboard response races, server validation, and offline outbox handling. They include correlated tab/window/page signals, repeated real departures, replay IDs, worker restart, stale document rejection, identity/consent, URL validation, immutable queued payloads, teacher termination, background-tab exclusion, and open-departure preservation beyond the history limit.

The build also checks JavaScript syntax, manifest/assets/permissions and file references. The ZIP has been independently opened and its entries read with .NET ZIP support.

## Live Supabase checks

On October 20, 2026, the initial migration ran successfully in the specified Supabase project. `supabase/tests/authorization.sql` passed on the live database:

- A teacher sees only their own exam and cannot see another teacher's student session.
- A teacher cannot spoof exam ownership or read student token hashes.
- Anonymous clients cannot list examinations.
- Teachers cannot invoke the privileged ingestion RPC.
- Incorrect session tokens are rejected.
- Replaying an identical event creates one row.
- Mutating a historical event is rejected.
- A teacher cannot read another teacher's events or terminate their session; the owner can read their own sessions and events.
- Retrying a start with the same token and identity returns the same attempt.

The deployed student API returned HTTP 401 for a missing session credential and HTTP 404 for a nonexistent invitation after its database lookup. These are live negative-path tests, not a completed end-to-end student examination.

All SQL test fixtures rolled back. These database tests do not substitute for testing Auth email delivery or an installed Chrome extension.

## Manual acceptance checklist

Use a disposable Google Form and clearly labelled test identities. Do not use a real high-stakes exam for the first test.

| Action | Expected result |
|---|---|
| Open dashboard while signed out | Authentication screen; no student data |
| Register, verify email, sign in | Teacher profile and protected workspace |
| Recover password, then log out | Recovery works; logout clears visible data |
| Create and activate exam | Valid respondent URL and saved practical rules |
| Open copied invitation without consenting | No active monitoring session |
| Enter name/email and consent | Exactly one uniquely identified active attempt |
| Switch tab, return | One departure record containing return and duration |
| Switch window/application, return | One observable window-departure record, no app-name claim |
| Two fast leave/return cycles | Two records, neither suppressed |
| Open several tabs during one absence | One departure episode |
| Refresh exam tab | Same session ID, no duplicate attempt |
| Restart service worker | Bound active attempt survives |
| Close popup | Attempt remains active |
| Disconnect network during active attempt | Local records remain pending; reconnect uploads once |
| Finish while offline, then reconnect | Final records and final status eventually synchronize |
| Copy/paste with rule enabled | Action recorded; contents never captured |
| Visit configured restricted domain | Domain observation; no unrelated URL history |
| Submit Google Form | Detection remains distinct from independent verification |
| Withdraw consent / technical stop | Monitoring stops, reason/status retained |
| Close exam tab or navigate away | Interrupted state; finalized local departure if needed |
| Teacher ends session | Client stops on next successful sync |
| Open same exam on a second device | Different session ID, separate student timeline |
| Sign in as second teacher | First teacher's records inaccessible |
| Export complete session CSV | Chronological records; spreadsheet formulas escaped |
| Finish then perform more actions | No continuing monitoring for ended attempt |
| Narrow screen and keyboard-only navigation | Readable layout and reachable labelled controls |

List views load the latest 1,000 records; individual session details fetch their full event history. Overview counts use database totals. “Currently monitoring” is a recent-sync heuristic, not proof that the student is still present.

## Not yet established

The local sign-in page and setup guide were opened successfully in the browser. No warnings/errors appeared in the dashboard console. The setup guide was visually checked at desktop and 390px width, without document overflow. Supabase email-provider/confirmation settings and the saved local Auth callbacks were verified.

Real email registration/recovery, full Chrome installation, actual Google Forms submission behavior, and simultaneous multi-device testing must be completed by the project owner with real test accounts and a Form. No passing result is implied for an unchecked manual row.
