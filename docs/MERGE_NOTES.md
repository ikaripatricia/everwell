# Integration notes

Historical notes for the app combination in PR #2. The current branch adds optional Supabase account persistence; see SUPABASE.md and the root README for current behaviour.

## Inputs

- Wattle prototype previously committed to this repository in PR #1.
- User-uploaded `everwell-standalone.html`, the prior Everwell Victorian women's preventive-health concept.

## Combined experience

The app keeps Wattle's prevention dashboard layout, national screening guide, life-stage topics, Australian launch requirements and GP discussion checklist. It uses the Everwell brand and adds the uploaded app's three sample biomarker histories, Core/Plus/Advanced package models and proposed clinician-led Victorian care pathway. Package data and sample histories are preserved as concept data.

Results can now be added directly to the same downloadable GP discussion notes used for preventive topics. Navigation and shareable section hashes use a single application shell. All demo state is in memory and resets on refresh.

## Clarified prototype content

- The original 82/100 health score is omitted because the supplied app provides no validated scoring method.
- The original scheduled test and doctor-call dates are replaced with preparation and follow-up information; no appointment or clinician review is claimed to have occurred.
- Biomarkers and lab intervals are explicitly illustrative. They do not provide diagnosis, individual recommendations or clinical targets.
- Package prices remain indicative AUD amounts, with no purchase or enrolment capability.
- Proposed clinical operations and pathology partnerships are described as launch requirements rather than existing services.
- External font and photo requests were replaced by system fonts and an embedded botanical illustration so the prototype works offline.

No existing hosted Site was changed and no deployment configuration was added. The source remains suitable for local testing as a standalone HTML file.
