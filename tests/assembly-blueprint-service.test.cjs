'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createBlueprintEngine}=require('../src/assembly-blueprint.cjs');
const createService=require('../src/assembly-service.cjs');
const {compileMarkdown,collectMediaDependencies}=require('../src/assembly-markdown.cjs');
const engine=createBlueprintEngine({core});
const roots={questionRoots:['题库'],knowledgeRoots:[],recursive:true};
const question=(id,type='fill_blank',body='题干 ?{1}。')=>'---\n'+JSON.stringify({id,question_type:type,subject:'高中数学',role:'训练'})+'\n---\n'+body;
const blueprint=()=>({schemaVersion:1,blueprintId:'bp-test',revision:1,title:'配额方案',rows:[
  {rowId:'A',label:'任意',filters:{},count:1},{rowId:'B',label:'选择',filters:{questionType:['choice']},count:1}
],constraints:{uniqueQuestion:true,maxPerFamily:null}});
function fixture(initial={'题库/choice.md':question('C','choice'),'题库/fill.md':question('F')},withEngine=true) {
  const nodes=new Map(),writes=[],reads=[],listeners=new Set();
  const trigger=(event,...args)=>{for(const listener of [...listeners])if(listener.event===event)listener.fn(...args);};
  const folder=path=>{
    if(nodes.has(path))return nodes.get(path);
    const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null;
    const node={path,name:path.split('/').pop(),children:[]};nodes.set(path,node);parent?.children.push(node);return node;
  };
  const file=(path,content)=>{
    const parent=folder(path.slice(0,path.lastIndexOf('/'))),name=path.split('/').pop();
    const node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent};
    nodes.set(path,node);parent.children.push(node);return node;
  };
  for(const [path,content]of Object.entries(initial))file(path,content);
  let stored={assemblySettings:roots};
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,getMarkdownFiles:()=>[...nodes.values()].filter(node=>node.extension==='md'),
    on:(event,fn)=>{const row={event,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),
    read:async node=>{reads.push(node.path);return node.content;},
    createFolder:async path=>{if(nodes.has(path))throw Error('exists');writes.push(['folder',path]);return folder(path);},
    create:async(path,text)=>{if(nodes.has(path))throw Error('exists');writes.push(['create',path]);const node=file(path,text);trigger('create',node);return node;},
    modify:async(node,text)=>{writes.push(['modify',node.path]);node.content=text;trigger('modify',node);}};
  const plugin={app:{vault,metadataCache:{getFirstLinkpathDest:()=>null}},loadData:async()=>stored,saveData:async value=>{stored=value;}};
  const deps={core,compileMarkdown,collectMediaDependencies,parseYaml:JSON.parse,previewFile:async()=>{},...(withEngine?{blueprintEngine:engine}:{})};
  return {service:createService(plugin,deps),plugin,deps,nodes,writes,reads,vault,file,folder,trigger,listeners,
    remove(path){const node=nodes.get(path);nodes.delete(path);node.parent.children=node.parent.children.filter(value=>value!==node);trigger('delete',node);}};
}
async function generated(f=fixture(),plan=core.createPlan('讲义'),bp=blueprint(),locks=[]) {
  const candidate=await f.service.generateBlueprintCandidate({plan,blueprint:bp,locks,seed:'repeatable'});
  assert.equal(candidate.status,'complete');return {...f,plan,bp,candidate};
}

test('full global allocation applies atomically and adds only new slots without source or plan writes',async()=>{
  const f=await generated(),before=JSON.stringify(f.plan),source=[...f.nodes].filter(([,node])=>node.extension==='md').map(([p,node])=>[p,node.content]);
  const applied=await f.service.applyBlueprintCandidate(f.plan,f.candidate);
  assert.equal(applied.plan.schemaVersion,3);assert.equal(applied.plan.entries.length,2);
  assert.deepEqual(applied.run.assignments.map(row=>[row.rowId,row.sourceId]),[['A','F'],['B','C']]);
  assert.equal(JSON.stringify(f.plan),before);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  for(const [path,content]of source)assert.equal(f.nodes.get(path).content,content);
  assert.deepEqual(Object.keys(applied.plan).sort(),['course','entries','output','schemaVersion','title']);
});

test('an explicitly bound existing plan question keeps position, entry ID, title and role and is not added twice',async()=>{
  const f=fixture(),index=await f.service.scan();let plan=core.addSection(core.createPlan('原方案'),'原分区');
  plan=core.addItem(plan,index.items.find(item=>item.id==='C'));plan=core.updateEntry(plan,plan.entries[1].entryId,{title:'卷内自定名',role:'例题'});
  const old=JSON.stringify(plan.entries),item=plan.entries[1],locks=[{rowId:'B',slotId:'B:1',origin:'plan',
    sourceId:item.sourceId,sourcePath:item.sourcePath,sourceFingerprint:item.sourceFingerprint,existingEntryId:item.entryId}];
  const g=await generated(f,plan,blueprint(),locks),applied=await f.service.applyBlueprintCandidate(plan,g.candidate);
  assert.equal(JSON.stringify(applied.plan.entries.slice(0,2)),old);assert.equal(applied.plan.entries.length,3);
  assert.equal(applied.run.assignments.find(row=>row.rowId==='B').entryId,item.entryId);
});

test('fresh apply rejects changed deleted replaced conflicted and stale-plan inputs without partial application',async t=>{
  for(const [name,change]of [
    ['changed',f=>{f.nodes.get('题库/fill.md').content=question('F','fill_blank','后来修改');}],
    ['deleted',f=>f.remove('题库/fill.md')],
    ['duplicate',f=>f.file('题库/duplicate.md',question('F'))],
    ['plan',f=>{f.plan.title='另一个版本';}],
    ['scope',async f=>{await f.service.saveSettings({...roots,recursive:false});}],
    ['quota',f=>{f.candidate.blueprint.rows[0].count=2;}],
    ['lock',f=>{f.candidate.locks=[{...f.candidate.allocation.assignments[0]}];}]
  ])await t.test(name,async()=>{
    const f=await generated();await change(f);const before=JSON.stringify(f.plan),writes=f.writes.length;
    await assert.rejects(f.service.applyBlueprintCandidate(f.plan,f.candidate));
    assert.equal(JSON.stringify(f.plan),before);assert.equal(f.writes.length,writes);assert.equal(f.listeners.size,0);
  });
});

test('candidate mutation cannot bypass quotas or duplicate identities',async()=>{
  const f=await generated();f.candidate.allocation.assignments[1]={...f.candidate.allocation.assignments[0],rowId:'B',slotId:'B:1'};
  await assert.rejects(f.service.applyBlueprintCandidate(f.plan,f.candidate));assert.equal(f.plan.entries.length,0);assert.equal(f.writes.length,0);
});

test('replacement and lock updates use captured candidates without I/O and still require fresh validation to apply',async()=>{
  const f=await generated(fixture({'题库/c.md':question('C','choice'),'题库/a.md':question('A'),'题库/b.md':question('B')}));
  const initial=JSON.stringify(f.candidate.allocation),reads=f.reads.length,writes=f.writes.length;
  const lock={...f.candidate.allocation.assignments.find(row=>row.rowId==='A')};
  const locked=f.service.updateBlueprintLocks(f.candidate,[lock]);
  assert.deepEqual(locked.allocation.assignments,f.candidate.allocation.assignments);assert.equal(locked.locks.length,1);
  const forbidden=f.service.replaceBlueprintCandidate(locked,{targetSlotId:'A:1',mode:'row',seed:'next'});
  assert.equal(forbidden.status,'conflict');assert.equal(forbidden.allocation,null);
  const unlocked=f.service.updateBlueprintLocks(locked,[]),replaced=f.service.replaceBlueprintCandidate(unlocked,{targetSlotId:'A:1',mode:'row',seed:'next'});
  assert.equal(replaced.status,'complete');assert.equal(replaced.sourceSnapshotDigest,f.candidate.sourceSnapshotDigest);
  assert.notEqual(replaced.allocation.assignments.find(row=>row.rowId==='A').sourceId,lock.sourceId);
  assert.deepEqual(replaced.allocation.assignments.find(row=>row.rowId==='B'),f.candidate.allocation.assignments.find(row=>row.rowId==='B'));
  assert.equal(f.reads.length,reads);assert.equal(f.writes.length,writes);assert.equal(JSON.stringify(f.candidate.allocation),initial);
  const applied=await f.service.applyBlueprintCandidate(f.plan,replaced);assert.equal(applied.plan.entries.length,2);
  assert(f.reads.length>reads);assert.equal(f.writes.length,writes);
});

test('unavailable replacement returns an explicit incomplete result while the original candidate remains unchanged',async()=>{
  const f=await generated(),before=JSON.stringify(f.candidate.allocation);
  const replacement=f.service.replaceBlueprintCandidate(f.candidate,{targetSlotId:'A:1',seed:'next'});
  assert.equal(replacement.status,'infeasible');await assert.rejects(f.service.applyBlueprintCandidate(f.plan,replacement));
  assert.equal(JSON.stringify(f.candidate.allocation),before);assert.equal(f.candidate.status,'complete');
  const stale={...f.candidate,context:'forged'};assert.throws(()=>f.service.updateBlueprintLocks(stale,[]),/上下文/);
});

test('generation exposes canonical lock order even when the teacher locked rows in the opposite order',async()=>{
  const f=await generated(),reverse=f.candidate.allocation.assignments.slice().reverse();
  const candidate=await f.service.generateBlueprintCandidate({plan:f.plan,blueprint:f.bp,locks:reverse,seed:'same'});
  assert.equal(candidate.status,'complete');assert.deepEqual(candidate.locks.map(row=>row.slotId),['A:1','B:1']);
  assert.equal((await f.service.applyBlueprintCandidate(f.plan,candidate)).plan.entries.length,2);
});

test('a change during later scan batches invalidates all slots and closes its scope watcher',async()=>{
  const initial=Object.fromEntries(Array.from({length:25},(_,i)=>['题库/'+String(i).padStart(2,'0')+'.md',question('Q'+i,i===0?'choice':'fill_blank')]));
  const f=await generated(fixture(initial)),read=f.vault.read;let changed=false;
  f.vault.read=async file=>{const result=await read(file);if(!changed&&file.path==='题库/24.md'){
    changed=true;await f.vault.modify(f.nodes.get('题库/00.md'),question('Q0','choice','同时改动'));
  }return result;};
  const before=JSON.stringify(f.plan);await assert.rejects(f.service.applyBlueprintCandidate(f.plan,f.candidate),/来源|源文|候选/);
  assert.equal(JSON.stringify(f.plan),before);assert.equal(f.listeners.size,0);
});

test('silent edits after scan and late UI invalidation cannot publish a plan',async t=>{
  for(const name of ['silent source','caller plan','closed view'])await t.test(name,async()=>{
    const f=await generated(),read=f.vault.read;let calls=0,current=true;
    f.vault.read=async file=>{const value=await read(file);if(++calls===2){
      if(name==='silent source')f.nodes.get('题库/choice.md').content=question('C','choice','静默变化');
      if(name==='caller plan')f.plan.title='并发编辑';
      if(name==='closed view')current=false;
    }return value;};
    await assert.rejects(f.service.applyBlueprintCandidate(f.plan,f.candidate,{isCurrent:()=>current}));
    assert.equal(f.plan.entries.length,0);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  });
});

test('cancelled generation and application release watchers and do not write sidecars',async()=>{
  const f=await generated(),controller=new AbortController();controller.abort();
  await assert.rejects(f.service.applyBlueprintCandidate(f.plan,f.candidate,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(f.service.generateBlueprintCandidate({plan:f.plan,blueprint:f.bp,seed:'x'},{signal:controller.signal}),{name:'AbortError'});
  assert.equal(f.listeners.size,0);assert.equal(f.writes.length,0);
});

test('infeasible and budget-limited candidates cannot be applied or mistaken for partial success',async()=>{
  const f=fixture(),plan=core.createPlan();const bp=blueprint();bp.rows[0].count=3;
  const insufficient=await f.service.generateBlueprintCandidate({plan,blueprint:bp,seed:'x'});
  assert.equal(insufficient.status,'infeasible');await assert.rejects(f.service.applyBlueprintCandidate(plan,insufficient));
  const limited=await f.service.generateBlueprintCandidate({plan,blueprint:blueprint(),seed:'x'},{limits:{maxOperations:1}});
  assert.equal(limited.status,'budget');await assert.rejects(f.service.applyBlueprintCandidate(plan,limited));assert.equal(f.writes.length,0);
});

test('blueprint sessions save by name with per-view external edit and deletion protection',async()=>{
  const f=fixture(),a=f.service.createBlueprintSession(),b=f.service.createBlueprintSession();
  const path=await a.saveBlueprint(blueprint());assert.match(path,/^Mathsemble\/组卷蓝图\/配额方案_.*\.json$/);
  await assert.rejects(b.saveBlueprint(blueprint(),path),/先打开/);
  const loaded=await b.loadBlueprint(path);await a.saveBlueprint({...blueprint(),title:'A修改'},path);
  await assert.rejects(b.saveBlueprint({...loaded,title:'B过期'},path),/外部修改/);
  assert.equal(JSON.parse(f.nodes.get(path).content).title,'A修改');
  await b.loadBlueprint(path);f.remove(path);await assert.rejects(b.saveBlueprint(loaded,path),/删除或替换/);
  assert(!f.nodes.has(path));assert.deepEqual(await f.service.listPlans(),[]);
});

test('blueprint saves do not accept foreign paths, stale replacement identities or unknown schemas',async()=>{
  const f=fixture(),session=f.service.createBlueprintSession(),path=await session.saveBlueprint(blueprint());
  await assert.rejects(session.saveBlueprint(blueprint(),'Mathsemble/组题方案/wrong.json'),/侧车/);
  await assert.rejects(session.saveBlueprint({...blueprint(),schemaVersion:2}),/版本/);
  f.remove(path);f.file(path,JSON.stringify(blueprint()));
  await assert.rejects(session.saveBlueprint(blueprint(),path),/删除或替换/);
  const before=f.nodes.get(path).content;f.nodes.get(path).content='{bad';await assert.rejects(session.loadBlueprint(path));
  assert.equal(f.nodes.get(path).content,'{bad');assert(before);
});

test('new blueprint saves from independent sessions create distinct files and never overwrite',async()=>{
  const f=fixture(),other=createService(f.plugin,f.deps);
  const paths=await Promise.all([f.service.saveBlueprint(blueprint()),other.saveBlueprint(blueprint())]);
  assert.notEqual(paths[0],paths[1]);assert.equal((await f.service.listBlueprints()).length,2);
  assert(f.writes.filter(([kind])=>kind==='create').length===2);
});

test('run sidecars require a saved matching v3 plan and round-trip independently from plans',async()=>{
  const f=await generated(),applied=await f.service.applyBlueprintCandidate(f.plan,f.candidate);
  await assert.rejects(f.service.saveBlueprintRun(applied.run,{planPath:'Mathsemble/组题方案/missing.json'}),/先保存/);
  const planPath=await f.service.savePlan(applied.plan),before=f.nodes.get(planPath).content;
  const path=await f.service.saveBlueprintRun(applied.run,{planPath});assert.match(path,/^Mathsemble\/组卷记录\//);
  const run=await f.service.loadBlueprintRun(path,applied.plan);assert.equal(run.planPathHint,planPath);
  assert.equal(run.schemaVersion,1);assert.equal(run.assignments.length,2);assert.equal(f.nodes.get(planPath).content,before);
  assert.equal((await f.service.listPlans()).length,1);assert.equal((await f.service.listBlueprintRuns()).length,1);
  const verified=await f.service.verifyBlueprintRun(run,applied.plan);assert.equal(verified.bindings.length,2);
  const changed=core.validatePlan(applied.plan);changed.title='改动';await assert.rejects(f.service.loadBlueprintRun(path,changed),/不匹配/);
  f.nodes.get('题库/fill.md').content=question('F','fill_blank','新内容');await assert.rejects(f.service.verifyBlueprintRun(run,applied.plan),/失效|变化/);
  assert.equal(f.listeners.size,0);
});

test('a sidecar write failure preserves the successful plan and retries only with a new create path',async()=>{
  const f=await generated(),applied=await f.service.applyBlueprintCandidate(f.plan,f.candidate),planPath=await f.service.savePlan(applied.plan);
  const original=f.nodes.get(planPath).content,create=f.vault.create;let failedPath;
  f.vault.create=async(path,text)=>{const result=await create(path,text);if(path.startsWith('Mathsemble/组卷记录/')){failedPath=path;throw Error('write rejected after persistence');}return result;};
  await assert.rejects(f.service.saveBlueprintRun(applied.run,{planPath}),/after persistence/);
  assert.equal(f.nodes.get(planPath).content,original);assert(f.nodes.has(failedPath));
  f.vault.create=create;const retry=await f.service.saveBlueprintRun(applied.run,{planPath});assert.notEqual(retry,failedPath);
  assert.equal(f.nodes.get(planPath).content,original);assert.equal(JSON.parse(original).schemaVersion,3);
});

test('a plan changed while the run directory is being created cannot receive a falsely matching sidecar',async()=>{
  const f=await generated(),applied=await f.service.applyBlueprintCandidate(f.plan,f.candidate),planPath=await f.service.savePlan(applied.plan);
  const createFolder=f.vault.createFolder;
  f.vault.createFolder=async path=>{const value=await createFolder(path);if(path==='Mathsemble/组卷记录')f.nodes.get(planPath).content=JSON.stringify({...applied.plan,title:'外部修改'});return value;};
  await assert.rejects(f.service.saveBlueprintRun(applied.run,{planPath}),/方案已被修改/);
  assert.equal((await f.service.listBlueprintRuns()).length,0);assert.equal(JSON.parse(f.nodes.get(planPath).content).title,'外部修改');
});

test('run validation rejects missing quota, altered bindings, future schemas and getters without invoking them',async()=>{
  const f=await generated(),applied=await f.service.applyBlueprintCandidate(f.plan,f.candidate),run=applied.run;
  assert.throws(()=>f.service.validateBlueprintRun({...run,assignments:run.assignments.slice(0,1)}),/不完整/);
  assert.throws(()=>f.service.validateBlueprintRun({...run,schemaVersion:2}),/版本/);
  const missingId={...run};delete missingId.runId;assert.throws(()=>f.service.validateBlueprintRun(missingId),/ID/);
  let touched=false;const hostile={...run};Object.defineProperty(hostile,'seed',{enumerable:true,get(){touched=true;return 'bad';}});
  assert.throws(()=>f.service.validateBlueprintRun(hostile),/属性/);assert.equal(touched,false);
  const planPath=await f.service.savePlan(applied.plan),changed=JSON.parse(JSON.stringify(run));changed.assignments[0].sourcePath='题库/wrong.md';
  await assert.rejects(f.service.saveBlueprintRun(changed,{planPath}),/不匹配/);
});

test('v1 v2 and v3 plans open normally without an engine or a valid sidecar and never gain planId',async()=>{
  const f=fixture(undefined,false),modern=core.createPlan('旧方案');
  f.file('Mathsemble/组卷记录/future.json','{"schemaVersion":99}');f.file('Mathsemble/组卷蓝图/broken.json','{bad');
  for(const version of [1,2,3]){
    const raw=version===1?{schemaVersion:1,title:modern.title,entries:[]}: {...modern,schemaVersion:version};
    const path='Mathsemble/组题方案/v'+version+'.json',text=JSON.stringify(raw);f.file(path,text);
    const loaded=await f.service.loadPlan(path);assert.equal(loaded.schemaVersion,3);assert(!Object.hasOwn(loaded,'planId'));
    assert.equal(f.nodes.get(path).content,text);
  }
  assert.equal(f.writes.length,0);assert.equal((await f.service.listPlans()).length,3);
  await assert.rejects(f.service.generateBlueprintCandidate({plan:modern,blueprint:blueprint(),seed:'x'}),/未配置/);
  assert.equal(f.writes.length,0);
});
