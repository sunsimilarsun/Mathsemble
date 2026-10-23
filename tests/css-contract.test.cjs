'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
const boundary = "/* Isolate controls and A4 simulation from Obsidian's own note layout. */";

function embeddedPrintCss() {
  const tag = 'module.exports = {typographyCss:';
  const start = source.indexOf(tag);
  const end = source.indexOf('};\nreturn module.exports; })();', start);
  assert.ok(start >= 0 && end > start, 'embedded print CSS found');
  return JSON.parse(source.slice(start + tag.length, end));
}

test('the isolated PDF stylesheet matches styles.css print section exactly', () => {
  const end = css.indexOf(boundary);
  assert.ok(end > 0, 'explicit export/UI boundary');
  assert.equal(embeddedPrintCss(), css.slice(0, end));
});

test('plugin stylesheet avoids important declarations and confines modal controls', () => {
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /!important\b/i);
  assert.match(css, /\.mwb-modal \.mwb-page/);
  assert.match(css, /\.mwb-modal \.mwb-measure-layer/);
  assert.match(css, /\.mwb-modal \.mwb-controls/);
  assert.doesNotMatch(css, /\.mwb-modal \.mwb-[\w-]+ \.mwb-modal \.mwb-/);
});

test('answer geometry and collapsed callouts retain explicit print styling', () => {
  const print = embeddedPrintCss();
  for (const cls of ['mwb-answer-space','mwb-answer-space-chunk','mwb-answer-slot',
    'mwb-teacher-fill-slot','mwb-choice-slot','mwb-options-measuring','mwb-fixed-blank',
    'mwb-print-document .callout.is-collapsed']) assert.ok(print.includes(cls), cls);
  assert.match(print, /\.mwb-typography \.mwb-choice-slot[\s\S]*?border-bottom: none/);
  assert.match(css, /\.mwb-cm-math-answer-slot\.mwb-fill-answer/);
  assert.match(css, /\.mwb-cm-text-answer-slot\.mwb-choice-answer/);
  assert.doesNotMatch(print, /\.mwb-modal \.mwb-/);
});

test('teaching callouts retain reading and live-preview reach without YAML', () => {
  for (const type of ['definition','theorem','method','conclusion','attention','thinking','answer','scaffold','solution'])
    assert.ok(css.includes('data-callout="' + type + '"'), type);
  assert.ok(css.includes('.markdown-preview-view'));
  assert.ok(css.includes('.markdown-source-view.mod-cm6'));
  assert.ok(!css.includes('data-callout="example"'));
});

test('MathJax custom container is retained and only its lint diagnostics are suppressed', () => {
  const typeSelector = 'mjx-container';
  const matches = [...css.matchAll(/\bmjx-container\b/g)];
  // Includes one explanatory comment and five CSS selector groups (six tokens).
  assert.ok(matches.length >= 7, 'MathJax container references retained');
  const nextLineCount = [...css.matchAll(/stylelint-disable-next-line selector-type-no-unknown -- MathJax creates mjx-container DOM elements\./g)].length;
  assert.equal(nextLineCount, 4, 'four single selector groups locally exempted');
  assert.equal((css.match(/stylelint-disable selector-type-no-unknown -- Only MathJax-rendered/g) || []).length, 1);
  assert.equal((css.match(/stylelint-enable selector-type-no-unknown/g) || []).length, 1);
  assert.ok(embeddedPrintCss().includes('.mwb-print-document mjx-container[display="true"]'));
  assert.ok(embeddedPrintCss().includes('.mwb-print-document mjx-container svg'));
});
