# Mathsemble Obsidian host acceptance (0.2.5 local reconciliation build)

This is a checklist, not a completed acceptance report. Record actual results in
[TESTING_0.2.5.md](TESTING_0.2.5.md). Earlier release results retain their original scope.

## Preparation

1. Back up the existing plugin installation and schemes. This checklist targets 0.2.5: only `-` Callouts are version-filtered, while `+` and unmarked blocks are shared. Official 0.2.4 cannot read newly saved v3 schemes.
2. In a separate test Vault, copy the target build's main.js, styles.css and matching manifest.json to `.obsidian/plugins/mathsemble/`. Record the branch and commit; development builds need not be on main. Never replace the stable teaching vault as the first test.
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
- [ ] Use the Reading View “显示／隐藏答案” action and command with text/math slots and collapsed Callouts; verify readable content and stable scrolling. Confirm separate views do not share state, changing files resets the state, and leaving/unloading the plugin cleans up its controls. Source Markdown must remain unchanged.

## Student and teacher export checks

- [ ] Teacher version displays inline answers and accessible `answer-` blocks. Other `-` types are hidden by default and display only when their type is selected. Student output hides all `-` blocks and answer slots; `+` and unmarked blocks remain shared in both editions.
- [ ] The native highlight and shared definition Callout appear in both PDFs.
- [ ] Accessible `answer-` blocks always leave measured student writing space. `scaffold-`, `solution-` and other types leave space only when selected. Changing teacher visibility does not reduce selected student space.
- [ ] An omitted outer `-` block removes its full subtree: an inner `answer-` does not independently reappear or create a blank. A selected outer blank measures the complete source block, including descendants, exactly once.
- [ ] Student HTML and PDF contain no extractable answers from hidden slots or `-` blocks (select/copy or inspect exported HTML, not just visual hiding). Check shared `+` and unmarked content separately so it does not accidentally contain answers intended to be hidden.
- [ ] Insert a long solution that crosses a page boundary; make sure lines/formulas/images do not clip and student space is not shortened.
- [ ] Check at least one image, one wide MathJax expression and a TikZ sample if TikZJax is installed.
- [ ] If any recoverable render problem is intentionally allowed, verify explicit consent and warning labels on the output.
- [ ] For a folder exam with one failed image, acknowledgement survives rechecking the same warning. A warning in another question requires fresh acknowledgement; missing questions still block export.
- [ ] The final page may be entirely blank; **never compress required student answer space just to remove it**.
- [ ] Trial layout reads ordinary document titles in `title` / `课题名称` / `titile` order, but generated `note_type: handout` titles in `titile` / `title` / `课题名称` order. A present empty field stays empty. Check the updated table, footer, long content and both editions in native PDFs.
- [ ] Read v1/v2/v3 schemes, save and reopen v3, and check per-type Callout settings and independent course titles. Reading an old scheme alone must not write the file. Keep rollback copies for official 0.2.4.
- [ ] Cancel an export and close/change the preview during slow resource reads; confirm recovery without stale output. Resource timeouts remain errors, repeated resources reuse the task cache, and already saved files remain reported accurately.

## Validation and later release records

- [ ] GitHub `npm run check` and clean-build CI succeed on the exact target commit.
- [ ] Community dashboard **Review branch** scan shows no blocking Errors; Warning cleanup is not itself an approval requirement.
- [ ] Record actual screenshots / exported PDFs and pass/fail per check. Until this is done, host acceptance is **not completed**.
- [ ] For an authorized later public release, keep manifest.json, package.json and package-lock.json versions aligned, provide matching release notes and record the new tag. The current reconciliation does not publish remotely.
- [ ] Verify the 3 Release assets and GitHub artifact attestations when published. Do not overwrite existing releases.

Official scanner: https://docs.obsidian.md/community-directory/manage-entry
