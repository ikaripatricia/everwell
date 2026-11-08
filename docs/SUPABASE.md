# Supabase integration

## Configured target

Project: **website_everwell** — `https://iczjiztltcpsnewofyya.supabase.co`.

Requested region: **Oceania (Sydney), `ap-southeast-2`**. Region must be confirmed in Supabase's dashboard; a project URL does not prove its physical location. The frontend configuration now targets this new project. No data, accounts, Auth settings or Storage objects have been migrated from the previous Tokyo project. See [cutover steps](SYDNEY_CUTOVER.md).

`supabase-config.js` contains the supplied publishable browser key. Publishable keys are intentionally visible, so security depends on Supabase Auth, PostgreSQL grants and row-level policies. Never replace it with a secret/service-role key. The client rejects known secret-key prefixes and legacy JWTs whose role is not `anon`.

## Setup boundary

The frontend and migration are prepared. The schema is NOT confirmed applied to the hosted project. Live Auth/Data API requests were blocked by the development environment's proxy (403), before reaching Supabase. No live user was created, no migration executed and no app published. Complete the README setup steps or provide the connected Supabase management capability to finish and verify.

The supplied public key cannot administer the database. No elevated credentials are requested or stored in app source.

## Data model and access

`public.everwell_workspaces` has one row keyed to `auth.users.id`:

| Column | Purpose |
| --- | --- |
| `user_id` | Auth identity; cascade delete on Auth user deletion |
| `display_name` | Optional name, maximum 80 characters |
| `completed_items` | Stable identifiers for completed base/topic/result discussion tasks |
| `topic_ids` | Selected predefined health discussion topics |
| `result_ids` | Selected predefined sample-result discussion topics; no lab numbers |
| `selected_package` | `core`, `plus` or `advanced`; preference only |
| `revision` | Server-controlled optimistic concurrency version |
| `updated_at` | Server-controlled update timestamp |

The SQL migration enables and forces RLS, revokes anonymous access, grants authenticated users only required operations/columns and checks ownership on SELECT/INSERT/UPDATE/DELETE. User IDs and revision/timestamps cannot be changed through the client's UPDATE permissions. Array constraints restrict saved identifiers and size. There is no generic JSON field for arbitrary clinical data.

## Client behaviour

`supabase-client.js` uses the documented Auth and PostgREST HTTP APIs with `fetch`. No external SDK or build is needed. Auth passwords are submitted directly to the configured project over HTTPS, cleared from form fields after each attempt, and never logged. Access/refresh tokens are kept only in memory. Requests omit cookies, avoid cache and send no referrer.

Sign-in loads or creates an empty owned workspace. The demo is never automatically saved into a new account. A display name is written through `textContent` in the interface. Plan changes are debounced and serialized, with a visible saving/saved/error status. A version condition on UPDATE prevents silent overwrites by a second session. A conflict requires explicitly reloading the saved plan; failed saves remain locally available for retry. Unsaved changes trigger the browser's leave warning.

Session changes abort obsolete requests and clear the previous user's interface. Sign-out revokes the current Auth session when reachable. Deletion removes only the signed-in user's workspace row; it does not delete the Auth account and does not silently recreate a row. An explicit reload/sign-in starts a new workspace.

All biomarker charts remain sample content, even when signed in. Actual lab result ingestion, clinician permissions, audit trails, appointments, health-record retention and a patient-data governance model are outside this integration.

## Verification

- Mocked-browser tests cover frontend authentication and persistence behaviour, not PostgreSQL enforcement.
- `supabase/tests/workspace_access.sql` is a separate real-database assertion script. It has been prepared but not executed here.
- Real-project Auth, email confirmation, persistence and two-user access checks remain required before reporting the hosted connection as verified.

Official references: [Supabase Auth](https://supabase.com/docs/guides/auth), [password-based sign-in](https://supabase.com/docs/guides/auth/passwords), [row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security), [publishable keys](https://supabase.com/docs/guides/api/api-keys).
