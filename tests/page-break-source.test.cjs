'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');

const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const renders = [];
class Component {
  constructor() { this.children = []; }
  addChild(child) { this.children.push(child); return child; }
  removeChild(child) { this.children.splice(this.children.indexOf(child),1); child.unload(); }
  unload() { this.unloaded = true; }
}
// Model the renderer's owned staging tree rather than assuming the native
// host receives the published preview directly. No HTML parser is needed here.
function createTarget() {
  class Node {
    constructor(doc, tag) { this.ownerDocument=doc; this.tagName=tag; this.childNodes=[]; this.parentNode=null; }
    get parentElement() { return this.parentNode; }
    get firstChild() { return this.childNodes[0] || null; }
    appendChild(child) { child.remove(); this.childNodes.push(child); child.parentNode=this; return child; }
    insertBefore(child,before) { child.remove(); this.childNodes.splice(this.childNodes.indexOf(before),0,child); child.parentNode=this; return child; }
    remove() { if(this.parentNode){this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this),1);this.parentNode=null;} }
  }
  const doc={createElement:tag=>new Node(doc,tag)};
  return doc.createElement('main');
}
const context = {
  console, Buffer, performance, setTimeout, clearTimeout, module: {exports:{}},
  require: name => name === 'obsidian' ? {
    Plugin:class {}, Component, Modal:class {}, Notice:class {}, MarkdownView:class {},
    MarkdownRenderer:{render:async (...args) => {
      renders.push(args);
      const result=args[2].ownerDocument.createElement('render-result');result.textContent=args[1];args[2].appendChild(result);
      return 'rendered';
    }},
    finishRenderMath:() => Promise.resolve(),
    renderMath:() => {throw Error('No MathJax host in source projection tests');},
  } : require(name),
};
vm.runInNewContext(source + '\nglobalThis.pageBreaks={mwbPageBreakLines,mwbProjectPageBreaks,mwbRenderMarkdown,mwbRenderSignalFor,mwbRenderDeadlineFor,mwbHandoutQuestionPlan,handoutPlan,studentSpacePlan,mwbTeacherMeasurementPlan};', context);
const a = context.pageBreaks;
const indices = text => Array.from(a.mwbPageBreakLines(text));

test('page breaks require exactly six top-level hyphens, with optional trailing horizontal whitespace', () => {
  for (const line of ['------','------ ','------\t']) {
    assert.deepEqual(indices('前文\n' + line + '\n后文'), [1]);
    const rendered = a.mwbProjectPageBreaks('前文\r\n' + line + '\r\n后文');
    assert.match(rendered, /前文\n\n<div class="mwb-page-break" data-mwb-page-break="true" aria-hidden="true"><\/div>\n\n后文/);
  }
  for (const line of ['---','-----','-------','--------','- - - - - -',' ------','\t------','> ------','- ------','------ text','text ------','\\------','`------`']) {
    const text = '前文\n\n' + line + '\n\n后文';
    assert.deepEqual(indices(text), [], line);
    assert.equal(a.mwbProjectPageBreaks(text), text, line);
  }
});

test('page break spelling inside code, quotes, YAML, math, comments and HTML stays literal', () => {
  const literals = [
    '```md\n------\n```',
    '~~~~\n------\n~~~~',
    '    ------',
    '\t------',
    '> ------',
    '> [!answer]- 答案\n> ------',
    '- 内容\n  ------',
    '---\nfield: |\n  ------\n---',
    '---\n------\n---',
    '$$\n------\n$$',
    '\\[\n------\n\\]',
    '<!--\n------\n-->',
    '<!--\n<div>\n\n-->\n',
    '<pre>\n\n------\n\n</pre>',
    '<script>\n\n------\n\n</script>',
    '<div>\n------\n</div>',
    '<div\nclass="literal">\n------\n</div>',
    '<?process\n------\n?>',
    '<![CDATA[\n------\n]]>',
  ];
  for (const literal of literals) {
    assert.deepEqual(indices(literal), [], literal);
    const text = literal + '\n\n------\n后文';
    assert.equal(indices(text).length, 1, literal);
    assert.equal((a.mwbProjectPageBreaks(text).match(/data-mwb-page-break="true"/g) || []).length, 1, literal);
    assert.ok(a.mwbProjectPageBreaks(text).startsWith(literal), literal);
  }
});

test('a six-hyphen boundary after prose never becomes a Setext question boundary', () => {
  const text = '##### 例1\n题干\n------\n补充条件\n\n> [!answer]- 完整答案\n> SECRET\n\n##### 方法总结\n总结';
  const p = a.mwbHandoutQuestionPlan(text);
  assert.equal(p.headings.length, 2);
  assert.deepEqual(Array.from(p.groups,group=>group.title), ['例1','方法总结']);
  assert.equal(p.groups[0].end, 8);
  assert.equal(p.groups[0].answerCount, 1);
  assert.equal(p.markdown.split('\n').length, text.split('\n').length);
  assert.deepEqual(indices(p.markdown), [2]);
  const plain = a.studentSpacePlan(text);
  const mapped = a.studentSpacePlan(p.markdown);
  assert.deepEqual(Array.from(mapped.targets, x => x.id), Array.from(plain.targets, x => x.id));
  for (const length of [3,5,7]) {
    const ordinary = a.mwbHandoutQuestionPlan('##### 例1\n题干\n\n总结\n' + '-'.repeat(length) + '\n说明');
    assert.equal(ordinary.groups[0].end, 3, String(length));
    assert.equal(ordinary.headings.at(-1).level, 2, String(length));
  }
});

test('page break projection is shared by raw, student, teacher and measurement rendering', async () => {
  const text = '# 讲义\n\n##### 例1\n题干\n------\n后续条件\n\n> [!answer]- 解答\n> SECRET';
  const mapped = a.mwbHandoutQuestionPlan(text);
  const plans = ['document','student','teacher'].map(mode => a.handoutPlan(mapped.markdown, mode));
  plans.push(a.mwbTeacherMeasurementPlan(text));
  renders.length = 0;
  for (const plan of plans) {
    const app = {}, target = createTarget(), component = new Component();
    assert.equal(await a.mwbRenderMarkdown(app, plan.markdown, target, '讲义.md', component), 'rendered');
    const args = renders.at(-1);
    assert.equal(args[0], app);
    assert.match(args[1], /data-mwb-page-break="true"/);
    assert.notEqual(args[2], target, 'native rendering must stay isolated in staging until successful');
    assert.equal(args[2].ownerDocument, target.ownerDocument);
    assert.equal(args[2].parentNode, null, 'successful staging is detached');
    assert.equal(args[2].childNodes.length, 0, 'rendered nodes moved out of staging');
    assert.equal(target.childNodes.length, 1, 'only the rendered result is published');
    assert.equal(target.firstChild.textContent, args[1]);
    assert.equal(a.mwbRenderSignalFor(args[2]), undefined);
    assert.equal(a.mwbRenderDeadlineFor(args[2]), undefined, 'completed staging cannot retain a render deadline');
    assert.equal(args[3], '讲义.md');
    assert.notEqual(args[4], component, 'each native render has an owned child component');
    assert.equal(component.children[0], args[4]);
    assert.equal(args[4].unloaded, undefined, 'successful render ownership remains attached');
  }
  assert.equal((source.match(/MarkdownRenderer\.render\(/g) || []).length, 1, 'native renderer must only be called by the shared projection wrapper');
  assert.equal((source.match(/await mwbRenderMarkdown\(/g) || []).length, 7, 'all preview/measurement routes share the wrapper');
  assert.equal(a.mwbProjectPageBreaks(a.mwbProjectPageBreaks(text)), a.mwbProjectPageBreaks(text));
  assert.match(text, /\n------\n/, 'source remains unchanged');
});

test('generated answer spans do not hide an immediately following page boundary', () => {
  for (const slot of ['?{42}', '!{B}', '?{$x+1$}']) {
    const text = slot + '\n------\n后文';
    for (const mode of ['student','teacher']) {
      const plan = a.handoutPlan(text, mode);
      assert.deepEqual(indices(plan.markdown), [1], mode + ': ' + slot);
      assert.match(a.mwbProjectPageBreaks(plan.markdown), /data-mwb-page-break="true"/);
    }
  }
  const mapped = a.mwbHandoutQuestionPlan('##### 例1\n?{42}\n------\n后文');
  for (const mode of ['document','student','teacher'])
    assert.deepEqual(indices(a.handoutPlan(mapped.markdown, mode).markdown), [2], mode);
});

test('literal HTML tokens cannot leak math or fence state into later real boundaries', () => {
  for (const literal of [
    '<div>\n$$\n</div>',
    '<div>\n```\n</div>',
    '<div>\n\\[\n</div>',
    '<pre>\n\n$$\n```\n\\[\n</pre>',
    '<!--\n<div>\n\n$$\n```\n--> ',
  ]) {
    const text = literal + '\n\n------\n后文';
    assert.deepEqual(indices(text), [literal.split('\n').length + 1], literal);
    assert.match(a.mwbProjectPageBreaks(text), /data-mwb-page-break="true"/);
  }
});

test('dedenting out of a list ends its unclosed nested fence or math before a top-level boundary', () => {
  for (const list of [
    '- 条目\n\n  ```\n  literal',
    '- 条目\n  $$',
    '- $$',
    '- \\[',
    '1. 条目\n\n   ~~~~\n   literal',
    '- 条目\n  - 子项\n\n    ```\n    literal',
  ]) {
    const text = list + '\n------\n后文';
    assert.deepEqual(indices(text), [list.split('\n').length], list);
    assert.match(a.mwbProjectPageBreaks(text), /data-mwb-page-break="true"/);
    assert.ok(a.mwbProjectPageBreaks(text).startsWith(list), list);
  }
  assert.deepEqual(indices('```\n------\n后文'), [], 'an unclosed top-level fence still protects its contents');
  assert.deepEqual(indices('$$\n------\n后文'), [], 'unclosed top-level math still protects its contents');
});
