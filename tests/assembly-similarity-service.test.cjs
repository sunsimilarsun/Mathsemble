'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createBlueprintEngine}=require('../src/assembly-blueprint.cjs');
const {createFamilyEngine}=require('../src/assembly-family.cjs');
const {createSimilarityEngine}=require('../src/assembly-similarity.cjs');
const createService=require('../src/assembly-service.cjs');
const roots={questionRoots:['数学教学/题库'],knowledgeRoots:[],recursive:true};
const clone=value=>JSON.parse(JSON.stringify(value));
const q=(id,extra={})=>'---\n'+JSON.stringify({id,title:'题目 '+id,subject:'高中数学',question_type:'choice',difficulty:2,
  family_id:'F'+id,knowledge_nodes:['等差数列'],methods:['配方法'],...extra})+'\n---\n已知数列，求通项公式。';
const path=id=>'数学教学/题库/'+id+'.md';
const taxonomyPath='数学教学/_system/规范/数学标签库/知识点.json';
const vocabulary=aliases=>JSON.stringify({dimension:'knowledge',tags:[{id:'K1',name:'等差数列',aliases,status:'approved'}]});
function fixture(initial={[path('A')]:q('A'),[path('B')]:q('B'),[path('C')]:q('C',{question_type:'fill_blank'})}) {
  const nodes=new Map(),writes=[],listeners=new Set(),reads=[];
  const trigger=(event,...args)=>{for(const row of [...listeners])if(row.event===event)row.fn(...args);};
  const folder=p=>{if(nodes.has(p))return nodes.get(p);const parent=p.includes('/')?folder(p.slice(0,p.lastIndexOf('/'))):null;
    const node={path:p,name:p.split('/').pop(),children:[]};nodes.set(p,node);parent?.children.push(node);return node;};
  const file=(p,content)=>{const parent=folder(p.slice(0,p.lastIndexOf('/'))),name=p.split('/').pop(),node={path:p,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent};
    nodes.set(p,node);parent.children.push(node);trigger('create',node);return node;};
  for(const [p,text]of Object.entries(initial))file(p,text);
  let stored={assemblySettings:clone(roots)};
  const vault={getAbstractFileByPath:p=>nodes.get(p)||null,getMarkdownFiles:()=>[...nodes.values()].filter(node=>node.extension==='md'),
    on:(event,fn)=>{const row={event,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),
    read:async node=>{reads.push(node.path);return node.content;},createFolder:async p=>{writes.push(['folder',p]);return folder(p);},
    create:async(p,text)=>{writes.push(['create',p]);return file(p,text);},
    modify:async(node,text)=>{writes.push(['modify',node.path]);node.content=text;trigger('modify',node);}};
  const plugin={app:{vault},loadData:async()=>stored,saveData:async value=>{stored=value;}};
  const deps={core,blueprintEngine:createBlueprintEngine({core}),familyEngine:createFamilyEngine({core}),similarityEngine:createSimilarityEngine({core}),parseYaml:JSON.parse};
  return {service:createService(plugin,deps),plugin,deps,nodes,writes,reads,vault,file,folder,trigger,listeners,
    remove(p){const node=nodes.get(p);nodes.delete(p);node.parent.children=node.parent.children.filter(value=>value!==node);trigger('delete',node);}};
}
async function ordinary(f=fixture()) {
  const index=await f.service.scan();let plan=core.addItem(core.createPlan('相似题讲义'),index.items.find(item=>item.id==='A'));
  plan=core.updateEntry(plan,plan.entries[0].entryId,{score:10,title:'保留标题',role:'例题'});
  return {...f,plan,entryId:plan.entries[0].entryId};
}
async function withRun({locked=false}={}) {
  const f=fixture({[path('A')]:q('A'),[path('Z')]:q('Z',{family_id:'FZ'})}),index=await f.service.scan();
  const base=core.addItem(core.createPlan(),index.items.find(item=>item.id==='Z'));
  const blueprint={schemaVersion:1,blueprintId:'similarity-bp',revision:1,title:'选择配额',rows:[{rowId:'R',label:'单选',filters:{questionType:['choice']},count:1}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
  let candidate=await f.service.generateBlueprintCandidate({plan:base,blueprint,seed:'similarity'});
  if(locked)candidate=f.service.updateBlueprintLocks(candidate,candidate.allocation.assignments.map(clone));
  const result=await f.service.applyBlueprintCandidate(base,candidate);
  f.file(path('B'),q('B'));f.file(path('C'),q('C',{question_type:'fill_blank'}));f.file(path('D'),q('D',{family_id:'FZ'}));
  f.file(path('U'),q('U',{family_id:null}));f.file(path('bad'),q('bad',{family_id:['bad']}));
  return {...f,plan:result.plan,run:result.run,entryId:result.plan.entries.find(entry=>entry.sourceId==='A').entryId};
}

test('browse uses a fresh read-only index, honours exclusions and does not require a plan',async()=>{
  const f=fixture(),result=await f.service.findSimilarQuestions({sourceKey:'id:A',mode:'knowledge',filters:{questionType:'choice'},excludedKeys:['id:C']});
  assert.equal(result.status,'ready');assert.deepEqual(result.candidates.map(row=>row.id),['B']);
  assert(result.candidates[0].reasons.length);assert(result.index.items.some(item=>item.id==='A'));
  assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  const unknown=await f.service.findSimilarQuestions({sourceKey:'id:missing'});assert.equal(unknown.status,'conflict');
});

test('cross-family replacement preserves entry identity, score and legacy source notes',async()=>{
  const f=await ordinary(),before=clone(f.plan),texts=[...f.nodes.values()].filter(row=>row.extension==='md').map(row=>[row.path,row.content]);
  const candidate=await f.service.prepareSimilarityReplacement({plan:f.plan,entryId:f.entryId,mode:'knowledge',filters:{questionType:'choice'}});
  assert.equal(candidate.status,'ready');assert.deepEqual(candidate.candidates.map(row=>row.id),['B']);
  assert(candidate.candidates[0].rankScore>=0);
  const result=await f.service.applySimilarityReplacement(f.plan,candidate,'id:B');
  assert.equal(result.plan.entries[0].sourceId,'B');assert.equal(result.plan.entries[0].entryId,f.entryId);assert.equal(result.plan.entries[0].score,10);
  assert.equal(result.plan.entries[0].title,'保留标题');assert.equal(result.plan.entries[0].role,'例题');assert(!Object.hasOwn(result.plan.entries[0],'rankScore'));
  assert.deepEqual(f.plan,before);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  for(const [p,content]of texts)assert.equal(f.nodes.get(p).content,content);
  await assert.rejects(f.service.applyFamilyReplacement(f.plan,candidate,'id:B'));
});

test('quota, cross-family cap, locks and immutable binding records survive similarity replacement',async()=>{
  const f=await withRun({locked:true}),before=clone(f.run);
  const locked=await f.service.prepareSimilarityReplacement({plan:f.plan,entryId:f.entryId,run:f.run});assert.equal(locked.status,'conflict');
  const candidate=await f.service.prepareSimilarityReplacement({plan:f.plan,entryId:f.entryId,run:f.run,unlock:true});
  assert.deepEqual(candidate.candidates.map(row=>row.id).sort(),['B','U']);
  candidate.candidates.push({key:'id:D'});candidate.run=null;candidate.filters={};candidate.unlock=false;
  await assert.rejects(f.service.applySimilarityReplacement(f.plan,candidate,'id:D'));
  const result=await f.service.applySimilarityReplacement(f.plan,candidate,'id:B');
  assert.deepEqual(f.run,before);assert.notEqual(result.run.runId,f.run.runId);assert.equal(result.run.locks.length,0);
  assert.equal(result.run.assignments[0].sourceId,'B');assert.equal(result.run.assignments[0].entryId,f.entryId);
  assert.equal(result.run.blueprintSnapshot.constraints.maxPerFamily,1);await f.service.verifyBlueprintRun(result.run,result.plan);
  assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
});

test('nearest ancestor vocabulary resolves aliases and is never written',async()=>{
  const f=fixture({[path('A')]:q('A',{knowledge_nodes:['等差旧称']}),[path('B')]:q('B'),[taxonomyPath]:vocabulary(['等差旧称'])});
  const result=await f.service.findSimilarQuestions({sourceKey:'id:A',mode:'knowledge'});
  assert.deepEqual(result.candidates.map(row=>row.id),['B']);assert(f.reads.includes(taxonomyPath));
  assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  f.file('数学教学/题库/_system/规范/数学标签库/知识点.json',vocabulary([]));
  const nearest=await f.service.findSimilarQuestions({sourceKey:'id:A',mode:'knowledge'});
  assert.deepEqual(nearest.candidates,[]);
});

test('vocabulary edit, removal and new closer vocabulary invalidate prepared candidates',async t=>{
  for(const mutation of ['edit','remove','new'])await t.test(mutation,async()=>{
    const f=await ordinary(fixture({[path('A')]:q('A'),[path('B')]:q('B'),[taxonomyPath]:vocabulary([])}));
    const candidate=await f.service.prepareSimilarityReplacement({plan:f.plan,entryId:f.entryId});
    if(mutation==='edit')f.nodes.get(taxonomyPath).content=vocabulary(['新别名']);
    if(mutation==='remove')f.remove(taxonomyPath);
    if(mutation==='new')f.file('数学教学/题库/_system/规范/数学标签库/知识点.json',vocabulary([]));
    await assert.rejects(f.service.applySimilarityReplacement(f.plan,candidate,'id:B'),/词表/);
    assert.equal(f.plan.entries[0].sourceId,'A');assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  });
});

test('source, plan, directory and fabricated wrappers cannot reuse a ranked candidate',async t=>{
  for(const mutation of ['source','duplicate','plan','directory','wrapper'])await t.test(mutation,async()=>{
    const f=await ordinary(),candidate=await f.service.prepareSimilarityReplacement({plan:f.plan,entryId:f.entryId});
    if(mutation==='source')f.nodes.get(path('B')).content+=' changed';
    if(mutation==='duplicate')f.file(path('duplicate'),q('B'));
    const plan=mutation==='plan'?core.updateEntry(f.plan,f.entryId,{title:'已变'}):f.plan;
    const options=mutation==='directory'?{config:{...roots,recursive:false}}:{};
    await assert.rejects(f.service.applySimilarityReplacement(plan,mutation==='wrapper'?{...candidate}:candidate,'id:B',options));
    assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  });
});

test('in-flight vocabulary change, cancellation and closed views release all source watchers',async()=>{
  const f=fixture({[path('A')]:q('A'),[path('B')]:q('B'),[taxonomyPath]:vocabulary([])}),read=f.vault.read;
  let mutated=false;f.vault.read=async file=>{const result=await read(file);if(!mutated&&file.path===path('B')){mutated=true;f.nodes.get(taxonomyPath).content=vocabulary(['changed']);f.trigger('modify',f.nodes.get(taxonomyPath));}return result;};
  await assert.rejects(f.service.findSimilarQuestions({sourceKey:'id:A'}));assert.equal(f.listeners.size,0);
  const controller=new AbortController();controller.abort();await assert.rejects(f.service.findSimilarQuestions({sourceKey:'id:A'},{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(f.service.findSimilarQuestions({sourceKey:'id:A'},{isCurrent:()=>false}));
  assert.equal(f.listeners.size,0);assert.equal(f.writes.length,0);
});
