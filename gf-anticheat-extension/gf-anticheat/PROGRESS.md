# FormSentry implementation progress

Updated: 2026-10-22 (Asia/Manila).

## Current stage

Stage 5 — implementation and packaging completed; real-browser acceptance and production hosting remain unverified. Continue from this state, do not rebuild the architecture.

## Completed stages

1. Audited the original ten runtime files. Reused the extension, fixed duplicate listeners/signals, replaced arbitrary endpoint uploads and unauthenticated local teacher administration.
2. Implemented and deployed the four-table Supabase schema with RLS, indexes, constraints, teacher profile trigger, idempotent session creation, immutable ingestion and teacher termination. Deployed both files of the student-api Edge Function. User approved custom session-token authentication; legacy JWT verification is disabled for this function only.
3. Implemented student identity/consent, unique attempts, document binding, refresh/worker recovery, one-record departure episodes, offline outbox, technical stops and honest unverified submission tracking.
4. Implemented protected teacher dashboard, practical exam rules, student details, live polling, filters, exports, FormSentry assets and setup guide.
5. Added dependency-free verification/build/ZIP scripts, README.md, DEPLOYMENT.md and TESTING.md. No Git push or commit performed.

## Latest bug fixes

- Open departure records survive local display-history trimming until their duration is finalized.
- Pending outbox records remain available in the current-session local export after display trimming.
- Background tab loading does not count as a visited restricted domain before activation.
- Overlapping student-detail responses cannot mix identities and events; closing or logging out invalidates pending details.
- Open session details refresh with dashboard polling; event pagination has a stable secondary order.
- Refresh/BFCache activation samples document visibility/focus to clear stale signals.
- Submission-route replies report the actual submission-unverified session status.

## Verified

- npm run build: PASS; 41 automated tests, 25 runtime files verified.
- Final October 22 rebuild: PASS, identical release checksum. git diff --check passed (only Windows line-ending conversion notices).
- Local dashboard sign-in screen and setup guide loaded successfully in the browser; no dashboard console warnings/errors observed. Setup guide checked at desktop and 390px width with no document overflow.
- Supabase email provider, new registrations and email confirmation are enabled; anonymous Auth sign-ins are disabled.
- ZIP independently read with .NET: all 25 entries readable, manifest.json at archive root.
- Release: dist/formsentry-1.0.0.zip.
- SHA-256: 47cae917aca4a9e1c303e0db9f6b344ffdf403349a724b9bae3609fa9cbcb4f8.
- Live Supabase initial schema: applied successfully through SQL editor on October 20.
- Expanded supabase/tests/authorization.sql: PASS on live project; cross-teacher exam/session/event isolation, owner reads, spoofed ownership denial, anonymous denial, restricted token column/RPC, wrong token, start retry, immutable event replay and unauthorized teacher termination. Synthetic fixtures rolled back.
- Live deployed API: missing session credential -> 401; unknown invitation -> database-backed 404.
- Evidence files: .qa/supabase-authorization.png and .qa/supabase-api.png (ignored by Git).

## Remaining acceptance work / limitations

- Real teacher registration, email verification/recovery and complete installed-Chrome Google Forms workflow are not verified. Use TESTING.md; no actual test Form or teacher credentials were supplied.
- No independent Google Forms response integration; never label a submission verified. Student identity is self-declared.
- Static dashboard is built but not publicly hosted. Choose production URL, configure Auth redirects, rebuild and distribute its matching ZIP.
- The earlier local-server approval limit was resolved: approved server launch and browser checks succeeded. Run npm run dev again if that server has stopped.
- User reported teacher sign-in, but the inspected FormSentry tab still showed the sign-in screen. Supabase project-console authentication is separate from FormSentry teacher authentication; sessionStorage is also scoped to the exact browser tab. Authenticated application acceptance remains pending.
- Parent Git repository is two directories above this writable workspace. Git status and whitespace review succeeded after the earlier approval limit resolved. No commits or pushes were made; current application documentation is inside this extension folder.
- No reference screenshot or actual CheatNoNo guide was attached; none was claimed as inspected.

## Configuration follow-up

User approved setting Supabase Site URL and allowed callback to http://localhost:4173/options.html. Both persisted values were verified after opening the page again. Evidence: .qa/supabase-auth-settings.png. No privileged key or database password is in browser code.

## Significant files

background.js, content.js, event-processor.js, shared.js, cloud-client.js, cloud-sync.js, teacher-client.js, options.*, popup.*, setup.*, ui.css, assets/*, tests/*, scripts/*, supabase/*, .env.example and project Markdown documentation.
