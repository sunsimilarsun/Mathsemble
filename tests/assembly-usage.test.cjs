'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('../src/assembly-core.cjs');
const {createUsageService,validateEvent,filterUsage,summarizeUsage}=require('../src/assembly-usage.cjs');
const clone=v=>JSON.parse(JSON.stringify(v)),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const A={classId:'甲班',courseId:'代数'},B={classId:'乙班',courseId:'代数'},C={classId:'甲班',courseId:'几何'};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture() {
  const nodes=new Map(),listeners=new Set(),writes=[],state={now:'2026-11-17T06:00:00.000Z',createMode:'normal',readHook:null,scanHook:null,createHook:null};let uid=0;
  const emit=(name,file,oldPath)=>{for(const ref of [...listeners])if(ref.name===name)ref.fn(file,oldPath);};
  const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,name:path.split('/').pop(),children:[]};nodes.set(path,node);parent?.children.push(node);emit('create',node);return node;};
  const put=(path,content,metadata)=>{const parent=folder(path.slice(0,path.lastIndexOf('/'))),old=nodes.get(path);if(old){old.content=content;if(metadata)old.metadata=metadata;emit('modify',old);return old;}const node={path,name:path.split('/').pop(),extension:path.split('.').pop(),content,metadata,parent};nodes.set(path,node);parent.children.push(node);emit('create',node);return node;};
  put('题库/A.md','题目 A ?{42}',{id:'A',family_id:'F'});put('题库/B.md','题目 B',{id:'B'});put('题库/noid.md','无 ID 原文',{});put('知识/K.md','知识原文',{id:'K'});
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,on:(name,fn)=>{const ref={name,fn};listeners.add(ref);return ref;},offref:ref=>listeners.delete(ref),
    async read(file){if(state.readHook)await state.readHook(file);return file.content;},async createFolder(path){if(nodes.has(path))throw Error('exists');writes.push(['folder',path]);return folder(path);},
    async create(path,content){if(state.createHook)await state.createHook(path,content);if(nodes.has(path))throw Error('exists');writes.push(['create',path]);if(state.createMode==='reject')throw Error('I/O uncertain');const node=put(path,state.createMode==='partial'?'{' : content);if(['partial','persist-reject'].includes(state.createMode))throw Error('persisted but rejected');return node;}};
  const index=()=>core.buildIndex([...nodes.values()].filter(f=>f.extension==='md').map(f=>({path:f.path,kind:f.path.startsWith('知识/')?'knowledge':'question',metadata:f.metadata,markdown:f.content})));
  const scanIndex=async options=>{if(state.scanHook)await state.scanHook(options);return index();};
  const service=()=>createUsageService({vault,core,scanIndex,now:()=>state.now,newId:()=>`action-${++uid}`,timeoutMs:50});
  const usage=service();let plan=core.addSection(core.createPlan('本次讲义'),'原分区');for(const id of ['A','B',''])plan=core.addItem(plan,index().items.find(i=>i.id===id));plan=core.addItem(plan,index().items.find(i=>i.id==='K'));
  return {nodes,listeners,writes,state,vault,index,put,emit,plan,usage,service,
    remove(path){const file=nodes.get(path);nodes.delete(path);file.parent.children=file.parent.children.filter(f=>f!==file);emit('delete',file);},
    rename(path,target){const file=nodes.get(path);nodes.delete(path);file.path=target;file.name=target.split('/').pop();nodes.set(target,file);emit('rename',file,path);}};
}
async function register(f,{action='taught',context=A,actionId='one',occurredAt=f.state.now,plan=f.plan,entryIds}={}) {
  const candidate=await f.usage.preparePlanUsage({plan,context,action,occurredAt,...(entryIds?{entryIds}:{})});
  return {...await f.usage.recordPlanUsage(candidate,{actionId}),candidate};
}
const active=async(f,context=A)=>(await f.usage.loadUsage({context})).activeEvents;

test('explicit plan action writes one immutable schema1 document with exact historical text and versions',async()=>{
  const f=fixture(),before=clone(f.plan),sources=[...f.nodes.values()].filter(n=>n.extension==='md').map(n=>[n.path,n.content]);
  const candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});assert.equal(f.writes.length,0);
  const result=await f.usage.recordPlanUsage(candidate,{actionId:'first'});assert.equal(result.state,'saved');assert.equal(result.idempotent,false);
  assert.equal(result.event.items.length,4);assert.equal(f.writes.filter(row=>row[0]==='create').length,1);assert.equal(result.event.action,'taught');
  for(const item of result.event.items){assert.equal(item.revisionSha256,hash(item.markdown));assert.equal(item.sourceFingerprint,core.fingerprint(item.markdown));}
  assert.equal(result.event.items.find(i=>i.path==='题库/noid.md').itemId,null);assert.match(result.event.planSnapshotSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.event.planId,undefined);assert.deepEqual(f.plan,before);for(const [path,text]of sources)assert.equal(f.nodes.get(path).content,text);
  assert.equal(f.listeners.size,0);assert.deepEqual(validateEvent(result.event),result.event);
});
test('export is not an accepted teaching action; opening and querying never records a use',async()=>{
  const f=fixture();await f.usage.loadUsage({context:A});assert.equal(f.writes.length,0);
  await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'exported'}),{code:'USAGE_INVALID'});assert.equal((await active(f)).length,0);
});
test('class and course contexts are independent, exact and require an explicit nonempty code',async()=>{
  const f=fixture();await register(f);for(const context of [B,C,{classId:'甲班',courseId:'ALGEBRA'}])assert.equal((await active(f,context)).length,0);
  assert.equal((await active(f,{classId:' 甲班 ',courseId:'代数 '})).length,1);
  await assert.rejects(f.usage.loadUsage({context:{classId:'',courseId:' '}}),{code:'USAGE_CONTEXT_REQUIRED'});
  assert.equal((await active(f,{classId:'',courseId:'代数'})).length,0);
});
test('same stable ID follows edits and renames, while stored historical content remains exact',async()=>{
  const f=fixture(),result=await register(f);f.put('题库/A.md','修改后的答案 99',{id:'A'});f.rename('题库/A.md','题库/renamed.md');
  const ledger=await f.usage.loadUsage({context:A}),row=summarizeUsage(f.index(),ledger,{context:A,now:f.state.now}).find(r=>r.item.id==='A');
  assert.equal(row.count,1);assert.equal(row.versions[0],hash('题目 A ?{42}'));assert.equal(ledger.activeEvents[0].items[0].markdown,'题目 A ?{42}');
  assert.deepEqual(JSON.parse(f.nodes.get(result.path).content),result.event);
});
test('ID-less path identity never follows a rename or silently merges into a later assigned ID',async()=>{
  const f=fixture();await register(f);f.rename('题库/noid.md','题库/newname.md');
  let ledger=await f.usage.loadUsage({context:A}),rows=summarizeUsage(f.index(),ledger,{context:A,now:f.state.now});assert.equal(rows.find(r=>r.item.path==='题库/newname.md').count,0);
  f.put('题库/newname.md','无 ID 原文',{id:'ADDED'});rows=summarizeUsage(f.index(),ledger,{context:A,now:f.state.now});assert.equal(rows.find(r=>r.item.id==='ADDED').count,0);
});
test('same action ID is idempotent across simultaneous calls, service instances and restart',async()=>{
  const f=fixture(),candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});
  const second=f.service(),other=await second.preparePlanUsage({plan:f.plan,context:A,action:'taught'});
  const result=await Promise.all([f.usage.recordPlanUsage(candidate,{actionId:'same'}),f.usage.recordPlanUsage(candidate,{actionId:'same'}),second.recordPlanUsage(other,{actionId:'same'})]);
  assert.equal(result.filter(r=>!r.idempotent).length,1);assert.equal((await active(f)).length,1);
  f.state.now='2026-11-17T08:00:00.000Z';const retry=await second.recordPlanUsage(other,{actionId:'same'});assert.equal(retry.idempotent,true);assert.equal(retry.event.createdAt,'2026-11-17T06:00:00.000Z');
});
test('same action ID with a different payload is rejected; different contexts do not collide',async()=>{
  const f=fixture();await register(f);await assert.rejects(register(f,{action:'assigned'}),{code:'USAGE_ACTION_CONFLICT'});
  await register(f,{context:B});assert.equal((await active(f,B)).length,1);assert.equal((await active(f)).length,1);
});
test('independent vault adapters racing the same create-only event converge without a shared queue',async()=>{
  const f=fixture(),other=createUsageService({vault:{...f.vault},core,scanIndex:async()=>f.index(),now:()=>f.state.now});
  const a=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'}),b=await other.preparePlanUsage({plan:f.plan,context:A,action:'taught'}),gate=deferred();let arrivals=0;
  f.state.createHook=async()=>{if(++arrivals===2)gate.resolve();await gate.promise;};
  const result=await Promise.all([f.usage.recordPlanUsage(a,{actionId:'race'}),other.recordPlanUsage(b,{actionId:'race'})]);
  assert.equal(result.filter(r=>!r.idempotent).length,1);assert.equal((await active(f)).length,1);assert.equal(f.listeners.size,0);
});
test('append-only revoke preserves history and snapshots, is idempotent and restores eligibility',async()=>{
  const f=fixture(),result=await register(f),original=f.nodes.get(result.path).content;
  const correction=await f.usage.revokeUsage(result.event.eventId,{context:A,actionId:'undo',reason:'误选班级'});
  assert.equal(correction.event.action,'revoke');assert.equal(correction.event.supersedes,result.event.eventId);assert.equal(f.nodes.get(result.path).content,original);
  const ledger=await f.usage.loadUsage({context:A});assert.equal(ledger.events.length,2);assert.equal(ledger.activeEvents.length,0);
  assert.equal(filterUsage(f.index().items,ledger,{context:A,mode:'unused',now:f.state.now}).length,4);
  assert.equal((await f.usage.revokeUsage(result.event.eventId,{context:A,actionId:'undo',reason:'误选班级'})).idempotent,true);
  await assert.rejects(f.usage.revokeUsage(result.event.eventId,{context:A,actionId:'undo2'}),{code:'USAGE_ALREADY_REVOKED'});
  await assert.rejects(f.usage.revokeUsage(result.event.eventId,{context:B,actionId:'undo3'}),{code:'USAGE_INVALID'});
});
test('two simultaneous revocations never double count or delete the original',async()=>{
  const f=fixture(),result=await register(f);const values=await Promise.allSettled(['u1','u2'].map(actionId=>f.usage.revokeUsage(result.event.eventId,{context:A,actionId})));
  assert.equal(values.filter(v=>v.status==='fulfilled').length,1);assert.equal((await f.usage.loadUsage({context:A})).events.length,2);
});
test('unused days uses a closed cutoff and lastUsed; future events are excluded by query time',async()=>{
  const f=fixture();await register(f,{occurredAt:'2026-11-10T06:00:00.000Z'});const ledger=await f.usage.loadUsage({context:A}),items=f.index().items;
  assert.equal(filterUsage(items,ledger,{context:A,mode:'unused',days:7,now:f.state.now}).length,0);
  assert.equal(filterUsage(items,ledger,{context:A,mode:'unused',days:6,now:f.state.now}).length,4);
  assert.equal(filterUsage(items,ledger,{context:A,mode:'unused',days:7,now:'2026-11-09T06:00:00.000Z'}).length,4);
  assert.equal(summarizeUsage(items,ledger,{context:A,now:f.state.now})[0].lastUsed,'2026-11-10T06:00:00.000Z');
});
test('taught-not-assigned follows the most recent cycle without confusing exports',async()=>{
  const f=fixture();await register(f,{occurredAt:'2026-11-10T06:00:00.000Z'});
  let ledger=await f.usage.loadUsage({context:A});assert.equal(filterUsage(f.index(),ledger,{context:A,mode:'taught-not-assigned',now:f.state.now}).length,4);
  await register(f,{action:'assigned',actionId:'assignment',occurredAt:'2026-11-11T06:00:00.000Z'});ledger=await f.usage.loadUsage({context:A});assert.equal(filterUsage(f.index(),ledger,{context:A,mode:'taught-not-assigned',now:f.state.now}).length,0);
  await register(f,{actionId:'reteach',occurredAt:'2026-11-12T06:00:00.000Z'});ledger=await f.usage.loadUsage({context:A});assert.equal(filterUsage(f.index(),ledger,{context:A,mode:'taught-not-assigned',now:f.state.now}).length,4);
});
test('pure filters preserve caller item identity and input order and reject another context ledger',async()=>{
  const f=fixture(),items=f.index().items.reverse(),ledger=await f.usage.loadUsage({context:A});const result=filterUsage(items,ledger,{context:A,now:f.state.now});assert.deepEqual(result,items);assert.equal(result[0],items[0]);
  assert.throws(()=>filterUsage(items,ledger,{context:B}),{code:'USAGE_CONTEXT_MISMATCH'});for(const days of [0,-1,1.2,NaN])assert.throws(()=>filterUsage(items,ledger,{context:A,days}),{code:'USAGE_INVALID'});
});
test('selected entry registration excludes sections and preserves old v1/v2/v3 plans',async()=>{
  for(const version of [1,2,3]){const f=fixture(),plan=version===1?{schemaVersion:1,title:f.plan.title,entries:f.plan.entries}:{...f.plan,schemaVersion:version},before=clone(plan);
    const result=await register(f,{plan,entryIds:[plan.entries[1].entryId]});assert.equal(result.event.items.length,1);assert.deepEqual(plan,before);}
});
test('snapshot metadata and public candidate mutation cannot launder the private captured command',async()=>{
  const f=fixture(),candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});candidate.context.classId='forged';candidate.context=B;candidate.action='assigned';candidate.items[0].markdown='forged';candidate.items.length=0;
  const result=await f.usage.recordPlanUsage(candidate,{actionId:'one'});assert.equal(result.event.action,'taught');assert.equal(result.event.items.length,4);assert.deepEqual(result.event.context,A);
  assert.throws(()=>f.usage.recordPlanUsage(clone(candidate),{actionId:'two'}),{code:'USAGE_INVALID'});
});
test('partial usage records selected stable fragment IDs and scores without claiming full teaching',async()=>{
  const f=fixture(),region=(type,id,body)=>`<!-- mathsemble:${type}${id?' '+id:''} -->\n\n${body}\n\n<!-- mathsemble:end -->`;
  const markdown=region('stem','','共用题干')+'\n\n'+region('part','p1','第一问 ?{1}')+'\n\n'+region('part','p2','第二问 ?{2}');f.put('题库/A.md',markdown,{id:'A'});
  let plan=core.addItem(core.createPlan('部分讲授'),f.index().items.find(item=>item.id==='A'));plan=core.updateEntry(plan,plan.entries[0].entryId,{fragmentRef:{kind:'question-part',ids:['p2'],scores:{p2:4.5}}});
  const saved=await register(f,{plan});assert.equal(plan.schemaVersion,4);assert.deepEqual(saved.event.items[0].fragmentRef,{kind:'question-part',ids:['p2'],scores:{p2:4.5}});assert.equal(saved.event.items[0].score,4.5);assert.equal(saved.event.items[0].markdown,markdown);
  const ledger=await f.usage.loadUsage({context:A}),rows=f.usage.summarizeUsage(f.index(),ledger,{context:A,now:f.state.now});assert.equal(rows.find(row=>row.item.id==='A').partialCount,1);
  assert(!f.usage.filterUsage(f.index(),ledger,{context:A,mode:'unused',now:f.state.now}).some(item=>item.id==='A'));
  assert.deepEqual(f.usage.validateEvent(saved.event),saved.event);
});
test('retrying a committed action retains its historic version after source edits',async()=>{
  const f=fixture(),saved=await register(f);f.put('题库/A.md','later revision',{id:'A'});const retry=await f.usage.recordPlanUsage(saved.candidate,{actionId:'one'});assert.equal(retry.idempotent,true);assert.equal(retry.event.items[0].markdown,'题目 A ?{42}');assert.equal((await active(f)).length,1);
});
test('directory settings captured at preparation cannot be silently changed for registration',async()=>{
  const f=fixture(),candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'},{config:{questionRoots:['题库']}});
  assert.throws(()=>f.usage.recordPlanUsage(candidate,{actionId:'one'},{config:{questionRoots:['other']}}),{code:'USAGE_STALE'});assert.equal((await active(f)).length,0);
});
test('source edit, deletion, reidentity and new duplicate reject before any event append',async t=>{
  for(const [name,change]of [['edit',f=>f.put('题库/A.md','changed',{id:'A'})],['delete',f=>f.remove('题库/A.md')],['id',f=>f.put('题库/A.md','题目 A ?{42}',{id:'OTHER'})],['duplicate',f=>f.put('题库/C.md','dup',{id:'A'})]])await t.test(name,async()=>{
    const f=fixture(),candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});change(f);await assert.rejects(f.usage.recordPlanUsage(candidate,{actionId:'one'}),{code:'USAGE_SOURCE_CHANGED'});assert.equal((await active(f)).length,0);assert.equal(f.listeners.size,0);
  });
});
test('edits during capture and after capture before append are rejected with watcher cleanup',async()=>{
  const f=fixture();f.state.readHook=file=>{if(file.path==='题库/A.md')f.emit('modify',file);};await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'}));assert.equal(f.listeners.size,0);f.state.readHook=null;
  const candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});let checked=false,sourceReads=0;f.state.readHook=file=>{if(file.extension==='md')sourceReads++;};
  const original=f.vault.getAbstractFileByPath;f.vault.getAbstractFileByPath=path=>{const value=original(path);if(sourceReads>=4&&!checked&&path.endsWith(f.usage.contextKey(A))&&Array.isArray(value?.children)){checked=true;queueMicrotask(()=>f.emit('modify',f.nodes.get('题库/A.md')));}return value;};
  await assert.rejects(f.usage.recordPlanUsage(candidate,{actionId:'race'}));assert.equal(f.writes.filter(x=>x[0]==='create').length,0);assert.equal(f.listeners.size,0);
});
test('aborted, stale-view and timed-out capture never writes; submitted write can finish after close',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'},{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'},{isCurrent:()=>false}),{code:'USAGE_STALE'});
  f.state.scanHook=()=>new Promise(()=>{});await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'}),{code:'USAGE_TIMEOUT'});f.state.scanHook=null;assert.equal(f.listeners.size,0);
  const candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'}),gate=deferred(),started=deferred(),cancel=new AbortController();f.state.createHook=async()=>{started.resolve();await gate.promise;};
  const pending=f.usage.recordPlanUsage(candidate,{actionId:'late'},{signal:cancel.signal});await started.promise;cancel.abort();gate.resolve();const result=await pending;assert.equal(result.state,'saved');assert.equal((await active(f)).length,1);assert.equal(f.listeners.size,0);
});
test('a persisted write rejection is verified, while unknown and truncated writes never pretend success',async()=>{
  const f=fixture();f.state.createMode='persist-reject';const result=await register(f);assert.equal(result.state,'saved');assert.equal((await active(f)).length,1);
  const g=fixture();g.state.createMode='reject';const candidate=await g.usage.preparePlanUsage({plan:g.plan,context:A,action:'taught'});await assert.rejects(g.usage.recordPlanUsage(candidate,{actionId:'retry'}),{code:'USAGE_WRITE_UNVERIFIED'});
  g.state.createMode='normal';await g.usage.recordPlanUsage(candidate,{actionId:'retry'});assert.equal((await active(g)).length,1);
  const h=fixture();h.state.createMode='partial';await assert.rejects(register(h),{code:'USAGE_CORRUPT'});const old=[...h.nodes.values()].find(n=>n.extension==='json').content;
  await assert.rejects(h.usage.loadUsage({context:A}),{code:'USAGE_CORRUPT'});await assert.rejects(register(h,{actionId:'new'}),{code:'USAGE_CORRUPT'});assert.equal([...h.nodes.values()].find(n=>n.extension==='json').content,old);
});
test('successful host write with timed-out readback remains unverified and can be retried idempotently',async()=>{
  const f=fixture(),candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught'});f.state.readHook=file=>file.extension==='json'?new Promise(()=>{}):undefined;
  await assert.rejects(f.usage.recordPlanUsage(candidate,{actionId:'readback'}),{code:'USAGE_WRITE_UNVERIFIED'});f.state.readHook=null;
  assert.equal((await f.usage.recordPlanUsage(candidate,{actionId:'readback'})).idempotent,true);assert.equal((await active(f)).length,1);
});
test('malformed JSON, hash changes, unsupported schema and conflicting names block only their context',async t=>{
  for(const [name,mutate]of [['json',()=>'{'],['source',e=>{e.items[0].markdown='forged';return JSON.stringify(e);}],['schema',e=>{e.schemaVersion=2;return JSON.stringify(e);}],['context',e=>{e.context=B;return JSON.stringify(e);}]])await t.test(name,async()=>{
    const f=fixture(),saved=await register(f);f.put(saved.path,mutate(clone(saved.event)));await assert.rejects(f.usage.loadUsage({context:A}),{code:'USAGE_CORRUPT'});assert.equal((await active(f,B)).length,0);
  });
});
test('missing correction targets and mutation while reading are never silently ignored',async()=>{
  const f=fixture(),saved=await register(f);await f.usage.revokeUsage(saved.event.eventId,{context:A,actionId:'undo'});f.remove(saved.path);await assert.rejects(f.usage.loadUsage({context:A}),{code:'USAGE_CORRUPT'});
  const g=fixture();await register(g);g.state.readHook=file=>{if(file.extension==='json')g.emit('modify',file);};await assert.rejects(g.usage.loadUsage({context:A}),{code:'USAGE_STALE'});assert.equal(g.listeners.size,0);
});
test('corrupt log appearing after final validation but before create blocks a new teaching event',async()=>{
  const f=fixture();await register(f);const candidate=await f.usage.preparePlanUsage({plan:f.plan,context:A,action:'assigned'});let sourceReads=0,injected=false;
  f.state.readHook=file=>{if(file.extension==='md')sourceReads++;};const original=f.vault.getAbstractFileByPath;
  f.vault.getAbstractFileByPath=path=>{const value=original(path);if(!injected&&sourceReads>=4&&path.startsWith('Mathsemble/使用账本/')&&path.endsWith('.json')&&!value){injected=true;queueMicrotask(()=>f.put('Mathsemble/使用账本/'+f.usage.contextKey(A)+'/'+'0'.repeat(64)+'.json','{'));}return value;};
  await assert.rejects(f.usage.recordPlanUsage(candidate,{actionId:'new-after-check'}),{code:'USAGE_STALE'});assert(injected);assert.equal(f.writes.filter(row=>row[0]==='create').length,1);assert.equal(f.listeners.size,0);
});
test('deleting the original event in the pre-create gap cannot append an orphan revocation',async()=>{
  const f=fixture(),saved=await register(f);let injected=false;const original=f.vault.getAbstractFileByPath;
  f.vault.getAbstractFileByPath=path=>{const value=original(path);if(!injected&&path.startsWith('Mathsemble/使用账本/')&&path.endsWith('.json')&&!value){injected=true;queueMicrotask(()=>f.remove(saved.path));}return value;};
  await assert.rejects(f.usage.revokeUsage(saved.event.eventId,{context:A,actionId:'undo-gap'}),{code:'USAGE_STALE'});assert(injected);assert.equal(f.writes.filter(row=>row[0]==='create').length,1);assert.equal((await active(f)).length,0);assert.equal(f.listeners.size,0);
});
test('invalid shapes, unsafe roots, getters and future activity times fail closed',async()=>{
  const f=fixture();assert.throws(()=>createUsageService({vault:f.vault,core,scanIndex:()=>f.index(),root:'../outside'}));
  await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught',occurredAt:'2027-01-01T00:00:00.000Z'}));
  await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught',occurredAt:'2026-02-30T00:00:00.000Z'}),{code:'USAGE_INVALID'});
  const getter={};Object.defineProperty(getter,'classId',{get(){throw Error('must not invoke');},enumerable:true});await assert.rejects(f.usage.loadUsage({context:getter}),/非法属性/);
  await assert.rejects(f.usage.preparePlanUsage({plan:f.plan,context:A,action:'taught',entryIds:[f.plan.entries[0].entryId]}));assert.equal(f.writes.length,0);
});
