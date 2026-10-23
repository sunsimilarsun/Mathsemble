# Mathsemble 0.1.10 — Obsidian Community review maintenance release

This is a **release-process and documentation update** from 0.1.9. There are **no changes to the plugin's JavaScript runtime or CSS**; student/teacher rendering, answer slots, Callout writing spaces, question assembly and PDF/print behavior remain unchanged.

## Changes
- Add an English Installation, Usage, Privacy and Development guide at the top of README.
- Support partial root-assets-only build scans while strictly requiring `src/main.js` and byte-for-byte source parity in CI.
- Add three build regression tests (17 total passing tests).
- Produce signed GitHub build provenance attestations for `main.js` and `styles.css`.
- Document the Obsidian Community scorecard findings and deferred CSS/filesystem review.

## Known limitations
- Desktop Obsidian only; the PDF print pipeline uses Electron/Node.js.
- Complex MathJax formulas, theme overrides, images and long-document page geometry should be visually checked.
- Some community CSS-lint recommendations are intentional MathJax/print layout rules; these remain under review.
- Obsidian Community directory acceptance is not implied by a GitHub release.

## Privacy
No plugin-managed telemetry. Referenced external images/fonts may be fetched, and temporary printable HTML may be written outside the vault. [Privacy details](https://github.com/sunsimilarsun/Mathsemble/blob/main/docs/PRIVACY.md).

Project: https://github.com/sunsimilarsun/Mathsemble
