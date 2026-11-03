'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function load() {
  const logs = [], commands = [];
  class Plugin {
    addCommand(command) { commands.push(command); }
    registerMarkdownPostProcessor() {}
    registerEditorExtension() {}
  }
  class MarkdownView {}
  const obsidian = {
    Plugin, MarkdownView, Modal: class {}, Notice: class {},
    MarkdownRenderer: {}, finishRenderMath: async () => {},
    renderMath: () => { throw Error('No MathJax host in naming tests'); },
  };
  const context = {
    module: {exports: {}}, Buffer, performance, setTimeout, clearTimeout,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push({level, args})])),
    navigator: {clipboard: {writeText: async () => { throw Error('clipboard unavailable'); }}},
    require: name => {
      if (name === 'obsidian') return obsidian;
      if (name === '@codemirror/view') throw Error('host not installed');
      return require(name);
    },
  };
  vm.runInNewContext(source + '\n;globalThis.namingApi={pdfBufferFromHtml};', context, {filename: 'src/plugin.js'});
  return {context, logs, commands};
}

test('naming: product and package names agree; installed compatibility identity is unchanged', () => {
  assert.equal(manifest.name, 'Mathsemble');
  assert.equal(pkg.name, 'mathsemble');
  assert.equal(manifest.id, 'math-teaching-workbench');
  assert.equal(pkg.version, manifest.version);
});

test('naming: actual exported class is MathsemblePlugin', () => {
  const {context} = load();
  assert.equal(context.module.exports.name, 'MathsemblePlugin');
});

test('naming: production runtime and generated bundle have no old brand', () => {
  for (const file of ['src/plugin.js', 'main.js']) {
    const code = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(code, /Math Teaching Workbench|MathTeachingWorkbench|math-teaching-workbench-pdf-/);
    const labels = Array.from(code.matchAll(/console\.(?:log|warn|error)\('([^']+)'/g), m => m[1]);
    assert.ok(labels.length >= 5, 'expected production log sites');
    for (const label of labels) assert.ok(label.startsWith('[Mathsemble] '), label);
  }
});

test('naming: all preview modes and the role picker use the Mathsemble brand', () => {
  for (const title of [
    'Mathsemble · Markdown 文档 A4 预览（实验版）',
    'Mathsemble · 数学试卷 A4 预览',
    'Mathsemble · 数学题卡 A4 预览',
    'Mathsemble · 设置题卡默认教学角色',
  ]) assert.ok(source.includes(title), title);
});

test('naming: installation documentation explicitly distinguishes the product and compatibility ID', () => {
  for (const file of ['README.md', 'docs/NAMING.md']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(text, /Mathsemble/);
    assert.match(text, /兼容插件 ID/);
    assert.match(text, /\.obsidian\/plugins\/math-teaching-workbench\//);
    assert.match(text, /sunsimilarsun\/Mathsemble/);
  }
});

test('naming: generated main.js is byte-for-byte synchronized with source', () => {
  assert.deepEqual(fs.readFileSync(path.join(root, 'main.js')), fs.readFileSync(path.join(root, 'src/plugin.js')));
});

test('naming: actual diagnostic fallback and host-error logs identify Mathsemble', async () => {
  const {context, logs, commands} = load();
  const plugin = new context.module.exports();
  plugin.manifest = manifest;
  plugin.app = {
    workspace: {
      getLeavesOfType: () => [],
      onLayoutReady: callback => callback(),
      getActiveViewOfType: () => ({
        file: {path: 'example.md'}, editor: {},
        containerEl: {querySelector: () => null, classList: {contains: () => false}},
      }),
    },
    vault: {read: async () => '普通正文'},
    metadataCache: {getFileCache: () => ({})},
  };
  await plugin.onload();
  const diagnostic = commands.find(command => command.id === 'diagnose-answer-visibility');
  assert.ok(diagnostic);
  await diagnostic.callback();
  const report = logs.find(log => log.args[0] === '[Mathsemble] 答案显隐诊断');
  assert.ok(report);
  assert.equal(report.args[1].插件, 'Mathsemble');
  assert.ok(logs.some(log => log.args[0] === '[Mathsemble] CodeMirror 6 答案隐藏扩展加载失败'));
  assert.equal(commands.length, 6);
  assert.deepEqual(commands.map(command => command.id), [
    'set-current-line-question-heading', 'diagnose-answer-visibility',
    'preview-current-markdown-document', 'preview-current-question',
    'set-current-question-teaching-role', 'preview-current-folder-exam',
  ]);
});

for (const failure of [false, true]) {
  test('naming: actual temp-file lifecycle uses mathsemble-pdf- and cleans up; fail=' + failure, async () => {
    const {context} = load();
    let loaded, destroyed = false;
    class FakeBrowserWindow {
      constructor(options) {
        assert.equal(options.webPreferences.sandbox, true);
        assert.equal(options.webPreferences.contextIsolation, true);
        assert.equal(options.webPreferences.nodeIntegration, false);
        this.webContents = {
          executeJavaScript: async () => ({badImage: false, badMath: false}),
          // A synthetic buffer validates lifecycle only, not PDF rendering.
          printToPDF: async () => Buffer.from('%PDF-1.4\n%%EOF\n'),
        };
      }
      async loadFile(file) {
        loaded = file;
        assert.match(path.basename(path.dirname(file)), /^mathsemble-pdf-/);
        assert.match(fs.readFileSync(file, 'utf8'), /naming lifecycle/);
        if (failure) throw Error('simulated load failure');
      }
      isDestroyed() { return destroyed; }
      destroy() { destroyed = true; }
    }
    const promise = context.namingApi.pdfBufferFromHtml('<!doctype html><p>naming lifecycle</p>', FakeBrowserWindow);
    if (failure) await assert.rejects(promise, /simulated load failure/);
    else assert.equal((await promise).subarray(0, 5).toString(), '%PDF-');
    assert.ok(loaded);
    assert.equal(destroyed, true);
    assert.equal(fs.existsSync(path.dirname(loaded)), false);
  });
}
