# Mathsemble clean-build review fix (2026-10-23)

The Obsidian Community scanner reported `Missing both src/main.js and main.js` for v0.1.10, while GitHub Actions builds passed and both file paths were present in the tagged Git tree.

**Diagnosis:** Both the tracked source and the generated runtime were named `main.js`. An automated clean-build procedure that removes all `main.js` files can therefore remove both the output and the source. This is the leading hypothesis based on the scanner error, not a verified description of its internals.

**Implemented:**
- Verbatim rename: `src/main.js` -> `src/plugin.js`; preserve original source blob.
- Build strict from `src/plugin.js` into root `main.js`; no use of an old generated file.
- Regression tests and CI clean-build simulation: delete all files named `main.js` before compilation, rebuild, then verify committed output parity.

**Acceptance:** `npm ci && npm run check`, tests, output SHA-256 equality with the published bundle, GitHub CI, and ultimately Obsidian dashboard **Review branch** preview (external step).

This change does not implement, remove or alter student/teacher/PDF/question-assembly runtime functionality.
