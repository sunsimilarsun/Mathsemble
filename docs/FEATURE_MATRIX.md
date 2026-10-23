# Existing feature assessment — release baseline v0.1.9

Evidence labels: **M** maintainer reports manual use with no issues; **N** Node/static tests run in release candidate; **B** Chromium layout smoke tests; **U** no independent full Obsidian integration/PDF visual verification.

| Subsystem | Functional baseline | Evidence | Remaining optimization |
| --- | --- | --- | --- |
| Single Markdown long-handout preview | Original, student, teacher editions | M, N | Mode switching and obsolete measurement cancellation across files (U) |
| Callout visibility | Any `[!type]+` / `[!type]-` teacher-only; unmarked shared | M, N; 36/36 long-handout mapping | Page-spanning teacher answer visual check (U) |
| Fill and choice answer slots | Parenthesis-only MC choice; others are fill, with math/Chinese support | M, N | Nested dollar/inline math corner cases (U) |
| Teacher-height-based response spaces | Default 100% with no minimum height | M; browser unit tests from prior iterations | Cross-OS, A4 overflow and font-specific tolerance (U) |
| PDF and system printing | Electron BrowserWindow isolated and A4 paginator | M, N (mock); node `printToPDF` output checks | Native printer driver differences, PDF page-content comparison (U) |
| Partial rendering warnings | Explicit acknowledgement before incomplete export | M, source audit, N blockers | Detect changes after approval, track precise source locations (U) |
| Question collection | Folder scan grouped by type or primary knowledge node | M, N | Search, filters and baskets are future version features |
| Read/Live Callout palette | Eight teaching types plus old `solution` alias; not `example` | M, B | User CSS conflicts in less-common themes (U) |
| Metadata updates | Explicit teaching-role edit only | Source audit | Frontmatter schema/role cross-validation (U) |
| Network and filesystem | Remote print assets and temporary print HTML supported | Source audit | Documented this round; add offline-only toggle later |
| Build and release | GitHub was docs-only | N source/export hash parity | Source import, license, Actions run, GitHub Release, Community review pending |

**Important:** Individual pass/fail figures are automation evidence for the cited cases; they are not an assertion that every page of every future user's math handout has been visually inspected.
