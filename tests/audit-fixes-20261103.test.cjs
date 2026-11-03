'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {loadApi} = require('./helpers/audit-api.cjs');
const api = loadApi();
const literalCases = {
  fence: '语法：\n\n```markdown\n$x^2$\n```',
  tildeFence: '~~~\n$$x$$\n~~~',
  indented: '语法\n\n    $x^2$',
  inline: '语法 `$x^2$`。',
  ticks: '语法 ``a `$x^2$` b``。',
  comment: '正文 <!-- $x^2$ -->',
  multilineComment: '正文 <!--\n$$x$$\n--> 结束',
  escaped: String.raw`正文 \$x^2\$`,
  yaml: '---\nlabel: "$x$"\n---\n正文',
  url: 'https://example.test/$x$',
  link: '[示例](https://example.test/$x$)',
  htmlAttribute: '<span title="$x$">正文</span>',
  rawHtml: '<pre>$x$</pre>',
  quotedFence: '> ```\n> $x$\n> ```',
  listFence: '- 示例\n  ```\n  $x$\n  ```',
  unmatched: '未闭合 $x',
  empty: '$$$$ 和 $ $',
};
for (const [name, markdown] of Object.entries(literalCases)) {
  test('A2 literal mathematics does not require MathJax: ' + name, () => {
    assert.equal(api.mwbHasRenderableMath(markdown), false);
  });
}
for (const [name, markdown] of Object.entries({
  inline: '$x^2$', display: '$$x^2$$', multiline: '$$\nx^2\n$$',
  tex: String.raw`$$\frac{1}{2}$$`,
  afterCode: '`$literal$` 后 $x^2$', afterComment: '<!-- $$ --> $x$',
  mixedHtml: '<span title="$literal$">$x$</span>',
  quote: '> $$\n> x^2\n> $$', list: '- $x^2$', standaloneSlot: '?{$x^2$}',
})) test('A2 real mathematics remains detectable: ' + name, () => {
  assert.equal(api.mwbHasRenderableMath(markdown), true);
});
const fakeRoot = () => ({
  textContent: '正文', parentElement: null,
  querySelectorAll: () => [], querySelector: selector => selector.includes('p,') ? {} : null,
  getBoundingClientRect: () => ({width: 600, height: 50, left: 0, right: 600}),
});
test('A2 real missing math is still a blocker; literal code is not', () => {
  const root = fakeRoot();
  assert.equal(api.issuesInRenderedNode(root, '```\n$x$\n```').length, 0);
  const issues = api.issuesInRenderedNode(root, '$x$');
  assert.ok(issues.some(x => x.includes('尚未检测到渲染结果')));
  assert.equal(api.divideRenderIssues(root, issues).blockers.length, 1);
});
function guardApi(math, fonts = Promise.resolve()) {
  let disconnected = 0;
  const scoped = loadApi({obsidian: {finishRenderMath: math}, globals: {
    document: {fonts: {ready: fonts}},
    MutationObserver: class { observe() {} disconnect() { disconnected++; } },
  }});
  return {scoped, disconnected: () => disconnected};
}
test('A3 hanging MathJax is bounded before observer startup', async () => {
  const {scoped} = guardApi(() => new Promise(() => {}));
  const begin = performance.now();
  await assert.rejects(scoped.waitForStableRender(fakeRoot(), '正文', 0, 25), /超时.*MathJax/);
  assert.ok(performance.now() - begin < 1000);
});
test('A3 fonts share the same deadline and cannot wait indefinitely', async () => {
  const {scoped} = guardApi(async () => {}, new Promise(() => {}));
  await assert.rejects(scoped.waitForStableRender(fakeRoot(), '正文', 0, 25), /超时.*字体/);
});
test('A3 render guard disconnects observer on success', async () => {
  const {scoped, disconnected} = guardApi(async () => {});
  assert.equal((await scoped.waitForStableRender(fakeRoot(), '正文', 0, 300)).length, 0);
  assert.equal(disconnected(), 1);
});
test('A3 guard releases observer on blocker timeout', async () => {
  const {scoped, disconnected} = guardApi(async () => {});
  await assert.rejects(scoped.waitForStableRender(fakeRoot(), '$x$', 0, 25), /超时/);
  assert.equal(disconnected(), 1);
});
test('A3 expired deadline never starts work; thrown errors propagate', async () => {
  let called = false;
  await assert.rejects(api.mwbBeforeDeadline(() => { called = true; }, performance.now()-1, 'test'), /超时/);
  assert.equal(called, false);
  await assert.rejects(api.mwbBeforeDeadline(() => { throw Error('original'); }, performance.now()+100, 'test'), /original/);
});
test('A3 late rejection is consumed and a subsequent render can finish', async () => {
  let rejectLate;
  await assert.rejects(api.mwbBeforeDeadline(() => new Promise((_,r) => {rejectLate=r;}), performance.now()+20, 'test'), /超时/);
  rejectLate(Error('late error'));
  assert.equal(await api.mwbBeforeDeadline(() => 42, performance.now()+100, 'next'), 42);
});
// A tiny tree tests asynchronous ownership, not browser geometry.
function tinyTree() {
  const doc = {createElement: () => make()};
  function make() { return {
    ownerDocument: doc, children: [], parent: null,
    get firstChild() {return this.children[0] || null;},
    appendChild(child) {child.remove?.(); this.children.push(child);child.parent=this;return child;},
    insertBefore(child, ref) {child.remove?.(); const i=this.children.indexOf(ref);this.children.splice(i,0,child);child.parent=this;},
    remove() { if(this.parent) {const p=this.parent;p.children.splice(p.children.indexOf(this),1);this.parent=null;} },
  }; }
  return make();
}
class TestComponent {
  constructor() {this.children=[];this.unloaded=false;}
  addChild(c) {this.children.push(c);return c;}
  removeChild(c) {this.children.splice(this.children.indexOf(c),1);c.unload();}
  unload() {this.unloaded=true;for(const c of this.children)c.unload();this.children=[];}
}
test('A3 timed-out Markdown render cannot write into a subsequent preview', async () => {
  const target=tinyTree(), owner=new TestComponent(); let late;
  const scoped=loadApi({obsidian:{Component:TestComponent,MarkdownRenderer:{render:(_a,_s,stage)=>
    new Promise(resolve=>{late=()=>{stage.appendChild(stage.ownerDocument.createElement('p'));resolve();};})}}});
  await assert.rejects(scoped.mwbRenderMarkdown({},'正文',target,'test.md',owner,20), /超时.*Markdown/);
  assert.equal(target.children.length,0);
  assert.equal(owner.children.length,0);
  const next=target.ownerDocument.createElement('p');target.appendChild(next);
  late();await new Promise(r=>setTimeout(r,10));
  assert.deepEqual(target.children,[next]);
});
test('A3 successful staging is flattened and render children unload with owner', async () => {
  const target=tinyTree(), owner=new TestComponent();
  const scoped=loadApi({obsidian:{Component:TestComponent,MarkdownRenderer:{render:async(_a,_s,stage)=>{
    stage.appendChild(stage.ownerDocument.createElement('p'));
    stage.appendChild(stage.ownerDocument.createElement('p'));
  }}}});
  await scoped.mwbRenderMarkdown({},'正文',target,'test.md',owner,100);
  assert.equal(target.children.length,2);
  assert.equal(owner.children.length,1);
  const child=owner.children[0];owner.unload();assert.equal(child.unloaded,true);
});
for(const [name, meta, label, role] of [
  ['formal',{role:'example'},'例题','example'],
  ['legacy',{teaching_role:'practice'},'练习','practice'],
  ['conflict',{role:'practice',teaching_role:'example'},'练习','practice'],
  ['test alias',{role:'test',teaching_role:'assessment'},'检测','assessment'],
  ['homework',{role:'homework'},'作业','homework'],
  ['null fallback',{role:null,teaching_role:'variant'},'变式','variant'],
  ['explicit empty',{role:'',teaching_role:'variant'},'',null],
]) test('A4 summary and printed role agree: '+name,()=>{
  const value=api.teachingRoleMetadata('',meta);
  assert.equal(value.role,role);assert.equal(value.label,label);
  assert.equal(api.formatMeta(meta,['role'])[0]?.value || '', label);
});
test('A4 YAML null remains missing while quoted null remains invalid',()=>{
  for(const token of ['null','~',''])assert.equal(api.teachingRoleMetadata(`---\nrole: ${token}\n---`).state,'missing');
  assert.equal(api.teachingRoleMetadata('---\nrole: "null"\n---').state,'invalid');
});
test('A4 metadata cache is authoritative for assembly and summary',()=>{
  const input={file:{path:'test.md'},markdown:'---\nrole: practice\n---\n正文',metadata:{object_type:'item',role:'example'}};
  const exam=api.collectExamItems([input]);
  assert.equal(exam.items[0].teachingRole.role,'example');
  assert.equal(api.teachingRoleSummary([input]),'例题1');
  assert.equal(api.teachingRoleSummary([{metadata:{role:'homework'},markdown:''}]),'作业1');
});
test('A4 equivalent aliases do not cause false conflict; real conflict still warns',()=>{
  assert.ok(!api.metadataAudit({role:'test',teaching_role:'assessment'}).warnings.some(x=>x.includes('不一致')));
  assert.ok(api.metadataAudit({role:'practice',teaching_role:'example'}).warnings.some(x=>x.includes('不一致')));
});
function picker(meta) {
  const buttons=[];
  const ui={empty(){},createDiv(){return this;},createEl(tag,opts){
    if(tag==='button'){const button={text:opts.text};buttons.push(button);return button;}return this;
  }};
  const modal=new api.RolePickerModal({fileManager:{processFrontMatter:async(_f,fn)=>fn(meta)}},{});
  modal.contentEl=ui;modal.onOpen();
  return label=>buttons.find(x=>x.text===label).onclick();
}
test('A4 explicit set writes formal role and removes conflicting legacy alias',async()=>{
  const meta={role:'practice',teaching_role:'variant',id:'kept'};
  await picker(meta)('例题');assert.deepEqual(meta,{role:'example',id:'kept'});
  await picker(meta)('检测');assert.equal(meta.role,'test');
  await picker(meta)('作业');assert.equal(meta.role,'homework');
});
test('A4 clear removes both fields, not unrelated metadata',async()=>{
  const meta={role:'practice',teaching_role:'example',id:'kept'};
  await picker(meta)('清除角色（未标注）');assert.deepEqual(meta,{id:'kept'});
  assert.equal(api.teachingRoleMetadata('',meta).state,'missing');
});
