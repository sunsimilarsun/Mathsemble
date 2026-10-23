import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const pkg=JSON.parse(readFileSync(resolve(root,'package.json'),'utf8'));
const manifest=JSON.parse(readFileSync(resolve(root,'manifest.json'),'utf8'));
const readme=readFileSync(resolve(root,'README.md'),'utf8');
const license=resolve(root,'LICENSE');
const failures=[];
if(!existsSync(license)) failures.push('Missing owner-approved LICENSE');
else {
  const licenseText=readFileSync(license,'utf8');
  if(!licenseText.startsWith('MIT License\n') || !licenseText.includes('Copyright (c) 2026 sunsimilarsun') || !licenseText.includes('Permission is hereby granted')) failures.push('LICENSE does not match the approved MIT grant');
}
if(pkg.license !== 'MIT') failures.push('package.json must declare the approved MIT license');
if(manifest.id!=='math-teaching-workbench'||manifest.version!==pkg.version) failures.push('Manifest/package identity mismatch');
if(!readme.includes('Network access')||!readme.includes('outside the vault')) failures.push('README disclosure incomplete');
if(failures.length){console.error('Publishing blockers:\n'+failures.map(x=>' - '+x).join('\n'));process.exit(1);}
console.log('Local prerequisites for GitHub Release are present. Community directory approval still requires an external scan.');
