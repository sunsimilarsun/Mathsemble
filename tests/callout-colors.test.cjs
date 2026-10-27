'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');
const chrome = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find(candidate => candidate && fs.existsSync(candidate));

test('real Chromium: native and paper callouts show matching edges without resizing', async t => {
  if (!chrome) {
    if (process.env.CI) throw Error('CI requires Chrome/Chromium for callout color regression');
    t.skip('Set CHROME_PATH to run browser callout color tests');
    return;
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mathsemble-callout-colors-'));
  // Model the default theme's zero-width callout borders and inherited title
  // color. This exercises actual CSS cascade/geometry, not Obsidian host QA.
  const hostCss = `
    body { margin: 0; }
    .theme-light { --text-normal: #222; background: #fff; color: var(--text-normal); }
    .theme-dark { --text-normal: #ddd; background: #1e1e1e; color: var(--text-normal); }
    .callout { --callout-color: 8, 109, 221; border: 0 solid rgba(var(--callout-color), .15);
      padding: 12px 12px 12px 24px; border-radius: 4px; }
    .callout-title { color: rgb(var(--callout-color)); }
  `;
  const script = `(${runCases.toString()})()`;
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + hostCss +
    '</style><style>' + css + '</style></head><body><script>' + script + '</script></body></html>';
  try {
    const input = path.join(directory, 'cases.html');
    fs.writeFileSync(input, html);
    const results = await runChromeDocument(chrome, input, path.join(directory, 'profile'));
    for (const result of results) await t.test(result.name, () => assert.equal(result.ok, true, result.error || ''));
  } finally {
    fs.rmSync(directory, {recursive: true, force: true, maxRetries: 10, retryDelay: 100});
  }
});

function runCases() {
  const results = [];
  const palette = {definition: [46,164,79], theorem: [47,129,247], method: [155,89,182],
    conclusion: [0,168,150], attention: [241,196,15], thinking: [99,110,114],
    answer: [230,126,34], scaffold: [143,112,181], solution: [135,148,173]};
  const check = (name, callback) => {
    try { callback(); results.push({name, ok: true}); }
    catch (error) { results.push({name, ok: false, error: error.stack || error.message}); }
  };
  const require = (value, message) => { if (!value) throw Error(message); };
  const sample = (host, type) => {
    const callout = document.createElement('div');
    callout.className = 'callout';
    callout.dataset.callout = type;
    callout.innerHTML = '<div class="callout-title">标题</div><div class="callout-content"><p>正文</p></div>';
    host.appendChild(callout);
    return callout;
  };
  for (const theme of ['theme-light', 'theme-dark']) {
    for (const view of ['markdown-preview-view', 'markdown-source-view mod-cm6']) {
      check(`${theme} ${view}: four visible edges share the left accent`, () => {
        const host = document.createElement('section');
        host.className = `${theme} ${view}`;
        document.body.appendChild(host);
        for (const [type, channels] of Object.entries(palette)) {
          const callout = sample(host, type);
          const style = getComputedStyle(callout);
          const ink = `rgb(${channels.join(', ')})`;
          for (const edge of ['Top', 'Right', 'Bottom', 'Left'])
            require(style[`border${edge}Color`] === ink, `${type} ${edge} edge color`);
          const shadows = style.boxShadow.split(/,\s*(?![^()]*\))/);
          require(shadows.some(shadow => shadow.includes(ink) && shadow.includes('0px 0px 0px 1px inset')),
            `${type}: zero-width native borders need a visible inner outline`);
          require(shadows.every(shadow => shadow.includes(ink)), `${type}: outline and left accent differ`);
          const before = callout.getBoundingClientRect();
          callout.style.boxShadow = 'none';
          const after = callout.getBoundingClientRect();
          require(before.width === after.width && before.height === after.height,
            `${type}: accent must not alter measured geometry`);
          require(style.color === getComputedStyle(host).color, `${type}: body text recolored`);
        }
        require(getComputedStyle(sample(host, 'example')).boxShadow === 'none', 'ordinary example was recolored');
        host.remove();
      });
    }
  }
  check('isolated PDF: all four physical borders match, with 2px left and 1px other edges', () => {
    const host = document.createElement('main');
    host.className = 'mwb-typography mwb-print-document';
    document.body.appendChild(host);
    for (const [type, channels] of Object.entries(palette)) {
      const style = getComputedStyle(sample(host, type));
      const ink = `rgb(${channels.join(', ')})`;
      for (const edge of ['Top', 'Right', 'Bottom', 'Left']) {
        require(style[`border${edge}Color`] === ink, `${type} ${edge} color differs`);
        require(style[`border${edge}Width`] === (edge === 'Left' ? '2px' : '1px'), `${type} ${edge} width changed`);
      }
      require(style.boxShadow === 'none', `${type}: native shadow leaked into isolated PDF`);
    }
    host.remove();
  });
  const output = document.createElement('pre');
  output.id = 'mwb-test-results';
  output.textContent = JSON.stringify(results);
  document.body.appendChild(output);
}
