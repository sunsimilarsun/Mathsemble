import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

// The original source is a readable, dependency-free JavaScript bundle.
// This conservative reproduction step intentionally does not re-minify or
// reorder the rendering logic that was manually tested in Obsidian.
const root = resolve(import.meta.dirname, '..');
const input = resolve(root, 'src/main.js');
const output = resolve(root, 'main.js');
if (existsSync(input)) {
  // Normal checkout: reproduce the reviewed bundle from the tracked source.
  copyFileSync(input, output);
  console.log('Built main.js from src/main.js without altering runtime behavior.');
} else if (existsSync(output)) {
  // Some external community scanners extract only root-level release files.
  // Preserve the existing, already-checked-in runtime in such partial extracts.
  // GitHub CI still explicitly requires src/main.js and verifies byte parity.
  console.warn('src/main.js is absent in this partial checkout; using checked-in main.js.');
} else {
  throw new Error('Missing both src/main.js and main.js');
}
