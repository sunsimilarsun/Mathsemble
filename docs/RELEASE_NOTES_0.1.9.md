# Mathsemble 0.1.9 — first Community release candidate

Mathsemble brings local-first mathematics handout and exam printing to Obsidian desktop.

## Included

- One Markdown lesson → original, student and teacher A4 previews and PDF/print outputs.
- `+/-` callouts visible in full to teachers and replaced with measured writing space for students; unmarked callouts shared.
- Parenthesis-based choice-answer and fill-in-answer slots, including common math notation.
- Folder-based question-card collection and grouping for teacher/student exam papers.
- Eight-category math Callout color palette in Reading View, Live Preview and A4 export.
- Opt-in continuation when only individual formulas or images fail, while keeping structural and page overflow blockers.
- Source/build parity and automated regression tests for release preparation.

## Known limitations

- Desktop only: Windows/macOS Obsidian; uses Electron for PDF printing.
- Complex themes, MathJax edge cases, wide formulas and OS printer driver settings may require visual checking.
- Incomplete-export confirmation warns that individual formulas or images may be missing or inaccurate.
- No full-database search basket, KnowledgeItem assembly, or automatic question-family builder yet.

## Privacy and security

No client telemetry. Referenced HTTP(S) images/fonts may be fetched when exporting, and temporary printable HTML is written outside the vault to the OS temp directory then deleted. Full details: [Privacy](PRIVACY.md).

Project: https://github.com/sunsimilarsun/Mathsemble
