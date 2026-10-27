'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const rootPath = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootPath, 'src/plugin.js'), 'utf8');
const css = fs.readFileSync(path.join(rootPath, 'styles.css'), 'utf8');
const obsidian = {Plugin: class {}, Modal: class {}, Notice: class {}, MarkdownRenderer: {},
  MarkdownView: class {}, finishRenderMath: () => Promise.resolve()};
const context = {module: {exports: {}}, require: name => name === 'obsidian' ? obsidian : require(name), Buffer, console};
vm.runInNewContext(source + '\nglobalThis.paginate = paginatePreviewDocument;', context);
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(candidate => candidate && fs.existsSync(candidate));

test('real Chromium: explicit page breaks preserve content, questions and writing space', async t => {
  if (!chrome) {
    if (process.env.CI) throw Error('CI requires Chrome/Chromium for explicit page-break layout regression');
    t.skip('Set CHROME_PATH to run browser page-break tests');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-page-breaks-'));
  const script = `const paginate = ${context.paginate.toString()};\n(${runCases.toString()})();`;
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
    '</style></head><body><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>';
  try {
    const input = path.join(directory, 'cases.html');
    fs.writeFileSync(input, html);
    const results = await runChromeDocument(chrome, input, path.join(directory, 'profile'));
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
});

async function runCases() {
  const results = [];
  const ok = (condition, message) => { if (!condition) throw Error(message); };
  const check = (name, callback) => {
    try { callback(); results.push({name, ok: true}); }
    catch (error) { results.push({name, ok: false, error: error.stack || error.message}); }
  };
  const br = '<div class="mwb-page-break" data-mwb-page-break="true"></div>';
  const p = (key, height = 15) => `<p data-key="${key}" style="height:${height}mm;margin:0">${key}</p>`;
  const heading = (key, className = '') => `<h2 class="${className}" data-key="${key}" style="height:10mm;margin:0">${key}</h2>`;
  const question = (id, blocks, exam = false) => `<section class="${exam ? 'mwb-exam-question' : 'mwb-handout-question'}" ` +
    `data-mwb-question-id="${id}" data-mwb-question-label="${id}"><div class="mwb-exam-question-content">${blocks.join('')}</div></section>`;
  const space = heights => {
    const pixels = heights.map(height => height * 96 / 25.4);
    return `<div class="mwb-answer-space" data-mwb-space-px="${pixels.reduce((total, height) => total + height, 0)}">` +
      pixels.map((height, index) => `<div class="mwb-answer-space-chunk" data-key="space${index}" style="height:${height}px"></div>`).join('') + '</div>';
  };
  const initialStyles = new Set(document.head.querySelectorAll('style'));
  let host;
  const layout = (html, {preview = false, strict = true} = {}) => {
    host?.remove();
    // An earlier print call must not supply global paper geometry to preview.
    for (const style of document.head.querySelectorAll('style')) if (!initialStyles.has(style)) style.remove();
    host = document.createElement('div');
    host.className = preview ? 'mwb-modal' : '';
    const root = document.createElement('main');
    root.className = 'mwb-export-doc mwb-typography mwb-print-document' + (preview ? ' mwb-preview-pages' : '');
    if (strict) root.setAttribute('data-mwb-question-policy', 'strict-h5');
    root.innerHTML = html;
    host.appendChild(root);
    document.body.appendChild(host);
    const originals = [...root.querySelectorAll('[data-key]')];
    const keys = originals.map(node => node.dataset.key);
    const report = paginate(root, false, preview);
    const pages = [...root.querySelectorAll('.mwb-paper-body')];
    const outputKeys = pages.flatMap(page => [...page.querySelectorAll('[data-key]')].map(node => node.dataset.key));
    ok(JSON.stringify(outputKeys) === JSON.stringify(keys), 'content lost, duplicated or reordered');
    ok(originals.every(node => root.contains(node)), 'existing rendered nodes were lost or recreated');
    ok(!root.querySelector('.mwb-page-break'), 'page-break marker leaked into page content');
    ok(pages.every(page => page.children.length > 0), 'an empty page was created');
    return {root, pages, report, pageOf: key => pages.findIndex(page => [...page.querySelectorAll('[data-key]')].some(node => node.dataset.key === key))};
  };
  await document.fonts.ready;
  check('a marker forces short ordinary content onto the next page', () => {
    const result = layout(p('before') + br + p('after'));
    ok(result.report.pages === 2 && result.pageOf('before') === 0 && result.pageOf('after') === 1, 'break ignored');
    ok(result.report.forcedPageBreaks === 1, 'explicit break not reported');
  });
  check('leading, consecutive and trailing markers do not produce empty sheets', () => {
    const result = layout(br + p('before') + br + br + p('after') + br);
    ok(result.report.pages === 2 && result.pageOf('after') === 1, 'marker emitted an empty sheet');
    ok(result.report.forcedPageBreaks === 4, 'not all explicit markers were consumed');
  });
  check('a trailing marker permits 200 real pages while a 201st page remains blocked', () => {
    const content = Array.from({length: 200}, (_, index) => p(`page${index}`, 5)).join(br);
    const result = layout(content + br);
    ok(result.report.pages === 200 && result.pageOf('page199') === 199,
      'a trailing marker incorrectly exceeded the 200-page limit');
    let failure = null;
    try { layout(content + br + p('page200', 5)); }
    catch (error) { failure = error; }
    ok(failure && /超过 200 页/.test(failure.message), 'a real 201st page bypassed the page limit');
  });
  check('pending document and exam headings stay on their authored side of a break', () => {
    for (const className of ['', 'mwb-exam-title', 'mwb-exam-section']) {
      const result = layout(heading('before', className) + br + heading('after') + p('body'));
      ok(result.pageOf('before') === 0 && result.pageOf('after') === 1 && result.pageOf('body') === 1,
        `heading crossed its explicit boundary: ${className}`);
    }
    for (const before of [p('before'), heading('before', 'mwb-exam-title')]) {
      const result = layout(before + br + heading('after') +
        question('LONG', Array.from({length: 10}, (_, index) => p(`long${index}`, 30))));
      ok(result.pageOf('before') === 0 && result.pageOf('after') === 1 && result.pageOf('long0') === 1,
        'pending explicit break and strict long-question start created an extra page');
      ok(result.report.pages === 3, 'strict long question emitted an extra page around its pending heading');
    }
  });
  check('an explicit boundary overrides strict whole-question keeping and preserves its ID', () => {
    const result = layout(question('Q1', [p('stem'), br, p('answer')]));
    const audit = result.report.strictQuestionPages[0];
    ok(result.pageOf('stem') === 0 && result.pageOf('answer') === 1, 'strict short question ignored explicit break');
    ok(audit.id === 'Q1' && audit.forced && !audit.short && audit.pages.join(',') === '1,2', 'strict forced-break report is incorrect');
    ok([...result.root.querySelectorAll('.mwb-question-fragment')].every(node => node.dataset.mwbQuestionId === 'Q1'),
      'question ID changed across its explicit boundary');
  });
  check('each short segment remains intact when its preceding page is nearly full', () => {
    const result = layout(p('filler', 235) + question('Q1', [p('first', 20), p('second', 20), br, p('third', 20)]));
    ok(result.pageOf('first') === 1 && result.pageOf('second') === 1 && result.pageOf('third') === 2,
      'short segment split or explicit boundary ignored');
  });
  check('a long segment splits safely and preserves every student writing chunk and its height', () => {
    const result = layout(question('Q1', [p('stem', 20), br, p('prompt', 20), space(Array(18).fill(20))]));
    ok(result.pageOf('stem') === 0 && result.pageOf('prompt') === 1 && result.pageOf('space0') === 1, 'long segment did not begin after break');
    ok(result.report.pages >= 3 && result.report.answerSpaceChunks === 18, 'long space was not safely paginated');
    ok(Math.abs(result.report.answerSpaceDeltaPx) < 0.01, 'allocated student writing height changed');
  });
  check('ordinary horizontal rules remain on the same page', () => {
    const result = layout(p('before') + '<hr>' + p('after'));
    ok(result.report.pages === 1 && result.report.forcedPageBreaks === 0, 'ordinary horizontal rule triggered a page break');
    ok(result.root.querySelectorAll('hr').length === 1, 'ordinary horizontal rule was removed');
  });
  check('preview and isolated printing assign the same explicit question segments to pages', () => {
    const html = p('filler', 235) + question('Q1', [p('stem', 20), p('answer', 20), br, p('next', 20)]);
    const printed = layout(html);
    const assignment = ['filler', 'stem', 'answer', 'next'].map(printed.pageOf);
    const audit = JSON.stringify(printed.report.strictQuestionPages);
    const previewed = layout(html, {preview: true});
    ok(JSON.stringify(assignment) === JSON.stringify(['filler', 'stem', 'answer', 'next'].map(previewed.pageOf)), 'preview/print page assignments differ');
    ok(audit === JSON.stringify(previewed.report.strictQuestionPages), 'preview/print question reports differ');
  });
  check('strict and legacy folder exams keep the source question number exactly once', () => {
    for (const strict of [true, false]) {
      const stem = p('stem').replace('>stem<', '><span class="mwb-question-index">1.</span>stem<');
      const result = layout(question('EXAM1', [stem, br, p('answer')], true), {strict});
      ok(result.pageOf('stem') === 0 && result.pageOf('answer') === 1, 'folder exam explicit break ignored');
      ok(result.root.querySelectorAll('.mwb-question-index').length === 1, 'source question number duplicated');
    }
  });
  const output = document.createElement('pre');
  output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results);
  document.body.appendChild(output);
}
