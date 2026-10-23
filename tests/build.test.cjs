const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync } = require('node:fs');
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

test('build from tracked source replaces the checked-in bundle', () => {
  withPartialCheckout({ 'src/main.js':'source bundle', 'main.js':'stale bundle' }, (root, run) => {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(root, 'main.js'), 'utf8'), 'source bundle');
  });
});

test('partial community scan with only root bundle does not fail build', () => {
  withPartialCheckout({ 'main.js':'validated release bundle' }, (root, run) => {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(readFileSync(join(root, 'main.js'), 'utf8'), 'validated release bundle');
    assert.match(run.stderr, /partial checkout/);
  });
});

test('missing both source and bundle fails explicitly', () => {
  withPartialCheckout({}, (_root, run) => {
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Missing both src\/main\.js and main\.js/);
  });
});
