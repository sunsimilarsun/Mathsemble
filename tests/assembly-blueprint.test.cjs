'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createBlueprintEngine}=require('../src/assembly-blueprint.cjs');
const engine=createBlueprintEngine({core});
const clone=value=>JSON.parse(JSON.stringify(value));
const frozen=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;};
const question=(id,metadata={},markdown)=>({path:'题库/'+(id||'no-id')+'.md',kind:'question',metadata:{id,subject:'高中数学',question_type:'choice',difficulty:2,teaching_tier:'基础',role:'训练',knowledge_nodes:['集合'],...metadata},markdown:markdown??'题 '+id});
const row=(rowId,count=1,filters={})=>({rowId,label:rowId,filters,count});
const blueprint=(rows=[row('A')],maxPerFamily=null)=>({schemaVersion:1,blueprintId:'blueprint-1',revision:1,title:'配额试验',rows,constraints:{uniqueQuestion:true,maxPerFamily}});
const setup=(records,options={})=>{
  const index=core.buildIndex(records),plan=options.plan||core.createPlan(),bp=options.blueprint||blueprint(),locks=options.locks||[],excludedKeys=options.excludedKeys||[];
  const prepared=engine.prepareAllocation({index,plan,blueprint:bp,locks,excludedKeys});
  return {index,plan,blueprint:bp,locks,excludedKeys,...prepared};
};
const allocate=(state,options)=>{assert.equal(state.status,'ready',JSON.stringify(state.issues));return engine.allocateQuestions(state.problem,options);};
const idsFor=allocation=>Object.fromEntries(allocation.assignments.filter(value=>value.origin==='candidate').map(value=>[value.slotId,'entry-'+value.slotId]));
const apply=(state,allocation,extra={})=>engine.applyAllocation({freshIndex:state.index,plan:state.plan,blueprint:state.blueprint,locks:state.locks,excludedKeys:state.excludedKeys,allocation,expectedContext:state.context,entryIdsBySlot:idsFor(allocation),...extra});
const lockFor=(item,rowId='A',slot=1,entry)=>({rowId,slotId:rowId+':'+slot,origin:entry?'plan':'candidate',sourceId:item.id,sourcePath:item.path,sourceFingerprint:item.fingerprint,...(entry?{existingEntryId:entry.entryId}:{})});

test('factory is injected and accepts an empty draft without accepting an empty allocation',()=>{
  assert.throws(()=>createBlueprintEngine(),/core/);
  const bp=blueprint([]);assert.deepEqual(engine.validateBlueprint(bp).rows,[]);
  assert.equal(setup([],{blueprint:bp}).issues[0].code,'EMPTY_BLUEPRINT');
});

test('blueprint canonicalization preserves existing dimension OR and cross-dimension AND semantics',()=>{
  const bp=engine.validateBlueprint(blueprint([row('A',1,{difficulty:['4',2,2],subject:'高中数学',query:'  数学  ',tier:['all','基础']})]));
  assert.deepEqual(bp.rows[0].filters.difficulty,[2,4]);assert.deepEqual(bp.rows[0].filters.subject,['高中数学']);
  assert.equal(bp.rows[0].filters.query,'数学');assert.deepEqual(bp.rows[0].filters.tier,['基础']);
  const records=[question('x',{difficulty:2,methods:['代入']}),question('y',{difficulty:4,methods:['代入']}),question('z',{difficulty:1,methods:['代入']}),question('no',{subject:'初中数学'})];
  const state=setup(records,{blueprint:blueprint([row('A',2,{difficulty:[2,4],subject:'高中数学',method:'代入',knowledge:['不存在','集合']})])});
  assert.deepEqual(allocate(state).assignments.map(value=>value.sourceId).sort(),['x','y']);
});

test('knowledge-note filters delegate the existing resolved/shared-tag semantics to core',()=>{
  const records=[{path:'知识/集合.md',kind:'knowledge',metadata:{id:'K',subject:'高中数学',knowledge_nodes:['集合']},markdown:'知识'},question('x'),question('other',{subject:'初中数学'})];
  const state=setup(records,{blueprint:blueprint([row('A',1,{knowledge:'id:K'})])});
  assert.deepEqual(allocate(state).assignments.map(value=>value.sourceId),['x']);
});

test('strict schema rejects unknown fields, versions, invalid counts, IDs and constraints',()=>{
  const good=blueprint();
  for(const patch of [{schemaVersion:2},{blueprintId:'with:colon'},{revision:0},{title:''},{extra:true},{constraints:{uniqueQuestion:false,maxPerFamily:null}},{constraints:{uniqueQuestion:true,maxPerFamily:0}}])assert.throws(()=>engine.validateBlueprint({...good,...patch}));
  for(const rows of [[row('A',0)],[row('A',1.5)],[row('A',1001)],[row('A',600),row('B',500)],[row('A'),row('A')],Array.from({length:65},(_,i)=>row('r'+i)),[row('A',1,{kind:'knowledge'})],[row('A',1,{difficulty:6})]])assert.throws(()=>engine.validateBlueprint({...good,rows}));
});

test('hostile getters, symbols, polluted prototypes and sparse arrays never execute getters',()=>{
  let calls=0;const evil=()=>{calls++;throw new Error('executed');};
  const top=blueprint();Object.defineProperty(top,'rows',{get:evil});
  const nested=blueprint();Object.defineProperty(nested.rows[0].filters,'query',{get:evil});
  const sparse=blueprint();sparse.rows=Array(1);
  const symbol=blueprint();symbol[Symbol('x')]=1;
  const extraArray=blueprint();extraArray.rows.foo='x';
  for(const value of [top,nested,sparse,symbol,extraArray,Object.assign(Object.create({hidden:true}),blueprint()),JSON.parse('{"__proto__":{}}')])assert.throws(()=>engine.validateBlueprint(value));
  assert.equal(calls,0);
});

test('global allocation solves the greedy trap for many seeds without moving row identities',()=>{
  const state=setup([question('x',{methods:['wide','narrow']}),question('y',{methods:['wide']})],{blueprint:blueprint([row('A',1,{method:'wide'}),row('B',1,{method:'narrow'})])});
  for(let seed=0;seed<30;seed++){
    const result=allocate(state,{seed:String(seed)});assert.equal(result.status,'complete');
    assert.deepEqual(result.assignments.map(value=>[value.slotId,value.sourceId]),[['A:1','y'],['B:1','x']]);
  }
});

test('global overlap infeasibility cannot publish a partial candidate or widen conditions',()=>{
  const state=setup(['x','y','z'].map(id=>question(id)),{blueprint:blueprint([row('A',2),row('B',2)])});
  const result=allocate(state);assert.equal(result.status,'infeasible');assert.deepEqual(result.assignments,[]);
  assert.equal(result.rowStats.reduce((sum,value)=>sum+value.missing,0),1);
  assert.equal(result.diagnostics.at(-1).code,'GLOBAL_QUOTA_SHORTFALL');assert.equal(result.diagnostics.at(-1).allocated,3);
  assert.throws(()=>apply(state,result),/完整候选/);
});

test('exact flow agrees with an independent exhaustive oracle for all 512 three-by-three matching graphs',()=>{
  const rows=[row('A',1,{method:'A'}),row('B',1,{method:'B'}),row('C',1,{method:'C'})];
  const possible=matrix=>{const visit=(r,used)=>r===3||matrix.some((matches,q)=>!used.has(q)&&matches[r]&&visit(r+1,new Set([...used,q])));return visit(0,new Set());};
  for(let bits=0;bits<512;bits++){
    const matrix=Array.from({length:3},(_,q)=>Array.from({length:3},(_,r)=>Boolean(bits&(1<<(q*3+r)))));
    const records=matrix.map((matches,q)=>question('Q'+q,{methods:rows.filter((_,r)=>matches[r]).map(value=>value.rowId)}));
    const result=allocate(setup(records,{blueprint:blueprint(rows)}),{seed:String(bits%7)});
    assert.equal(result.status==='complete',possible(matrix),'graph '+bits);
  }
});

test('the complete candidate pool includes more than the visible first hundred',()=>{
  const records=Array.from({length:150},(_,i)=>question('Q'+String(i).padStart(3,'0')));
  const result=allocate(setup(records,{blueprint:blueprint([row('A',150)])}));
  assert.equal(result.status,'complete');assert.equal(result.assignments.length,150);assert(result.assignments.some(value=>value.sourceId==='Q149'));
});

test('same seed is deterministic across scan ordering and all caller inputs remain unchanged',()=>{
  const records=Array.from({length:12},(_,i)=>question('Q'+i,{methods:['A','B']})),bp=frozen(blueprint([row('A',3),row('B',2)])),plan=frozen(core.createPlan());
  const state=setup(frozen(records),{plan,blueprint:bp}),before=JSON.stringify({state,records});
  const first=allocate(state,{seed:'repeat'}),second=allocate(setup(records.slice().reverse(),{plan,blueprint:bp}),{seed:'repeat'});
  assert.deepEqual(first,second);assert.equal(JSON.stringify({state,records}),before);
  assert.notDeepEqual(first.assignments,allocate(state,{seed:'different'}).assignments);
  assert(Object.isFrozen(state.problem));assert(Object.isFrozen(state.problem.candidates));
});

test('stable row-plus-ordinal slots retain their row identities across reordering',()=>{
  const rows=[row('A',2),row('B')],records=['a','b','c'].map(id=>question(id));
  const one=allocate(setup(records,{blueprint:blueprint(rows)})),two=allocate(setup(records,{blueprint:blueprint(rows.slice().reverse())}));
  const sort=values=>values.slice().sort((a,b)=>a.slotId.localeCompare(b.slotId));assert.deepEqual(sort(one.assignments),sort(two.assignments));
});

test('existing IDs, existing paths, duplicate identities, excluded keys and knowledge notes cannot be selected',()=>{
  const records=[question('used'),question(''),question('dup'),{...question('dup'),path:'题库/duplicate.md'},question('allowed'),question('exclude'),{path:'知识/k.md',kind:'knowledge',metadata:{id:'K'},markdown:'知识'}];
  let plan=core.addItem(core.createPlan(),core.buildIndex(records).items[0]);plan=core.addItem(plan,core.buildIndex(records).items[1]);
  const renamed=[{...records[0],path:'题库/renamed.md'},...records.slice(1)];
  const state=setup(renamed,{plan,excludedKeys:['id:exclude']});assert.deepEqual(allocate(state).assignments.map(value=>value.sourceId),['allowed']);
});

test('an ID-less eligible source keeps its path identity through atomic application',()=>{
  const state=setup([question('')]),allocation=allocate(state),result=apply(state,allocation);
  assert.equal(result.plan.entries[0].sourceId,'');assert.equal(result.plan.entries[0].sourcePath,'题库/no-id.md');assert.equal(result.bindings[0].entryId,'entry-A:1');
});

test('existing questions count toward a quota only with explicit plan-origin slot ownership',()=>{
  const records=['old','other','new'].map(id=>question(id)),index=core.buildIndex(records);
  let plan=core.addSection(core.createPlan(),'保留分区');plan=core.addItem(plan,index.items[0]);plan=core.addItem(plan,index.items[1]);
  plan=core.updateEntry(plan,plan.entries[1].entryId,{title:'自定义题名',role:'例题'});
  const bp=blueprint([row('A',2)]),lock=lockFor(index.items[0],'A',1,plan.entries[1]);
  const state=setup(records,{plan,blueprint:bp,locks:[lock]}),allocation=allocate(state),result=apply(state,allocation);
  assert.equal(allocation.status,'complete');assert.equal(result.plan.entries.length,4);assert.deepEqual(result.plan.entries.slice(0,3),plan.entries);
  assert.deepEqual(result.bindings.map(value=>value.entryId),[plan.entries[1].entryId,'entry-A:2']);assert.equal(allocation.assignments[1].sourceId,'new');
  const without=allocate(setup(records,{plan,blueprint:bp}));assert.equal(without.status,'infeasible');
});

test('a candidate lock remains in its row across regeneration and can make another row genuinely infeasible',()=>{
  const records=[question('x',{methods:['A','B']}),question('y',{methods:['A']})],index=core.buildIndex(records),bp=blueprint([row('A',1,{method:'A'}),row('B',1,{method:'B'})]);
  const locked=setup(records,{blueprint:bp,locks:[lockFor(index.items[0])]});assert.equal(allocate(locked).status,'infeasible');
  assert.equal(allocate(setup(records,{blueprint:bp})).status,'complete');
  const many=setup(['x','y','z','w'].map(id=>question(id)),{blueprint:blueprint([row('A',2)]),locks:[lockFor(index.items[0])]});
  for(const seed of ['one','two','three'])assert.equal(allocate(many,{seed}).assignments[0].sourceId,'x');
});

test('removed or shrunk rows, changed filters, stale sources and duplicate locks are explicit conflicts',()=>{
  const records=[question('x',{methods:['A']})],item=core.buildIndex(records).items[0],lock=lockFor(item);
  const cases=[{blueprint:blueprint([row('B')])},{blueprint:blueprint([row('A',1,{method:'B'})])},{locks:[lock,lock]},{locks:[{...lock,slotId:'A:2'}]},{locks:[{...lock,sourceFingerprint:'stale'}]},{locks:[{...lock,origin:'plan',existingEntryId:'absent'}]}];
  for(const patch of cases){const state=setup(records,{locks:[lock],...patch});assert.equal(state.status,'conflict',JSON.stringify(patch));assert(state.issues.length);}
});

test('capacity counts every original section and knowledge entry, not only questions',()=>{
  const records=[question('x'),question('y')],index=core.buildIndex(records),plan=core.createPlan();
  for(let i=0;i<999;i++)plan.entries.push({entryId:'s'+i,kind:'section',sourceId:'',sourcePath:'',sourceFingerprint:'',title:'分区',role:''});
  assert.equal(setup(records,{plan,blueprint:blueprint([row('A',2)])}).issues[0].code,'PLAN_CAPACITY_EXCEEDED');
  const full=core.addItem(plan,index.items[0]),state=setup(records,{plan:full,locks:[lockFor(index.items[0],'A',1,full.entries[999])]});
  assert.equal(apply(state,allocate(state)).plan.entries.length,1000);
});

test('family capacity is global across rows and counts pre-existing unassigned questions',()=>{
  const records=[question('old',{family_id:'F'}),question('f',{family_id:'F'}),question('g',{family_id:'G'}),question('h',{family_id:'H'})],index=core.buildIndex(records),plan=core.addItem(core.createPlan(),index.items[0]);
  const state=setup(records,{plan,blueprint:blueprint([row('A'),row('B')],1)}),result=allocate(state);
  assert.deepEqual(result.assignments.map(value=>value.sourceId).sort(),['g','h']);assert.deepEqual(result.familyStats.map(value=>[value.familyId,value.count]),[['F',1],['G',1],['H',1]]);
  const noRoom=setup(records.slice(0,3),{plan,blueprint:blueprint([row('A'),row('B')],1)});assert.equal(allocate(noRoom).status,'infeasible');
});

test('plan-origin locks do not charge family capacity twice; candidate locks do charge it',()=>{
  const records=[question('old',{family_id:'F'}),question('new',{family_id:'F'}),question('g',{family_id:'G'})],index=core.buildIndex(records),plan=core.addItem(core.createPlan(),index.items[0]);
  const state=setup(records,{plan,blueprint:blueprint([row('A',2)],1),locks:[lockFor(index.items[0],'A',1,plan.entries[0])]});assert.equal(allocate(state).status,'complete');
  const conflict=setup(records,{plan,blueprint:blueprint([row('A')],1),locks:[lockFor(index.items[1])]});assert(conflict.issues.some(value=>value.code==='LOCK_FAMILY_LIMIT'));
});

test('unknown family values are separate unclassified questions, never one synthetic family',()=>{
  const state=setup([question('a',{family_id:null}),question('b',{family_id:''}),question('c')],{blueprint:blueprint([row('A',3)],1)});
  const result=allocate(state);assert.equal(result.status,'complete');assert.deepEqual(result.familyStats,[]);
});

test('invalid family values are excluded only with enabled caps and old invalid or unresolved sources conflict',()=>{
  const records=[question('bad',{family_id:{id:'F'}}),question('good',{family_id:' F '})],index=core.buildIndex(records);
  const plain=setup(records,{blueprint:blueprint([row('A',2)])});assert.equal(allocate(plain).status,'complete');
  const capped=setup(records,{blueprint:blueprint([row('A',2)],1)});assert.equal(allocate(capped).status,'infeasible');assert(capped.issues.some(value=>value.code==='INVALID_FAMILY'));
  const invalidPlan=core.addItem(core.createPlan(),index.items[0]);assert.equal(setup(records,{plan:invalidPlan,blueprint:blueprint([row('A')],1)}).status,'conflict');
  const goodPlan=core.addItem(core.createPlan(),index.items[1]);assert.equal(setup([records[0]],{plan:goodPlan}).status,'ready');assert.equal(setup([records[0]],{plan:goodPlan,blueprint:blueprint([row('A')],1)}).status,'conflict');
});

test('an already over-cap plan is never silently reduced to make an allocation feasible',()=>{
  const records=[question('a',{family_id:'F'}),question('b',{family_id:'F'}),question('c',{family_id:'G'})],index=core.buildIndex(records);
  const plan=core.addItem(core.addItem(core.createPlan(),index.items[0]),index.items[1]),before=JSON.stringify(plan);
  const state=setup(records,{plan,blueprint:blueprint([row('A')],1)});assert(state.issues.some(value=>value.code==='PLAN_FAMILY_LIMIT'));assert.equal(JSON.stringify(plan),before);
});

test('family flow matches an independent search over small overlapping pools and caps',()=>{
  const ids=['a','b','c','d'],families=['F','F','G',null],rowIds=['A','B'];
  for(let bits=0;bits<256;bits++){
    const matrix=ids.map((_,q)=>rowIds.map((_,r)=>Boolean(bits&(1<<(q*2+r)))));
    const records=ids.map((id,q)=>question(id,{methods:rowIds.filter((_,r)=>matrix[q][r]),family_id:families[q]}));
    const possible=matrix.some((matches,q)=>matches[0]&&matrix.some((other,p)=>p!==q&&other[1]&&(!families[q]||families[p]!==families[q])));
    const state=setup(records,{blueprint:blueprint(rowIds.map(id=>row(id,1,{method:id})),1)});
    assert.equal(allocate(state,{seed:String(bits)}).status==='complete',possible,'family graph '+bits);
  }
});

test('single-slot replacement fixes all other slots and excludes the previous question',()=>{
  const state=setup(['a','b','c','d'].map(id=>question(id)),{blueprint:blueprint([row('A',2),row('B')])}),allocation=allocate(state),before=clone(allocation),target=allocation.assignments[0];
  const prepared=engine.prepareReplacement({problem:state.problem,allocation,targetSlotId:target.slotId}),replacement=allocate(prepared,{seed:'replace'});
  assert.equal(replacement.status,'complete');assert.notEqual(replacement.assignments[0].sourceId,target.sourceId);assert.deepEqual(replacement.assignments.slice(1),allocation.assignments.slice(1));assert.deepEqual(allocation,before);
  assert.equal(apply(state,replacement).plan.entries.length,3);
});

test('replacement cannot silently reshuffle an occupied alternative or break a lock',()=>{
  const state=setup(['a','b'].map(id=>question(id)),{blueprint:blueprint([row('A',2)])}),allocation=allocate(state);
  const replacement=allocate(engine.prepareReplacement({problem:state.problem,allocation,targetSlotId:'A:1'}));assert.equal(replacement.status,'infeasible');assert.deepEqual(replacement.assignments,[]);
  const locked=setup(['a','b'].map(id=>question(id)),{locks:[allocation.assignments[0]]});
  assert.equal(engine.prepareReplacement({problem:locked.problem,allocation:allocate(locked),targetSlotId:'A:1'}).issues[0].code,'REPLACEMENT_LOCKED');
});

test('same-family replacement releases the old slot capacity and still obeys its row filters',()=>{
  const records=[question('a',{family_id:'F',methods:['ok']}),question('b',{family_id:'F',methods:['ok']}),question('c',{family_id:'F',methods:['wrong']}),question('g',{family_id:'G',methods:['ok']})];
  const state=setup(records,{blueprint:blueprint([row('A',1,{method:'ok'})],1),excludedKeys:['id:g']}),allocation=allocate(state),old=allocation.assignments[0].sourceId;
  const replacement=allocate(engine.prepareReplacement({problem:state.problem,allocation,targetSlotId:'A:1',mode:'same-family'}));assert.equal(replacement.status,'complete');assert.notEqual(replacement.assignments[0].sourceId,old);assert(!['c','g'].includes(replacement.assignments[0].sourceId));
  assert.equal(engine.prepareReplacement({problem:state.problem,allocation,targetSlotId:'A:1',candidateKey:'id:c'}).status,'conflict');
});

test('unknown-family same-family replacement refuses to invent a relationship',()=>{
  const state=setup([question('a'),question('b')]),allocation=allocate(state);
  assert.equal(engine.prepareReplacement({problem:state.problem,allocation,targetSlotId:'A:1',mode:'same-family'}).issues[0].code,'REPLACEMENT_FAMILY_UNKNOWN');
});

test('budget and cancellation are distinct from proven infeasibility and never expose partial assignments',()=>{
  const state=setup(Array.from({length:20},(_,i)=>question('Q'+i)),{blueprint:blueprint([row('A',10)])});
  for(const limits of [{maxEdges:0},{maxOperations:0},{maxOperations:50}]){const result=allocate(state,{limits});assert.equal(result.status,'budget');assert.deepEqual(result.assignments,[]);}
  assert.equal(allocate(state,{signal:{aborted:true}}).status,'cancelled');
  let polls=0;const during=allocate(state,{signal:{get aborted(){return ++polls>20;}}});assert.equal(during.status,'cancelled');
  assert.equal(allocate(state).status,'complete');
  assert.throws(()=>allocate(state,{limits:{timeout:1}}));assert.throws(()=>allocate(state,{seed:''}));
});

test('the solver never accepts an invented or cloned opaque problem',()=>{
  const state=setup([question('a')]);assert.throws(()=>engine.allocateQuestions(clone(state.problem)),/当次准备/);
  assert.throws(()=>createBlueprintEngine({core}).allocateQuestions(state.problem),/当次准备/);
});

test('atomic application uses injected IDs, preserves old entries and rejects duplicate or absent IDs',()=>{
  const state=setup([question('a'),question('b')],{blueprint:blueprint([row('A',2)])}),allocation=allocate(state),before=JSON.stringify(state.plan);
  assert.throws(()=>apply(state,allocation,{entryIdsBySlot:{'A:1':'same','A:2':'same'}}),/重复/);
  assert.throws(()=>apply(state,allocation,{entryIdsBySlot:{'A:1':'one'}}));
  assert.throws(()=>apply(state,allocation,{entryIdsBySlot:{...idsFor(allocation),extra:'other'}}));
  assert.equal(JSON.stringify(state.plan),before);assert.deepEqual(Object.keys(apply(state,allocation).plan).sort(),['course','entries','output','schemaVersion','title']);
});

test('application rejects stale source edits, deletion, new duplicate IDs, plan edits and blueprint edits',()=>{
  const records=[question('a'),question('b')],state=setup(records),allocation=allocate(state),selected=allocation.assignments[0].sourceId;
  const changed=records.map(record=>record.metadata.id===selected?{...record,markdown:'changed'}:record);
  const gone=records.filter(record=>record.metadata.id!==selected),duplicate=[...records,{...question(selected),path:'题库/duplicate-new.md'}];
  for(const freshIndex of [core.buildIndex(changed),core.buildIndex(gone),core.buildIndex(duplicate),core.buildIndex([...records,question('new')])])assert.throws(()=>apply(state,allocation,{freshIndex}),/变化|失效/);
  assert.throws(()=>apply(state,allocation,{plan:{...state.plan,title:'other'}}),/上下文/);
  assert.throws(()=>apply(state,allocation,{blueprint:{...state.blueprint,revision:2}}),/上下文/);
  assert.throws(()=>apply(state,allocation,{excludedKeys:['id:'+selected]}),/上下文/);
  assert.equal(state.plan.entries.length,0);
});

test('allocation JSON validation safely clones and does not trust forged row statistics or source assignments',()=>{
  const state=setup([question('a'),question('b')],{blueprint:blueprint([row('A',2)])}),allocation=allocate(state),roundtrip=engine.validateAllocation(clone(allocation));
  assert.deepEqual(roundtrip,allocation);roundtrip.assignments[0].sourceId='mutated';assert.notEqual(allocation.assignments[0].sourceId,'mutated');
  for(const mutate of [a=>a.assignments.pop(),a=>a.assignments[1]={...a.assignments[0]},a=>a.assignments[0].rowId='B',a=>a.assignments[0].sourceFingerprint='changed',a=>a.assignments[0].sourceId='nonexistent',a=>a.assignments[0].origin='plan']){
    const forged=clone(allocation);mutate(forged);assert.throws(()=>apply(state,forged));
  }
  let called=false;const hostile=clone(allocation);Object.defineProperty(hostile.assignments[0],'sourceId',{get(){called=true;return 'a';}});assert.throws(()=>engine.validateAllocation(hostile));assert.equal(called,false);
  const unknown=clone(allocation);unknown.planId='illegal';assert.throws(()=>engine.validateAllocation(unknown));
});

test('lock ownership cannot be forged in a complete candidate or omitted at apply',()=>{
  const records=[question('a'),question('b')],index=core.buildIndex(records),lock=lockFor(index.items[0]),state=setup(records,{locks:[lock]}),allocation=allocate(state);
  const forged=clone(allocation);forged.assignments[0]=lockFor(index.items[1]);assert.throws(()=>apply(state,forged),/锁定/);
  assert.throws(()=>apply(state,allocation,{locks:[]}),/上下文/);
});

test('locking and unlocking candidate slots keeps all assignments and enables immediate atomic application',()=>{
  const state=setup(['a','b','c'].map(id=>question(id)),{blueprint:blueprint([row('A',2)])}),allocation=allocate(state,{seed:'unchanged'}),locks=[allocation.assignments[0]];
  const locked=engine.updateAllocationLocks({index:state.index,plan:state.plan,blueprint:state.blueprint,locks,allocation});
  assert.deepEqual(locked.assignments,allocation.assignments);assert.equal(locked.seed,allocation.seed);assert.equal(locked.rowStats[0].locked,1);assert.notEqual(locked.context,allocation.context);
  assert.equal(apply(state,locked,{locks,expectedContext:locked.context}).plan.entries.length,2);
  const unlocked=engine.updateAllocationLocks({index:state.index,plan:state.plan,blueprint:state.blueprint,locks:[],allocation:locked});
  assert.deepEqual(unlocked,allocation);assert.deepEqual(allocation.locks,[]);
});

test('changing locks cannot launder a stale source, blueprint, plan or exclusion context',()=>{
  const records=[question('a'),question('b')],state=setup(records),allocation=allocate(state),base={index:state.index,plan:state.plan,blueprint:state.blueprint,locks:[allocation.assignments[0]],allocation};
  for(const patch of [{index:core.buildIndex(records.map(value=>({...value,markdown:'edited'})))},{plan:{...state.plan,title:'changed'}},{blueprint:{...state.blueprint,revision:2}},{excludedKeys:['id:unrelated']}])
    assert.throws(()=>engine.updateAllocationLocks({...base,...patch}),error=>error.code==='BLUEPRINT_STALE');
});

test('unlocking explicit existing-plan ownership requires regeneration instead of silently changing origin',()=>{
  const records=[question('a'),question('b')],index=core.buildIndex(records),plan=core.addItem(core.createPlan(),index.items[0]);
  const state=setup(records,{plan,locks:[lockFor(index.items[0],'A',1,plan.entries[0])]}),allocation=allocate(state),before=clone(allocation);
  assert.throws(()=>engine.updateAllocationLocks({index,plan,blueprint:state.blueprint,locks:[],allocation}),error=>error.code==='BLUEPRINT_REGENERATE_REQUIRED');
  assert.deepEqual(allocation,before);assert.equal(plan.entries.length,1);
});

test('relocking to a different valid candidate never overwrites the visible assignment silently',()=>{
  const state=setup([question('a'),question('b')]),allocation=allocate(state),other=state.index.items.find(item=>item.id!==allocation.assignments[0].sourceId);
  assert.throws(()=>engine.updateAllocationLocks({index:state.index,plan:state.plan,blueprint:state.blueprint,allocation,locks:[lockFor(other)]}),error=>error.code==='BLUEPRINT_REGENERATE_REQUIRED');
});

test('legacy v1 and v2 input plans remain unchanged and apply returns only the standard v3 schema',()=>{
  for(const version of [1,2,3]){
    const plan=core.createPlan('legacy');plan.schemaVersion=version;if(version===1){delete plan.course;delete plan.output;}if(version===2)plan.output.solutionOptions={solutionSpaces:false,showSolution:true};
    const before=JSON.stringify(plan),state=setup([question('a')],{plan:frozen(plan)}),result=apply(state,allocate(state));
    assert.equal(result.plan.schemaVersion,3);assert.equal(JSON.stringify(plan),before);assert.deepEqual(Object.keys(result.plan).sort(),['course','entries','output','schemaVersion','title']);
  }
});

test('pure engine neither calls the clock nor randomness during allocation and apply',()=>{
  const state=setup([question('a'),question('b')]),oldNow=Date.now,oldRandom=Math.random;
  Date.now=()=>{throw new Error('clock used');};Math.random=()=>{throw new Error('random used');};
  try{const allocation=allocate(state,{seed:'explicit'});assert.equal(apply(state,allocation).plan.entries.length,1);}finally{Date.now=oldNow;Math.random=oldRandom;}
});
