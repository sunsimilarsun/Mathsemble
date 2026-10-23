import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// The original source is a readable, dependency-free JavaScript bundle.
// This conservative reproduction step intentionally does not re-minify or
// reorder the rendering logic that was manually tested in Obsidian.
const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'src/main.js');
const output = resolve(root, 'main.js');
if (!existsSync(input)) throw new Error('Missing src/main.js');
copyFileSync(input, output);
console.log('Built main.js from src/main.js without altering runtime behavior.');
