import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { synchronizePrintCss } from './print-css.mjs';

// Runtime code stays in tracked src/plugin.js. Only its embedded printing CSS
// literal is generated from styles.css. Never recover code from prebuilt main.js.
const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'src/plugin.js');
const output = resolve(root, 'main.js');
if (!existsSync(input)) {
  throw new Error('Missing tracked source src/plugin.js; a publishable build cannot use a prebuilt bundle as its source');
}
if (!existsSync(resolve(root, 'styles.css'))) throw new Error('Missing styles.css; cannot generate printing stylesheet');
const original = readFileSync(input, 'utf8');
const source = synchronizePrintCss(original, readFileSync(resolve(root, 'styles.css'), 'utf8'));
if (source !== original) writeFileSync(input, source, 'utf8');
writeFileSync(output, source, 'utf8');
console.log('Synchronized printing CSS from styles.css; built main.js from src/plugin.js.');
