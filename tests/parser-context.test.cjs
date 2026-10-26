'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { runChromeDocument } = require('./helpers/run-chromium.cjs');

// Exercise the authoritative implementation without requiring a generated bundle
// or a running Obsidian instance. These cases verify source projection, not PDF layout.
const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const context = {
  console, Buffer, module: { exports: {} },
  require: name => name === 'obsidian' ? {
    Plugin: class {}, Modal: class {}, Notice: class {}, MarkdownRenderer: {}, MarkdownView: class {},
    finishRenderMath: () => Promise.resolve(),
    renderMath: () => { throw Error('No Obsidian MathJax host in source projection tests'); },
  } : require(name),
};
vm.runInNewContext(source + '\nglobalThis.audit={handoutPlan,transformQuestion,answerSlots,mwbValidateTypedAnswers,mwbTeacherMeasurementPlan,mwbHandoutQuestionPlan,normalizePrintBlanks,createMathAnswerEditorExtension};', context);
const a = context.audit;
const studentOutputs = markdown => [a.handoutPlan(markdown, 'student').markdown, a.transformQuestion(markdown, 'student')];

test('comments cannot change math state or conceal a real teacher-only Callout from projection', () => {
  for (const comment of [
    '<!-- $$ -->',
    '<!-- $$ ?{\n> [!answer]- literal example\n> LITERAL_EXAMPLE\n-->',
    '<!-- first line\n    $$ ?{ -->',
  ]) {
    const markdown = comment + '\n\n##### 例1\n题干 ?{SLOT_SECRET}\n\n> [!answer]- 完整答案\n> TEACHER_SECRET';
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), []);
    assert.equal(a.answerSlots(markdown).length, 1);
    for (const student of studentOutputs(markdown)) {
      assert.ok(student.startsWith(comment));
      assert.doesNotMatch(student, /TEACHER_SECRET|SLOT_SECRET/);
      assert.match(student, /mwb-answer-slot/);
    }
    const plan = a.handoutPlan(markdown, 'student');
    const measured = a.mwbTeacherMeasurementPlan(markdown);
    assert.equal(plan.solutionCount, 1);
    assert.equal(measured.blocks.length, 1);
    assert.equal(measured.targets.length, 1);
    assert.equal(measured.targets[0].id, plan.targets[0].id);
    assert.match(measured.markdown, /TEACHER_SECRET/);
    assert.equal(a.mwbHandoutQuestionPlan(markdown).groups.length, 1);
  }
});

test('resource addresses and HTML attributes stay literal beside real answer slots', () => {
  const literals = [
    '[参考](https://example.com/?{42})',
    '![图](images/a!{42}.png "?{broken")',
    '[label ?{42}][reference]',
    '[[题卡 ?{42}|题名]]',
    'https://example.com/?{42}',
    '<https://example.com/?{42}>',
    '<span title="?{42} > $$">说明</span>',
    '<span title="first\n    $$ ?{broken\nlast">说明</span>',
    '<span\n title="$$ ?{broken">说明</span>',
  ];
  for (const literal of literals) {
    const markdown = literal + ' 求值 ?{REAL_SECRET}。';
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), [], literal);
    assert.equal(a.answerSlots(markdown).length, 1, literal);
    for (const student of studentOutputs(markdown)) {
      assert.ok(student.startsWith(literal), literal);
      assert.doesNotMatch(student, /REAL_SECRET/);
      assert.equal((student.match(/mwb-answer-slot/g) || []).length, 1);
    }
  }
  const reference = '[ref]: https://example.com/?{42} "$$ ?{"';
  const markdown = reference + '\n\n?{REAL_SECRET}';
  assert.equal(a.answerSlots(markdown).length, 1);
  assert.ok(a.handoutPlan(markdown, 'student').markdown.startsWith(reference));
});

test('raw HTML content cannot create fake answers, Callouts or a lasting math state', () => {
  for (const tag of ['pre', 'code', 'script', 'style', 'textarea']) {
    const literal = `<${tag}\n class="example">$$ ?{broken ___\n> [!answer]- literal\n> LITERAL\n</${tag}>`;
    const markdown = literal + '\n\n> [!answer]- real\n> TEACHER_SECRET';
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), []);
    assert.equal(a.answerSlots(markdown).length, 0);
    assert.equal(a.mwbTeacherMeasurementPlan(markdown).targets.length, 1);
    for (const student of studentOutputs(markdown)) {
      assert.ok(student.startsWith(literal), tag);
      assert.doesNotMatch(student, /TEACHER_SECRET/);
    }
  }
  const markdown = '<span\n title="$$">text</span>\n\n正文 ?{SLOT_SECRET}\n\n> [!answer]- 答案\n> TEACHER_SECRET';
  assert.equal(a.answerSlots(markdown).length, 1);
  const plan = a.handoutPlan(markdown, 'student');
  const measurement = a.mwbTeacherMeasurementPlan(markdown);
  assert.equal(plan.solutionCount, 1);
  assert.equal(measurement.targets.length, 1);
  assert.equal(measurement.targets[0].id, plan.targets[0].id);
  for (const output of studentOutputs(markdown)) assert.doesNotMatch(output, /SLOT_SECRET|TEACHER_SECRET/);
});

test('paragraph continuations and basic list continuations conceal typed answers', () => {
  // In CommonMark these are paragraph/list content, not indented code blocks.
  for (const markdown of [
    '题干\n    答案 ?{REAL_SECRET}',
    '题干\n\t答案 ?{REAL_SECRET}',
    '<!-- comment -->题干\n    答案 ?{REAL_SECRET}',
    '<span>题干</span>\n    答案 ?{REAL_SECRET}',
    '1. 求值\n\n    答案 ?{REAL_SECRET}',
    '- 求值\n\n    答案 ?{REAL_SECRET}',
    '1. 求值\n   - 小问\n\n     答案 ?{REAL_SECRET}',
    '> [!note] 题干\n> 1. 求值\n>\n>     答案 ?{REAL_SECRET}',
  ]) {
    assert.equal(a.answerSlots(markdown).length, 1, markdown);
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), []);
    for (const student of studentOutputs(markdown)) {
      assert.doesNotMatch(student, /REAL_SECRET/, markdown);
      assert.match(student, /mwb-answer-slot/);
    }
    assert.match(a.handoutPlan(markdown, 'teacher').markdown, /REAL_SECRET/);
  }
});

test('actual indented code, fenced code and escaped markers retain literal syntax', () => {
  for (const markdown of [
    '    ?{LITERAL} ___ ?{',
    '\t?{LITERAL} ___ ?{',
    '题干\n\n    ?{LITERAL} ___ ?{',
    '题干\n2. 普通续段\n\n    ?{LITERAL} ___ ?{',
    '题干\n2) 普通续段\n\n    ?{LITERAL} ___ ?{',
    '题干\n- \n\n    ?{LITERAL} ___ ?{',
    '1. 求值\n\n       ?{LITERAL} ___ ?{',
    '1. 求值\n\n       - ?{LITERAL} ___ ?{',
    '> [!note] 示例\n>     ?{LITERAL} ___ ?{',
    '```md\n?{LITERAL} ___ ?{\n```',
    '- ```md\n  ?{LITERAL} ___ ?{\n  ```',
    '> ~~~~md\n> ?{LITERAL} ___ ?{\n> ~~~~',
    '`?{LITERAL}` \\?{LITERAL}',
  ]) {
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), [], markdown);
    assert.equal(a.answerSlots(markdown).length, 0, markdown);
    for (const student of studentOutputs(markdown)) {
      assert.match(student, /\?\{LITERAL\}/, markdown);
      assert.doesNotMatch(student, /mwb-answer-slot|mwb-fixed-blank/);
    }
  }
});

test('new ordered lists start at one when interrupting a paragraph, while existing siblings keep their numbers', () => {
  for (const markdown of [
    '题干\n1. 新列表\n\n    ?{REAL_SECRET}',
    '题干\n- 新列表\n\n    ?{REAL_SECRET}',
    '1. 第一项\n2. 第二项\n\n    ?{REAL_SECRET}',
    '2. 独立起点\n3. 第二项\n\n    ?{REAL_SECRET}',
  ]) {
    assert.equal(a.answerSlots(markdown).length, 1, markdown);
    for (const student of studentOutputs(markdown)) assert.doesNotMatch(student, /REAL_SECRET/);
  }
});

test('unclosed list fences end at their container boundary without consuming later answers', () => {
  // CommonMark 4.5: an unclosed fence stops at the end of its containing block.
  // Ordinary paragraphs cannot lazily continue a fenced code block in a list.
  for (const markdown of [
    '- ```md\n  ?{CODE}\n\n正文 ?{REAL_SECRET}',
    '- ```md\n  ?{CODE}\n- 新题 ?{REAL_SECRET}',
    '1. ```md\n   ?{CODE}\n2. 新题 ?{REAL_SECRET}',
    '- parent\n  - ```md\n    ?{CODE}\n  - 新题 ?{REAL_SECRET}',
    '> - ```md\n>   ?{CODE}\n>\n> 正文 ?{REAL_SECRET}',
  ]) {
    assert.equal(a.answerSlots(markdown).length, 1, markdown);
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), []);
    for (const student of studentOutputs(markdown)) {
      assert.match(student, /\?\{CODE\}/);
      assert.doesNotMatch(student, /REAL_SECRET/);
    }
  }
  const markdown = '- ```md\n  ?{CODE}\n\n##### 例1\n题干 ?{REAL_SECRET}\n\n> [!answer]- 完整答案\n> TEACHER_SECRET';
  const student = a.handoutPlan(markdown, 'student');
  const measured = a.mwbTeacherMeasurementPlan(markdown);
  assert.equal(a.answerSlots(markdown).length, 1);
  assert.equal(student.solutionCount, 1);
  assert.equal(measured.blocks.length, 1);
  assert.equal(measured.targets.length, 1);
  assert.equal(measured.targets[0].id, student.targets[0].id);
  assert.match(measured.markdown, /TEACHER_SECRET/);
  for (const output of studentOutputs(markdown)) assert.doesNotMatch(output, /REAL_SECRET|TEACHER_SECRET/);
  assert.match(a.mwbValidateTypedAnswers('- ```\n  literal\n\n正文 ?{').join('\n'), /第 4 行/);
});

test('blank lines do not end list fences and top-level unclosed fences remain literal', () => {
  for (const markdown of [
    '- ```md\n  ?{CODE}\n\n  ?{LITERAL}\n  ```',
    '```md\n?{CODE}\n\n正文 ?{LITERAL}\n- ?{LITERAL}\n> [!answer]- literal\n> LITERAL',
  ]) {
    assert.equal(a.answerSlots(markdown).length, 0, markdown);
    assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(markdown)), []);
    assert.equal(a.mwbTeacherMeasurementPlan(markdown).targets.length, 0);
    for (const output of studentOutputs(markdown)) {
      assert.equal(output, markdown);
      assert.doesNotMatch(output, /mwb-answer-slot|MWB_SOLUTION_SPACE_ANCHOR/);
    }
  }
});

test('real math and real malformed answers remain active outside literal regions', () => {
  for (const markdown of [
    '$x=?{REAL_SECRET}$',
    '$$\n    x=?{REAL_SECRET}\n$$',
    '> [!note] Formula\n> $$\n>     x=?{REAL_SECRET}\n> $$',
  ]) {
    assert.equal(a.answerSlots(markdown).length, 1);
    for (const student of studentOutputs(markdown)) {
      assert.doesNotMatch(student, /REAL_SECRET|<span/);
      assert.match(student, /\\underline/);
    }
  }
  const markdown = '<!-- ?{ignored -->\n\n题干\n    ?{';
  assert.match(a.mwbValidateTypedAnswers(markdown).join('\n'), /第 4 行/);
  assert.throws(() => a.handoutPlan(markdown, 'student'), /答案槽花括号未闭合/);
  assert.throws(() => a.transformQuestion(markdown, 'student'), /答案槽花括号未闭合/);
  assert.match(a.handoutPlan('比较 x<3，求值 ?{42}', 'student').markdown, /mwb-answer-slot/);
});

test('fixed blanks share literal protection and paragraph/list indentation context', () => {
  const literal = '<pre>___\n___</pre>\n<!-- ___ -->\n<span title="___">说明</span>';
  const result = a.normalizePrintBlanks(literal + '\n\n1. 求值\n\n    答案 ______。');
  assert.ok(result.startsWith(literal));
  assert.equal((result.match(/mwb-fixed-blank/g) || []).length, 1);
});

test('math widgets distinguish fill and choice when document edits keep selection outside the slot', () => {
  let Extension;
  const runtime = {
    ViewPlugin: { fromClass: cls => (Extension = cls) }, WidgetType: class {},
    Decoration: { none: [], replace: ({ widget }) => ({ range: () => widget }), set: ranges => ranges },
  };
  a.createMathAnswerEditorExtension(runtime, () => {}, () => {});
  const view = text => ({
    dom: { closest: () => true },
    state: { doc: { toString: () => text }, selection: { ranges: [{ from: 20, to: 20 }] } },
    visibleRanges: [{ from: 0, to: 100 }],
  });
  const fill = new Extension(view('?{$x$}')).decorations[0];
  const sameFill = new Extension(view('?{$x$}')).decorations[0];
  const choice = new Extension(view('!{$x$}')).decorations[0];
  assert.equal(fill.eq(sameFill), true);
  assert.equal(fill.eq(choice), false);
  assert.equal(choice.eq(fill), false);
});

test('Reading View leaves literal links untouched beside a real answer slot', async t => {
  const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => file && fs.existsSync(file));
  if (!chrome) { if (process.env.CI) throw Error('Chrome required in CI'); t.skip('Set CHROME_PATH'); return; }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-parser-'));
  const stub = 'const module={exports:{}};function require(){return {Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{}};}';
  const body = `
    const markdown='[链接 ?{LITERAL}](https://example.com) 正文 ?{REAL}';
    const root=document.createElement('div');
    root.innerHTML='<p><a href="https://example.com">链接 ?{LITERAL}</a> 正文 ?{REAL}</p>';
    document.body.append(root);
    const count=mwbDecorateReadingTypedSlots(root,markdown);
    const ok=count===1&&root.querySelector('a').textContent==='链接 ?{LITERAL}'&&root.querySelector('mark')?.textContent==='REAL';
    const result=document.createElement('pre');result.id='mwb-test-results';
    result.textContent=JSON.stringify([{name:'literal link and real answer',ok,error:root.innerHTML}]);document.body.append(result);
  `;
  const html = '<!doctype html><meta charset="utf-8"><body><script>' + (stub + '\n' + source + '\n' + body).replace(/<\/script/gi, '<\\/script') + '</script></body>';
  const input = path.join(temp, 'parser.html');
  fs.writeFileSync(input, html);
  try { for (const result of await runChromeDocument(chrome, input, path.join(temp, 'profile'))) assert.equal(result.ok, true, result.error); }
  finally { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
});
