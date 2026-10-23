import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// src/plugin.js is the tracked, verbatim JavaScript source.
// Keep the source basename distinct from the generated Obsidian main.js:
// community clean-build scanners may remove all existing main.js files.
const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'src/plugin.js');
const output = resolve(root, 'main.js');
if (!existsSync(input)) {
  throw new Error('Missing tracked source src/plugin.js; a publishable build cannot use a prebuilt bundle as its source');
}
copyFileSync(input, output);
console.log('Built main.js deterministically from src/plugin.js.');
