# Wattle prototype

An interactive Australian women's preventive health concept inspired by Function Health. This is a fictional demo, not a clinical service.

## Test locally

No dependencies or build step are required.

1. Check out this branch and open `index.html` in a modern browser.
2. Alternatively, run `python3 -m http.server 8000 --bind 127.0.0.1` from the repository root and visit http://localhost:8000.

No deployment or publishing is configured. Google Fonts and an Unsplash image require an internet connection; the interface remains functional if they are unavailable.

## Manual checks

- Navigate all five views using the sidebar.
- Open the prevention planner, select an age group and explore its general screening guidance.
- Tick checklist items and confirm the overview count changes.
- Add a health topic to GP discussion notes and download the notes as a text file.
- Change life-stage tabs and open official guidance links.
- Check desktop and mobile layouts and close dialogs using Escape or the close button.
- Refresh the page to reset all demo selections.

## Validation performed

JavaScript syntax check passed. Chromium checks passed for the planner, checklist count and desktop/mobile overflow. External assets were blocked during browser QA, so their appearance was not verified.

## Scope and limitations

The profile is fictional. Inputs are held in page memory only. There are no accounts, bookings, patient records, clinical alerts or clinician communications. Do not enter real health information.

The Knowledge hub contains the reference-model analysis and Australian launch requirements covering privacy, clinical governance, medical-device classification and advertising. These are product planning notes, not legal clearance. Clinical and legal review, operational controls and appropriate security are required before real use.
