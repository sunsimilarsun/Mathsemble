'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const record=(path,kind,metadata={},markdown='完整正文')=>({path,kind,metadata,markdown});
const knowledge=(path='知识/集合.md',id='K1',extra={})=>record(path,'knowledge',{id,title:'集合',aliases:['集合表示'],...extra});
const question=(path='题库/题目.md',id='Q1',extra={},markdown='题目 $x=2$')=>record(path,'question',{id,subject:'高中数学',question_type:'choice',difficulty:2,teaching_tier:'核心',role:'例题',knowledge_nodes:['[[集合]]'],methods:['[[数形结合]]'],source:'教材',...extra},markdown);
const frozen=value=>{for(const child of Object.values(value))if(child&&typeof child==='object')frozen(child);return Object.freeze(value);};

test('index reads existing fields without mutating source, inventing IDs or requiring legacy fields',()=>{
  const records=frozen([knowledge(),question(),question('题库/无ID.md','',{knowledge_nodes:[],role:'训练'})]);
  const index=core.buildIndex(records);
  assert.equal(index.items.length,3); assert.equal(index.issues.length,0);
  assert.equal(index.items[1].key,'id:Q1');
  assert.equal(index.items[2].key,'path:题库/无ID.md'); assert.equal(index.items[2].id,'');
  assert.equal(index.items[2].role,'训练'); assert.deepEqual(index.items[2].knowledgeNodes,[]);
  assert.equal(Object.hasOwn(index.items[1].metadata,'chapter_id'),false);
});

test('duplicate IDs remain visible separately and cannot enter a plan',()=>{
  const index=core.buildIndex([question(),question('题库/另一题.md')]);
  assert.equal(index.items.length,2); assert.equal(index.issues[0].code,'duplicate-id');
  assert.notEqual(index.items[0].key,index.items[1].key);
  assert.throws(()=>core.addItem(core.createPlan(),index.items[0]),/冲突/);
});

test('knowledge references resolve names, aliases and explicit paths, preserving unmatched labels',()=>{
  const index=core.buildIndex([knowledge(),question('题库/题目.md','Q1',{knowledge_nodes:['[[集合表示]]','纯标签','[[不存在]]','[[知识/集合|显示名]]']})]);
  const refs=index.items[1].knowledgeRefs;
  assert.deepEqual(refs.map(r=>r.status),['resolved','tag','missing','resolved']);
  assert.equal(refs[0].nodeKey,'id:K1'); assert.equal(refs[3].nodeKey,'id:K1');
  assert.equal(refs[3].label,'显示名');
  for(const filter of ['id:K1','K1','知识/集合.md','集合','集合表示'])
    assert.equal(core.filterItems(index,{kind:'question',knowledge:filter}).length,1,filter);
  assert.equal(core.filterItems(index,{kind:'question',knowledge:'纯标签'}).length,1);
});

test('same-name knowledge nodes are not guessed; explicit paths disambiguate',()=>{
  const index=core.buildIndex([knowledge('初中/集合.md','K1'),knowledge('高中/集合.md','K2'),question(),question('题库/明确.md','Q2',{knowledge_nodes:['[[高中/集合]]']})]);
  assert.equal(index.items[2].knowledgeRefs[0].status,'ambiguous');
  assert.deepEqual(core.filterItems(index,{kind:'question',knowledge:'id:K2'}).map(i=>i.id),['Q2']);
  assert.equal(core.filterItems(index,{kind:'question',knowledge:'id:K1'}).length,0);
});

test('relative knowledge links resolve in their source file context',()=>{
  const index=core.buildIndex([knowledge(),question('题库/题.md','Q1',{knowledge_nodes:['[[../知识/集合]]']})]);
  assert.equal(index.items[1].knowledgeRefs[0].nodeKey,'id:K1');
});

test('search combines dimensions with AND and multi-selection within a dimension with OR',()=>{
  const index=core.buildIndex([knowledge(),question(),question('题库/二.md','Q2',{difficulty:4,role:'variant',source:'考试'},'空间直线'),question('题库/三.md','Q3',{subject:'初中数学'})]);
  assert.deepEqual(core.filterItems(index,{kind:'question',subject:'高中数学',difficulty:[2,4],query:'题目 x=2',method:'数形结合'}).map(i=>i.id),['Q1']);
  assert.deepEqual(core.filterItems(index,{kind:'question',role:'变式',source:'考'}).map(i=>i.id),['Q2']);
  assert.equal(core.filterItems(index,{knowledge:'未关联标签'}).length,0);
});

test('plan operations are immutable and preserve mixed entry ordering and source identities',()=>{
  const index=core.buildIndex([knowledge(),question()]);
  const original=frozen(core.createPlan('集合讲义'));
  let plan=core.addSection(original,'第一部分');
  plan=core.addItem(plan,index.items[0]); plan=core.addItem(plan,index.items[1]);
  const questionEntry=plan.entries[2];
  const renamed=core.updateEntry(frozen(plan),questionEntry.entryId,{title:'本次例题',role:'训练'});
  assert.equal(plan.entries[2].title,'题目'); assert.equal(index.items[1].role,'例题');
  assert.equal(renamed.entries[2].sourceId,'Q1');
  const moved=core.moveEntry(renamed,questionEntry.entryId,1);
  assert.deepEqual(moved.entries.map(e=>e.kind),['section','question','knowledge']);
  assert.equal(core.removeEntry(moved,questionEntry.entryId).entries.length,2);
  assert.equal(original.entries.length,0);
  assert.throws(()=>core.addItem(moved,index.items[1]),/重复/);
});

test('plans round-trip JSON and sections have no source dependency',()=>{
  let plan=core.addSection(core.createPlan(),'知识梳理');
  plan=core.addItem(plan,core.buildIndex([knowledge()]).items[0]);
  assert.deepEqual(core.validatePlan(JSON.parse(JSON.stringify(plan))),plan);
  const resolved=core.resolvePlan(plan,core.buildIndex([knowledge()]));
  assert.equal(resolved.entries[0].status,'ok'); assert.equal(resolved.entries[0].item,null);
  assert.deepEqual(resolved.issues,[]);
});

test('stable source ID follows renames and never falls back to a replacement at the old path',()=>{
  const index=core.buildIndex([question()]),plan=core.addItem(core.createPlan(),index.items[0]);
  const renamed=core.resolvePlan(plan,core.buildIndex([question('题库/改名.md')]));
  assert.equal(renamed.entries[0].status,'ok'); assert.equal(renamed.entries[0].item.path,'题库/改名.md');
  const replacement=core.resolvePlan(plan,core.buildIndex([question('题库/题目.md','Q2')]));
  assert.equal(replacement.entries[0].status,'missing');
});

test('source modifications, deletion and ID conflicts are distinct states',()=>{
  const index=core.buildIndex([question()]),plan=core.addItem(core.createPlan(),index.items[0]);
  assert.equal(core.resolvePlan(plan,core.buildIndex([question(undefined,undefined,{},'新的题干')])).entries[0].status,'changed');
  assert.equal(core.resolvePlan(plan,core.buildIndex([])).entries[0].status,'missing');
  assert.equal(core.resolvePlan(plan,core.buildIndex([question(),question('二.md')])).entries[0].status,'conflict');
  assert.equal(core.resolvePlan(plan,core.buildIndex([knowledge('题库/题目.md','Q1')])).entries[0].status,'conflict');
});

test('ID-less sources use exact paths and require review if a new identity appears',()=>{
  const index=core.buildIndex([question('题库/旧题.md','')]),plan=core.addItem(core.createPlan(),index.items[0]);
  assert.equal(core.resolvePlan(plan,index).entries[0].status,'ok');
  assert.equal(core.resolvePlan(plan,core.buildIndex([question('题库/改名.md','')])).entries[0].status,'missing');
  assert.equal(core.resolvePlan(plan,core.buildIndex([question('题库/旧题.md','Q1')])).entries[0].status,'conflict');
});

test('validation rejects hostile properties, unknown versions and malformed references',()=>{
  const valid=core.createPlan();
  assert.throws(()=>core.validatePlan(JSON.parse('{"schemaVersion":1,"title":"x","entries":[],"__proto__":{}}')),/属性/);
  assert.throws(()=>core.validatePlan({...valid,schemaVersion:2}),/版本/);
  assert.throws(()=>core.validatePlan({...valid,extra:'bad'}),/未知字段/);
  const getter={schemaVersion:1,title:'x',get entries(){throw Error('getter must not execute');}};
  assert.throws(()=>core.validatePlan(getter),/不允许的属性/);
  const plan=core.addItem(valid,core.buildIndex([question()]).items[0]);
  for(const sourcePath of ['/etc/a.md','../../a.md','a/../b.md','bad.txt']){
    const copy=JSON.parse(JSON.stringify(plan)); copy.entries[0].sourcePath=sourcePath;
    assert.throws(()=>core.validatePlan(copy),/源路径/);
  }
  const copy=JSON.parse(JSON.stringify(plan)); copy.entries.push({...copy.entries[0],entryId:'different'});
  assert.throws(()=>core.validatePlan(copy),/重复/);
  assert.throws(()=>core.updateEntry(plan,plan.entries[0].entryId,JSON.parse('{"__proto__":{}}')),/属性/);
});

test('validation caps size and rejects array prototype manipulation',()=>{
  assert.throws(()=>core.createPlan('x'.repeat(501)),/标题/);
  assert.throws(()=>core.validatePlan({schemaVersion:1,title:'x',entries:Array(1001)}),/最多/);
  const entries=[]; Object.defineProperty(entries,'constructor',{value:{}});
  assert.throws(()=>core.validatePlan({schemaVersion:1,title:'x',entries}),/不允许的属性/);
});

test('role normalization accepts current and legacy practice labels without prototype lookup',()=>{
  for(const role of ['训练','练习','practice','problem'])assert.equal(core.normalizeRole(role),'训练');
  assert.equal(core.normalizeRole('example'),'例题'); assert.equal(core.normalizeRole('variant'),'变式');
  assert.equal(core.normalizeRole('constructor'),'constructor');
});

test('fingerprint is deterministic and notices content changes',()=>{
  assert.equal(core.fingerprint('中文公式\\alpha'),core.fingerprint('中文公式\\alpha'));
  assert.notEqual(core.fingerprint('x=1'),core.fingerprint('x=2'));
});
