const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const build = resolve(__dirname, '../scripts/build.mjs');

function withPartialCheckout(files, verify) {
  const root = mkdtempSync(join(tmpdir(), 'mathsemble-build-check-'));
  try {
    mkdirSync(join(root, 'scripts'));
    copyFileSync(build, join(root, 'scripts/build.mjs'));
    for (const [name, content] of Object.entries(files)) {
      if (name.startsWith('src/')) mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    const result = spawnSync(process.execPath, [join(root, 'scripts/build.mjs')], { encoding: 'utf8' });
    verify(root, result);
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('clean build generates main.js from the tracked src/plugin.js', () => {
  withPartialCheckout({ 'src/plugin.js':'source bundle' }, (root, run) => {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(root, 'main.js'), 'utf8'), 'source bundle');
  });
});

test('build replaces stale root main.js without touching the source', () => {
  withPartialCheckout({ 'src/plugin.js':'source bundle', 'main.js':'stale bundle' }, (root, run) => {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(root, 'main.js'), 'utf8'), 'source bundle');
    assert.equal(readFileSync(join(root, 'src/plugin.js'), 'utf8'), 'source bundle');
  });
});

test('scanner may remove all main.js files and source still survives', () => {
  withPartialCheckout({ 'src/plugin.js':'preserved source' }, (root, run) => {
    assert.equal(run.status, 0, run.stderr);
    assert.ok(existsSync(join(root,'main.js')));
    assert.equal(readFileSync(join(root,'main.js'),'utf8'),'preserved source');
    assert.equal(existsSync(join(root,'src/main.js')),false);
  });
});

test('a release-only main.js is not an acceptable substitute for tracked source', () => {
  withPartialCheckout({ 'main.js':'unverified bundle' }, (_root, run) => {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Missing tracked source src\/plugin\.js/);
  });
});

test('missing both source and bundle fails explicitly', () => {
  withPartialCheckout({}, (_root, run) => {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Missing tracked source src\/plugin\.js/);
  });
});
