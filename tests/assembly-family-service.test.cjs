'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createBlueprintEngine}=require('../src/assembly-blueprint.cjs');
const {createFamilyEngine}=require('../src/assembly-family.cjs');
const createService=require('../src/assembly-service.cjs');
const blueprintEngine=createBlueprintEngine({core}),familyEngine=createFamilyEngine({core});
const roots={questionRoots:['题库'],knowledgeRoots:[],recursive:true};
const clone=value=>JSON.parse(JSON.stringify(value));
const question=(id,{family='同族甲',type='choice',difficulty=2,body='合成题干',...other}={})=>'---\n'+JSON.stringify({id,title:'题目 '+id,subject:'高中数学',question_type:type,difficulty,role:'训练',family_id:family,...other})+'\n---\n'+body;
function fixture(initial={'题库/A.md':question('A'),'题库/B.md':question('B'),'题库/C.md':question('C',{type:'fill_blank'}),'题库/D.md':question('D',{family:'另一族'})},withFamily=true) {
  const nodes=new Map(),writes=[],listeners=new Set(),reads=[];
  const trigger=(event,...args)=>{for(const row of [...listeners])if(row.event===event)row.fn(...args);};
  const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null;
    const node={path,name:path.split('/').pop(),children:[]};nodes.set(path,node);parent?.children.push(node);return node;};
  const file=(path,content)=>{const parent=folder(path.slice(0,path.lastIndexOf('/'))),name=path.split('/').pop(),node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent};
    nodes.set(path,node);parent.children.push(node);trigger('create',node);return node;};
  for(const [path,text]of Object.entries(initial))file(path,text);
  let stored={assemblySettings:roots};
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,getMarkdownFiles:()=>[...nodes.values()].filter(node=>node.extension==='md'),
    on:(event,fn)=>{const row={event,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),
    read:async node=>{reads.push(node.path);return node.content;},createFolder:async path=>{if(nodes.has(path))throw Error('exists');writes.push(['folder',path]);return folder(path);},
    create:async(path,text)=>{if(nodes.has(path))throw Error('exists');writes.push(['create',path]);return file(path,text);},
    modify:async(node,text)=>{writes.push(['modify',node.path]);node.content=text;trigger('modify',node);}};
  const plugin={app:{vault},loadData:async()=>stored,saveData:async value=>{stored=value;}},deps={core,blueprintEngine,...(withFamily?{familyEngine}:{}),parseYaml:JSON.parse};
  return {service:createService(plugin,deps),plugin,deps,nodes,writes,reads,vault,file,folder,trigger,listeners,
    remove(path){const node=nodes.get(path);nodes.delete(path);node.parent.children=node.parent.children.filter(value=>value!==node);trigger('delete',node);}};
}
async function ordinary(f=fixture()) {
  const index=await f.service.scan();let plan=core.addSection(core.createPlan('同族换题'),'保留分区');
  plan=core.addItem(plan,index.items.find(item=>item.id==='A'));plan=core.updateEntry(plan,plan.entries[1].entryId,{title:'卷内标题',role:'例题'});
  return {...f,plan,entryId:plan.entries[1].entryId};
}
async function withRun({locked=false,originPlan=false,cap=1}={}) {
  const f=fixture({'题库/A.md':question('A')});const index=await f.service.scan();let plan=core.addSection(core.createPlan('配额旧方案'),'原分区');
  if(originPlan)plan=core.addItem(plan,index.items[0]);
  const blueprint={schemaVersion:1,blueprintId:'family-bp',revision:1,title:'选择配额',rows:[{rowId:'R',label:'单选',filters:{questionType:['choice']},count:1}],constraints:{uniqueQuestion:true,maxPerFamily:cap}};
  const entry=plan.entries[1],locks=originPlan?[{rowId:'R',slotId:'R:1',origin:'plan',sourceId:entry.sourceId,sourcePath:entry.sourcePath,sourceFingerprint:entry.sourceFingerprint,existingEntryId:entry.entryId}]:[];
  let candidate=await f.service.generateBlueprintCandidate({plan,blueprint,locks,seed:'family-seed'});
  if(locked&&!originPlan)candidate=f.service.updateBlueprintLocks(candidate,candidate.allocation.assignments.map(clone));
  const applied=await f.service.applyBlueprintCandidate(plan,candidate);f.file('题库/B.md',question('B'));f.file('题库/C.md',question('C',{type:'fill_blank'}));f.file('题库/D.md',question('D',{family:'另一族'}));
  return {...f,plan:applied.plan,run:applied.run,entryId:applied.plan.entries.find(entry=>entry.kind==='question').entryId};
}
const replacementKey=(candidate,id='B')=>candidate.candidates.find(item=>item.id===id)?.key;

test('score editing derives an exact saved quota run and keeps family locks instead of silently falling back',async()=>{
  const f=await withRun({locked:true}),planPath=await f.service.savePlan(f.plan),oldPath=await f.service.saveBlueprintRun(f.run,{planPath}),oldText=f.nodes.get(oldPath).content;
  const writes=f.writes.length,before=clone(f.plan),result=await f.service.updateEntryContent(f.plan,f.entryId,{score:8.25});
  assert.equal(result.plan.schemaVersion,4);assert.equal(result.plan.entries.find(e=>e.entryId===f.entryId).score,8.25);
  assert.notEqual(result.run.runId,f.run.runId);assert.equal(result.run.basePlanSnapshotDigest,f.run.resultPlanDigest);
  assert.deepEqual(result.run.assignments,f.run.assignments);assert.deepEqual(result.run.locks,f.run.locks);assert.equal(result.run.planPathHint,null);
  assert.equal(f.writes.length,writes);assert.equal(f.nodes.get(oldPath).content,oldText);assert.deepEqual(f.plan,before);
  await f.service.verifyBlueprintRun(result.run,result.plan);
  const locked=await f.service.prepareFamilyReplacement({plan:result.plan,entryId:f.entryId,run:result.run});assert.notEqual(locked.status,'ready');
  const unlocked=await f.service.prepareFamilyReplacement({plan:result.plan,entryId:f.entryId,run:result.run,unlock:true});assert.deepEqual(unlocked.candidates.map(q=>q.id),['B']);
  const changed=await f.service.applyFamilyReplacement(result.plan,unlocked,replacementKey(unlocked));
  assert.equal(changed.plan.entries.find(e=>e.entryId===f.entryId).score,8.25);assert.equal(changed.run.locks.length,0);
  const newPath=await f.service.savePlan(result.plan),newRunPath=await f.service.saveBlueprintRun(result.run,{planPath:newPath});
  assert.notEqual(newRunPath,oldPath);assert.equal(f.nodes.get(oldPath).content,oldText);assert.equal(f.listeners.size,0);
});
test('content edits use explicit pending run and reject stale or ambiguous quota records atomically',async()=>{
  const f=await withRun({locked:true}),planPath=await f.service.savePlan(f.plan);
  await f.service.saveBlueprintRun(f.run,{planPath});await f.service.saveBlueprintRun(f.run,{planPath});
  const writes=f.writes.length;
  await assert.rejects(f.service.updateEntryContent(f.plan,f.entryId,{score:5}),error=>error.code==='BLUEPRINT_RUN_SELECTION_REQUIRED');
  const result=await f.service.updateEntryContent(f.plan,f.entryId,{score:5},{run:f.run});assert.deepEqual(result.run.locks,f.run.locks);
  await assert.rejects(f.service.updateEntryContent(f.plan,f.entryId,{score:5},{run:{...f.run,resultPlanDigest:'0'.repeat(64)}}),/不匹配/);
  assert.equal(f.writes.length,writes);assert.equal(f.listeners.size,0);
});
test('a question already bound to a quota cannot be reduced to fragments through content editing',async()=>{
  const f=await withRun(),before=clone(f.plan);
  await assert.rejects(f.service.updateEntryContent(f.plan,f.entryId,{fragmentRef:{kind:'question-part',ids:['p1']}},{run:f.run}),
    error=>error.code==='BLUEPRINT_FRAGMENT_BINDING_CONFLICT');
  assert.deepEqual(f.plan,before);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
});
test('an unassigned entry may select fragments while a derived run retains other entries quota and lock',async()=>{
  const body='<!-- mathsemble:stem -->\n\n共同条件\n\n<!-- mathsemble:end -->\n\n<!-- mathsemble:part proof -->\n\n证明小问\n\n> [!answer]- 答案\n> 完整步骤\n\n<!-- mathsemble:end -->';
  const f=fixture({'题库/A.md':question('A'),'题库/D.md':question('D',{family:'另一族',type:'proof',body})}),index=await f.service.scan();
  const base=core.addItem(core.createPlan(),index.items.find(item=>item.id==='D')),entryId=base.entries[0].entryId;
  const blueprint={schemaVersion:1,blueprintId:'mixed-v4',revision:1,title:'整题配额',rows:[{rowId:'R',label:'单选',filters:{questionType:['choice']},count:1}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
  let candidate=await f.service.generateBlueprintCandidate({plan:base,blueprint,seed:'mixed'});
  candidate=f.service.updateBlueprintLocks(candidate,candidate.allocation.assignments.map(clone));
  const applied=await f.service.applyBlueprintCandidate(base,candidate),result=await f.service.updateEntryContent(applied.plan,entryId,
    {fragmentRef:{kind:'question-part',ids:['proof'],scores:{proof:5}}},{run:applied.run});
  assert.deepEqual(result.run.assignments,applied.run.assignments);assert.deepEqual(result.run.locks,applied.run.locks);
  assert.equal(result.plan.entries.find(entry=>entry.entryId===entryId).score,5);
  await f.service.verifyBlueprintRun(result.run,result.plan);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
});

test('ordinary same-family replacement changes only source reference fields and never writes source or sidecars',async()=>{
  const f=await ordinary(),before=clone(f.plan),source=[...f.nodes.values()].filter(n=>n.extension==='md').map(n=>[n.path,n.content]);
  const candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,filters:{questionType:['choice']}});
  assert.equal(candidate.status,'ready');assert.deepEqual(candidate.candidates.map(item=>item.id),['B']);
  const result=await f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate));
  const expected=clone(before),item=result.index.items.find(item=>item.id==='B');Object.assign(expected.entries[1],{sourceId:item.id,sourcePath:item.path,sourceFingerprint:item.fingerprint});
  assert.deepEqual(result.plan,expected);assert.deepEqual(f.plan,before);assert(!Object.hasOwn(result,'run'));assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  for(const [path,text]of source)assert.equal(f.nodes.get(path).content,text);
});

test('bound quota row intersects current filters and cannot be silently dropped',async()=>{
  const f=await withRun(),candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run});
  assert.deepEqual(candidate.candidates.map(item=>item.id),['B']);
  const impossible=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run,filters:{questionType:['fill_blank']}});
  assert.deepEqual(impossible.candidates,[]);assert(impossible.issues.some(issue=>issue.code==='FAMILY_NO_CANDIDATES'));
  await assert.rejects(f.service.applyFamilyReplacement(f.plan,impossible,'anything'));
  const before=clone(f.plan);candidate.run=null;candidate.filters={};candidate.unlock=true;candidate.candidates.push({id:'C',key:'id:C'});
  await assert.rejects(f.service.applyFamilyReplacement(f.plan,candidate,'id:C'));assert.deepEqual(f.plan,before);
  const result=await f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate));assert.equal(result.run.blueprintSnapshot.rows[0].filters.questionType[0],'choice');
});

test('a known quota run produces a new immutable run with updated binding, digests and no v3 fields',async()=>{
  const f=await withRun(),old=clone(f.run),planPath=await f.service.savePlan(f.plan),oldPath=await f.service.saveBlueprintRun(f.run,{planPath}),oldText=f.nodes.get(oldPath).content;
  const candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run}),result=await f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate));
  assert.notEqual(result.run.runId,old.runId);assert.notEqual(result.run.resultPlanDigest,old.resultPlanDigest);assert.equal(result.run.basePlanSnapshotDigest,old.resultPlanDigest);
  assert.equal(result.run.planPathHint,null);assert.equal(result.run.sourceSnapshotDigest,candidate.sourceSnapshotDigest);assert.equal(result.run.assignments[0].entryId,f.entryId);
  assert.equal(result.run.assignments[0].sourceId,'B');assert.equal(result.run.assignments[0].origin,'candidate');assert.deepEqual(f.run,old);assert.equal(f.nodes.get(oldPath).content,oldText);
  assert.deepEqual(Object.keys(result.plan).sort(),['course','entries','output','schemaVersion','title']);
  await f.service.verifyBlueprintRun(result.run,result.plan);
  const nextPlanPath=await f.service.savePlan(result.plan),nextRunPath=await f.service.saveBlueprintRun(result.run,{planPath:nextPlanPath});assert.notEqual(nextRunPath,oldPath);assert.equal(f.nodes.get(oldPath).content,oldText);
});

test('real locks reject by default; explicit unlock removes only the target in a new run and preserves origin-plan identity',async()=>{
  for(const originPlan of [false,true]){
    const f=await withRun({locked:true,originPlan}),before=clone(f.run);
    const locked=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run});assert.notEqual(locked.status,'ready');
    locked.unlock=true;locked.run=null;await assert.rejects(f.service.applyFamilyReplacement(f.plan,locked,'B'));
    const candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run,unlock:true});assert.equal(candidate.status,'ready');assert.deepEqual(f.run,before);
    const result=await f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate));assert.equal(result.run.locks.length,0);assert.deepEqual(f.run,before);
    assert.equal(result.run.assignments[0].origin,originPlan?'plan':'candidate');
    if(originPlan)assert.equal(result.run.assignments[0].existingEntryId,f.entryId);
    await f.service.verifyBlueprintRun(result.run,result.plan);assert.equal(f.writes.length,0);
  }
});

test('unlocking one of several quota locks preserves every other lock and slot assignment',async()=>{
  const f=fixture({'题库/A.md':question('A'),'题库/Z.md':question('Z',{family:'另一个有效族'})});
  const blueprint={schemaVersion:1,blueprintId:'two-locks',revision:1,title:'双锁',rows:[{rowId:'R',label:'两题',filters:{questionType:['choice']},count:2}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
  const base=core.createPlan();let candidate=await f.service.generateBlueprintCandidate({plan:base,blueprint,seed:'locks'});
  candidate=f.service.updateBlueprintLocks(candidate,candidate.allocation.assignments.map(clone));const first=await f.service.applyBlueprintCandidate(base,candidate);
  f.file('题库/B.md',question('B'));f.file('题库/Y.md',question('Y',{family:'另一个有效族'}));const target=first.plan.entries.find(entry=>entry.sourceId==='A');
  const prepared=await f.service.prepareFamilyReplacement({plan:first.plan,entryId:target.entryId,run:first.run,unlock:true});
  const result=await f.service.applyFamilyReplacement(first.plan,prepared,replacementKey(prepared));
  assert.deepEqual(result.run.locks,first.run.locks.filter(lock=>lock.sourceId==='Z'));
  assert.deepEqual(result.run.assignments.find(row=>row.sourceId==='Z'),first.run.assignments.find(row=>row.sourceId==='Z'));
  assert.equal(first.run.locks.length,2);assert.equal(f.writes.length,0);await f.service.verifyBlueprintRun(result.run,result.plan);
});

test('a supplied mismatching, malformed, future or stale run never falls back to ordinary replacement',async()=>{
  const f=await withRun(),before=clone(f.plan);
  for(const run of [{...f.run,resultPlanDigest:'0'.repeat(64)},{...f.run,schemaVersion:99},{...f.run,assignments:[]},null])
    await assert.rejects(f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run}));
  f.nodes.get('题库/A.md').content=question('A',{body:'来源已改'});
  await assert.rejects(f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:f.run}));assert.deepEqual(f.plan,before);assert.equal(f.writes.length,0);
});

test('known run family caps and all bindings are revalidated even when the target is unbound',async()=>{
  const f=await withRun();let plan=core.addItem(f.plan,(await f.service.scan()).items.find(item=>item.id==='D'));
  // A legitimate newer snapshot may include extra non-quota entries; its row
  // binding still must be verified before any unrelated entry is replaced.
  const digest=require('node:crypto').createHash('sha256').update(JSON.stringify((function stable(v){return Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;})(plan))).digest('hex');
  const run=f.service.validateBlueprintRun({...f.run,resultPlanDigest:digest});f.file('题库/E.md',question('E',{family:'另一族'}));
  const extra=plan.entries.at(-1),candidate=await f.service.prepareFamilyReplacement({plan,entryId:extra.entryId,run});assert.equal(candidate.status,'ready');
  const result=await f.service.applyFamilyReplacement(plan,candidate,replacementKey(candidate,'E'));assert.deepEqual(result.run.assignments,run.assignments);await f.service.verifyBlueprintRun(result.run,result.plan);
  const overPlan=core.addItem(f.plan,(await f.service.scan()).items.find(item=>item.id==='B'));
  const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  const overDigest=require('node:crypto').createHash('sha256').update(JSON.stringify(stable(overPlan))).digest('hex');
  const overRun={...f.run,resultPlanDigest:overDigest};
  await assert.rejects(f.service.prepareFamilyReplacement({plan:overPlan,entryId:overPlan.entries.at(-1).entryId,run:overRun}),/失效|复核/);
  f.nodes.get('题库/A.md').content=question('A',{type:'fill_blank'});
  await assert.rejects(f.service.prepareFamilyReplacement({plan,entryId:extra.entryId,run}));assert.equal(f.writes.length,0);
});

test('fresh apply rejects edited, deleted, duplicate, reclassified and added source changes atomically',async t=>{
  for(const [name,change]of [
    ['edited',f=>{f.nodes.get('题库/B.md').content=question('B',{body:'修改正文'});}],
    ['deleted',f=>f.remove('题库/B.md')],
    ['duplicate',f=>f.file('题库/duplicate.md',question('B'))],
    ['family',f=>{f.nodes.get('题库/B.md').content=question('B',{family:'另一族'});}],
    ['unselected',f=>f.file('题库/new.md',question('NEW'))]
  ])await t.test(name,async()=>{
    const f=await ordinary(),candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId}),before=clone(f.plan);change(f);
    await assert.rejects(f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate)),/变化/);assert.deepEqual(f.plan,before);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  });
});

test('plan, directory and fabricated wrapper changes cannot reuse an old family candidate',async()=>{
  const f=await ordinary(),candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId});
  await assert.rejects(f.service.applyFamilyReplacement(f.plan,{...candidate},replacementKey(candidate)),/候选无效/);
  const changed=core.addSection(f.plan,'后来修改');await assert.rejects(f.service.applyFamilyReplacement(changed,candidate,replacementKey(candidate)),/方案已变化/);
  await f.service.saveSettings({...roots,recursive:false});await assert.rejects(f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate)),/目录设置已变化/);
  assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
});

test('concurrent edit and closing-view checks abort both stages and release all watchers',async t=>{
  for(const stage of ['prepare','apply'])for(const mutation of ['source','plan','view'])await t.test(stage+' '+mutation,async()=>{
    const f=await ordinary(),candidate=stage==='apply'?await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId}):null;
    const read=f.vault.read;let calls=0,current=true;
    f.vault.read=async file=>{const value=await read(file);if(++calls===2){if(mutation==='source')f.nodes.get('题库/A.md').content=question('A',{body:'扫描中修改'});if(mutation==='plan')f.plan.title='并发改标题';if(mutation==='view')current=false;}return value;};
    const options={isCurrent:()=>current};await assert.rejects(stage==='prepare'?f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId},options):f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate),options));
    assert.equal(f.plan.entries.length,2);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  });
});

test('aborted and timed-out family scans never write and release listeners',async()=>{
  const f=await ordinary(),controller=new AbortController();controller.abort();
  await assert.rejects(f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId},{signal:controller.signal}),{name:'AbortError'});
  const candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId});await assert.rejects(f.service.applyFamilyReplacement(f.plan,candidate,replacementKey(candidate),{signal:controller.signal}),{name:'AbortError'});
  f.vault.read=()=>new Promise(()=>{});await assert.rejects(f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId},{timeoutMs:30,resourceTimeoutMs:10}),{code:'MWB_ASSEMBLY_TIMEOUT'});
  assert.equal(f.listeners.size,0);assert.equal(f.writes.length,0);
});

test('list matching runs uses exact plan digest, tolerates unrelated sidecars and returns each immutable match',async()=>{
  const f=await withRun(),planPath=await f.service.savePlan(f.plan),a=await f.service.saveBlueprintRun(f.run,{planPath}),b=await f.service.saveBlueprintRun(f.run,{planPath});
  f.file('Mathsemble/组卷记录/broken.json','{bad');f.file('Mathsemble/组卷记录/future.json','{"schemaVersion":99}');
  const matches=await f.service.listMatchingBlueprintRuns(f.plan);assert.deepEqual(matches.map(item=>item.path).sort(),[a,b].sort());assert(matches.every(item=>item.runId===f.run.runId&&item.title==='选择配额'));
  assert.deepEqual(await f.service.listMatchingBlueprintRuns({...f.plan,title:'改名方案'}),[]);assert.equal((await f.service.listPlans()).length,1);
  const loaded=await f.service.loadBlueprintRun(matches[0].path,f.plan),candidate=await f.service.prepareFamilyReplacement({plan:f.plan,entryId:f.entryId,run:loaded});assert.equal(candidate.status,'ready');
});

test('missing or unknown sidecars leave legacy plans usable and ordinary routes do not require the family engine',async()=>{
  const f=fixture(undefined,false),plan=core.createPlan('旧计划');f.file('Mathsemble/组卷记录/future.json','{"schemaVersion":99}');
  for(const schemaVersion of [1,2,3]){
    const raw=schemaVersion===1?{schemaVersion,title:'旧计划',entries:[]}:{...plan,schemaVersion},path='Mathsemble/组题方案/v'+schemaVersion+'.json',text=JSON.stringify(raw);f.file(path,text);
    const loaded=await f.service.loadPlan(path);assert.equal(loaded.schemaVersion,3);assert.deepEqual(await f.service.listMatchingBlueprintRuns(loaded),[]);assert.equal(f.nodes.get(path).content,text);
  }
  await assert.rejects(f.service.prepareFamilyReplacement({plan,entryId:'missing'}),/未配置/);assert.equal(f.writes.length,0);
});
