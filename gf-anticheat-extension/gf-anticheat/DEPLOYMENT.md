# Deployment

## 1. Public configuration

Copy `.env.example` to `.env`. Keep `.env` untracked. Set:

```env
SUPABASE_URL=https://orwugyexvdgwzkndsbpk.supabase.co
SUPABASE_PUBLISHABLE_KEY=<project publishable key>
DASHBOARD_URL=http://localhost:4173/options.html
```

For production, replace `DASHBOARD_URL` with the exact HTTPS dashboard URL and rebuild. The build compiles only public values. Never substitute a secret or service-role key for the publishable key. PostgreSQL credentials are not needed by the extension or static dashboard.

Changing the Supabase project also requires reviewing the host allowlists in the manifest, page CSP, and build script.

## 2. Database

The initial migration has already been applied to project `orwugyexvdgwzkndsbpk` through Supabase's SQL editor. **Do not run that initial creation script again on this project.** It intentionally fails on existing tables instead of overwriting them.

For a new empty project, run the complete contents of:

```text
supabase/migrations/202610200001_formsentry.sql
```

It creates teachers, exams, student_sessions and monitoring_events, along with constraints, indexes, RLS, profile creation, session start, immutable event ingestion and teacher termination functions.

Run `supabase/tests/authorization.sql` afterward. It uses synthetic fixtures inside a transaction and rolls them back. A passing result explicitly says authorization, token scope and idempotency checks passed.

For later CLI migration management, reconcile the manually applied initial migration before pushing:

```powershell
npx supabase login
npx supabase link --project-ref orwugyexvdgwzkndsbpk
npx supabase migration repair 202610200001 --status applied
npx supabase migration list
```

Only mark it applied after verifying the deployed schema matches this file. Put subsequent schema changes in new migration files and review them before `npx supabase db push`. Enter database passwords only in trusted local prompts or secret environment variables.

The supplied direct connection uses host `db.orwugyexvdgwzkndsbpk.supabase.co`, port `5432`, database `postgres`, user `postgres`, SSL required. If direct connectivity is unavailable, obtain the actual project pooler connection string from **Connect** in Supabase; do not guess the pooler hostname or username. Direct PostgreSQL access is optional for this application.

## 3. Student API

The `student-api` Edge Function is deployed from both files in `supabase/functions/student-api`.

To deploy an update with the official Supabase CLI:

```powershell
npx supabase login
npx supabase functions deploy student-api --project-ref orwugyexvdgwzkndsbpk --no-verify-jwt
```

Alternatively use the Supabase Edge Functions editor, preserve `index.ts` and `validation.mjs`, and deploy as `student-api`.

This function uses its own session-scoped token authorization. Its **Verify JWT with legacy secret** setting must be off; a random student token is not a Supabase Auth JWT. The invitation endpoint exposes only the matching active exam; event ingestion verifies a hashed 256-bit session token, validates rules and metadata, and calls restricted server RPCs. Teachers still use normal Supabase Auth JWTs and RLS.

Supabase supplies `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` inside its hosted function environment. Never copy that server key into browser files. There is no need to paste it into chat.

## 4. Teacher Auth

For the supplied project, email sign-in and confirmation are enabled, and the local Site URL plus allowed redirect have been configured and verified as `http://localhost:4173/options.html`. Email delivery and recovery still require a real-account acceptance test.

In Supabase Authentication:

1. Enable email/password sign-in and email confirmation.
2. Set Site URL to the intended dashboard origin.
3. Add the exact dashboard URL to the allowed redirect URLs. For local testing add `http://localhost:4173/options.html`.
4. Configure your email delivery provider for real users and verify confirmation and password-recovery emails arrive.
5. Register through FormSentry, complete email verification, and sign in. Registration creates the corresponding teacher profile through a database trigger.

Credentials are entered by the account owner. Dashboard tokens persist only in that browser tab's sessionStorage and are removed on logout; they are not exported with reports.

## 5. Build, host and distribute

```powershell
npm run build
npm run dev
```

The build verifies source, runs automated tests, and produces:

- `dist/dashboard`: upload its contents to a static HTTPS host.
- `dist/extension`: Chrome Load unpacked folder.
- `dist/formsentry-1.0.0.zip`: distributable extension ZIP with manifest at its root.
- `dist/SHA256SUMS.txt` and `dist/PACKAGE-CONTENTS.txt`: package checks.

No backend server must run beside the static dashboard. Supabase hosts Auth, database, and the student API. Publish only `dist/dashboard` to your host, never the whole repository or `.env`. Hosting is not complete until the actual HTTPS URL, Auth redirects, and complete exam workflow are tested.

After choosing the production URL, set it in `.env`, rebuild, and distribute that newly built ZIP. An old ZIP may still point teachers to localhost.

## 6. Prepare for GitHub

Review changes from the parent Git repository, which contains this extension subfolder. Ensure `.env`, `.qa`, `dist`, exported reports, and credentials are excluded. Review source and generated assets, run `npm run build`, then commit only the intended project files. Do not blindly stage the entire parent repository.

No push is performed by these scripts. Publish a repository or release only when you choose. This subfolder README is current; the parent repository README may still describe the previous implementation and should link here.

## Release gate

Complete [TESTING.md](TESTING.md), especially real teacher email flows, a real Google Form in Chrome, two separate student devices, offline recovery, and final cloud synchronization. The current package is suitable for controlled acceptance testing; those checks remain necessary before classroom rollout.
