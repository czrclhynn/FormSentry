# FormSentry

FormSentry combines a Chrome Manifest V3 extension with a Supabase-backed teacher dashboard. Students identify themselves and consent before monitoring starts. Teachers create examinations, share invitation links, review individual sessions, and export CSV reports.

One departure and its return form one activity record, even when Chrome reports several focus and visibility signals. Reports describe observations; they do not assign cheating scores or verdicts.

## Quick start

Use Node.js 22 or newer. No npm dependencies are required.

```powershell
npm run build
npm run dev
```

Open `http://localhost:4173/options.html`. The server serves the built dashboard, so rebuild after editing source files.

In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this project's `dist/extension` folder. For distribution, extract `dist/formsentry-1.0.0.zip` and select the extracted folder containing `manifest.json`.

The included public configuration points to Supabase project `orwugyexvdgwzkndsbpk`. A publishable key is intentionally public; database and service-role credentials must never be included in the extension.

## Backend and deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for exact database, function, Auth, hosting, and GitHub preparation steps. The initial schema and student API were applied to the specified project on October 20, 2026. Deployment evidence and outstanding checks are recorded in [PROGRESS.md](PROGRESS.md).

The dashboard is prepared for static HTTPS hosting; it has not been publicly hosted. Teacher email confirmation and recovery redirects must match the actual dashboard URL.

## Examination workflow

1. Register in the dashboard, verify the email, and sign in.
2. Create an examination using its Google Forms respondent URL. Configure departures, fullscreen, clipboard, restricted domains, and Record Only or Warning mode.
3. Activate the examination and copy its invitation link. Share the extension ZIP and [setup guide](setup.html).
4. The student opens that exact invitation link in Chrome, enters a name and email, accepts the guidelines, and starts.
5. The student submits Google Forms before finishing. A technical-stop option allows withdrawal or reporting a problem.
6. The teacher opens Student Sessions, selects the student, reviews the timeline, and exports CSV.

Students with matching names remain separate through unique session IDs. Identity is self-reported. Refreshing the bound exam tab preserves the attempt; closing a popup does not end monitoring.

## Privacy and practical limits

- No answers, clipboard contents, screenshots, keystrokes, or external application names are collected.
- Clipboard monitoring records only the action. Domain monitoring stores configured domain matches, not arbitrary browsing URLs.
- Chrome focus loss can indicate leaving the exam window; it cannot prove Alt+Tab or identify another application.
- The extension is voluntary browser software, not a tamper-proof lockdown browser. Disabling it or using another device cannot be reliably detected.
- Starting requires connectivity. During an active attempt, events queue locally and retry after reconnection. Keep the extension installed until pending records synchronize; clearing extension storage removes that queue.
- Google Forms submission-route detection is evidence of an attempted submission flow, not confirmation that Google accepted an answer. FormSentry does not mark a submission verified without an independent response integration. This implementation has no such integration.
- Teachers should interpret records in context and set an appropriate retention policy. Names, email addresses, and examination activity are personal data.

## Structure

| Path | Purpose |
|---|---|
| `background.js` | Serialized session/storage owner and Chrome event handling |
| `event-processor.js` | Correlated departure episodes and event identity |
| `content.js` | Student introduction, consent, monitoring panel and page signals |
| `cloud-client.js`, `cloud-sync.js` | Supabase requests and persistent acknowledged outbox |
| `teacher-client.js`, `options.*` | Teacher authentication, examinations, sessions and reports |
| `supabase/migrations/` | Tables, indexes, constraints, RLS and transactional RPCs |
| `supabase/functions/student-api/` | Invitation/session authorization and validated ingestion |
| `supabase/tests/authorization.sql` | Live database checks with rolled-back fixtures |
| `tests/` | Reducer, worker-harness, validation and outbox tests |
| `scripts/` | Verification, assets, static server and ZIP build |

Run `npm run check` for local tests and source verification, or `npm run build` to also package deliverables. See [TESTING.md](TESTING.md) for the real-browser acceptance checklist. A successful mocked Chrome test does not establish a successful Chrome installation.
