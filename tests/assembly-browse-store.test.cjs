'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

async function browserCases(createStore) {
  const store = createStore('/vault-A'), other = createStore('/vault-B');
  if (location.hash === '#restart') {
    const restored = await other.load();
    if (restored?.entries[0]?.record?.markdown !== 'C') throw Error('snapshot unavailable after browser restart');
    return;
  }
  const row = (path,markdown) => ({path,mtime:1,size:4,record:{path,markdown}});
  const a = row('a.md','old'), b = row('b.md','B'), c = row('c.md','C');
  const snapshot = entries => ({version:1,config:{recursive:true},entries});
  const result = async () => (await createStore('/vault-A').load()).entries
    .map(entry=>entry.path+'='+entry.record.markdown).sort().join(',');
  const check = (ok,message) => {if (!ok) throw Error(message);};
  check(await store.load() === null,'new vault has a snapshot');
  await store.save(snapshot([a,b]));
  check(await other.load() === null,'two vaults shared data');
  const second = createStore('/vault-A'), loaded = await second.load();
  check(loaded.version === 1 && loaded.config.recursive,'did not restore header');
  await second.save(snapshot([row('a.md','new'),c]));
  check(await result() === 'a.md=new,c.md=C','edit with unchanged stat / addition / removal failed');

  // This writer still knows only a + b. Its commit must replace the other generation completely.
  await store.save(snapshot([b]));
  check(await result() === 'b.md=B','stale writer mixed two generations');
  const invalid = row('z.md','broken');
  invalid.record.uncloneable = () => {};
  let aborted = false;
  try {await store.save(snapshot([a,invalid]));} catch {aborted = true;}
  check(aborted && await result() === 'b.md=B','failed write replaced the last committed snapshot');
  await Promise.all([store.save(snapshot([a,b])),store.clear()]);
  check(await createStore('/vault-A').load() === null,'queued clear left cached entries');
  await other.save(snapshot([c]));
}

test('real IndexedDB restores isolated vaults and commits whole generations atomically',async t => {
  const chrome = [process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p && fs.existsSync(p));
  if (!chrome) {if (process.env.CI) throw Error('Chrome required in CI');t.skip('Set CHROME_PATH');return;}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-indexeddb-'));
  try {
    const source = fs.readFileSync(path.join(__dirname,'../src/assembly-browse-store.cjs'),'utf8');
    const file = path.join(dir,'test.html');
    const run = '('+browserCases.toString()+')(module.exports).then(()=>report(true),error=>report(error.stack))';
    fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>const module={exports:{}};\n'+source+
      '\nfunction report(value){const el=document.createElement("pre");el.id="mwb-test-results";el.textContent=JSON.stringify(value);document.body.append(el)}\n'+run+'</script>');
    for (const hash of ['','#restart']) {
      const outcome = await runChromeDocument(chrome,file,path.join(dir,'profile'),{url:pathToFileURL(file).href+hash});
      assert.equal(outcome,true,String(outcome));
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
