const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, copyFileSync, cpSync, existsSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const build = resolve(__dirname, '../scripts/build.mjs');
const boundary = "/* Isolate controls and A4 simulation from Obsidian's own note layout. */";
const prefix = '.mwb-print-document { color: #141414; }\n';
const css = prefix + boundary + '\n.mwb-modal { width: 90vw; }';
const source = 'const preserved = 42;\nmodule.exports = {typographyCss:' + JSON.stringify(prefix) + '};\n';
const defaults = {'src/plugin.js':source, 'styles.css':css};
function withPartialCheckout(files, verify) {
  const root = mkdtempSync(join(tmpdir(), 'mathsemble-build-check-'));
  try {
    mkdirSync(join(root, 'scripts'));
    for(const name of ['build.mjs','print-css.mjs']) copyFileSync(resolve(__dirname,'../scripts',name), join(root,'scripts',name));
    for (const [name, content] of Object.entries(files)) {
      if (name.startsWith('src/')) mkdirSync(join(root, 'src'), { recursive: true });
      writeFileSync(join(root, name), content);
    }
    const run = () => spawnSync(process.execPath, [join(root,'scripts/build.mjs')], {encoding:'utf8'});
    verify(root, run(), run);
  } finally { rmSync(root, { recursive: true, force: true }); }
}
test('clean build generates main.js from tracked source and authored printing CSS', () => {
  withPartialCheckout(defaults, (root, run) => {
    assert.equal(run.status,0,run.stderr);assert.equal(readFileSync(join(root,'main.js'),'utf8'),source);
  });
});
test('build replaces stale root main.js without changing synchronized source',()=>{
  withPartialCheckout({...defaults,'main.js':'stale bundle'},(root,run)=>{
    assert.equal(run.status,0,run.stderr);
    assert.equal(readFileSync(join(root,'main.js'),'utf8'),source);
    assert.equal(readFileSync(join(root,'src/plugin.js'),'utf8'),source);
  });
});
test('scanner may remove all main.js files and source still survives',()=>{
  withPartialCheckout(defaults,(root,run)=>{
    assert.equal(run.status,0,run.stderr);assert.ok(existsSync(join(root,'main.js')));
    assert.equal(existsSync(join(root,'src/main.js')),false);
  });
});
test('a release-only main.js is not a substitute for tracked source',()=>{
  withPartialCheckout({'main.js':'unverified bundle','styles.css':css},(_root,run)=>{
    assert.notEqual(run.status,0);assert.match(run.stderr,/Missing tracked source src\/plugin\.js/);
  });
});
test('missing both source and bundle fails explicitly',()=>{
  withPartialCheckout({},(_root,run)=>{assert.notEqual(run.status,0);assert.match(run.stderr,/Missing tracked source/);});
});
test('CSS-only print changes regenerate both embedded mirror and install bundle deterministically',()=>{
  withPartialCheckout(defaults,(root,first,run)=>{
    assert.equal(first.status,0,first.stderr);
    const nextPrefix=prefix+'/* $& is literal; no replacement expansion */\n.mwb-callout { border: 2px solid orange; }\n';
    writeFileSync(join(root,'styles.css'),nextPrefix+boundary+'\n.mwb-modal{height:1px}');
    assert.equal(run().status,0);
    const expected=source.replace(JSON.stringify(prefix),()=>JSON.stringify(nextPrefix));
    assert.equal(readFileSync(join(root,'src/plugin.js'),'utf8'),expected);
    assert.equal(readFileSync(join(root,'main.js'),'utf8'),expected);
    assert.equal(run().status,0);assert.equal(readFileSync(join(root,'main.js'),'utf8'),expected);
    assert.ok(!expected.includes('mwb-modal'));
  });
});
test('UI-only stylesheet changes do not change embedded print code',()=>{
  withPartialCheckout(defaults,(root,first,run)=>{
    assert.equal(first.status,0);writeFileSync(join(root,'styles.css'),prefix+boundary+'\n.mwb-modal{height:99vh}');
    assert.equal(run().status,0);assert.equal(readFileSync(join(root,'main.js'),'utf8'),source);
  });
});
test('build fails safely for missing CSS or malformed/ambiguous generated boundaries',()=>{
  for(const files of [
    {'src/plugin.js':source},
    {...defaults,'styles.css':'.all {color:red}'},
    {...defaults,'styles.css':css+boundary},
    {...defaults,'src/plugin.js':source+source},
    {...defaults,'src/plugin.js':'invalid typography binding'},
  ]) withPartialCheckout({...files,'main.js':'existing'},(root,run)=>{
    assert.notEqual(run.status,0);assert.equal(readFileSync(join(root,'main.js'),'utf8'),'existing');
    assert.equal(readFileSync(join(root,'src/plugin.js'),'utf8'),files['src/plugin.js']);
  });
});

test('verify without build rejects CSS drift even if source equals main.js',()=>{
  const temp=mkdtempSync(join(tmpdir(),'mathsemble-css-verification-'));
  try {
    cpSync(resolve(__dirname,'..'),temp,{recursive:true,filter:p=>!p.split(pathSeparator()).includes('.git')});
    const file=join(temp,'styles.css');writeFileSync(file,readFileSync(file,'utf8').replace('#141414','#121212'));
    const verify=()=>spawnSync(process.execPath,[join(temp,'scripts/verify.mjs')],{encoding:'utf8'});
    const stale=verify();assert.notEqual(stale.status,0);assert.match(stale.stderr,/Embedded print CSS is stale/);
    const rebuilt=spawnSync(process.execPath,[join(temp,'scripts/build.mjs')],{encoding:'utf8'});
    assert.equal(rebuilt.status,0,rebuilt.stderr);assert.equal(verify().status,0);
  } finally {rmSync(temp,{recursive:true,force:true});}
});
function pathSeparator(){return require('node:path').sep;}
