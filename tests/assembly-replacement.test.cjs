'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createFamilyEngine}=require('../src/assembly-family.cjs');
const engine=createFamilyEngine({core});
const q=(id,family,extra={})=>({path:'题库/'+id+'.md',kind:'question',markdown:id,
  metadata:{id,subject:'高中数学',question_type:'choice',family_id:family,...extra}});
const setup=records=>{const index=core.buildIndex(records);let plan=core.addItem(core.createPlan(),index.items[0]);return {index,plan,entryId:plan.entries[0].entryId};};

test('shared replacement permits unclassified and cross-family questions, excluding malformed families',()=>{
  const input=setup([q('A',null),q('B',null),q('C','F'),q('bad',['F'])]);
  assert.equal(engine.prepareReplacement(input).status,'conflict');
  const result=engine.prepareConstrainedReplacement(input);
  assert.equal(result.status,'ready');assert.deepEqual(result.candidates.map(item=>item.id),['B','C']);
  const applied=engine.applyConstrainedReplacement({...input,freshIndex:input.index,candidateKey:'id:C',expectedContext:result.context});
  assert.equal(applied.plan.entries[0].sourceId,'C');assert.equal(input.plan.entries[0].sourceId,'A');
});

test('cross-family caps release target once and count the whole remaining plan before admitting candidates',()=>{
  const input=setup([q('A','FA'),q('used','FB'),q('same','FA'),q('full','FB'),q('other','FC'),q('unknown',null)]);
  input.plan=core.addItem(input.plan,input.index.items.find(item=>item.id==='used'));
  const result=engine.prepareConstrainedReplacement({...input,maxPerFamily:1});
  assert.deepEqual(result.candidates.map(item=>item.id),['other','same','unknown']);
  assert(!result.candidates.some(item=>item.id==='full'));
  assert.throws(()=>engine.applyConstrainedReplacement({...input,freshIndex:input.index,maxPerFamily:1,candidateKey:'id:full',expectedContext:result.context}));
  assert.equal(engine.applyConstrainedReplacement({...input,freshIndex:input.index,maxPerFamily:1,candidateKey:'id:other',expectedContext:result.context}).plan.entries[0].sourceId,'other');
});

test('replacement strategies cannot exchange contexts and both preserve P2 whole-question scores',()=>{
  const input=setup([q('A','F'),q('B','F'),q('C','G')]);
  input.plan=core.updateEntry(input.plan,input.entryId,{score:12,title:'卷内标题',role:'例题'});
  const ordinary=engine.prepareReplacement(input),similar=engine.prepareConstrainedReplacement(input);
  assert.throws(()=>engine.applyConstrainedReplacement({...input,freshIndex:input.index,candidateKey:'id:B',expectedContext:ordinary.context}));
  assert.throws(()=>engine.applyReplacement({...input,freshIndex:input.index,candidateKey:'id:B',expectedContext:similar.context}));
  const next=engine.applyConstrainedReplacement({...input,freshIndex:input.index,candidateKey:'id:C',expectedContext:similar.context}).plan;
  assert.equal(next.schemaVersion,4);assert.equal(next.entries[0].score,12);assert.equal(next.entries[0].title,'卷内标题');
  assert.equal(next.entries[0].entryId,input.entryId);assert.equal(next.entries[0].role,'例题');
  assert(!Object.hasOwn(next.entries[0],'rankScore'));
});

test('shared replacement preserves lock, fragment, source and row-filter restrictions',()=>{
  const input=setup([q('A','F'),q('B','G'),q('C','G',{question_type:'fill_blank'})]);
  assert.equal(engine.prepareConstrainedReplacement({...input,locked:true}).issues[0].code,'FAMILY_LOCKED');
  const filtered=engine.prepareConstrainedReplacement({...input,filters:{questionType:'fill_blank'},rowFilters:{questionType:'choice'}});
  assert.deepEqual(filtered.candidates,[]);
  const fragmentPlan=core.updateEntry(input.plan,input.entryId,{fragmentRef:{kind:'question-part',ids:['part-a']}});
  assert.equal(engine.prepareConstrainedReplacement({...input,plan:fragmentPlan}).issues[0].code,'FAMILY_FRAGMENT_SELECTED');
  const invalid=setup([q('A',[]),q('B',null)]);
  assert.equal(engine.prepareConstrainedReplacement(invalid).issues[0].code,'FAMILY_FIELD_INVALID');
});
