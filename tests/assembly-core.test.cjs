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
  assert.throws(()=>core.validatePlan({...valid,schemaVersion:3}),/版本/);
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

test('legacy plans migrate in memory with independent course and output defaults',()=>{
  const current=core.addItem(core.createPlan('旧方案'),core.buildIndex([question()]).items[0]);
  const legacy=frozen({schemaVersion:1,title:current.title,entries:current.entries});
  const migrated=core.validatePlan(legacy);
  assert.equal(migrated.schemaVersion,2);
  assert.deepEqual(migrated.entries,legacy.entries);
  assert.equal(migrated.entries[0].entryId,legacy.entries[0].entryId);
  assert.deepEqual(migrated.course,core.defaultCourse());
  assert.deepEqual(migrated.output,core.defaultOutputSettings());
  const next=core.validatePlan(legacy);
  migrated.course.teacher='李老师';migrated.output.spaceSettings.ratio=150;
  assert.equal(next.course.teacher,'');assert.equal(next.output.spaceSettings.ratio,100);
  assert.deepEqual(Object.keys(legacy),['schemaVersion','title','entries']);
  assert.throws(()=>core.validatePlan({...legacy,course:core.defaultCourse()}),/未知字段/);
  assert.throws(()=>core.validatePlan({schemaVersion:2,title:'不完整',entries:[]}),/缺少字段/);
});

test('all entry edits preserve explicit course settings and blank title through JSON round trips',()=>{
  const index=core.buildIndex([question()]);
  let plan=core.createPlan('集合讲义');
  plan.course={teacher:'  李老师 ',student:'小甲',time:'周六',subject:'数学',grade:'高一',title:'',objectives:'第一条\n第二条'};
  plan.output={layout:'trial',mode:'teacher',spaceSettings:{ratio:125,minimumCm:4},solutionOptions:{solutionSpaces:true,showSolution:false}};
  const settings=JSON.stringify({course:plan.course,output:plan.output});
  plan=core.addItem(frozen(plan),index.items[0]);
  const id=plan.entries[0].entryId;
  plan=core.addSection(frozen(plan),'分区');
  plan=core.updateEntry(frozen(plan),id,{title:'本次标题',role:'变式'});
  plan=core.moveEntry(frozen(plan),id,1);
  plan=core.removeEntry(frozen(plan),plan.entries[0].entryId);
  plan=core.validatePlan(JSON.parse(JSON.stringify(plan)));
  assert.equal(JSON.stringify({course:plan.course,output:plan.output}),settings);
  assert.equal(plan.entries[0].entryId,id);
});

test('course and output validators reject malformed data and never restore runtime export permission',()=>{
  const invalidCourse=[{title:false},{teacher:null},{objectives:[]},{teacher:'x'.repeat(201)},
    {title:'x'.repeat(501)},{objectives:'x'.repeat(1601)},{student:'bad\u0000text'},{unknown:'x'}];
  for(const patch of invalidCourse)assert.throws(()=>core.validateCourse({...core.defaultCourse(),...patch}));
  for(const patch of [{layout:'wide'},{mode:'both'},{spaceSettings:{ratio:'100',minimumCm:0}},
    {spaceSettings:{ratio:0,minimumCm:0}},{spaceSettings:{ratio:100,minimumCm:-1}},
    {solutionOptions:{solutionSpaces:true,showSolution:'false'}},
    {partialExportApproved:true},{overflowOmissionEnabled:true},{renderWarnings:[]}])
    assert.throws(()=>core.validateOutputSettings({...core.defaultOutputSettings(),...patch}));
  let getterCalls=0;
  const course=core.defaultCourse();Object.defineProperty(course,'title',{get(){getterCalls++;return '不应读取';}});
  assert.throws(()=>core.validateCourse(course),/不允许的属性/);
  const output=core.defaultOutputSettings();Object.defineProperty(output.spaceSettings,'ratio',{get(){getterCalls++;return 100;}});
  assert.throws(()=>core.validateOutputSettings(output),/不允许的属性/);
  assert.equal(getterCalls,0);
  assert.throws(()=>core.validateCourse(Object.assign(Object.create({hidden:true}),core.defaultCourse())),/普通对象/);
  assert.throws(()=>core.validateOutputSettings({...core.defaultOutputSettings(),solutionOptions:JSON.parse('{"solutionSpaces":false,"showSolution":true,"__proto__":{}}')}),/属性/);
  const symbolCourse={...core.defaultCourse(),[Symbol('hidden')]:true};
  assert.throws(()=>core.validateCourse(symbolCourse),/未知字段/);
  const hiddenOutput=core.defaultOutputSettings();Object.defineProperty(hiddenOutput,'partialExportApproved',{value:true});
  assert.throws(()=>core.validateOutputSettings(hiddenOutput),/未知字段/);
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

test('whole knowledge notes expose each declared tier, while questions retain a single tier',()=>{
  const records=frozen([
    knowledge('知识/完整.md','K1',{subject:'高中数学',teaching_tier:['培优','基础','基础',null,'未知']}),
    knowledge('知识/旧单值.md','K2',{teaching_tier:'核心'}),
    knowledge('知识/旧level.md','K3',{level:'扩展'}),
    knowledge('知识/空值.md','K4',{teaching_tier:[],level:'核心'}),
    question(),question('题库/错误列表.md','Q2',{teaching_tier:['核心','培优']})
  ]);
  const index=core.buildIndex(records);
  assert.deepEqual(index.items.map(item=>item.tiers),[['基础','培优'],['核心'],['扩展'],[],['核心'],[]]);
  assert.equal(index.items[0].tier,'基础 / 培优');
  for(const tier of ['基础','培优'])assert.deepEqual(core.filterItems(index,{kind:'knowledge',tier}).map(item=>item.id),['K1']);
  assert.deepEqual(core.filterItems(index,{kind:'knowledge',tier:['培优','扩展']}).map(item=>item.id),['K1','K3']);
  assert.deepEqual(records[0].metadata.teaching_tier,['培优','基础','基础',null,'未知']);
});

test('a plain shared label relates a question to every covering note in the same subject',()=>{
  const index=core.buildIndex([
    knowledge('知识/表示.md','K1',{title:'表示方法',subject:'高中数学',knowledge_nodes:['代表元素']}),
    knowledge('知识/辨析.md','K2',{title:'概念辨析',subject:'高中数学',knowledge_nodes:['代表元素','数集与点集']}),
    question('题库/题.md','Q1',{knowledge_nodes:['代表元素']})
  ]);
  const ref=index.items[2].knowledgeRefs[0];
  assert.equal(ref.status,'covered');assert.equal(ref.relation,'shared-tag');
  assert.deepEqual(ref.nodeKeys,['id:K1','id:K2']);
  assert.equal(ref.candidates,undefined,'Multiple covering notes are not ambiguous identities');
  for(const knowledge of ['id:K1','id:K2'])
    assert.deepEqual(core.filterItems(index,{kind:'question',knowledge}).map(item=>item.id),['Q1']);
  assert.deepEqual(core.filterItems(index,{knowledge:'代表元素'}).map(item=>item.id),['K1','K2','Q1']);
});

test('shared labels and plain names never infer links across subjects or from an unknown subject',()=>{
  const index=core.buildIndex([
    knowledge('知识/高中.md','K1',{title:'同名标签',aliases:['另一标签'],subject:'高中数学',knowledge_nodes:['共同标签']}),
    knowledge('知识/未知.md','K2',{title:'未分类知识',knowledge_nodes:['共同标签']}),
    question('题库/初中.md','Q1',{subject:'初中数学',knowledge_nodes:['共同标签','同名标签','另一标签']}),
    question('题库/未知.md','Q2',{subject:'',knowledge_nodes:['共同标签','同名标签','另一标签']}),
    question('题库/高中.md','Q3',{knowledge_nodes:['共同标签','同名标签','另一标签']})
  ]);
  for(const item of index.items.slice(2,4))assert.deepEqual(item.knowledgeRefs.map(ref=>ref.status),['tag','tag','tag']);
  assert.deepEqual(index.items[4].knowledgeRefs.map(ref=>ref.status),['covered','resolved','resolved']);
  assert.deepEqual(index.items[4].knowledgeRefs[0].nodeKeys,['id:K1']);
  assert.deepEqual(core.filterItems(index,{kind:'question',knowledge:'id:K1'}).map(item=>item.id),['Q3']);
  assert.deepEqual(core.filterItems(index,{kind:'question',knowledge:'同名标签'}).map(item=>item.id),['Q1','Q2','Q3'],
    'Literal label search does not turn a label into a cross-subject node relationship');
});

test('explicit IDs, paths and Wiki links remain authoritative and do not fall back to label coverage',()=>{
  const index=core.buildIndex([
    knowledge('知识/甲.md','K1',{title:'唯一名称',subject:'初中数学'}),
    knowledge('知识/乙.md','K2',{title:'标签正文',subject:'高中数学',knowledge_nodes:['唯一名称','缺失页']}),
    question('题库/题.md','Q1',{knowledge_nodes:['K1','知识/甲','[[唯一名称]]','[[缺失页]]','缺失页']})
  ]);
  const refs=index.items[2].knowledgeRefs;
  assert.deepEqual(refs.map(ref=>ref.status),['resolved','resolved','resolved','missing','covered']);
  assert.deepEqual(refs.slice(0,3).map(ref=>ref.nodeKey),['id:K1','id:K1','id:K1']);
  assert.deepEqual(refs[4].nodeKeys,['id:K2']);
});

test('direct same-subject names take precedence over coverage and ambiguous links remain ambiguous',()=>{
  const index=core.buildIndex([
    knowledge('知识/甲.md','K1',{title:'表示法',subject:'高中数学'}),
    knowledge('知识/乙.md','K2',{title:'概念',subject:'高中数学',knowledge_nodes:['表示法']}),
    knowledge('知识/丙.md','K3',{title:'概念',subject:'高中数学'}),
    question('题库/题.md','Q1',{knowledge_nodes:['表示法','[[概念]]']})
  ]);
  assert.equal(index.items[3].knowledgeRefs[0].nodeKey,'id:K1');
  assert.equal(index.items[3].knowledgeRefs[1].status,'ambiguous');
  assert.equal(core.filterItems(index,{kind:'question',knowledge:'id:K2'}).length,0);
});

test('conflicted knowledge identities cannot be used as shared-label coverage',()=>{
  const index=core.buildIndex([
    knowledge('知识/甲.md','K1',{title:'正文甲',subject:'高中数学',knowledge_nodes:['覆盖标签']}),
    knowledge('知识/乙.md','K1',{title:'正文乙',subject:'高中数学',knowledge_nodes:['覆盖标签']}),
    question('题库/题.md','Q1',{knowledge_nodes:['覆盖标签']})
  ]);
  assert.equal(index.items[2].knowledgeRefs[0].status,'tag');
  assert.equal(core.filterItems(index,{kind:'question',knowledge:index.items[0].key}).length,0);
});

test('empty placeholder labels never become knowledge relations or filter options',()=>{
  const index=core.buildIndex([question('题库/题.md','Q1',{
    knowledge_nodes:[[],null,'','~','[[~]]','[]','有效标签'],
    methods:[[],null,'~','[[~]]','分类讨论'],aliases:['~','[[~]]','旧名称']
  })]);
  assert.deepEqual(index.items[0].knowledgeNodes,['有效标签']);
  assert.deepEqual(index.items[0].methods,['分类讨论']);
  assert.deepEqual(index.items[0].aliases,['旧名称']);
  assert.equal(core.filterItems(index,{knowledge:'[[~]]'}).length,0);
});
