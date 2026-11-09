'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const rootPath = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(rootPath, 'src/plugin.js'), 'utf8');
const start = source.indexOf('function paginatePrintDocument(');
const end = source.indexOf('// Serialize a pure browser function.', start);
assert.ok(start >= 0 && end > start, 'production paginator is available');
const paginateSource = source.slice(start, end);
const css = fs.readFileSync(path.join(rootPath, 'styles.css'), 'utf8');
const abortHelpers = source.slice(source.indexOf('function mwbRenderAbortError('),
  source.indexOf('// The deadline also covers a stalled response body.'));
const exportStart = source.indexOf('const { exportHtml } = (() =>');
const exportHelpers = source.slice(exportStart, source.indexOf('const { typographyCss } =', exportStart));
const headerStart = source.indexOf('function mwbCreateTrialHeader(');
const headerHelper = source.slice(headerStart, source.indexOf('class PreviewModal', headerStart));
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]
  .find(value => value && fs.existsSync(value));

test('real Chromium: selectable page appearances preserve content and physical page boundaries', async t => {
  if (!chrome) {
    if (process.env.CI) throw new Error('Chrome/Chromium is required in CI; set CHROME_PATH');
    t.skip('Set CHROME_PATH to run browser appearance checks'); return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-appearance-'));
  try {
    const input = path.join(dir, 'fixture.html');
    const script = `${paginateSource}\nconst paginatePreviewDocument = paginatePrintDocument;\n` +
      `${abortHelpers}\n${headerHelper}\n${exportHelpers}\nconst appearanceCss = ${JSON.stringify(css)};\n` +
      `(${browserCases.toString()})();`;
    fs.writeFileSync(input, '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
      '</style></head><body><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
    const results = await runChromeDocument(chrome, input, path.join(dir, 'profile'));
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    fs.rmSync(dir, {recursive:true, force:true, maxRetries:10, retryDelay:100});
  }
});

test('real Chromium: appearance controls, measurement widths and dual-edition workers stay in sync', async t => {
  if (!chrome) {
    if (process.env.CI) throw new Error('Chrome/Chromium is required in CI; set CHROME_PATH');
    t.skip('Set CHROME_PATH to run browser appearance checks'); return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-appearance-ui-'));
  try {
    const stub = `const mockObsidian = {Plugin:class {}, Modal:class {constructor(app){this.app=app;}},
      Notice:class {}, MarkdownRenderer:{}, MarkdownView:class {}, finishRenderMath:()=>Promise.resolve()};
      const module = {exports:{}}; function require(name){return name==='obsidian'?mockObsidian:{};}`;
    const script = stub + '\n' + source + '\n(' + browserUiCases.toString() + ')();';
    const input = path.join(dir, 'fixture.html');
    fs.writeFileSync(input, '<!doctype html><html><head><meta charset="utf-8"><style>' + css +
      '</style></head><body><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>');
    const results = await runChromeDocument(chrome, input, path.join(dir, 'profile'));
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    fs.rmSync(dir, {recursive:true, force:true, maxRetries:10, retryDelay:100});
  }
});

async function browserUiCases() {
  const results = [];
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const check = async (name, fn) => {
    try { await fn(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, error:String(error.stack || error)}); }
  };
  HTMLElement.prototype.createEl = function(tag, opts = {}) {
    const element = document.createElement(tag);
    if (opts.cls) element.className = opts.cls;
    if (opts.text) element.textContent = opts.text;
    for (const key of ['type','value']) if (opts[key]) element[key] = opts[key];
    for (const [key,value] of Object.entries(opts.attr || {})) element.setAttribute(key, value);
    this.appendChild(element); return element;
  };
  HTMLElement.prototype.createDiv = function(opts) { return this.createEl('div', opts); };
  HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  HTMLElement.prototype.addClass = function(value) { this.classList.add(value); };
  HTMLElement.prototype.setText = function(value) { this.textContent = value; };
  HTMLElement.prototype.appendText = function(value) { this.appendChild(document.createTextNode(value)); };
  mockObsidian.MarkdownRenderer.render = async (_app, text, target) => { target.createEl('p', {text}); };
  const makeModal = () => {
    const modal = new PreviewModal({}, {manifest:{version:'test'}}, {basename:'外观测试',path:'appearance.md'},
      '求二次函数的对称轴，并结合图象说明理由。'.repeat(7));
    modal.modalEl = document.body.createDiv();
    modal.contentEl = modal.modalEl.createDiv({cls:'modal-content'});
    // The fixture renderer is synchronous plain text; production rendering,
    // source projection, width setup, pagination and controls remain real.
    modal.collectRenderWarnings = async () => {};
    modal.silentRender = true;
    return modal;
  };
  const verifyWidths = modal => {
    ok(modal.ready && modal.previewPages, modal.lastRenderError || modal.previewPaginationIssue || 'preview not ready');
    const body = modal.previewPages.querySelector('.mwb-paper-body');
    const sourceWidth = modal.rendered.getBoundingClientRect().width;
    const bodyWidth = body.getBoundingClientRect().width;
    ok(Math.abs(sourceWidth - bodyWidth) < 0.5, `${modal.layout}: source width ${sourceWidth} differs from physical body ${bodyWidth}`);
    const measurement = modal.createMeasurement().page;
    try {
      measurement.innerHTML = modal.rendered.innerHTML;
      const measureWidth = measurement.getBoundingClientRect().width;
      ok(Math.abs(measureWidth - bodyWidth) < 0.5, `${modal.layout}: teacher measurement width ${measureWidth} differs from physical body ${bodyWidth}`);
      assertMeasurementWidth(modal.rendered, measurement, 0.5);
    } finally { modal.removeMeasurement(measurement); }
    return sourceWidth;
  };
  await document.fonts.ready;
  await check('changing appearance rerenders visible sheets and uses their exact width for teacher measurement', async () => {
    const modal = makeModal();
    try {
      let renders = 0;
      const renderMode = modal.renderMode;
      modal.renderMode = function(mode) { renders++; return renderMode.call(this, mode); };
      modal.onOpen(); await modal.renderQueue;
      const picker = modal.contentEl.querySelector('[aria-label="排版外观"]');
      ok([...picker.options].map(option => option.textContent).join(',') === '默认排版,双列排版,试听排版', 'appearance menu choices missing');
      const widths = [];
      for (const appearance of ['default','two-column','trial','default']) {
        const previous = modal.previewPages;
        picker.value = appearance; picker.dispatchEvent(new Event('change'));
        await modal.renderQueue;
        widths.push(verifyWidths(modal));
        ok(modal.layout === appearance && !previous.isConnected, 'appearance change retained stale preview');
      }
      ok(renders === 5, 'appearance change did not schedule a complete rerender');
      ok(widths[1] < widths[0] * 0.5 && widths[2] > widths[1] && widths[2] < widths[0] && Math.abs(widths[0] - widths[3]) < 0.5,
        'switching away from an alternative appearance failed to restore default measurement width');
    } finally { modal.onClose(); modal.modalEl.remove(); }
  });
  await check('trial fields update the first visible sheet and remain available after changing appearances', async () => {
    const modal = makeModal();
    try {
      modal.onOpen(); await modal.renderQueue;
      const picker = modal.contentEl.querySelector('[aria-label="排版外观"]');
      picker.value = 'trial'; picker.dispatchEvent(new Event('change')); await modal.renderQueue;
      const details = modal.contentEl.querySelector('.mwb-trial-menu');
      ok(details.style.display !== 'none', 'trial information controls are hidden');
      const emptyCells = [...modal.previewPages.querySelectorAll('.mwb-trial-table td')].map(cell => cell.textContent);
      ok(emptyCells[0] === '孙老师' && emptyCells.slice(1).every(value => value === ''),
        'a document without properties must show only the default teacher, with no invented subject, title or goal numbers');
      for (const [label,value] of [['试听教师','孙老师'],['试听学生','小明'],['试听上课时间','周六 09:00'],
        ['试听学科','数学'],['试听年级','高一'],['试听课题名称','函数图象'],['试听学习目标','1. 识别图象\n2. 分析性质']]) {
        const input = modal.contentEl.querySelector(`[aria-label="${label}"]`);
        input.value = value; input.dispatchEvent(new Event('input')); await modal.renderQueue;
        ok(modal.previewPages.querySelector('.mwb-trial-header').textContent.includes(value), `${label} did not update the visible header`);
      }
      picker.value = 'two-column'; picker.dispatchEvent(new Event('change')); await modal.renderQueue;
      ok(details.style.display === 'none' && !modal.previewPages.querySelector('.mwb-trial-header'), 'trial controls or header leaked to double-column appearance');
      picker.value = 'trial'; picker.dispatchEvent(new Event('change')); await modal.renderQueue;
      ok(modal.previewPages.querySelector('.mwb-trial-header').textContent.includes('孙老师'), 'trial details were lost when switching appearances');
    } finally { modal.onClose(); modal.modalEl.remove(); }
  });
  await check('dual-edition workers retain an independent appearance snapshot for both student and teacher', async () => {
    const modal = makeModal();
    try {
      modal.onOpen(); await modal.renderQueue;
      for (const appearance of ['two-column','trial']) {
        modal.layout = appearance; modal.trialDetails.teacher = '快照教师';
        const settings = modal.dualExportSettings();
        modal.trialDetails.teacher = '随后修改';
        ok(settings.layout === appearance && settings.trialDetails.teacher === '快照教师', 'dual settings share mutable trial details');
        const input = {file:modal.file, markdown:modal.markdown, exam:null, documentMode:false,
          sourceScope:modal.sourceScope, sourceSnapshot:null, settingsKey:JSON.stringify(settings)};
        for (const edition of ['student','teacher']) {
          const context = modal.createDualExportWorker(input);
          try {
            const worker = context.worker;
            worker.collectRenderWarnings = async () => {};
            await worker.renderMode(edition);
            ok(worker.layout === appearance && worker.mode === edition, 'dual worker lost the selected appearance or edition');
            ok(worker.trialDetails.teacher === '快照教师' && worker.trialDetails !== modal.trialDetails, 'worker uses live mutable details');
            verifyWidths(worker);
            if (appearance === 'trial') ok(worker.previewPages.querySelector('.mwb-trial-header').textContent.includes('快照教师'), 'dual worker visible header ignores captured details');
            else ok(worker.previewPages.querySelectorAll('.mwb-paper-columns > .mwb-paper-body').length === 2, 'dual worker lost column layout');
          } finally { context.dispose(); }
        }
      }
      ok(!modal.contentEl.querySelector('.mwb-dual-export-host'), 'hidden dual worker leaked after disposal');
    } finally { modal.onClose(); modal.modalEl.remove(); }
  });
  const output = document.createElement('pre'); output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results); document.body.appendChild(output);
}

async function browserCases() {
  const results = [];
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const check = (name, fn) => {
    try { fn(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, error:String(error.stack || error)}); }
  };
  const checkAsync = async (name, fn) => {
    try { await fn(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, error:String(error.stack || error)}); }
  };
  const block = (key, height = 15) => `<div data-key="${key}" style="height:${height}mm;margin:0">${key}</div>`;
  const br = '<div class="mwb-page-break" data-mwb-page-break="true"></div>';
  const question = (id, content) => `<section class="mwb-handout-question" data-mwb-question-id="${id}" ` +
    `data-mwb-question-label="${id}"><div class="mwb-exam-question-content">${content}</div></section>`;
  const header = '<div class="mwb-trial-header" style="box-sizing:border-box;height:50mm;margin:0">' +
    '<table style="width:100%;margin:0"><tbody><tr><th>教师</th><td>示例教师</td><th>学生</th><td>示例学生</td></tr>' +
    '<tr><th>学科</th><td>数学</td><th>课题名称</th><td>二次函数</td></tr>' +
    '<tr><th>学习目标</th><td colspan="3">1. 理解图象<br>2. 解决问题</td></tr></tbody></table></div>';
  const math = key => `<div data-key="${key}" style="height:30mm;margin:0"><mjx-container jax="SVG" display="true" ` +
    `style="display:block;width:35mm;height:12mm" data-baseline="preserve"><svg xmlns="http://www.w3.org/2000/svg" ` +
    'width="120" height="40" viewBox="0 0 120 40"><text x="1" y="22" font-size="16">x² + y² = 1</text></svg></mjx-container></div>';
  const space = count => {
    const px = 25 * 96 / 25.4;
    return `<div class="mwb-answer-space" data-mwb-space-px="${count * px}">` +
      Array.from({length:count}, (_, i) => `<div class="mwb-answer-space-chunk" data-key="space${i}" style="height:${px}px"></div>`).join('') + '</div>';
  };
  const initialStyles = new Set(document.head.querySelectorAll('style'));
  let host;
  const layout = (html, {appearance = 'default', preview = false, strict = true} = {}) => {
    host?.remove();
    for (const style of document.head.querySelectorAll('style')) if (!initialStyles.has(style)) style.remove();
    host = document.createElement('div');
    host.className = preview ? 'mwb-modal' : '';
    const root = document.createElement('main');
    root.className = 'mwb-export-doc mwb-typography mwb-print-document' + (preview ? ' mwb-preview-pages' : '');
    if (appearance !== null) root.setAttribute('data-mwb-layout', appearance);
    if (strict) root.setAttribute('data-mwb-question-policy', 'strict-h5');
    root.innerHTML = (appearance === 'trial' ? header : '') + html;
    host.appendChild(root); document.body.appendChild(host);
    const originals = [...root.querySelectorAll('[data-key]')];
    const keys = originals.map(node => node.dataset.key);
    const formulas = [...root.querySelectorAll('mjx-container')];
    const formulaMarkup = formulas.map(node => node.outerHTML);
    const report = paginatePrintDocument(root, false, preview);
    const sheets = [...root.querySelectorAll('.mwb-paper')];
    const regions = [...root.querySelectorAll('.mwb-paper-body')];
    const outputKeys = regions.flatMap(body => [...body.querySelectorAll('[data-key]')].map(node => node.dataset.key));
    ok(JSON.stringify(outputKeys) === JSON.stringify(keys), 'content was lost, duplicated or reordered');
    ok(originals.every(node => root.contains(node)), 'rendered content was recreated or lost');
    ok(formulas.every((node, i) => root.contains(node) && node.outerHTML === formulaMarkup[i]), 'MathJax markup or node identity changed');
    ok(!root.querySelector('.mwb-page-break'), 'manual break marker leaked into content');
    ok(report.pages === sheets.length, 'page report counts columns instead of physical sheets');
    ok(sheets.every((sheet, i) => sheet.querySelectorAll('.mwb-paper-footer').length === 1 &&
      sheet.querySelector('.mwb-paper-footer').textContent === `${i + 1}/${sheets.length}`), 'physical page footer numbering is incorrect');
    const find = key => [...root.querySelectorAll('[data-key]')].find(node => node.dataset.key === key);
    const assignment = key => {
      const node = find(key), sheet = node.closest('.mwb-paper'), region = node.closest('.mwb-paper-body');
      return [sheets.indexOf(sheet), [...sheet.querySelectorAll('.mwb-paper-body')].indexOf(region)];
    };
    return {root, report, sheets, regions, assignment, find};
  };
  await document.fonts.ready;

  check('default and missing layout retain full-width single-column pagination', () => {
    const html = Array.from({length:3}, (_, i) => block(`block${i}`, 120)).join('');
    const explicit = layout(html);
    const assignment = ['block0','block1','block2'].map(explicit.assignment);
    ok(explicit.sheets.length === 2 && explicit.regions.length === 2, 'default page count changed');
    ok(explicit.regions[0].getBoundingClientRect().width > 660, 'default column no longer spans the page');
    const implicit = layout(html, {appearance:null});
    ok(JSON.stringify(assignment) === JSON.stringify(['block0','block1','block2'].map(implicit.assignment)), 'missing setting changed default behavior');
  });
  check('two columns fill top-to-bottom on the left, then right, then next physical page', () => {
    const result = layout(Array.from({length:5}, (_, i) => block(`block${i}`, 120)).join(''), {appearance:'two-column'});
    const actual = ['block0','block1','block2','block3','block4'].map(result.assignment);
    ok(JSON.stringify(actual) === JSON.stringify([[0,0],[0,0],[0,1],[0,1],[1,0]]), `incorrect reading order: ${JSON.stringify(actual)}`);
    const [left,right] = result.sheets[0].querySelectorAll('.mwb-paper-body');
    const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
    ok(Math.abs(a.width - b.width) < 0.5 && a.width > 315 && a.width < 330, 'columns do not have equal half-page widths');
    ok(Math.abs(a.top - b.top) < 0.5 && b.left - a.right > 25, 'columns are stacked or lack their gutter');
  });
  check('a manual page break skips the unused right column and starts next page on the left', () => {
    for (const html of [block('before') + br + block('after'), block('before', 250) + block('right', 40) + br + block('after')]) {
      const result = layout(html, {appearance:'two-column'});
      ok(JSON.stringify(result.assignment('after')) === '[1,0]', 'manual page break was treated as a column break');
      ok(result.report.forcedPageBreaks === 1 && result.report.pages === 2, 'manual page count incorrect');
    }
  });
  check('leading, repeated and trailing breaks create no additional empty two-column sheets', () => {
    const result = layout(br + block('before') + br + br + block('after') + br, {appearance:'two-column'});
    ok(result.report.pages === 2 && JSON.stringify(result.assignment('after')) === '[1,0]', 'empty physical sheet created');
  });
  check('strict short questions move intact to the next column on the same sheet', () => {
    const result = layout(block('filler', 235) + question('Q1', block('stem', 20) + block('answer', 25)), {appearance:'two-column'});
    ok(JSON.stringify(result.assignment('stem')) === '[0,1]' && JSON.stringify(result.assignment('answer')) === '[0,1]', 'short question split at column boundary');
    const audit = result.report.strictQuestionPages.find(item => item.id === 'Q1');
    ok(audit.short && audit.startPage === 1 && audit.endPage === 1 && audit.pages.join(',') === '1', 'question report used column numbers as page numbers');
  });
  check('long strict questions can continue into the right column without duplicating physical page reports', () => {
    const result = layout(question('Q1', Array.from({length:4}, (_, i) => block(`part${i}`, 110)).join('')), {appearance:'two-column'});
    ok(result.report.pages === 1 && JSON.stringify(result.assignment('part3')) === '[0,1]', 'long question did not flow across columns');
    const audit = result.report.strictQuestionPages.find(item => item.id === 'Q1');
    ok(!audit.short && audit.pages.join(',') === '1', 'one physical question page was reported twice');
  });
  check('student writing chunks and typeset math survive continuation across columns', () => {
    const result = layout(question('Q1', math('formula') + space(23)), {appearance:'two-column'});
    ok(result.report.pages >= 2 && result.report.answerSpaceChunks === 23, 'student space did not continue across columns and pages');
    ok(Math.abs(result.report.answerSpaceDeltaPx) < 0.01, 'student writing height changed');
    ok(result.root.querySelectorAll('mjx-container').length === 1, 'formula duplicated');
  });
  check('a formula that fits default width but exceeds a column remains a blocking overflow', () => {
    const wide = '<div><mjx-container jax="SVG" style="display:block;width:100mm;height:10mm"><svg xmlns="http://www.w3.org/2000/svg" width="370" height="30"><text x="0" y="20">wide formula</text></svg></mjx-container></div>';
    ok(layout(wide).report.pages === 1, 'wide formula should fit default layout');
    let failure;
    try { layout(wide, {appearance:'two-column'}); } catch (error) { failure = error; }
    ok(failure && /超过 A4|不可拆分|仍然溢出/.test(failure.message), 'column overflow was silently clipped');
  });
  check('trial metadata appears only on the first sheet and reduces only its framed content height', () => {
    const result = layout(Array.from({length:4}, (_, i) => block(`block${i}`, 120)).join(''), {appearance:'trial'});
    ok(result.root.querySelectorAll('.mwb-trial-header').length === 1, 'trial metadata duplicated');
    ok(result.sheets[0].querySelector('.mwb-trial-header') && !result.sheets[1].querySelector('.mwb-trial-header'), 'trial header not confined to first sheet');
    const first = result.regions[0].getBoundingClientRect(), next = result.regions[1].getBoundingClientRect();
    ok(next.height - first.height > 180, 'header space was not deducted from first-page capacity');
    ok(first.top >= result.root.querySelector('.mwb-trial-header').getBoundingClientRect().bottom, 'handout overlaps trial metadata');
    ok(JSON.stringify(result.assignment('block1')) === '[1,0]' && JSON.stringify(result.assignment('block2')) === '[1,0]', 'subsequent trial pages do not use their full content height');
    for (const region of result.regions) {
      const frame = region.closest('.mwb-trial-frame');
      ok(frame && parseFloat(getComputedStyle(frame).borderLeftWidth) > 0, 'handout content is missing its border');
    }
  });
  check('a trial question taller than the first content area stays intact on the following full page', () => {
    const result = layout(question('Q1', block('tall', 225)), {appearance:'trial'});
    ok(JSON.stringify(result.assignment('tall')) === '[1,0]', 'trial header caused rejection or splitting of a full-page question');
    ok(result.root.querySelectorAll('.mwb-trial-header').length === 1, 'first-page metadata lost during move');
    ok(result.report.strictQuestionPages[0].pages.join(',') === '2', 'trial question physical page report incorrect');
  });
  check('preview and isolated print agree on page assignments and usable body geometry for all appearances', () => {
    const html = block('filler', 235) + question('Q1', block('stem', 20) + math('formula') + br + block('answer', 20));
    for (const appearance of ['default','two-column','trial']) {
      const printed = layout(html, {appearance});
      const assignment = ['filler','stem','formula','answer'].map(printed.assignment);
      const dimensions = printed.regions.map(body => { const r = body.getBoundingClientRect(); return [r.width, r.height]; });
      const report = JSON.stringify(printed.report.strictQuestionPages);
      const previewed = layout(html, {appearance, preview:true});
      ok(JSON.stringify(assignment) === JSON.stringify(['filler','stem','formula','answer'].map(previewed.assignment)), `${appearance}: preview and print assignments differ`);
      ok(report === JSON.stringify(previewed.report.strictQuestionPages), `${appearance}: question reports differ`);
      ok(previewed.regions.length === dimensions.length && previewed.regions.every((body, i) => {
        const r = body.getBoundingClientRect(); return Math.abs(r.width - dimensions[i][0]) < 0.5 && Math.abs(r.height - dimensions[i][1]) < 0.5;
      }), `${appearance}: preview and print capacities differ`);
    }
  });
  await checkAsync('saved alternative HTML retains static sheets, selected layout and safely escaped trial information', async () => {
    for (const appearance of ['two-column', 'trial']) {
      const body = document.createElement('main');
      body.className = 'mwb-typography mwb-print-document';
      body.setAttribute('data-mwb-question-policy', 'strict-h5');
      body.innerHTML = question('Q1', block('one', 120) + block('two', 120) + block('three', 120));
      document.body.appendChild(body);
      const frameCount = document.querySelectorAll('iframe').length;
      try {
        const html = await exportHtml(body, 'Appearance export', appearanceCss, document, {
          layout:appearance, trialDetails:{teacher:'<script>untrusted()</script>', student:'示例学生',
            subject:'数学', title:'二次函数', objectives:'1. 理解图象\n2. 解决问题'},
        });
        const saved = await mwbPaginateSavedHtml(html, document);
        const parsed = new DOMParser().parseFromString(saved, 'text/html');
        const exported = parsed.querySelector('.mwb-export-doc');
        ok(exported.getAttribute('data-mwb-layout') === appearance, 'selected layout was lost in saved HTML');
        ok(exported.querySelectorAll('.mwb-paper').length > 0, 'saved HTML did not retain premeasured sheets');
        ok([...exported.querySelectorAll('[data-key]')].map(node => node.dataset.key).join(',') === 'one,two,three', 'saved HTML lost or duplicated handout content');
        ok(!parsed.querySelector('script, iframe'), 'executable content or measuring frame leaked into saved HTML');
        ok(parsed.querySelector('meta[http-equiv="Content-Security-Policy"]').content.includes("default-src 'none'"), 'saved HTML lost its restrictive content security policy');
        ok(document.querySelectorAll('iframe').length === frameCount, 'hidden measuring frame was not cleaned up');
        if (appearance === 'two-column') ok(exported.querySelectorAll('.mwb-paper-columns > .mwb-paper-body').length >= 2, 'saved HTML lost its columns');
        else {
          const trial = exported.querySelector('.mwb-trial-header');
          ok(exported.querySelectorAll('.mwb-trial-header').length === 1 && trial.textContent.includes('<script>untrusted()</script>'), 'trial information was duplicated or interpreted as markup');
          ok(trial.textContent.includes('1. 理解图象\n2. 解决问题'), 'trial objective line breaks were lost');
        }
      } finally { body.remove(); }
    }
  });
  const output = document.createElement('pre'); output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results); document.body.appendChild(output);
}
