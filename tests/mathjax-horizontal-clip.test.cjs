'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const source = fs.readFileSync(path.resolve(__dirname, '../src/plugin.js'), 'utf8');
const start = source.indexOf('function paginatePrintDocument(');
const end = source.indexOf('// Serialize a pure browser function.', start);
assert.ok(start >= 0 && end > start, 'production paginator is available');
const paginateSource = source.slice(start, end);
const typography = JSON.parse(source.match(/module\.exports = \{typographyCss:("(?:\\.|[^"\\])*")\};/)[1]);
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
  process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')]
  .find(value => value && fs.existsSync(value));

// Reduced from MathJax 4 CHTML's underline assembly. The actual browser lays
// out the clipped spacer and its text; no DOM rectangle or Range is mocked.
// Fixed dimensions make the regression independent of TeX fonts and installed
// MathJax packages. Full Obsidian renderer/PDF acceptance is a separate check.
const fixtureCss = `
  .fixture-math { display:inline-block; width:20px; height:40px; vertical-align:baseline; }
  .fixture-math mjx-math, .fixture-math mjx-munder, .fixture-math mjx-row,
  .fixture-math mjx-base, .fixture-math mjx-under { display:block; }
  .fixture-math mjx-base { height:24px; }
  .fixture-math mjx-mfrac { display:inline-block; width:20px; text-align:center; }
  .fixture-math mjx-num, .fixture-math mjx-den { display:block; height:11px; font:10px/11px serif; }
  .fixture-math mjx-num { border-bottom:1px solid currentColor; }
  .fixture-math mjx-stretchy-h {
    display:inline-block; box-sizing:border-box; width:20px; height:4px;
    clip-path:padding-box polygon(0 -2px,100% -2px,100% calc(100% + 2px),0 calc(100% + 2px));
  }
  .fixture-math mjx-ext { display:inline-block; width:20px; height:4px; }
  .fixture-math mjx-spacer { display:inline-block; width:28px; height:16px;
    margin-left:-4px; white-space:nowrap; font:16px/16px monospace; }
  .fixture-range mjx-spacer { display:block; width:20px; margin-left:0; text-indent:-8px; }
  .fixture-range-right mjx-spacer { text-indent:16px; }
`;

function browserCases() {
  const results = [];
  const ok = (condition, message) => { if (!condition) throw new Error(message); };
  const check = (name, fn) => {
    try { fn(); results.push({name, ok:true}); }
    catch (error) { results.push({name, ok:false, error:String(error.stack || error)}); }
  };
  const fraction = () => {
    const host = document.createElement('div');
    host.innerHTML = '<mjx-container class="MathJax fixture-math" jax="CHTML">' +
      '<mjx-math><mjx-munder><mjx-row><mjx-base><mjx-mfrac>' +
      '<mjx-num>3</mjx-num><mjx-den>4</mjx-den>' +
      '</mjx-mfrac></mjx-base></mjx-row><mjx-row><mjx-under>' +
      '<mjx-stretchy-h><mjx-ext><mjx-spacer>–––</mjx-spacer></mjx-ext></mjx-stretchy-h>' +
      '</mjx-under></mjx-row></mjx-munder></mjx-math></mjx-container>';
    return host.firstElementChild;
  };
  const rootWith = (node, right = false) => {
    const root = document.createElement('main');
    root.className = 'mwb-export-doc mwb-typography mwb-print-document';
    const paragraph = document.createElement('p');
    if (right) paragraph.style.textAlign = 'right';
    paragraph.appendChild(node); root.appendChild(paragraph); document.body.appendChild(root);
    return root;
  };
  const rejects = (node, expected = /超过 A4|不可拆分|仍然溢出/) => {
    const root = rootWith(node);
    try {
      let caught;
      try { paginatePrintDocument(root); } catch (error) { caught = error; }
      ok(caught && expected.test(caught.message), 'real or unrecognized overflow was accepted');
    } finally { root.remove(); }
  };
  const withinX = (rect, region) => rect.left >= region.left - 2.5 && rect.right <= region.right + 2.5;
  const runClipped = ({right = false, rangeOnly = false, linewrap = false} = {}) => {
    const math = fraction();
    if (rangeOnly) math.classList.add('fixture-range');
    if (rangeOnly && right) math.classList.add('fixture-range-right');
    const root = rootWith(math, right);
    if (linewrap) root.firstElementChild.prepend(document.createTextNode('上一行正文'), document.createElement('br'));
    const originalText = root.textContent;
    try {
      const report = paginatePrintDocument(root);
      ok(report.pages === 1, 'small clipped fraction should fit one A4 page');
      ok(root.textContent === originalText + '1/1', 'fraction or text was dropped/reordered');
      const region = root.querySelector('.mwb-paper-body').getBoundingClientRect();
      const spacer = math.querySelector('mjx-spacer');
      const clip = math.querySelector('mjx-stretchy-h').getBoundingClientRect();
      ok(withinX(clip, region), 'fixture painted clip does not fit');
      if (!rangeOnly) {
        const raw = spacer.getBoundingClientRect();
        ok(right ? raw.right > region.right + 2.5 : raw.left < region.left - 2.5,
          'fixture no longer reproduces the original raw spacer overflow');
      } else {
        ok(withinX(spacer.getBoundingClientRect(), region), 'Range fixture must pass element bounds');
        const range = document.createRange(); range.selectNodeContents(spacer);
        const rects = Array.from(range.getClientRects()); range.detach();
        ok(rects.some(rect => right ? rect.right > region.right + 2.5 : rect.left < region.left - 2.5),
          'fixture no longer exercises final text Range overflow');
      }
    } finally { root.remove(); }
  };

  check('CHTML underline spacer at left edge honors its painted clip', () => runClipped());
  check('CHTML underline spacer at right edge honors its painted clip', () => runClipped({right:true}));
  check('CHTML underline spacer after a line break remains intact', () => runClipped({linewrap:true}));
  check('final text Range audit honors the left clip even when element bounds fit', () => runClipped({rangeOnly:true}));
  check('final text Range audit honors the right clip even when element bounds fit', () => runClipped({rangeOnly:true, right:true}));

  for (const [name, change] of [
    ['missing clip-path', node => { node.querySelector('mjx-stretchy-h').style.clipPath = 'none'; }],
    ['different polygon', node => { node.querySelector('mjx-stretchy-h').style.clipPath = 'padding-box polygon(-1px -2px,100% -2px,100% calc(100% + 2px),-1px calc(100% + 2px))'; }],
    ['default border-box clip', node => { node.querySelector('mjx-stretchy-h').style.clipPath = 'polygon(0 -2px,100% -2px,100% calc(100% + 2px),0 calc(100% + 2px))'; }],
    ['horizontal border', node => { node.querySelector('mjx-stretchy-h').style.borderInline = '1px solid black'; }],
    ['non-CHTML jax', node => { node.setAttribute('jax', 'SVG'); }],
  ]) check(name + ' retains strict raw geometry checks', () => { const node = fraction(); change(node); rejects(node); });

  check('missing MathJax container retains strict raw geometry checks', () => {
    const math = fraction(), span = document.createElement('span'); span.className = 'fixture-math';
    span.append(...math.childNodes); rejects(span);
  });
  check('real wide MathJax container is rejected', () => { const node = fraction(); node.style.width = '900px'; rejects(node); });
  check('real translated MathJax container is rejected', () => { const node = fraction(); node.style.transform = 'translateX(-50px)'; rejects(node); });
  check('real tall MathJax container is rejected', () => { const node = fraction(); node.style.height = '1200px'; rejects(node); });
  check('ordinary wide HTML is still rejected', () => {
    const node = document.createElement('span'); node.style.cssText = 'display:inline-block;width:900px'; node.textContent = 'wide'; rejects(node);
  });
  check('ordinary clipped HTML is still rejected', () => {
    const node = document.createElement('span'); node.style.cssText = 'display:inline-block;width:20px;overflow:hidden';
    node.innerHTML = '<span style="display:inline-block;width:100px">clipped</span>'; rejects(node);
  });
  check('unclipped ordinary text Range overflow is still rejected', () => {
    const node = document.createElement('span'); node.style.cssText = 'display:inline-block;width:20px;text-indent:-30px'; node.textContent = 'outside'; rejects(node);
  });
  const output = document.createElement('pre'); output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results); document.body.appendChild(output);
}

test('real Chromium: MathJax CHTML horizontal clip and strict overflow boundaries', async t => {
  if (!chrome) {
    if (process.env.CI) throw new Error('Chrome/Chromium is required in CI; set CHROME_PATH');
    t.skip('Set CHROME_PATH to run browser layout checks'); return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-horizontal-clip-'));
  try {
    const input = path.join(dir, 'fixture.html');
    const script = paginateSource + '\n(' + browserCases.toString() + ')();';
    fs.writeFileSync(input, '<!doctype html><meta charset="utf-8"><style>' + typography + fixtureCss +
      '</style><body><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
    for (const result of await runChromeDocument(chrome, input, path.join(dir, 'profile')))
      await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
