'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createFamilyEngine}=require('../src/assembly-family.cjs');
const {createBlueprintEngine}=require('../src/assembly-blueprint.cjs');
const engine=createFamilyEngine({core});
const clone=value=>JSON.parse(JSON.stringify(value));
const freeze=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))freeze(item);Object.freeze(value);}return value;};
const q=(id,metadata={},path='题库/'+id+'.md')=>({path,kind:'question',
  metadata:{id,subject:'高中数学',question_type:'choice',teaching_tier:'基础',role:'训练',family_id:'F',...metadata},markdown:JSON.stringify({id,...metadata})});
const k=(id='K',metadata={})=>({path:'知识/'+id+'.md',kind:'knowledge',metadata:{id,title:'集合',subject:'高中数学',...metadata},markdown:'# 知识'});
function setup(records=[q('old'),q('new')],extra={}) {
  const index=extra.index || core.buildIndex(records);
  const plan=extra.plan || core.addItem(core.createPlan('本次讲义'),index.items.find(item=>item.id==='old'));
  const entryId=plan.entries.find(item=>item.sourceId==='old')?.entryId;
  const inputs={index,plan,entryId,...extra};delete inputs.records;
  return {...inputs,...engine.prepareReplacement(inputs)};
}
const apply=(state,overrides={})=>engine.applyReplacement({freshIndex:state.index,plan:state.plan,entryId:state.entryId,
  filters:state.filters,rowFilters:state.rowFilters,maxPerFamily:state.maxPerFamily,locked:state.locked,
  candidateKey:state.candidates[0]?.key,expectedContext:state.context,...overrides});

test('family and explicit parent identities only trim, retaining case and Unicode spellings',()=>{
  for(const id of ['F','f','Ｆ','é','e\u0301','all']) {
    const value=core.normalizeFamilyMetadata({family_id:' '+id+' ',parent_id:' '+id+' '});
    assert.equal(value.familyId,id);assert.equal(value.parentId,id);
    assert.equal(value.familyState,'classified');assert.equal(value.parentState,'declared');
  }
  const record=q('child',{family_id:' F ',parent_id:' P '});const before=clone(record);
  const item=core.buildIndex([freeze(record)]).items[0];
  assert.equal(item.familyId,'F');assert.equal(item.metadata.family_id,' F ');assert.deepEqual(record,before);
});

test('empty family values remain unclassified and non-string or malformed identities are explicitly invalid',()=>{
  for(const value of [undefined,null,'','   ']) {
    const parsed=core.normalizeFamilyMetadata({family_id:value,parent_id:value});
    assert.equal(parsed.familyState,'unclassified');assert.equal(parsed.familyId,null);assert.equal(parsed.familyValid,true);
    assert.equal(parsed.parentState,'none');assert.equal(parsed.parentId,null);
  }
  for(const value of [0,1,false,[],['F'],{},'F\nX','x'.repeat(513)]) {
    const parsed=core.normalizeFamilyMetadata({family_id:value,parent_id:value});
    assert.equal(parsed.familyState,'invalid');assert.equal(parsed.familyId,null);assert.equal(parsed.familyValid,false);
    assert.equal(parsed.parentState,'invalid');assert.equal(parsed.parentValid,false);
  }
});

test('family filtering is exact and orthogonal to ordinary filters, and the literal ID all is usable',()=>{
  const index=core.buildIndex(['F','f','Ｆ','é','e\u0301','all'].map((family_id,i)=>q(String(i),{family_id}))
    .concat(q('none',{family_id:null}),q('bad',{family_id:[]}),k('family-note',{family_id:'F'})));
  assert.deepEqual(core.filterItems(index,{familyId:' F '}).map(item=>item.id),['0']);
  assert.deepEqual(core.filterItems(index,{familyId:['F','f']}).map(item=>item.id),['0','1']);
  assert.deepEqual(core.filterItems(index,{familyId:'all'}).map(item=>item.id),['5']);
  assert.deepEqual(core.filterItems(index,{familyId:'é'}).map(item=>item.id),['3']);
  assert.equal(core.filterItems(index,{familyId:12}).length,0);
  assert.deepEqual(core.filterItems(index,{familyState:'unclassified'}).map(item=>item.id),['none']);
  assert.deepEqual(core.filterItems(index,{familyState:'invalid'}).map(item=>item.id),['bad']);
  assert.equal(core.filterItems(index,{familyId:'F',familyState:'invalid'}).length,0);
  assert.equal(core.filterItems(index,{familyId:'F',subject:'初中数学'}).length,0);
});

test('family groups report question members and dimensions without combining unknown or invalid families',()=>{
  const records=[q('a',{role:'example'}),q('b',{teaching_tier:'培优'}),q('lower',{family_id:'f'}),
    q('none1',{family_id:null}),q('none2',{family_id:''}),q('invalid',{family_id:[]}),k('note',{family_id:'F'})];
  const index=core.buildIndex(freeze(records)),before=JSON.stringify(index),summary=core.familyGroups(index);
  assert.deepEqual(summary.groups.map(group=>[group.familyId,group.count]),[['F',2],['f',1]]);
  assert.deepEqual(summary.groups[0].memberKeys,['id:a','id:b']);assert.equal(summary.groups[0].tiers['基础'],1);
  assert.equal(summary.groups[0].tiers['培优'],1);assert.equal(summary.groups[0].roles['例题'],1);
  assert.equal(summary.unclassifiedCount,2);assert.equal(summary.invalidCount,1);assert.equal(JSON.stringify(index),before);
});

test('same-family replacement can reuse chapter and section filters from the question list',()=>{
  const filters={chapter:'函数',section:'性质'};
  const state=setup([q('old'),q('inScope',filters),q('otherChapter',{chapter:'数列',section:'性质'}),
    q('otherSection',{chapter:'函数',section:'定义'})],{filters});
  assert.deepEqual(state.candidates.map(item=>item.id),['inScope']);
  assert.equal(apply(state).plan.entries[0].sourceId,'inScope');
});

test('same family and a variant role never invent or require a parent relationship',()=>{
  const index=core.buildIndex([q('a',{role:'变式'}),q('b',{role:'variant'}),q('c')]);
  assert(index.items.every(item=>item.parentRef.status==='none'));assert.deepEqual(index.issues,[]);
});

test('explicit parent diagnostics distinguish missing scope, duplicate ID, self, non-question and cross-family',()=>{
  const index=core.buildIndex([q('parent'),q('good',{parent_id:' parent '}),q('missing',{parent_id:'outside'}),
    q('self',{parent_id:'self'}),k(),q('wrong-kind',{parent_id:'K'}),q('other-family',{family_id:'G',parent_id:'parent'}),
    q('dup'),q('dup',{},'题库/duplicate.md'),q('ambiguous',{parent_id:'dup'}),q('bad',{parent_id:[]})]);
  const codes=new Set(index.issues.map(issue=>issue.code));
  for(const code of ['parent-missing','parent-ambiguous','parent-self','parent-non-question','parent-cross-family','parent-invalid'])assert(codes.has(code),code);
  const good=index.items.find(item=>item.id==='good');assert.equal(good.parentRef.status,'resolved');assert.equal(good.parentRef.parentKey,'id:parent');
  assert.match(index.issues.find(issue=>issue.code==='parent-missing').message,/当前素材范围/);
  assert.equal(index.items.find(item=>item.id==='other-family').parentRef.status,'resolved','a warning must not silently rewrite the explicit relation');
});

test('parent lookup uses only explicit case-sensitive IDs, never names, file paths or Unicode folding',()=>{
  const index=core.buildIndex([q('P',{title:'parent'}),q('case',{parent_id:'p'}),q('name',{parent_id:'parent'}),
    q('path',{parent_id:'题库/P.md'}),q('wiki',{parent_id:'[[P]]'}),q('é'),q('unicode',{parent_id:'e\u0301'})]);
  for(const id of ['case','name','path','wiki','unicode'])assert.equal(index.items.find(item=>item.id===id).parentRef.status,'missing',id);
});

test('parent cycle diagnosis is iterative, marks cycle members only and leaves a tail resolved',()=>{
  const records=Array.from({length:2200},(_,i)=>q('N'+i,{parent_id:'N'+((i+1)%2200)}));
  records.push(q('tail',{parent_id:'N0'}));const index=core.buildIndex(records);
  const cycles=index.issues.filter(issue=>issue.code==='parent-cycle');assert.equal(cycles.length,1);assert.equal(cycles[0].paths.length,2200);
  assert(index.items.slice(0,2200).every(item=>item.parentRef.status==='cycle'));
  assert.equal(index.items.at(-1).parentRef.status,'resolved');
});

test('blueprint family caps use core trim-only identity, never NFC or case folding',()=>{
  const index=core.buildIndex([q('a',{family_id:'é'}),q('b',{family_id:'e\u0301'}),q('c',{family_id:'F'}),q('d',{family_id:'f'})]);
  const blueprint={schemaVersion:1,blueprintId:'bp',revision:1,title:'族额',rows:[{rowId:'R',label:'',filters:{},count:4}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
  const bp=createBlueprintEngine({core}),prepared=bp.prepareAllocation({index,plan:core.createPlan(),blueprint});
  assert.equal(prepared.status,'ready');assert.equal(bp.allocateQuestions(prepared.problem).status,'complete');
});

test('same-family replacement changes only three source references in an immutable v3 plan',()=>{
  const index=core.buildIndex([k(),q('old'),q('new',{role:'例题',title:'新源标题'})]);
  let plan=core.addSection(core.createPlan('自定讲义'),'第一部分');plan=core.addItem(plan,index.items[0]);plan=core.addItem(plan,index.items[1]);
  const entryId=plan.entries[2].entryId;plan=core.updateEntry(plan,entryId,{title:'保留本次标题',role:'变式'});
  const before=clone(plan),state=setup([],{index,plan,entryId});freeze(plan);const result=apply(state);
  const expected=clone(before);Object.assign(expected.entries[2],result.replacement.next);
  assert.deepEqual(result.plan,expected);assert.deepEqual(plan,before);assert.equal(result.plan.entries[2].sourceId,'new');
  assert.deepEqual(result.replacement.previous,{sourceId:'old',sourcePath:'题库/old.md',sourceFingerprint:index.items[1].fingerprint});
});

test('current filters and row filters are AND even for the same field, while each dimension retains OR',()=>{
  const records=[q('old'),q('both',{difficulty:2}),q('current-only',{difficulty:3}),q('row-only',{difficulty:1}),q('wrong-family',{family_id:'G',difficulty:2})];
  const state=setup(records,{filters:{difficulty:[2,3]},rowFilters:{difficulty:[1,2]}});
  assert.deepEqual(state.candidates.map(item=>item.id),['both']);assert.equal(apply(state).plan.entries[0].sourceId,'both');
  assert.equal(setup(records,{filters:{difficulty:3},rowFilters:{difficulty:1}}).candidates.length,0);
});

test('both filter passes retain the full knowledge index for resolved and shared-tag semantics',()=>{
  const records=[k('K',{knowledge_nodes:['集合']}),q('old'),q('yes',{knowledge_nodes:['集合']}),q('no',{knowledge_nodes:['其他']})];
  const state=setup(records,{filters:{knowledge:'id:K'},rowFilters:{subject:'高中数学'}});
  assert.deepEqual(state.candidates.map(item=>item.id),['yes']);
  const reverse=setup(records,{rowFilters:{knowledge:'id:K'},filters:{subject:'高中数学'}});
  assert.deepEqual(reverse.candidates.map(item=>item.id),['yes']);
});

test('unknown families, non-questions, explicit locks and changed target sources refuse replacement',()=>{
  for(const family_id of [null,[],1,''])assert.equal(setup([q('old',{family_id}),q('new')]).issues[0].code,'FAMILY_UNKNOWN');
  assert.equal(setup(undefined,{locked:true}).issues[0].code,'FAMILY_LOCKED');
  const state=setup();const changed=core.buildIndex([q('old',{title:'edited'}),q('new')]);
  assert.equal(engine.prepareReplacement({...state,index:changed}).issues[0].code,'FAMILY_SOURCE_CHANGED');
  assert.equal(engine.prepareReplacement({...state,index:core.buildIndex([q('new')])}).status,'conflict');
  const section=core.addSection(state.plan,'分区');
  assert.equal(engine.prepareReplacement({...state,plan:section,entryId:section.entries[1].entryId}).issues[0].code,'FAMILY_TARGET_INVALID');
});

test('identity conflicts and already used IDs or paths cannot enter the replacement pool',()=>{
  const records=[q('old'),q('used'),q('good'),q('dup'),q('dup',{},'题库/dup2.md'),k('knowledge',{family_id:'F'})];
  const index=core.buildIndex(records);let plan=core.addItem(core.createPlan(),index.items[0]);plan=core.addItem(plan,index.items[1]);
  const state=setup([],{index,plan});assert.deepEqual(state.candidates.map(item=>item.id),['good']);
  assert.throws(()=>apply(state,{candidateKey:'id:used'}),{code:'FAMILY_STALE'});
  const ambiguous=core.buildIndex([...records,q('old',{},'题库/old2.md')]);
  assert.equal(engine.prepareReplacement({...state,index:ambiguous}).issues[0].code,'FAMILY_SOURCE_CHANGED');
});

test('an ID-less same-family candidate uses its exact path and is not assigned an invented ID',()=>{
  const state=setup([q('old'),q('',{},'题库/无ID.md')]);assert.equal(state.candidates[0].key,'path:题库/无ID.md');
  const result=apply(state);assert.equal(result.plan.entries[0].sourceId,'');assert.equal(result.plan.entries[0].sourcePath,'题库/无ID.md');
});

test('global family caps count every existing question and release the target exactly once',()=>{
  const index=core.buildIndex([q('old'),q('new'),q('existing'),q('other',{family_id:'G'})]);
  let plan=core.addItem(core.createPlan(),index.items[0]);plan=core.addItem(plan,index.items[2]);plan=core.addItem(plan,index.items[3]);
  const valid=setup([],{index,plan,maxPerFamily:2});assert.equal(valid.status,'ready');assert.equal(apply(valid).plan.entries.length,3);
  const blocked=setup([],{index,plan,maxPerFamily:1});assert.equal(blocked.issues[0].code,'FAMILY_LIMIT');
  assert.equal(setup(undefined,{maxPerFamily:1}).status,'ready','replacing one member must not consume two slots');
});

test('an unrelated over-cap, invalid or unresolved existing family cannot be hidden by replacement',()=>{
  const index=core.buildIndex([q('old'),q('new'),q('g1',{family_id:'G'}),q('g2',{family_id:'G'}),q('bad',{family_id:[]})]);
  let plan=core.addItem(core.createPlan(),index.items[0]);plan=core.addItem(plan,index.items[2]);plan=core.addItem(plan,index.items[3]);
  assert.equal(setup([],{index,plan,maxPerFamily:1}).issues[0].code,'FAMILY_LIMIT');
  const invalidPlan=core.addItem(core.addItem(core.createPlan(),index.items[0]),index.items[4]);
  assert.equal(setup([],{index,plan:invalidPlan,maxPerFamily:2}).issues[0].code,'FAMILY_FIELD_INVALID');
  const missing=core.buildIndex([q('old'),q('new')]);
  assert.equal(setup([],{index:missing,plan,maxPerFamily:2}).issues[0].code,'FAMILY_PLAN_SOURCE_UNRESOLVED');
});

test('apply rejects a changed plan, row filter, cap, lock, candidate edit, deletion or new duplicate',()=>{
  const state=setup();const before=clone(state.plan);
  for(const overrides of [
    {plan:{...state.plan,title:'changed'}},{rowFilters:{difficulty:1}},{filters:{query:'new'}},{maxPerFamily:1},{locked:true},
    {freshIndex:core.buildIndex([q('old'),q('new',{title:'edited'})])},
    {freshIndex:core.buildIndex([q('old')])},{freshIndex:core.buildIndex([q('old'),q('new'),q('new',{},'duplicate.md')])},
    {freshIndex:core.buildIndex([q('old'),q('new'),q('third')])},
  ])assert.throws(()=>apply(state,overrides),{code:'FAMILY_STALE'});
  assert.deepEqual(state.plan,before);
});

test('candidate DTO mutations cannot forge a replacement or alter the engine source context',()=>{
  const state=setup();const key=state.candidates[0].key;state.candidates[0].path='other.md';state.candidates[0].fingerprint='forged';
  assert.equal(apply(state,{candidateKey:key}).plan.entries[0].sourcePath,'题库/new.md');
  assert.throws(()=>apply(state,{candidateKey:'id:invented'}),{code:'FAMILY_STALE'});
});

test('plan v1 and v2 remain unchanged and replacement returns standard v3 without sidecar fields',()=>{
  for(const version of [1,2]) {
    const state=setup(),legacy=clone(state.plan);legacy.schemaVersion=version;
    if(version===1){delete legacy.course;delete legacy.output;}else legacy.output.solutionOptions={solutionSpaces:false,showSolution:true};
    const before=clone(legacy),prepared=engine.prepareReplacement({...state,plan:freeze(legacy)});
    const result=apply({...state,...prepared,plan:legacy});assert.deepEqual(legacy,before);assert.equal(result.plan.schemaVersion,3);
    assert.deepEqual(Object.keys(result.plan).sort(),['course','entries','output','schemaVersion','title']);
  }
});

test('invalid settings and hostile filter objects fail without executing getters or mutating inputs',()=>{
  assert.throws(()=>createFamilyEngine(),/core/);const state=setup();
  for(const patch of [{maxPerFamily:0},{maxPerFamily:1.5},{locked:'yes'},{filters:{unknown:true}},{filters:{familyId:3}},{rowFilters:[]}])
    assert.throws(()=>engine.prepareReplacement({...state,...patch}),{code:'FAMILY_INVALID'});
  let called=false;const filters={get role(){called=true;return '训练';}};
  assert.throws(()=>engine.prepareReplacement({...state,filters}),{code:'FAMILY_INVALID'});assert.equal(called,false);
  const cyclic={};cyclic.self=cyclic;assert.throws(()=>engine.prepareReplacement({...state,filters:cyclic}),{code:'FAMILY_INVALID'});
});

test('preparation is deterministic across scan ordering and pure operations do not call clock or randomness',()=>{
  const state=setup([q('old'),q('b'),q('a')]);const reverse=engine.prepareReplacement({...state,index:core.buildIndex([q('a'),q('old'),q('b')])});
  assert.equal(reverse.context,state.context);assert.deepEqual(reverse.candidates,state.candidates);
  const originalNow=Date.now,originalRandom=Math.random;
  Date.now=()=>{throw Error('clock used');};Math.random=()=>{throw Error('randomness used');};
  try{assert.equal(apply(state).plan.entries[0].sourceId,'a');}finally{Date.now=originalNow;Math.random=originalRandom;}
});
