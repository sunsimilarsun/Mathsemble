# Mathsemble Obsidian host acceptance (development main, not v0.1.10)

## Preparation

1. Back up the existing vault and plugin installation. The tagged v0.1.10 has the old ==answer== syntax; this checklist is for a manually installed **development main** build only.
2. In a separate test Vault, copy the current main-branch main.js, styles.css and matching manifest.json to `.obsidian/plugins/math-teaching-workbench/`. Never replace the stable teaching vault as the first test.
3. Open `tests/fixtures/typed-answer-host.md` in that test Vault (copy it as a Markdown note). No network resources are required for the baseline cases.
4. Record Obsidian version, OS, theme, locale, installed relevant plugins, and the exact Git commit being tested.

## Reading and Live Preview checks

- [ ] `?{-1}` shows a fill underline with a hidden answer and on hover/focus the answer is visible; no unexpected wrapping.
- [ ] `?{$\frac{19}{21}$}` renders a fraction; confirm the answer line is present and at least 3em wide.
- [ ] `（!{B}）` and `（!{ACD}）` have no underlines and reveal the correct choices.
- [ ] Ordinary `==...==` highlights stay visible, even in notes containing typed answers.
- [ ] Clicking a Live Preview answer reveals the source marker for editing without modifying the note automatically.
- [ ] The fenced-code example and escaped markers display literally, not as answers.
- [ ] Plain paragraph/list continuation answers are concealed; real indented/fenced code stays literal. After leaving a list with an unclosed inner code fence, following real questions still transform.
- [ ] Comments and multiline HTML attributes containing `$$` or `?{` cannot affect following teacher-only Callouts; link text and resource addresses stay literal beside real answers.
- [ ] Change a mathematical fill slot to a choice slot using an edit outside the current selection; confirm the underline disappears.
- [ ] Repeat in default light, default dark and one third-party theme.
- [ ] A section mixing escaped and real typed markers may currently skip Reading View decoration; record separately as a known limitation rather than claim it works.

## Student and teacher export checks

- [ ] Teacher version displays all inline answers and complete teacher-only Callout content; student version reveals none of those strings.
- [ ] The native highlight and shared definition Callout appear in both PDFs.
- [ ] The teacher-only `answer` and `scaffold` Callouts leave independently matching student writing space measured from their fully rendered outer heights.
- [ ] Student HTML and PDF contain no extractable raw answer strings (select/copy or inspect exported HTML, not just visual hiding).
- [ ] Insert a long solution that crosses a page boundary; make sure lines/formulas/images do not clip and student space is not shortened.
- [ ] Check at least one image, one wide MathJax expression and a TikZ sample if TikZJax is installed.
- [ ] If any recoverable render problem is intentionally allowed, verify explicit consent and warning labels on the output.
- [ ] For a folder exam with one failed image, acknowledgement survives rechecking the same warning. A warning in another question requires fresh acknowledgement; missing questions still block export.
- [ ] The final page may be entirely blank; **never compress required student answer space just to remove it**.

## Release gate

- [ ] GitHub `npm run check` and clean-build CI succeed on the exact target commit.
- [ ] Community dashboard **Review branch** scan shows no blocking Errors; Warning cleanup is not itself an approval requirement.
- [ ] Record actual screenshots / exported PDFs and pass/fail per check. Until this is done, host acceptance is **not completed**.
- [ ] Only after approval, bump manifest.json, package.json, package-lock.json together; create matching `docs/RELEASE_NOTES_<version>.md` and publish a new tag.
- [ ] Verify the 3 Release assets and GitHub artifact attestations. Do **not** overwrite v0.1.10 release.

Official scanner: https://docs.obsidian.md/community-directory/manage-entry
