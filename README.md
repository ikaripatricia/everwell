# Everwell — preventive health test app

Everwell combines a women's prevention dashboard, sample biomarker trends, care-package exploration, Australian screening guidance and GP discussion notes. This branch adds Supabase Auth and owner-scoped persistence for prevention workspace preferences.

## Test locally — no publishing

Download this branch as a ZIP, extract it and run this in the folder:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open http://localhost:8000 on the same computer. No framework, package installation or build is needed. Directly opening `index.html` still allows demo exploration; use localhost for account testing.

## Supabase setup status

The user-supplied test project URL and public publishable key are configured in `supabase-config.js`. This is public browser configuration, not a server secret. No secret/service-role key, database password or personal access token belongs in this repository.

**The migration has not been applied and live connectivity has not been verified from the development environment.** Its network policy denied connections to Supabase. A public project URL/key does not grant database-administration access.

To finish setup in the selected TEST project:

1. Run [`supabase/migrations/202611040001_everwell_workspaces.sql`](supabase/migrations/202611040001_everwell_workspaces.sql) in its SQL Editor as an administrator. It creates one app-specific table, owner-only row policies, restricted column grants and a server-controlled revision trigger, in a transaction. It does not touch existing clinical tables or import the sample lab data. If the table already exists, stop and inspect it rather than deleting it.
2. Run [`supabase/tests/workspace_access.sql`](supabase/tests/workspace_access.sql) in the SQL Editor. It creates test fixtures inside a transaction, checks anonymous and cross-account denial plus owner access, and rolls everything back. Do not proceed if an assertion fails.
3. Confirm email/password sign-in is enabled under Authentication. Keep email confirmation enabled, configure the local test Site URL/allowed redirect if needed, and use only test email accounts. Hosted default email sending is rate-limited; check Supabase's SMTP settings for reliable confirmation delivery.
4. Serve the app locally, open **My account**, create a test account, confirm its email and sign in. Tick checklist items, add a discussion topic or select a package. After the indicator says **Account · saved**, refresh, sign in again and verify the changes reload.
5. Test a second account; it must start with a separate empty workspace. Also test sign-out and deleting a saved workspace.

Alternatively, finish connecting Supabase in the assistant chat so the migration and live checks can be applied through the management connection. No app deployment is needed for either route.

## What is stored

- Auth: email and credentials handled by Supabase Auth, not by an Everwell password table.
- `public.everwell_workspaces`: user ID, optional display name, completed task identifiers, chosen health/result discussion identifiers and package preference.
- Lab values remain explicitly fictional fixtures bundled with the app. They are never uploaded or seeded as patient records. No clinical notes, appointment records, prescriptions or clinician alerts are implemented.

Demo selections are not automatically imported on sign-in: a new account starts with an empty prevention workspace. Changes save automatically while signed in. Access/refresh tokens stay in page memory; refreshing requires signing in again. On sign-out the workspace is cleared from the interface. There is no analytics, external font/image request, localStorage session, checkout or enrolment.

Read [database details](docs/SUPABASE.md), [testing steps](docs/TESTING.md) and [source integration notes](docs/MERGE_NOTES.md).

This remains a test prototype for fictional information, not a clinical service or legal compliance certification. Australian hosting/region, vendor arrangements, health-data security, clinical governance and legal obligations need validation before real patient use.
