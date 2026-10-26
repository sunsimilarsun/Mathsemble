import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { synchronizePrintCss } from './print-css.mjs';
const root = resolve(import.meta.dirname, '..');
const read = (s) => readFileSync(resolve(root,s));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const pkg = JSON.parse(read('package.json').toString('utf8'));
const required = ['main.js','src/plugin.js','styles.css','manifest.json','README.md','tests/regression.test.cjs'];
for (const name of required) if (!existsSync(resolve(root,name))) throw new Error('Missing: '+name);
if (manifest.id !== 'math-teaching-workbench') throw new Error('Plugin ID mismatch');
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) throw new Error('Non-semver manifest version');
if (pkg.version !== manifest.version) throw new Error('Package/manifest versions differ');
const lock = JSON.parse(read('package-lock.json').toString('utf8'));
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version)
  throw new Error('Package-lock/package versions differ');
if (manifest.isDesktopOnly !== true) throw new Error('Node/Electron requires desktopOnly=true');
if (!manifest.description.endsWith('.') || manifest.description.length>250) throw new Error('Invalid manifest description');
if (!read('main.js').equals(read('src/plugin.js'))) throw new Error('Build differs from source');
if (synchronizePrintCss(read('src/plugin.js').toString('utf8'), read('styles.css').toString('utf8')) !== read('src/plugin.js').toString('utf8'))
  throw new Error('Embedded print CSS is stale; run npm run build');
execFileSync(process.execPath,['--check',resolve(root,'main.js')]);
// This validation is intentionally separate from publish readiness. Do not
// create the first public release before choosing a LICENSE and performing
// the browser/community account steps documented in docs/PUBLISHING.md.
const sha=(n)=>createHash('sha256').update(read(n)).digest('hex');
console.log(JSON.stringify({status:'passed-local-checks',id:manifest.id,version:manifest.version,sourceSha256:sha('src/plugin.js'),bundleSha256:sha('main.js'),styleSha256:sha('styles.css')},null,2));
