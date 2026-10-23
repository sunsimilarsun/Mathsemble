# Typed answer slots: fill / choice

Mathsemble now recognizes `?{answer}` as fill and `!{answer}` as choice.
Nested LaTeX braces are supported; a math fill can be `?{$\frac{1}{2}$}`.
Authors add outer parentheses for choices when needed, e.g. `（!{B}）`.
Native `==highlight==` is not an answer, even inside parentheses.
Escaped typed markers, inline code, fenced blocks and YAML are not transformed.

## Migration safety

Old answers written as `==42==` or `(==B==)` must be reviewed and migrated manually.
Do not silently rewrite note files. Mixed escaped and unescaped typed markers in one
Reading View section remain unmodified to avoid mistaking an escaped literal for an answer.
This initial change is on the development main branch only, not in v0.1.10 Release.
PDF pagination and answer-space heights remain unchanged.