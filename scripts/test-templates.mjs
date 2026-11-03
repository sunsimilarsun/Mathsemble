import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// External content acceptance is explicit; do not silently skip missing input,
// fetch private templates during CI, or fabricate replacements for that suite.
const input = process.env.MATHSEMBLE_TEMPLATE_DIR?.trim();
if (!input) {
  console.error('Set MATHSEMBLE_TEMPLATE_DIR to the external template library before npm run test:templates. npm test uses committed core fixtures.');
  process.exit(1);
}
const directory = resolve(input);
try {
  if (!statSync(directory).isDirectory()) throw new Error('not a directory');
} catch (error) {
  console.error('External template directory is unavailable: ' + directory + ' (' + error.message + ')');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
const result = spawnSync(process.execPath, ['--test', resolve(root, 'tests/integration/templates.test.cjs')], {
  cwd: root, env: {...process.env, MATHSEMBLE_TEMPLATE_DIR: directory}, stdio: 'inherit',
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
