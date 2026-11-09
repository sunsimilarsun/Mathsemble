'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const record=(id,extra={})=>({path:`题库/${id || '无ID'}.md`,kind:'question',
  metadata:{id,subject:'高中数学',question_type:'choice',teaching_tier:'基础',knowledge_nodes:['集合'],...extra},
  markdown:`题目 ${id}`});
const frozen=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')frozen(child);return Object.freeze(value);};

test('conditional draw combines existing filters and never widens an insufficient pool',()=>{
  const records=[record('Q1'),record('Q2',{teaching_tier:'培优'}),record('Q3',{question_type:'proof'}),
    record('Q4',{subject:'初中数学'}),record('Q5',{knowledge_nodes:['函数']}),
    {path:'知识/集合.md',kind:'knowledge',metadata:{id:'K1',subject:'高中数学',knowledge_nodes:['集合']},markdown:'知识'}];
  const index=core.buildIndex(frozen(records)),plan=frozen(core.createPlan());
  const result=core.selectQuestions(index,{subject:'高中数学',questionType:'choice',tier:'基础',knowledge:'id:K1'},plan,5,()=>0);
  assert.deepEqual(result.items.map(item=>item.id),['Q1']);
  assert.equal(result.requested,5);assert.equal(result.available,1);
  assert.equal(plan.entries.length,0);assert.equal(records[0].metadata.teaching_tier,'基础');
});

test('draw excludes existing IDs and paths, identity conflicts, and knowledge notes; missing IDs retain path identity',()=>{
  const records=[record('Q1'),record('Q2'),record(''),record('DUP'),{...record('DUP'),path:'题库/重复.md'},
    {path:'知识/旧题.md',kind:'knowledge',metadata:{id:'K'},markdown:'知识'}];
  const index=core.buildIndex(records);
  let plan=core.addItem(core.createPlan(),index.items[0]);
  // Stable ID exclusion still holds after the indexed source moves.
  const renamed=core.buildIndex([{...record('Q1'),path:'题库/改名.md'},...records.slice(1)]);
  const result=core.selectQuestions(renamed,{kind:'knowledge'},plan,10,()=>0);
  assert.deepEqual(result.items.map(item=>item.id),['Q2','']);
  plan=core.addItem(plan,result.items[1]);
  assert.deepEqual(core.selectQuestions(renamed,{},plan,10,()=>0).items.map(item=>item.id),['Q2']);
});

test('draw samples beyond the visible first hundred and does not mutate index order',()=>{
  const index=core.buildIndex(Array.from({length:150},(_,i)=>record('Q'+i)));
  const before=index.items.map(item=>item.path);
  const result=core.selectQuestions(index,{},core.createPlan(),3,()=>0.999999);
  assert.equal(result.available,150);assert.equal(result.items[0].id,'Q149');
  assert.equal(new Set(result.items.map(item=>item.path)).size,3);
  assert.deepEqual(index.items.map(item=>item.path),before);
});

test('same random stream yields the same candidates, and resampling changes no plan',()=>{
  const index=core.buildIndex([record('Q1'),record('Q2'),record('Q3')]),plan=frozen(core.createPlan());
  const pick=random=>core.selectQuestions(index,{},plan,2,random).items.map(item=>item.id);
  assert.deepEqual(pick(()=>0),pick(()=>0));assert.notDeepEqual(pick(()=>0),pick(()=>0.99));
  assert.equal(plan.entries.length,0);
});

test('draw validates counts and random values without silently accepting fractional quantities',()=>{
  const index=core.buildIndex([record('Q1')]),plan=core.createPlan();
  for(const count of [0,-1,1.5,1001,NaN,Infinity,'2'])assert.throws(()=>core.selectQuestions(index,{},plan,count),/数量/);
  for(const value of [-0.1,1,NaN,Infinity])assert.throws(()=>core.selectQuestions(index,{},plan,1,()=>value),/随机值/);
  const empty=core.selectQuestions(core.buildIndex([]),{},plan,1,()=>{throw Error('should not draw');});
  assert.equal(empty.available,0);assert.deepEqual(empty.items,[]);
});

test('candidate count respects remaining plan capacity and batch application is atomic',()=>{
  const index=core.buildIndex([record('Q1'),record('Q2')]);
  const plan=core.validatePlan({schemaVersion:1,title:'已有编排',entries:Array.from({length:999},(_,i)=>({
    entryId:'e'+i,kind:'section',sourceId:'',sourcePath:'',sourceFingerprint:'',title:'分区'+i,role:''}))});
  const result=core.selectQuestions(index,{},plan,2,()=>0);
  assert.equal(result.capacity,1);assert.equal(result.available,2);assert.equal(result.items.length,1);
  assert.throws(()=>core.addSelectedQuestions(frozen(plan),index,{},index.items),/最多/);
  assert.equal(plan.entries.length,999);
});

test('batch application keeps existing order and adds only retained candidates',()=>{
  const index=core.buildIndex([record('Q1'),record('Q2'),record('Q3')]);
  const plan=frozen(core.addItem(core.addSection(core.createPlan(),'原有分区'),index.items[0]));
  const candidates=core.selectQuestions(index,{},plan,2,()=>0).items;
  const next=core.addSelectedQuestions(plan,index,{},candidates.slice(1));
  assert.deepEqual(next.entries.map(entry=>entry.kind==='section'?entry.title:entry.sourceId),['原有分区','Q1','Q3']);
  assert.equal(plan.entries.length,2);
  assert.throws(()=>core.addSelectedQuestions(plan,index,{},[candidates[0],candidates[0]]),/重复/);
});

test('changed, missing, re-identified, conflicting or filtered-out candidates reject the whole batch',()=>{
  const records=[record('Q1'),record('Q2')],index=core.buildIndex(records),plan=frozen(core.createPlan());
  const selected=core.selectQuestions(index,{},plan,2,()=>0).items;
  const altered=[
    [records[0],{...records[1],markdown:'修改正文'}],
    [records[0]],
    [records[0],{...records[1],metadata:{...records[1].metadata,id:'NEW'}}],
    [...records,{...records[1],path:'题库/冲突.md'}]
  ];
  for(const next of altered)assert.throws(()=>core.addSelectedQuestions(plan,core.buildIndex(next),{},selected),/来源或筛选条件已变化/);
  assert.throws(()=>core.addSelectedQuestions(plan,index,{tier:'培优'},selected),/来源或筛选条件已变化/);
  const used=core.addItem(plan,index.items[1]);
  assert.throws(()=>core.addSelectedQuestions(used,index,{},selected),/来源或筛选条件已变化/);
  assert.deepEqual(plan.entries,[]);assert.equal(used.entries.length,1);
});
