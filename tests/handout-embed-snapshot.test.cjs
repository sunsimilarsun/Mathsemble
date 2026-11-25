'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {previewEvidence} = require('../src/export-host.cjs');
const {collectMediaDependencies} = require('../src/assembly-markdown.cjs');

const plugin = fs.readFileSync(path.join(__dirname,'..','main.js'),'utf8');
const obsidian = {Plugin:class {}, Modal:class {}, Notice:class {}, ItemView:class {}, parseYaml:() => ({}),
  resolveSubpath:(cache, subpath) => cache[subpath]};
const context = {module:{exports:{}}, require:name => name === 'obsidian' ? obsidian : require(name),
  performance, setTimeout, clearTimeout, console};
const api = vm.runInNewContext(plugin + '\n({mwbHandoutScope,mwbReadSourceSnapshot,mwbSameSourceSnapshot,mwbWatchSource,handoutPlan})',context);

function fixture() {
  const file = {path:'lecture/M02.md',extension:'md',body:'##### Example\n\n![[Card]]\n\n##### More\n\nText'};
  const card = {path:'bank/Card.md',extension:'md',body:'Prompt\n\n> [!answer]- Answer\n> Answer from card'};
  const files = new Map([file,card].map(item => [item.path,item]));
  const events = new Map();
  const vault = {
    read:async item => item.body, getAbstractFileByPath:key => files.get(key),
    on(event,handler) { events.set(event,handler); return event; },
    offref(event) { events.delete(event); }
  };
  const app = {vault, metadataCache:{getFirstLinkpathDest:name => ['Card','../bank/Card.md'].includes(name) ? card : null}};
  return {vault,file,card,events,scope:api.mwbHandoutScope(app,file)};
}

test('handout snapshot renders both editions from expanded text and archives both original sources',async () => {
  const {vault,file,card,scope} = fixture();
  const snapshot = await api.mwbReadSourceSnapshot(vault,scope);
  assert.deepEqual(Array.from(snapshot.entries,e => e.record.markdown),[file.body,card.body]);
  const student = api.handoutPlan(snapshot.expandedMarkdown,'student');
  assert.equal(student.solutionCount,1);
  assert.doesNotMatch(student.markdown,/Answer from card|!\[\[Card/);
  assert.match(api.handoutPlan(snapshot.expandedMarkdown,'teacher').markdown,/Answer from card/);
  const evidence = previewEvidence({sourceSnapshot:snapshot},collectMediaDependencies);
  assert.equal(evidence.sources.length,2);
  assert.equal(evidence.declaredDependencies.length,0);
  const generatedHeading = snapshot.expandedMarkdown.split('\n').indexOf('##### More');
  assert.equal(snapshot.rootLines[generatedHeading],file.body.split('\n').indexOf('##### More')+1);
  card.body = card.body.replace('from','FROM');
  const reread = await api.mwbReadSourceSnapshot(vault,scope);
  assert.equal(api.mwbSameSourceSnapshot(snapshot,reread),false);
  assert.match(reread.expandedMarkdown,/Answer FROM card/);
});

test('a Markdown note embed is archived as source while ordinary images remain media dependencies',async () => {
  const {vault,file,scope} = fixture();
  file.body = '![](../bank/Card.md)\n\n![[photo.png]]';
  const snapshot = await api.mwbReadSourceSnapshot(vault,scope);
  const evidence = previewEvidence({sourceSnapshot:snapshot},collectMediaDependencies);
  assert.equal(evidence.sources.length,2);
  assert.deepEqual(Array.from(evidence.declaredDependencies,item => item.target),['photo.png']);
});

test('changing an embedded note during capture invalidates the complete snapshot',async () => {
  const {vault,card,scope,events} = fixture();
  let reads = 0;
  vault.read = async item => {
    if (item === card && ++reads === 1) events.get('modify')(card);
    return item.body;
  };
  await assert.rejects(api.mwbReadSourceSnapshot(vault,scope),/发生变化/);
  assert.equal(events.size,0);
});

test('a block link selecting a line inside a hidden answer retains its enclosing Callout',async () => {
  const {vault,file,card} = fixture();
  file.body = '![[Card#^step]]';
  card.body = '> [!answer]- Standard\n> Do not print in the student edition. ^step';
  const metadataCache = {getFirstLinkpathDest:() => card, getFileCache:() => ({
    '#^step':{start:{line:1,col:2},end:{line:1,col:card.body.split('\n')[1].length}}
  })};
  const snapshot = await api.mwbReadSourceSnapshot(vault,api.mwbHandoutScope({vault,metadataCache},file));
  assert.doesNotMatch(api.handoutPlan(snapshot.expandedMarkdown,'student').markdown,/Do not print/);
  assert.match(api.handoutPlan(snapshot.expandedMarkdown,'teacher').markdown,/Do not print/);
});
