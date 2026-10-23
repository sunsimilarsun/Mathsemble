# Conservative CSS and publishing review (2026-10-23)

## Confirmed

- Obsidian says scanner Warnings do not block submissions; Errors must be resolved. https://docs.obsidian.md/community-directory/manage-entry
- Current manifest has valid identity/version/description, and isDesktopOnly is true; no minAppVersion change, so versions.json is not required merely for this maintenance.
- The latest GitHub release is v0.1.10, but main contains **unreleased** typed ?{fill} and !{choice} implementation. Do not overwrite the historical 0.1.10 release.

## CSS change

- The 75 occurrences of !important in styles.css were reduced to **72**, exclusively by removing the earlier of two identical choice-border override triples. The later identical selectors and important declarations are retained; the earlier text-decoration reset is retained.
- All MathJax mjx-container rules, visual answer hiding, fill-in underlines, teacher-only callout expansion, answer-space/pagination declarations and embedded print CSS remain untouched.
- The CSS contract tests detect print stylesheet drift and prevent accidental deletion of critical visibility and pagination declarations.
- Remaining warnings are intentional or require **real Obsidian visual testing**, not bulk text substitutions.

## Release workflow change

- A tag release now requires docs/RELEASE_NOTES_<tag>.md, rather than always using the 0.1.9 notes.
- The GitHub Actions job verifies that the built main.js matches the versioned source bundle.
- If the tag's GitHub Release already exists, the workflow fails rather than overwriting assets with --clobber.
- Release provenance and separate main.js/manifest.json/styles.css assets remain required.

## Pending real-host acceptance

- Run Community directory Review branch on main (not available from GitHub alone).
- Check light/dark and at least one third-party Obsidian theme in Reading View and Live Preview.
- Confirm ?{fill}, !{choice}, ==native highlight==, escaped markers, formulas and mixed documents.
- Export teacher/student long PDF and exam: no answer recoverable in student HTML/PDF, complete teacher-derived response space, no clipping.
- Blank final PDF pages are allowed and must not be removed by compressing response space.
- Bump manifest/package/lock coherently and add matching notes only after host acceptance; **do not tag a new version now**.
