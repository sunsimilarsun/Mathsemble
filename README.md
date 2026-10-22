# Mathsemble｜数课工坊

Mathsemble is a local-first Obsidian desktop plugin for mathematics teaching materials, question sheets, handouts, and student/teacher PDF exports.

**Status:** Public repository initialized. The full source and automated release workflow are being prepared for an initial beta; **there is no installable GitHub Release yet**. Do not submit this repository to the Obsidian community directory until the source, `manifest.json`, build artifacts, license, and host tests are complete.

## Product scope

- Current experimental plugin: Markdown question cards, A4 previews, solution/answer separation, writing spaces, handout student/teacher export, printing.
- Future work: question search and basket, KnowledgeItem assembly, family-aware teaching materials, full content assemblies, and audited release pipeline.
- Privacy: do not commit private question banks, student records, PDFs containing personal data, or API keys.

## Version and identity

Last independently tested prototype: **0.1.6.0** (145/145 Node tests). Before a public Obsidian release, convert to a three-part version (planned **0.1.6**) and keep the legacy plugin ID `math-teaching-workbench` unless a migration is explicitly designed.

The full release candidate source has not been committed to this repository yet.

## Answer-slot grammar (0.1.8)

Mathsemble determines each inline `==...==` answer slot **only from its immediately surrounding parentheses**:

- `(==anything==)` or `（==anything==）` (optional spaces): **choice**, hidden without an underline in student output.
- `==anything==` without immediately surrounding parentheses: **fill-in**, hidden with an underline in student output.
- Both ASCII and Chinese full-width parentheses are accepted. The answer can be letters, numbers, Chinese text, or TeX. **Neither answer content nor YAML `question_type` overrides this per-slot rule.**
- YAML `question_type` may still be used for question grouping and other question-level functionality.

This behavior has been implemented in a local **0.1.8 experimental source package** and passed 159/159 Node tests; **the public repository does not yet contain the plugin source or an installable Release**. Obsidian host and PDF visual acceptance remain pending.
