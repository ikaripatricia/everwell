# Testing Everwell with Supabase

## Offline demo

Serve the repository with `python3 -m http.server 8000 --bind 127.0.0.1` and open http://localhost:8000. Navigate overview, prevention plan, results, care packages, screening guide, life stages, My account and knowledge hub. Verify chart switching, result history, preparation guide, age-based screening guidance and downloadable GP notes.

## Automated frontend checks (mock API only)

Install Playwright in a development environment with an available Chromium browser:

```sh
python3 -m pip install playwright
EVERWELL_CHROMIUM=/path/to/chromium python3 tests/browser_supabase.py
```

The default executable path is `/usr/bin/chromium`. The test intercepts every network request and supplies a fake Supabase API. It does not contact the configured project or send confirmation emails.

Covered: missing/privileged-key refusal, sign-in, owned workspace creation, stable checklist IDs, adding result topics, package persistence, safe display-name rendering, GP-note download, new-page reload after sign-in, account switching without previous-user data, failed-save retry, version conflict detection, deletion without automatic recreation, confirmation-required signup, access-token refresh and responsive navigation at 1440/768/390px. These checks passed in Chromium. They do not prove that deployed RLS policies are correct.

## Real database checks — pending setup

Apply the migration in the TEST project, then run `supabase/tests/workspace_access.sql` in its SQL Editor. The script asserts anonymous operation denial, owner access, cross-account operation denial, server-controlled revisions and invalid task rejection. It rolls back all fixtures. This script has not been executed from the current environment.

Then test through the actual app:

1. Create test account A and confirm email. Sign in through My account.
2. Complete a task, add a topic, choose Core, enter an optional fictional display name, and wait for **Account · saved**.
3. Refresh and sign in again. All saved preferences must reload; sample lab numbers remain unchanged examples.
4. Sign out. The interface must return to a clean demo. Create/sign in as account B and verify A's preferences are absent.
5. Using account B's access token in a dedicated test client, attempt to read/update/delete account A's row or insert a row with A's ID. Database policies must deny these operations even if the request's query parameters are changed.
6. Open A in two browser tabs. Make/save a change in one, then edit the older state in the other. The older version must show a conflict rather than silently overwrite.
7. Block the network, make a change and verify **Not saved**. Restore access and retry.
8. Delete A's saved workspace and verify its row is removed, B is unaffected, and no row is recreated until A explicitly reloads or signs in again.

Do not use real health data. Safari/Firefox, assistive technology, live SQL/RLS, email delivery and real-project network checks remain unverified here. No app publication is part of these steps.
