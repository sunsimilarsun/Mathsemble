# Obsidian Community scorecard follow-up — 2026-10-23

This note addresses the scorecard for Mathsemble **0.1.9**, audited at commit **138ac23**. The report classified the release as publishable but identified a failed clean build, README language/use, missing provenance, and CSS/permission recommendations.

## Confirmed findings and remediation

| Finding | Result |
| --- | --- |
| Clean-build error: `Missing src/main.js` | The audit commit's **Git tree does include** `src/main.js`; reproduction from the complete project succeeded. Exact scanner-extraction cause remains unconfirmed. Build script now tolerates an incomplete root-assets-only scan while CI explicitly requires and verifies the tracked source. Added 3 regression tests. |
| README install/use and English | Added English Installation, Usage, Privacy and Development sections at the **top** of README; Chinese details remain. |
| Missing signed build provenance (recommendation) | GitHub Actions CI on main and future tag release builds now call `actions/attest@v4` for `main.js` and `styles.css`. Proof is effective only after a workflow actually completes and publishes the attestations. Existing 0.1.9 GitHub asset bits are unchanged. |
| `fs` outside Vault API (warning) | Known and deliberately used for OS temporary print HTML and explicitly referenced local file resources; `isDesktopOnly: true`; documented in privacy disclosure. Further limit/scope audit remains. |
| Vault enumeration (recommendation) | Folder exam assembly uses `getMarkdownFiles()` then filters files in the selected folder; metadata scan can see paths outside that folder, but does not export those notes. Can later narrow enumerations by folder. |
| Clipboard (recommendation) | Writes diagnostic strings only after explicit user action; no background clipboard reads. |
| CSS multi-column compatibility (warning) | Flagged `break-inside`/`break-after` are intentional pagination hints, not multi-column layout. Removing them risks changing PDF geometry. |
| CSS `!important` (warning) | Theme and printing overrides include essential answer visibility, writing-line and collapsed-callout rules. A later isolated CSS reduction must preserve geometry and semantic test results. |
| Unknown `mjx-container` (warning) | This is an actual MathJax custom element, intentionally styled inside scoped math/answer selectors. |
| No vulnerable deps, no obfuscation | Passed in the supplied audit; do not claim independent full security certification. |

## Distinguish scanner score from live releases

Changes on `main` do not rewrite the existing immutable historical **0.1.9** tag/source snapshot or retroactively generate an attestation under that tag. The scorecard may need a new evaluated release to reflect fixes. The next patch tag should be created only after GitHub CI and provenance verification succeed.

## Prioritized follow-ups

1. Verify GitHub CI and two provenance attestations on the new default-branch commit.
2. Verify the scanner build in the Community directory or provide the Git-tree source-file evidence when reporting the discrepancy.
3. Only then release the next patch version with attestation-enabled tag workflow.
4. Keep functional CSS overrides until independent Obsidian visual and PDF geometry acceptance demonstrates safe simplification.
