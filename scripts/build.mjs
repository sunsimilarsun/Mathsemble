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
let source = original.replace(/\r\n?/g, '\n');
if (source.includes('/* MWB_ASSEMBLY_GENERATED_START */')) {
  const modules = ['core','markdown','service','view'].map(name => {
    const body = readFileSync(resolve(root, `src/assembly-${name}.cjs`), 'utf8').replace(/\r\n?/g, '\n');
    return `const mwbAssembly${name[0].toUpperCase()+name.slice(1)} = (() => { const module = {exports:{}};\n${body}\nreturn module.exports; })();`;
  }).join('\n');
  source = source.replace(/\/\* MWB_ASSEMBLY_GENERATED_START \*\/[\s\S]*?\/\* MWB_ASSEMBLY_GENERATED_END \*\//,
    () => '/* MWB_ASSEMBLY_GENERATED_START */\n' + modules + '\n/* MWB_ASSEMBLY_GENERATED_END */');
  const cssPath = resolve(root,'styles.css');
  const css = readFileSync(cssPath,'utf8').replace(/\r\n?/g,'\n').replace(/\n\/\* MWB_ASSEMBLY_STYLES_START \*\/[\s\S]*$/, '');
  const assemblyCss = readFileSync(resolve(root,'styles/assembly.css'),'utf8').replace(/\r\n?/g,'\n');
  writeFileSync(cssPath, css + '\n/* MWB_ASSEMBLY_STYLES_START */\n' + assemblyCss);
}
source = synchronizePrintCss(source, readFileSync(resolve(root, 'styles.css'), 'utf8'));
if (source !== original) writeFileSync(input, source, 'utf8');
writeFileSync(output, source, 'utf8');
console.log('Synchronized printing CSS from styles.css; built main.js from src/plugin.js.');
