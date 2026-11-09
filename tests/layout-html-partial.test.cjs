'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/plugin.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]
  .find(candidate => candidate && fs.existsSync(candidate));

test('saved alternative HTML receives only the acknowledged warning categories', async () => {
  const captured = [];
  const obsidian = {Plugin:class {}, Modal:class {}, Notice:class {}, MarkdownRenderer:{}, MarkdownView:class {}};
  const context = {module:{exports:{}}, require:name => name === 'obsidian' ? obsidian : require(name),
    console, Buffer, captured};
  vm.runInNewContext(source + '\n;globalThis.ReviewModal = PreviewModal;' +
    '\nmwbPaginateSavedHtml = async (html, doc, options) => { captured.push(options); return html; };', context);
  for (const [approved, warnings, imageAllowed, mathAllowed] of [
    [true, ['存在未加载或加载失败的图片'], true, false],
    [true, ['MathJax 公式语法错误'], false, true],
    [false, ['存在未加载或加载失败的图片'], false, false],
  ]) {
    const modal = Object.create(context.ReviewModal.prototype);
    Object.assign(modal, {
      layout:'two-column', file:{basename:'测试讲义'}, partialExportApproved:approved, renderWarnings:warnings,
      rendered:{ownerDocument:{}}, status:{setText() {}}, app:{vault:{getAbstractFileByPath:() => ({}), create:async () => {}}},
      beginExport:() => ({mode:'student', controller:new AbortController()}),
      preparePrintHtml:async () => '<main>测试讲义</main>', assertCurrentExport() {}, assertSourceCurrent:async () => {},
      resourceSummary:() => '', finishExport() {}, reportExportFailure(job, error) { throw error; },
    });
    await modal.saveHtml();
    const options = captured.at(-1);
    assert.equal(options.allowPartialImage, imageAllowed);
    assert.equal(options.allowPartialMath, mathAllowed);
  }
});

test('real Chromium: saved layouts handle malformed images only with image-specific consent', async t => {
  if (!chrome) {
    if (process.env.CI) throw new Error('Chrome/Chromium is required in CI; set CHROME_PATH');
    t.skip('Set CHROME_PATH to run browser image consent checks'); return;
  }
  const start = source.indexOf('function paginatePrintDocument(');
  const paginator = source.slice(start, source.indexOf('// Serialize a pure browser function.', start));
  const abortHelpers = source.slice(source.indexOf('function mwbRenderAbortError('),
    source.indexOf('// The deadline also covers a stalled response body.'));
  const savedStart = source.indexOf('async function mwbPaginateSavedHtml(');
  const savedHelper = source.slice(savedStart, source.indexOf('const { typographyCss } =', savedStart));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-html-image-consent-'));
  try {
    const script = `${paginator}\nconst paginatePreviewDocument = paginatePrintDocument;\n` +
      `${abortHelpers}\n${savedHelper}\nconst appearanceCss = ${JSON.stringify(css)};\n(${browserCases.toString()})();`;
    const input = path.join(directory, 'fixture.html');
    fs.writeFileSync(input, '<!doctype html><meta charset="utf-8"><body><script>' +
      script.replace(/<\/script/gi, '<\\/script') + '</script></body>');
    const results = await runChromeDocument(chrome, input, path.join(directory, 'profile'));
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    fs.rmSync(directory, {recursive:true, force:true, maxRetries:10, retryDelay:100});
  }
});

async function browserCases() {
  const results = [];
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, callback) => {
    try { await callback(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, error:String(error.stack || error)}); }
  };
  const goodImage = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20"/></svg>');
  const html = layout => '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'; font-src data:;">' +
    '<style>' + appearanceCss + '</style></head><body>' +
    `<main class="mwb-export-doc mwb-typography mwb-print-document" data-mwb-layout="${layout}">` +
    (layout === 'trial' ? '<div class="mwb-trial-header" style="height:30mm">试听信息</div>' : '') +
    '<p>BEFORE_IMAGE</p><p><img src="data:image/png;base64,AAAA" alt="损坏图片 &lt;script&gt;test&lt;/script&gt;"></p>' +
    `<p><img src="${goodImage}" alt="有效图片"></p><p>AFTER_IMAGE</p></main></body></html>`;

  await check('missing image approval blocks both layouts and removes temporary frames', async () => {
    for (const layout of ['two-column', 'trial']) {
      let failure;
      try { await mwbPaginateSavedHtml(html(layout), document); } catch (error) { failure = error; }
      ok(failure && /图片加载失败/.test(failure.message), 'malformed data image was accepted without consent');
      ok(!document.querySelector('iframe'), 'failed export leaked its temporary frame');
    }
  });
  await check('math and overflow permissions do not permit image omission', async () => {
    let failure;
    try { await mwbPaginateSavedHtml(html('two-column'), document, {allowPartialMath:true, allowOverflowOmission:true}); }
    catch (error) { failure = error; }
    ok(failure && /图片加载失败/.test(failure.message), 'non-image consent allowed a malformed image');
    ok(!document.querySelector('iframe'), 'rejected export leaked its temporary frame');
  });
  await check('image approval emits a visible marker and preserves valid images and surrounding content', async () => {
    for (const layout of ['two-column', 'trial']) {
      const saved = await mwbPaginateSavedHtml(html(layout), document, {allowPartialImage:true});
      const output = new DOMParser().parseFromString(saved, 'text/html');
      const marker = output.querySelector('.mwb-missing-image');
      ok(marker?.textContent === '[图片未能导出：损坏图片 <script>test</script>]', 'missing visible or safely escaped omission marker');
      ok(output.querySelectorAll('img').length === 1 && output.querySelector('img').getAttribute('alt') === '有效图片', 'valid image removed or failed image retained');
      ok(output.querySelectorAll('.mwb-paper').length === 1, 'static sheet missing');
      const text = output.body.textContent;
      ok(text.indexOf('BEFORE_IMAGE') < text.indexOf(marker.textContent) && text.indexOf(marker.textContent) < text.indexOf('AFTER_IMAGE'), 'surrounding content reordered or lost');
      ok(!output.querySelector('script, iframe'), 'active content leaked into saved HTML');
      ok(!document.querySelector('iframe'), 'successful export leaked its temporary frame');
    }
  });
  await check('image approval does not bypass cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    let failure;
    try { await mwbPaginateSavedHtml(html('two-column'), document, {allowPartialImage:true, signal:controller.signal}); }
    catch (error) { failure = error; }
    ok(failure?.name === 'AbortError', 'cancellation was treated as image permission');
    ok(!document.querySelector('iframe'), 'cancelled export created a temporary frame');
  });
  const output = document.createElement('pre');
  output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results);
  document.body.appendChild(output);
}
