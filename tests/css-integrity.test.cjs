'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const css=fs.readFileSync(path.join(root,'styles.css'),'utf8').replace(/\r\n?/g,'\n');
const js=fs.readFileSync(path.join(root,'main.js'),'utf8');
const workflow=fs.readFileSync(path.join(root,'.github/workflows/release.yml'),'utf8');

test('embedded print CSS equals the initial stylesheet prefix',()=>{
  const match=js.match(/module\.exports = \{typographyCss:("(?:\\.|[^"\\])*")\};/);
  assert.ok(match,'print CSS not embedded');
  const embedded=JSON.parse(match[1]);
  assert.ok(embedded.length>10000);
  assert.ok(css.startsWith(embedded),'embedded PDF and external style prefix diverged');
});
test('preserve high-impact mathematics/answer/print layout CSS',()=>{
  for(const fragment of [
    'display: block;\n  visibility: visible;',
    '-webkit-text-fill-color: transparent;',
    'visibility: hidden;',
    'border-bottom: none;',
    'page-break-inside: auto;',
    'page-break-inside: avoid;',
    'mjx-container svg'
  ])assert.ok(css.includes(fragment),fragment);
  assert.ok(css.includes('.mwb-answer-space-chunk'));
  assert.ok(css.includes('.mwb-typography :is(ul,ol).mwb-options.mwb-options-measuring'),
    'option width probe must outrank the final choice grid');
});
test('choice border declarations exist only in the final effective override',()=>{
  const target=[
    'mark.mwb-hover-answer.mwb-choice-answer,',
    '.markdown-source-view.mod-cm6.is-live-preview .mwb-cm-math-answer-slot.mwb-choice-answer,',
    'mark.mwb-hover-answer.mwb-reading-answer-math.mwb-choice-answer {',
    '  border: 0;',
    '  border-bottom: none;',
    '  box-shadow: none;'
  ].join('\n');
  assert.equal(css.split(target).length-1,1);
  assert.equal((css.match(/!important/g)||[]).length,0);
});
test('release workflow is version-aware, immutable and build-verified',()=>{
  assert.ok(workflow.includes('docs/RELEASE_NOTES_${GITHUB_REF_NAME}.md'));
  assert.ok(workflow.includes('git diff --exit-code -- main.js'));
  assert.ok(workflow.includes('Release $GITHUB_REF_NAME already exists'));
  assert.ok(!workflow.includes('gh release upload'));
  assert.ok(!workflow.includes('RELEASE_NOTES_0.1.9.md'));
});
