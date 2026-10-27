# Typed answer slots: fill / choice

Current source: 0.1.15 development. The authoritative writing contract is
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
current 0.1.15 syntax. The published v0.1.10 uses legacy highlighting answers.
Current question boundaries and pagination follow the H5 writing contract.
