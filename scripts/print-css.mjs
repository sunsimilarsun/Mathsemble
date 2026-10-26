// styles.css is the only authored source of printing CSS. The literal in
// src/plugin.js is a generated mirror retained for Obsidian clean-build scans.
export const printBoundary = "/* Isolate controls and A4 simulation from Obsidian's own note layout. */";
const binding = /module\.exports = \{typographyCss:("(?:\\.|[^"\\])*")\};/g;
export function synchronizePrintCss(source, css) {
  if (typeof source !== 'string' || typeof css !== 'string') throw new TypeError('Source and CSS must be text');
  const boundary = css.indexOf(printBoundary);
  if (boundary < 0 || css.indexOf(printBoundary, boundary + 1) >= 0)
    throw new Error('Expected one explicit print/UI stylesheet boundary');
  const matches = [...source.matchAll(binding)];
  if (matches.length !== 1) throw new Error('Expected one generated typographyCss binding');
  // Parse before replacement to reject a corrupt generated block, not mask it.
  JSON.parse(matches[0][1]);
  return source.replace(binding, () => 'module.exports = {typographyCss:' + JSON.stringify(css.slice(0, boundary)) + '};');
}
