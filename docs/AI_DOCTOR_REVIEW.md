# OpenAI blood-analysis drafts with doctor approval

## Implemented test workflow

1. An authenticated user enters structured lab values and acknowledges external AI processing. Supported markers in this first version: ferritin (ug/L), vitamin D (nmol/L), HbA1c (% or mmol/mol), haemoglobin (g/L), LDL (mmol/L) and TSH (mIU/L).
2. `submit_lab_report` requires a verified, active assigned doctor, consent and valid values. Raw measurements are immutable through the client. Five new reports per user per 24 hours and three worker attempts per report bound intake/retries. An idempotent report UUID avoids duplicate submission on network retry.
3. The Supabase Edge worker validates the user's Auth session and report ownership, then claims the job atomically. It sends only structured values, dates, lab intervals and deterministic comparisons to OpenAI; it does not send account names, email addresses or patient IDs. These measurements must still be treated as health information.
4. OpenAI returns a schema-constrained narrative draft. Refusals, incomplete/malformed responses and references to unprovided markers fail rather than publish. The provider request sets `store:false`; this is not a guarantee of zero retention or Australian-only processing.
5. Graph series are calculated from submitted numeric values, never model-generated values. They preserve units, per-result lab intervals and actual date spacing. Different units remain separate; no conversions, invented reference ranges, scores or interpolated clinical values are added. Only dates in this submission are charted; earlier reports are not automatically pooled.
6. Draft narrative, observations, limitations, model/prompt provenance and graphs are stored in `blood_analysis_drafts`, accessible only to verified assigned doctors. Patients can see their submission status/raw input but cannot query draft content or graphs.
7. The doctor compares the original source report and clinical context, edits a final patient explanation, writes a review note and explicitly confirms source/output verification. Approval is an atomic database RPC tied to the exact draft version. Only the final doctor explanation and reviewed graph data are copied into `blood_analysis_releases`; raw AI observations/limitations are not automatically released. Rejection keeps all draft content private and asks for a new corrected submission.
8. Approval identity, reviewer name, version and time are recorded. Submit/worker/failure/approval/rejection events are append-only to ordinary app roles. Revoking a doctor's active status or assignment prevents future access/review operations, even if a browser still shows a loaded queue.

No real results were sent to OpenAI during implementation. All network/browser tests use fictional measurements and simulated services.

## Database and role setup — not yet deployed

Apply `supabase/migrations/202611140001_doctor_review.sql` in the selected test project after the workspace migration. Run `supabase/tests/doctor_approval.sql` as an administrator. The test creates fixture Auth users, verifies the patient/draft/release and doctor-assignment boundaries, and rolls back. It has NOT been executed here because live Supabase management/database access is unavailable.

Reviewer identity and registration must be verified outside the app by an authorised service operator. Only then may the operator insert a `clinical_reviewers` row, including their real registration number, verification timestamp and `active=true`, and create the intended `clinical_assignments`. There is no self-service promotion, profile-metadata role flag or browser write privilege. Self-review assignments are prohibited. Provision fictional staff only in a non-clinical test project; do not use a verification timestamp as a substitute for actual identity/registration verification.

All clinical tables have RLS and no browser INSERT/UPDATE/DELETE grants. Patient intake and doctor decisions use narrow security-definer RPCs with identity/assignment checks. Worker RPCs are callable only by the server's service role. Do not expose that key or provider credentials to the browser.

## Deploy the test worker

The project owner must first confirm the test project's region, migrations, Auth, staff assignments and access tests. Deploy `supabase/functions/analyse-blood/index.ts` as the `analyse-blood` Edge Function using normal authenticated Supabase tooling or the project dashboard. Keep the gateway's JWT validation enabled; the function also verifies the access token through Supabase Auth before privileged work.

Set server-side secrets/configuration from `.env.example`:

- `OPENAI_API_KEY`: a provider key entered in Supabase Edge Function Secrets, never in chat or GitHub.
- `EVERWELL_AI_MODEL`: an explicitly selected and evaluated model that supports Responses structured JSON output. Prefer a tested snapshot for reproducibility.
- `EVERWELL_ALLOWED_ORIGINS`: exact comma-separated allowed browser origins, initially `http://localhost:8000` for local testing; no wildcard.
- `EVERWELL_ANALYSIS_ENABLED=true`: opt in only after the test setup and provider configuration are ready. It is disabled by default.

The Supabase runtime supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY`. No OpenAI key or model is configured by the frontend's publishable key. Without the enabled flag/required settings the endpoint returns 503 and makes no provider request. Provider, Auth and database calls are bounded by timeouts and no raw health/provider/error payloads are logged.

For deployments where Edge requests do not execute in Sydney by default, configure and verify the supported regional invocation/deployment behaviour. Database region alone does not locate Edge or OpenAI processing in Australia. The existing Supabase project was not changed or published by this PR.

## Testing

- `node --test tests/blood_analysis.test.mjs tests/analysis_worker.test.mjs` (Node 24+ for native TypeScript loading of the Edge entrypoint): validates numeric/unit/date handling, graph integrity, prompt/schema/refusal handling, owner checks, fail-closed configuration and the worker's status-only response. External calls are mocked.
- `python3 tests/browser_clinical.py` (Playwright + Chromium): verifies pending graphs/text are withheld, doctor-only queue display, explicit source acknowledgement, doctor-edited release, rejection, different accounts and responsive layouts. API responses are simulated.
- `python3 tests/browser_supabase.py`: existing preference/Auth regression tests.
- `supabase/tests/doctor_approval.sql`: real database access/state-machine assertions, pending execution in the test project. Mocks do not establish actual RLS enforcement.

Live deployment, actual model performance, live role/access enforcement and clinical validation remain unverified. The implementation is a reviewable test integration, not an operating medical service.

## Clinical and operational limits

The clinician must independently verify the original lab report; this version has structured entry only and does not ingest, retain or extract a PDF/photo. Original-source verification occurs through the doctor's existing secure source-access process, not through an uploaded document viewer here. Incorrect sources require rejection and resubmission; approved inputs/releases cannot be silently edited by patients. A clinician amendment/retraction and patient-notification process for already approved reports is not implemented in this first version and is required before real clinical use.

There are no diagnoses, prescriptions, supplement doses, autonomous treatment decisions, invented health scores or automatic patient release. This is not an urgent/critical-result triage or clinician-alerting service. Every real service must have a separate reliable lab critical-result and escalation process; AI failure/queues must never replace that process. No email or external message is sent to a doctor by this implementation; doctors use the review queue.

Before real health information is processed, establish patient/provider consent and notices, suitable OpenAI/Supabase processing arrangements, retention/deletion and audit-access policies, clinician responsibility/response times, source provenance, evaluated model behaviour and clinical governance. The interface's processing acknowledgement is a test control, not a complete consent or legal-compliance framework. Workspace deletion does not delete clinical submissions; Auth user deletion is restricted by clinical record references pending a governed retention workflow.

Doctor review alone does not determine whether this software is a medical device or exempt. Assess intended purpose and claims against [TGA CDSS guidance](https://www.tga.gov.au/resources/guidance/understanding-clinical-decision-support-system-software-regulation) and [software-device regulation](https://www.tga.gov.au/resources/guidance/understanding-how-we-regulate-software-based-medical-devices) before clinical supply. Provider implementation follows [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) and the [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).
