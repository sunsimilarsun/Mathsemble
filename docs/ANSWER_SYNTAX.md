# Typed answer slots: fill / choice

Current version: [0.2.5](https://github.com/sunsimilarsun/Mathsemble/releases/tag/0.2.5). The authoritative writing contract is
[MARKDOWN_SPEC.md](MARKDOWN_SPEC.md); this page summarizes answer migration.

Mathsemble now recognizes `?{answer}` as fill and `!{answer}` as choice.
Nested LaTeX braces are supported; a math fill can be `?{$\frac{1}{2}$}`.
Authors add outer parentheses for choices when needed, e.g. `（!{B}）`.
Native `==highlight==` is not an answer, even inside parentheses.
Escaped typed markers, inline code, fenced blocks and YAML are not transformed.

## Answers and explanations by question type

Choice and true/false questions use `!{...}` in the question text; fill-in
questions use `?{...}` at each blank. True/false slots may contain
`!{$\checkmark$}` or `!{$\times$}`. These types have no `answer` Callout;
put the explanation in `[!solution]-` without a separate answer summary.

For calculation, written-response and proof questions, `[!answer]-` contains
the full standard response: required working, reasoning and conclusions,
including applicable case splits and equality conditions. `[!solution]-` is
optional supplementary explanation. Hiding `solution` in the teacher version
must leave a complete full-credit response in `answer`.

## Migration safety

Old answers written as `==42==` or `(==B==)` must be reviewed and migrated manually.
Do not silently rewrite note files. Mixed escaped and unescaped typed markers in one
Reading View section remain unmodified to avoid mistaking an escaped literal for an answer.
Typed slots were introduced during the 0.1.11 development work and remain the
current syntax. The published v0.1.10 uses legacy highlighting answers.
Current question boundaries and pagination follow the H5 writing contract.

## Callout changes from official 0.2.4

Only `-` marks a version-filtered block. `+` and unmarked Callouts are shared,
including `answer` and `solution`; they can therefore expose their contents in
student output. Review old `+` answers individually instead of bulk-replacing
every fold marker.

An accessible `answer-` is hidden with measured writing space for students and
shown for teachers. Other `-` types default to no student space and no teacher
display; select each type separately for either behavior. An omitted ancestor
removes its whole subtree: a nested `answer-` does not override that omission.
Measuring a selected outer blank retains all its descendants, independently of
teacher display choices, without double-counting nested blanks.

The Reading View “显示／隐藏答案” control changes the current view only. It does
not rewrite notes or change A4 projection settings. Scheme files are read as
v1/v2/v3 and saved as v3; official 0.2.4 cannot read v3.
