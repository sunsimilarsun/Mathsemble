'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');

const freeze=value=>{
  if(value&&typeof value==='object'){
    for(const child of Object.values(value))freeze(child);
    Object.freeze(value);
  }
  return value;
};
const item=(entryId,kind='question')=>({entryId,kind,sourceId:'source-'+entryId,
  sourcePath:`${kind==='knowledge'?'知识':'题库'}/${entryId}.md`,sourceFingerprint:'fingerprint-'+entryId,
  title:'本次标题 '+entryId,role:kind==='question'?'训练':''});
const section=entryId=>({entryId,kind:'section',sourceId:'',sourcePath:'',sourceFingerprint:'',title:'分区 '+entryId,role:''});
function fixture() {
  const plan=core.createPlan('分区移动讲义');
  plan.course={...plan.course,teacher:'李老师',title:'本次课题',objectives:'目标一\n目标二'};
  plan.output={layout:'trial',mode:'teacher',spaceSettings:{ratio:125,minimumCm:2},
    solutionOptions:{solutionSpaces:true,showSolution:false}};
  plan.entries=[item('intro-k','knowledge'),item('intro-q'),
    section('a'),item('a-q'),item('a-k','knowledge'),section('b'),
    section('c'),item('c-k','knowledge'),item('c-q1'),item('c-q2'),section('d')];
  return core.validatePlan(plan);
}
const ids=plan=>plan.entries.map(entry=>entry.entryId);
const blocks=plan=>core.getSections(plan).map(({start,end})=>plan.entries.slice(start,end).map(entry=>entry.entryId));
function assertPreserved(before,after) {
  assert.equal(after.entries.length,before.entries.length);
  assert.deepEqual(after.course,before.course);assert.deepEqual(after.output,before.output);
  assert.equal(after.title,before.title);assert.equal(after.schemaVersion,before.schemaVersion);
  const original=new Map(before.entries.map(entry=>[entry.entryId,entry]));
  assert.equal(new Set(after.entries.map(entry=>entry.entryId)).size,original.size);
  for(const entry of after.entries)assert.deepEqual(entry,original.get(entry.entryId));
  assert.equal(after.entries.filter(entry=>entry.kind==='question').length,before.entries.filter(entry=>entry.kind==='question').length);
  assert.equal(after.entries.filter(entry=>entry.kind==='knowledge').length,before.entries.filter(entry=>entry.kind==='knowledge').length);
}

test('section ranges exclude the preamble and include mixed bodies through the next heading',()=>{
  const plan=freeze(fixture()),before=JSON.stringify(plan);
  assert.deepEqual(core.getSections(plan),[
    {entryId:'a',start:2,end:5},{entryId:'b',start:5,end:6},
    {entryId:'c',start:6,end:10},{entryId:'d',start:10,end:11},
  ]);
  assert.equal(JSON.stringify(plan),before);
  const ranges=core.getSections(plan);ranges[0].start=900;
  assert.equal(core.getSections(plan)[0].start,2,'derived ranges cannot mutate the plan');
});

test('moving a first or last section preserves all bodies and the unsectioned preamble',()=>{
  const plan=freeze(fixture()),before=JSON.stringify(plan);
  const last=core.moveSection(plan,'a',3);
  assert.deepEqual(ids(last),['intro-k','intro-q','b','c','c-k','c-q1','c-q2','d','a','a-q','a-k']);
  assertPreserved(plan,last);
  const first=core.moveSection(plan,'d',0);
  assert.deepEqual(ids(first),['intro-k','intro-q','d','a','a-q','a-k','b','c','c-k','c-q1','c-q2']);
  assertPreserved(plan,first);assert.equal(JSON.stringify(plan),before);
});

test('adjacent up and down moves exchange complete sections, including empty sections',()=>{
  const plan=freeze(fixture());
  const up=core.moveSection(plan,'c',1);
  assert.deepEqual(blocks(up),[['a','a-q','a-k'],['c','c-k','c-q1','c-q2'],['b'],['d']]);
  const down=core.moveSection(plan,'b',2);
  assert.deepEqual(ids(up),ids(down));assertPreserved(plan,up);assertPreserved(plan,down);
  assert.deepEqual(core.moveSection(up,'c',2),plan,'inverse move restores the complete plan');
});

test('same-position and single-section moves are safe no-ops without sharing mutable plan data',()=>{
  const plan=freeze(fixture()),same=core.moveSection(plan,'c',2);
  assert.deepEqual(same,plan);assert.notEqual(same,plan);assert.notEqual(same.entries,plan.entries);
  same.course.teacher='其他';same.entries[0].title='改动副本';
  assert.equal(plan.course.teacher,'李老师');assert.equal(plan.entries[0].title,'本次标题 intro-k');
  for(const entries of [[section('only')],[item('prefix'),section('only'),item('tail')]]){
    const single=freeze(core.validatePlan({...core.createPlan(),entries}));
    assert.deepEqual(core.moveSection(single,'only',0),single);
  }
});

test('all move targets reorder only whole sections and conserve each original entry',()=>{
  // Exhaustive source/target permutations include consecutive empty sections,
  // a trailing populated section, and layouts with or without a preamble.
  for(const prefixLength of [0,2])for(const bodyLengths of [[0,0],[1,0,3],[0,2,0,1],[2,1,3,0,2]]){
    const prefix=Array.from({length:prefixLength},(_,i)=>item('prefix-'+i,'knowledge'));
    const originalBlocks=bodyLengths.map((length,i)=>[section('s'+i),
      ...Array.from({length},(_,j)=>item(`s${i}-${j}`,j%2?'knowledge':'question'))]);
    const plan=freeze(core.validatePlan({...core.createPlan(),entries:prefix.concat(...originalBlocks)}));
    for(let from=0;from<originalBlocks.length;from++)for(let to=0;to<originalBlocks.length;to++){
      const expected=originalBlocks.map(block=>block.map(entry=>entry.entryId));
      const [moved]=expected.splice(from,1);expected.splice(to,0,moved);
      const result=core.moveSection(plan,'s'+from,to);
      assert.deepEqual(ids(result),prefix.map(entry=>entry.entryId).concat(...expected),`${prefixLength}/${bodyLengths}/${from}->${to}`);
      assert.deepEqual(blocks(result),expected);assertPreserved(plan,result);
      assert.deepEqual(core.moveSection(result,'s'+from,from),plan);
    }
  }
});

test('section operations reject invalid identities, positions and malformed plans',()=>{
  const plan=freeze(fixture()),before=JSON.stringify(plan);
  for(const entryId of ['a-q','intro-k','missing',null,1])assert.throws(()=>core.moveSection(plan,entryId,0),/分区移动位置无效/);
  for(const target of [-1,4,100,0.5,NaN,Infinity,'1',null,undefined,{},[]])
    assert.throws(()=>core.moveSection(plan,'a',target),/分区移动位置无效/);
  for(const entries of [[],[item('unsectioned')]]){
    const plain=core.validatePlan({...core.createPlan(),entries});
    assert.deepEqual(core.getSections(plain),[]);
    assert.throws(()=>core.moveSection(plain,'missing',0),/分区移动位置无效/);
  }
  const malformed={...fixture(),entries:[section('duplicate'),section('duplicate')]};
  assert.throws(()=>core.getSections(malformed),/重复/);
  assert.throws(()=>core.moveSection(malformed,'duplicate',0),/重复/);
  assert.throws(()=>core.getSections({...fixture(),unknown:true}),/未知/);
  assert.equal(JSON.stringify(plan),before);
});

test('section order and all source overrides survive JSON save and reopening without a schema change',()=>{
  const original=freeze(fixture()),moved=core.moveSection(original,'c',0);
  const saved=JSON.stringify(moved),reopened=core.validatePlan(JSON.parse(saved));
  assert.deepEqual(reopened,moved);assert.equal(reopened.schemaVersion,2);
  assert.deepEqual(Object.keys(reopened).sort(),Object.keys(original).sort());
  assert.deepEqual(core.getSections(reopened).map(entry=>entry.entryId),['c','a','b','d']);
  assertPreserved(original,reopened);
  // Older v1 files still follow the existing read-upgrade contract.
  const legacy={schemaVersion:1,title:original.title,entries:original.entries};
  assert.deepEqual(core.moveSection(legacy,'a',3).entries,core.moveSection(original,'a',3).entries);
});

test('single-item moves retain their original semantics instead of implicitly taking a section body',()=>{
  const plan=freeze(fixture()),moved=core.moveEntry(plan,'a',5);
  assert.deepEqual(ids(moved),['intro-k','intro-q','a-q','a-k','b','a','c','c-k','c-q1','c-q2','d']);
  assertPreserved(plan,moved);
});
