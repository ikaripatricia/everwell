# Testing the combined Everwell prototype

Open `index.html` directly in a modern browser. See the root README for optional local-server instructions. No deployment is needed.

## Main flows

1. Navigate all seven sections: overview, prevention plan, results, care packages, screening, life stages and knowledge hub.
2. In Results & trends, select each of Ferritin, Vitamin D and HbA1c. Confirm the value, units, chart, four-row history and discussion context change together.
3. Add a result to GP discussion notes. Add a health topic from the overview. Both should appear in the prevention checklist and downloaded notes. Adding the same result twice should not duplicate it.
4. Tick a checklist item and check the overview next-step count. Download notes and confirm selected topics and completion marks are included.
5. In Care packages, select Core, Plus and Advanced. Confirm the selected card and current-package heading agree. There must be no charge or enrolment.
6. Open the overview's preparation guide. Check its close button, Escape key and outside-click dismissal.
7. Open the prevention planner and explore several age groups. Read the full screening guide for individual-risk and symptoms caveats.
8. Change the life-stage tabs and open health-topic dialogs.
9. Open with `#results` or `#membership` in the URL. Refresh: the requested section should remain selected while package/checklist choices reset.
10. Check 390px, 768px and desktop widths for horizontal page overflow. On narrow screens the top navigation scrolls horizontally.
11. Disconnect from the internet and repeat core flows. Font and image assets are local/embedded; only deliberately opened official links need internet access.

## Validation completed

- Inline JavaScript syntax check passed.
- Chromium checks passed at 1440px, 768px and 390px widths across all seven views.
- All three marker datasets, result-history tables, package selection, adding a result to discussion notes, checklist count and the downloaded notes were verified.
- Preparation dialog dismissal, age-based guidance, life-stage content, hash navigation and refresh reset were verified.
- No JavaScript errors or external asset requests occurred during the checks.

Safari/Firefox and assistive-technology testing have not been performed. This is functional prototype validation, not clinical validation or legal compliance certification.
