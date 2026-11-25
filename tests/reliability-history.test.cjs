'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
function loadPreview(finishRenderMath = async () => {}) {
  class Modal {
    constructor(app) { this.app = app; }
    close() {}
  }
  const obsidian = {Plugin:class {}, Modal, Notice:class {}, finishRenderMath};
  const context = {module:{exports:{}}, require:name => name==='obsidian' ? obsidian : require(name),
    Buffer, console, performance, setTimeout, clearTimeout};
  return vm.runInNewContext(source + '\n;({waitForStableRender,issuesInRenderedNode,metadataAudit,RolePickerModal,paginatePreviewDocument})', context);
}

test('preview deadlines identify a stalled native MathJax or font operation before observing layout', {timeout:5000}, async () => {
  const pending = new Promise(() => {});
  const target = {querySelectorAll:() => [], ownerDocument:{fonts:{ready:pending}}};
  const math = loadPreview(() => pending);
  await assert.rejects(math.waitForStableRender(target, '正文', 0, 100), /超时.*MathJax/);
  const fonts = loadPreview();
  await assert.rejects(fonts.waitForStableRender(target, '正文', 0, 100), /超时.*字体/);
});

test('missing-formula diagnostics distinguish escaped, code and resource literals from math in the same note', () => {
  const {issuesInRenderedNode} = loadPreview();
  const target = {querySelectorAll:() => [], querySelector:() => null, textContent:'题干',
    getBoundingClientRect:() => ({left:0, right:600, width:600})};
  const literal = '正文 \\$5 与 `$x$`。 [图](https://example.test/$label$/image.png)\n\n> ```\n> $y$\n> ```';
  const missing = issues => issues.some(issue => issue.includes('尚未检测到渲染结果'));
  assert.equal(missing(issuesInRenderedNode(target, literal)), false);
  assert.equal(missing(issuesInRenderedNode(target, literal+'\n\n求 $x+y$。')), true);
});

test('role edits use current Chinese values, remove the legacy alias and preserve other metadata', async () => {
  const {metadataAudit, RolePickerModal} = loadPreview();
  const conflict = meta => metadataAudit(meta).warnings.some(message => message.includes('不一致'));
  assert.equal(conflict({role:'test',teaching_role:'assessment'}), false);
  const fields = {id:'Q1',role:'practice',teaching_role:'example'};
  assert.equal(conflict(fields), true);
  const file = {path:'题库/题.md'};
  const modal = new RolePickerModal({fileManager:{processFrontMatter:async (target, update) => {
    assert.equal(target, file);
    update(fields);
  }}}, file);
  const buttons = new Map();
  modal.contentEl = {
    empty() {}, createDiv() { return this; }, createEl(tag, {text}) {
      const node = {};
      if (tag==='button') buttons.set(text, node);
      return node;
    },
  };
  modal.onOpen();
  await buttons.get('例题').onclick();
  assert.deepEqual(fields, {id:'Q1', role:'例题'});
  fields.teaching_role = 'variant';
  await buttons.get('清除角色（未标注）').onclick();
  assert.deepEqual(fields, {id:'Q1'});
});

function longListCase(paginate) {
  const output = document.createElement('pre');
  output.id = 'mwb-test-results';
  try {
    const root = document.createElement('main');
    root.className = 'mwb-export-doc mwb-typography mwb-print-document';
    root.innerHTML = '<div class="callout" data-callout="answer"><div class="callout-title">解答</div><div class="callout-content"><ol start="7"><li><strong id="derivation"></strong></li><li id="following">验算。</li></ol></div></div>';
    document.body.append(root);
    const text = '说明函数的单调性并验证结果。abc😀𝑥 '.repeat(450);
    root.querySelector('strong').textContent = text;
    const report = paginate(root);
    const fragments = [...root.querySelectorAll('li:not(#following)')];
    output.textContent = JSON.stringify({pages:report.pages, fragments:fragments.length,
      complete:[...root.querySelectorAll('strong')].map(node=>node.textContent).join('')===text,
      anchors:root.querySelectorAll('#derivation').length, next:root.querySelectorAll('#following').length,
      numbers:fragments.map(node=>node.value), continuation:fragments.slice(1).every(node=>node.style.listStyleType==='none'),
      last:root.querySelectorAll('li')[fragments.length]?.id});
  } catch (error) { output.textContent = JSON.stringify({error:String(error.stack || error)}); }
  document.body.append(output);
}

test('paginating a single long answer list item preserves Unicode, its anchor and its original list number', async t => {
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(candidate => candidate && fs.existsSync(candidate));
  if (!chrome) {
    if (process.env.CI) throw new Error('Set CHROME_PATH for the list continuation regression');
    return t.skip('Set CHROME_PATH to run Chromium layout tests');
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-list-continuation-'));
  try {
    const css = fs.readFileSync(path.join(root,'styles.css'), 'utf8');
    const script = '('+longListCase.toString()+')('+loadPreview().paginatePreviewDocument.toString()+');';
    const input = path.join(folder, 'case.html');
    fs.writeFileSync(input, '<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const result = await runChromeDocument(chrome, input, path.join(folder, 'profile'));
    assert.ifError(result.error);
    assert(result.pages >= 2 && result.fragments >= 2);
    assert.equal(result.complete, true);
    assert.equal(result.anchors, 1);
    assert.equal(result.next, 1);
    assert.equal(result.last, 'following');
    assert(result.numbers.every(number => number===7));
    assert.equal(result.continuation, true);
  } finally { fs.rmSync(folder, {recursive:true,force:true,maxRetries:5,retryDelay:100}); }
});
