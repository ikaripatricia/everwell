# Everwell — women's preventive health prototype

A combined interactive concept for Australian women's preventive care, bringing together the original Everwell Victorian pilot app and the Wattle prevention experience.

## Try it without publishing

1. Download this branch as a ZIP using GitHub's **Code → Download ZIP** option.
2. Extract the ZIP.
3. Open `index.html` in Chrome, Edge, Safari or Firefox.

The complete app is in one file. It needs no dependencies, installation, build, account or internet connection. Official reference links need internet access when opened.

Alternatively, from the extracted folder run:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Then open http://localhost:8000 in the browser on that same computer. No publishing or external hosting is configured.

## Included

- Unified Everwell overview and prevention checklist.
- Sample ferritin, vitamin D and HbA1c trends with accessible result-history tables.
- Core, Plus and Advanced care package comparison with indicative AUD pricing.
- Proposed Victorian clinician assessment, results review and follow-up pathway.
- National cervical, breast and bowel screening information by age group.
- Women's life-stage topics, heart health, bone health, sleep and wellbeing.
- Preparation checklist and downloadable GP discussion notes.
- Australian clinical, privacy, software-regulation and advertising launch considerations.

All selections stay in page memory and reset on refresh. There is no backend, analytics, clinical monitoring, patient record, booking, enrolment or checkout. Use fictional data only.

This is a product prototype, not medical advice or a live care service. Sample intervals are illustrative, package pricing is unvalidated and clinical/legal review is required before real use.

See [testing instructions](docs/TESTING.md) and [integration notes](docs/MERGE_NOTES.md).
