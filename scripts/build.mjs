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
if (source.includes('/* MWB_HANDOUT_EMBEDS_START */')) {
  const embeds = readFileSync(resolve(root,'src/handout-embeds.cjs'),'utf8').replace(/\r\n?/g,'\n');
  source = source.replace(/\/\* MWB_HANDOUT_EMBEDS_START \*\/[\s\S]*?\/\* MWB_HANDOUT_EMBEDS_END \*\//,
    () => '/* MWB_HANDOUT_EMBEDS_START */\nconst MWB_HANDOUT_EMBEDS = (() => { const module = {exports:{}};\n' +
      embeds + '\nreturn module.exports; })();\n/* MWB_HANDOUT_EMBEDS_END */');
}
if (source.includes('/* MWB_EXPORT_GENERATED_START */')) {
  const modules = ['resources','archive','host'].map(name => {
    const body = readFileSync(resolve(root, `src/export-${name}.cjs`), 'utf8').replace(/\r\n?/g, '\n');
    return `const mwbExport${name[0].toUpperCase()+name.slice(1)} = (() => { const module = {exports:{}};\n${body}\nreturn module.exports; })();`;
  }).join('\n');
  source = source.replace(/\/\* MWB_EXPORT_GENERATED_START \*\/[\s\S]*?\/\* MWB_EXPORT_GENERATED_END \*\//,
    () => '/* MWB_EXPORT_GENERATED_START */\n' + modules + '\n/* MWB_EXPORT_GENERATED_END */');
}
if (source.includes('/* MWB_ASSEMBLY_GENERATED_START */')) {
  const modules = ['fragments','core','markdown','blueprint','family','similarity-text','similarity','browse-store','service','usage','usage-ui','library','library-ui','presentation','blueprint-ui','family-ui','similarity-ui','view'].map(name => {
    const body = readFileSync(resolve(root, `src/assembly-${name}.cjs`), 'utf8').replace(/\r\n?/g, '\n');
    const label = name.split('-').map(part=>part[0].toUpperCase()+part.slice(1)).join('');
    const alias=name==='fragments'?'\nconst MWB_ASSEMBLY_FRAGMENTS = mwbAssemblyFragments;':
      name==='similarity-text'?'\nconst MWB_ASSEMBLY_SIMILARITY_TEXT = mwbAssemblySimilarityText;':'';
    return `const mwbAssembly${label} = (() => { const module = {exports:{}};\n${body}\nreturn module.exports; })();${alias}`;
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
