# Sydney test-project cutover

Target: `website_everwell` at `https://iczjiztltcpsnewofyya.supabase.co`.

The frontend URL and publishable key have been updated. This is a configuration change, not a completed database migration. The previous Tokyo project is untouched. No app was published.

## Before using the new target

1. Confirm the new primary database shows **Oceania (Sydney), ap-southeast-2** in its Supabase dashboard. Region cannot be inferred from the URL.
2. Check the old Tokyo project for existing users, workspace rows, Storage objects and other data. If there is data to preserve, back it up and follow Supabase's [project migration guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase). Preserve Auth identities and user IDs when migrating owned workspace rows. Reconfigure Auth providers, redirect URLs, SMTP and other project-specific settings as required. Do not copy elevated keys into browser source.
3. For a genuinely empty test project, apply `supabase/migrations/202611040001_everwell_workspaces.sql` in the NEW project's SQL Editor. If restoring existing data/schema instead, inspect the restored schema first; do not rerun a CREATE TABLE migration against an already restored table.
4. Run `supabase/tests/workspace_access.sql` in the new project and require all assertions to pass. Configure email/password authentication and local test redirects.
5. Test this branch locally: create or use a test account, save preferences, refresh and sign in again. Verify a second account cannot access the first account's data. If old data was migrated, also confirm the expected old records are available under the original identities.
6. Only switch existing users to this configuration after these checks. Keep Tokyo available until the cutover and data/account verification are complete. Rollback means restoring the prior configuration; reconcile writes made to either project before a rollback.

## Current verification limits

The development environment has no connected Supabase management tools or permitted outbound Supabase access. Its network policy previously rejected the Auth/Data API probes before they reached Supabase. Live region, schema, access policies, data migration and Auth settings have not been verified. Local syntax/configuration checks do not establish a successful migration.
