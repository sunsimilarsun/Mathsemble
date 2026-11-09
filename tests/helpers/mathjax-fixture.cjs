'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');

// Serve the pinned npm renderer and fonts locally. Obsidian's custom bundle is
// still an explicit comparison option; the npm component is not a host mock.
async function createMathJaxFixture({allowLegacyBundle = false} = {}) {
  const legacyBundle = allowLegacyBundle && process.env.MATHSEMBLE_MATHJAX_BUNDLE;
  const hostDirectory = process.env.MATHSEMBLE_MATHJAX4_DIR;
  const host = legacyBundle ? path.dirname(path.resolve(legacyBundle)) : hostDirectory && path.resolve(hostDirectory);
  const mounts = host ? [['/host/', host]] : [
    ['/mathjax/', path.dirname(require.resolve('mathjax/package.json'))],
    ['/fonts/mathjax-tex-font/', path.dirname(require.resolve('@mathjax/mathjax-tex-font/package.json'))],
  ];
  const bundlePath = host ? '/host/' + (legacyBundle ? path.basename(legacyBundle) : 'obsidian-mathjax.js') : '/mathjax/tex-chtml-nofont.js';
  const bundleFile = host ? path.join(host, path.basename(bundlePath)) : path.join(mounts[0][1], 'tex-chtml-nofont.js');
  assert.ok(fs.existsSync(bundleFile), 'MathJax browser bundle must exist; run npm ci or check the host override');
  const fonts = legacyBundle && process.env.MATHSEMBLE_MATHJAX_FONTS
    ? JSON.parse(fs.readFileSync(process.env.MATHSEMBLE_MATHJAX_FONTS, 'utf8')) : {};
  const override = process.env.MATHSEMBLE_MATHJAX_CONFIG
    ? JSON.parse(fs.readFileSync(process.env.MATHSEMBLE_MATHJAX_CONFIG, 'utf8')) : {};
  const requests = [], failures = [];
  let html = '';
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
    if (req.url === '/fixture.html') {
      // Any accidental CDN/script/font fallback fails closed and is reported by
      // the browser fixture, including when the runner has network access.
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; worker-src 'none'");
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(html); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
    catch (_) { failures.push(req.url); res.writeHead(400).end(); return; }
    const mount = mounts.find(([prefix]) => pathname.startsWith(prefix));
    const target = mount && path.resolve(mount[1], pathname.slice(mount[0].length));
    if (!mount || !target.startsWith(mount[1] + path.sep)) {
      failures.push(req.url); res.writeHead(404).end(); return;
    }
    fs.readFile(target, (error, bytes) => {
      if (error) { failures.push(req.url); res.writeHead(404).end(); return; }
      res.setHeader('Content-Type', target.endsWith('.js') ? 'application/javascript' : target.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
      res.end(bytes);
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const config = {
    startup: {typeset: false},
    options: {enableMenu: false, enableEnrichment: false, enableSpeech: false,
      enableBraille: false, enableExplorer: false, enableAssistiveMml: false,
      // Combined v4 components include ui/menu, whose settings otherwise
      // re-enable speech after startup even when enableMenu is false.
      // https://docs.mathjax.org/en/v4.1/options/accessibility.html
      menuOptions: {settings: {enrich: false, speech: false, braille: false,
        collapsible: false, assistiveMml: false}}},
    loader: {paths: host ? {'mathjax-tex': origin + '/host/tex-font', 'mathjax-mhchem-extension': origin + '/host/mhchem-font-extension'}
      : {mathjax: origin + '/mathjax', fonts: origin + '/fonts'}},
    output: {font: 'mathjax-tex', ...(host && !legacyBundle ? {fontExtensions: ['mathjax-mhchem']} : {})},
  };
  const merged = {...config, ...override,
    loader: {...config.loader, ...override.loader, paths: {...config.loader.paths, ...override.loader?.paths}}};
  const bootstrap = '<script>globalThis.mwbFixtureResourceViolations=[];addEventListener("securitypolicyviolation",event=>mwbFixtureResourceViolations.push(event.blockedURI));' +
    'globalThis.mwbFixtureErrors=[];addEventListener("error",event=>mwbFixtureErrors.push(event.message));addEventListener("unhandledrejection",event=>mwbFixtureErrors.push(String(event.reason)));' +
    'globalThis.MathJax=' + JSON.stringify(merged).replace(/</g, '\\u003c') +
    ';</script><script src="' + origin + bundlePath + '"></script>';
  return {
    url: origin + '/fixture.html', bootstrap, fonts, requests,
    setHtml(value) { html = value; },
    assertAssets() { assert.deepEqual(failures, [], 'all requested MathJax resources must resolve locally'); },
    close() { return new Promise(resolve => server.close(resolve)); },
  };
}

// Injected in each real-browser suite so blocked requests cannot silently use
// fallback glyphs. The server also checks every local request for missing files.
function assertLocalMathJaxResources() {
  if (globalThis.mwbFixtureErrors?.length) throw Error('Unhandled fixture errors: ' + mwbFixtureErrors.join(', '));
  if (globalThis.mwbFixtureResourceViolations?.length) throw Error('Fixture blocked external resources: ' + mwbFixtureResourceViolations.join(', '));
  const external = performance.getEntriesByType('resource').filter(entry => {
    const url = new URL(entry.name, location.href);
    return url.origin !== location.origin && !['data:', 'blob:'].includes(url.protocol);
  });
  if (external.length) throw Error('Non-local fixture resources: ' + external.map(entry => entry.name).join(', '));
}

module.exports = {createMathJaxFixture, assertLocalMathJaxResources};
