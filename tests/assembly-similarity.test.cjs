'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {createSimilarityEngine}=require('../src/assembly-similarity.cjs');
const engine=createSimilarityEngine({core});
const question=(id,meta={},markdown='求 $x+2=5$ 的解。',path='题库/'+id+'.md')=>({path,kind:'question',markdown,
  metadata:{id,subject:'高中数学',question_type:'choice',difficulty:2,teaching_tier:'基础',knowledge_nodes:['一元一次方程'],methods:['移项法'],...meta}});
const note=(id,title,extra={})=>({path:'知识/'+id+'.md',kind:'knowledge',markdown:'# '+title+'\n## 小节甲\n内容',metadata:{id,title,subject:'高中数学',...extra}});
const run=(records,extra={})=>engine.search({index:core.buildIndex(records),sourceKey:'id:source',...extra});
const ids=result=>result.candidates.map(x=>x.id);
const taxonomy={knowledge:{tags:[{id:'K1',name:'一元一次方程',aliases:['一次方程'],scope:'高中及相关拓展',status:'approved'}]},
  methods:{tags:[{id:'M1',name:'移项法',aliases:['移项'],scope:'跨主题',status:'approved'}]}};

test('knowledge retrieval requires actual shared knowledge and never returns same words alone',()=>{
  const result=run([question('source'),question('same'),question('words',{knowledge_nodes:['几何']})]);
  assert.deepEqual(ids(result),['same']);assert.equal(result.status,'ready');assert.equal(result.algorithmVersion,engine.algorithmVersion);
  assert(result.candidates[0].reasons.some(x=>x.includes('一元一次方程')));
});
test('same-family mode uses trim-only identities and does not merge null, case or Unicode variants',()=>{
  const result=run([question('source',{family_id:' F '}),...['F','f','Ｆ',null,''].map((family_id,i)=>question('q'+i,{family_id}))],{mode:'family'});
  assert.deepEqual(ids(result),['q0']);assert(result.candidates[0].reasons[0].includes('同一登记题族'));
  assert.equal(run([question('source',{family_id:null})],{mode:'family'}).status,'conflict');
});
test('malformed family fields exclude candidates while an unclassified old card remains usable',()=>{
  const records=[question('source'),question('bad',{family_id:['invalid']}),question('unknown',{family_id:null})];
  assert.deepEqual(ids(run(records)),['unknown']);assert.deepEqual(ids(run(records,{mode:'method'})),['unknown']);
  const malformedSource=run([question('source',{family_id:['invalid']}),question('q')]);
  assert.deepEqual(ids(malformedSource),['q']);assert(malformedSource.issues.some(x=>x.code==='SIMILARITY_FAMILY_INVALID'));
});
test('identity conflicts, excluded items, self and known subject mismatches are rejected',()=>{
  const records=[question('source'),question('excluded'),question('junior',{subject:'初中数学'}),question('dup'),question('dup',{},'same','题库/duplicate.md'),question('ok')];
  assert.deepEqual(ids(run(records,{excludedKeys:['id:excluded']})),['ok']);
  assert.equal(run([question('source'),question('source',{},'same','题库/other.md')]).status,'conflict');
});
test('ordinary filters evaluate against the full index with knowledge notes still available',()=>{
  const index=core.buildIndex([question('source',{knowledge_nodes:['[[K]]']}),question('yes',{knowledge_nodes:['[[K]]']}),question('no',{knowledge_nodes:['[[K]]'],difficulty:4}),note('K','一次方程')]);
  const calls=[],wrapped={...core,filterItems:(value,filters)=>{calls.push(value);return core.filterItems(value,filters);}};
  const result=createSimilarityEngine({core:wrapped}).search({index,sourceKey:'id:source',filters:{knowledge:'id:K',difficulty:2}});
  assert.deepEqual(ids(result),['yes']);assert.equal(calls[0],index);assert.equal(index.items.length,4);
});
test('taxonomy aliases and stable tag IDs map to one term without modifying the source',()=>{
  const records=[question('source',{knowledge_nodes:['一次方程'],methods:['M1']}),question('canonical'),question('id',{knowledge_nodes:['K1'],methods:['移项']})];
  const index=core.buildIndex(records),before=JSON.stringify({index,taxonomy});
  const result=engine.search({index,sourceKey:'id:source',taxonomy});
  assert.deepEqual(new Set(ids(result)),new Set(['canonical','id']));assert.equal(JSON.stringify({index,taxonomy}),before);
  assert(result.candidates.every(x=>x.normalized.knowledge[0].key==='knowledge:tag:K1'));
});
test('ambiguous aliases and conflicting definitions of one tag ID are not silently merged',()=>{
  const conflicted={knowledge:{tags:[{id:'A',name:'甲',aliases:['别名']},{id:'B',name:'乙',aliases:['别名']}]}};
  assert.deepEqual(ids(run([question('source',{knowledge_nodes:['别名']}),question('q',{knowledge_nodes:['甲']})],{taxonomy:conflicted})),[]);
  const sameId={knowledge:{tags:[{id:'A',name:'甲',aliases:[]},{id:'A',name:'乙',aliases:[]}]}};
  const result=run([question('source',{knowledge_nodes:['甲']}),question('q',{knowledge_nodes:['乙']})],{taxonomy:sameId});
  assert.deepEqual(ids(result),[]);assert(result.issues.some(x=>x.message.includes('歧义')));
});
test('scope prevents a high-school alias mapping from being applied to junior-school labels',()=>{
  const records=[question('source',{subject:'初中数学',knowledge_nodes:['一次方程']}),question('q',{subject:'初中数学'})];
  assert.deepEqual(ids(run(records,{taxonomy})),[]);
  assert.deepEqual(ids(run([question('source',{knowledge_nodes:['一次方程']}),question('q')],{taxonomy})),['q']);
});
test('unknown plain tags remain usable exact declarations and empty arrays remain unknown',()=>{
  assert.deepEqual(ids(run([question('source',{knowledge_nodes:['特殊模型']}),question('q',{knowledge_nodes:['特殊模型']})])),['q']);
  const result=run([question('source',{knowledge_nodes:[],methods:[]}),question('q',{knowledge_nodes:[],methods:[]})]);
  assert.deepEqual(ids(result),[]);assert.equal(result.issues[0].code,'SIMILARITY_EVIDENCE_MISSING');
});
test('missing Wiki links are not treated as resolved; vocabulary evidence is distinctly identified',()=>{
  const records=[question('source',{knowledge_nodes:['[[一次方程]]']}),question('q')];
  assert.deepEqual(ids(run(records)),[]);
  const result=run(records,{taxonomy});assert.deepEqual(ids(result),['q']);assert(result.candidates[0].missing.some(x=>x.includes('原链接未解析')));
});
test('old simple Wiki labels retain exact declaration matching without pretending to resolve the link',()=>{
  const records=[question('source',{knowledge_nodes:['[[求整数部分]]'],methods:['[[估算法]]']}),
    question('plain',{knowledge_nodes:['求整数部分'],methods:['估算法']}),
    question('wiki',{knowledge_nodes:['[[求整数部分|显示别名]]'],methods:['[[估算法]]']}),
    question('unrelated',{knowledge_nodes:['显示别名'],methods:['整数估算']})];
  const result=run(records);assert.deepEqual(new Set(ids(result)),new Set(['plain','wiki']));
  assert(result.candidates.every(x=>x.missing.some(message=>message.includes('原链接未解析'))));
  assert.equal(result.candidates.find(x=>x.id==='wiki').normalized.knowledge[0].status,'declared-unresolved');
  assert.deepEqual(new Set(ids(run(records,{mode:'method'}))),new Set(['plain','wiki']));
  const noCandidate=run([records[0]]);assert.equal(noCandidate.candidates.length,0);
  assert(noCandidate.issues.some(issue=>issue.code==='SIMILARITY_TAG_DIAGNOSTIC'&&issue.message.includes('原链接未解析')));
});
test('resolved note names, Wiki links and relative paths identify one real method',()=>{
  const records=[question('source',{methods:['[[../知识/M.md|显示别名]]']}),question('q',{methods:['移项法']}),note('M','移项法')];
  const result=run(records,{mode:'method',taxonomy});assert.deepEqual(ids(result),['q']);assert(result.candidates[0].scores.method===1);
});
test('method paths never fall back to basename guessing and duplicate note names are ambiguous',()=>{
  const q=question('q',{methods:['移项法']});
  assert.deepEqual(ids(run([question('source',{methods:['[[wrong/移项法.md]]']}),q,note('M','移项法')],{mode:'method'})),[]);
  const a=note('M1','移项法'),b=note('M2','移项法');
  assert.deepEqual(ids(run([question('source',{methods:['[[移项法]]']}),q,a,b],{mode:'method',taxonomy})),[]);
});
test('co-coverage by a large knowledge note does not make different knowledge tags identical',()=>{
  const page=note('K','综合知识',{knowledge_nodes:['甲考点','乙考点']});
  const index=core.buildIndex([question('source',{knowledge_nodes:['甲考点']}),question('q',{knowledge_nodes:['乙考点']}),page]);
  assert.equal(index.items[0].knowledgeRefs[0].status,'covered');
  assert.deepEqual(ids(engine.search({index,sourceKey:'id:source'})),[]);
});
test('anchors retain separate identities and a missing anchor is not collapsed to its parent page',()=>{
  const records=[question('source',{knowledge_nodes:['[[K#小节甲]]']}),question('whole',{knowledge_nodes:['[[K]]']}),question('same',{knowledge_nodes:['[[K#小节甲]]']}),note('K','总页')];
  assert.deepEqual(ids(run(records)),['same']);
  assert.deepEqual(ids(run([question('source',{knowledge_nodes:['[[K#不存在]]']}),question('whole',{knowledge_nodes:['[[K]]']}),note('K','总页')])),[]);
});
test('broad methods require corroborating shared knowledge while concrete methods can cross topics',()=>{
  const result=run([question('source',{methods:['分类讨论法']}),question('unrelated',{methods:['分类讨论法'],knowledge_nodes:['圆']}),question('related',{methods:['分类讨论法']})],{mode:'method'});
  assert.deepEqual(ids(result),['related']);
  assert.deepEqual(ids(run([question('source'),question('q',{knowledge_nodes:['二次方程']})],{mode:'method'})),['q']);
});
test('text ranking excludes solutions and source metadata and preserves changed numbers and negation',()=>{
  const source=question('source',{},'求 $x+2=5$ 的解。'),same=question('same',{},'求 $x+2=5$ 的解。\n\n> [!solution]- 不同解析内容');
  const changed=question('changed',{},'求 $x+2=7$ 的解。'),negative=question('negative',{},'求不是 $x+2=5$ 的解。');
  const result=run([source,changed,negative,same]);assert.equal(result.candidates[0].id,'same');
  assert.equal(result.candidates[0].scores.text,1);assert(result.candidates.slice(1).every(x=>x.scores.text<1));
});
test('unknown information lowers evidence coverage without being replaced by false agreement',()=>{
  const result=run([question('source',{methods:[],difficulty:null}),question('q',{methods:[],difficulty:null})]);
  const candidate=result.candidates[0];assert.equal(candidate.evidenceCoverage.method,false);assert.equal(candidate.scores.method,0);
  assert.equal(candidate.rankScore,.75);assert(candidate.missing.some(x=>x.includes('难度')));assert(!candidate.reasons.includes('难度同档'));
});
test('image-only stems do not contribute text evidence or claim visual similarity',()=>{
  const result=run([question('source',{},'![[one.png]]'),question('q',{},'![[two.png]]')]);
  assert.equal(result.candidates[0].scores.text,0);assert.equal(result.candidates[0].evidenceCoverage.text,false);assert(result.candidates[0].missing.some(x=>x.includes('图形')));
});
test('ties and input order yield a stable ranking without requiring migrated old cards',()=>{
  const records=[question('source',{type:undefined,level:'基础',teaching_tier:undefined}),question('b'),question('a')];
  const before=JSON.stringify(records),a=run(records),b=run([...records].reverse());
  assert.deepEqual(ids(a),['a','b']);assert.deepEqual(a.candidates,b.candidates);assert.equal(JSON.stringify(records),before);
});
test('inherited labels and hostile property names cannot pollute a plain-object dictionary',()=>{
  const result=run([question('source',{knowledge_nodes:['__proto__']}),question('q',{knowledge_nodes:['__proto__']})]);
  assert.deepEqual(ids(result),['q']);assert.equal({}.polluted,undefined);
});
test('sparse text comparisons are limited to shared-label candidates rather than all question pairs',()=>{
  const textModule=require('../src/assembly-similarity-text.cjs'),original=textModule.sparseCosine;let comparisons=0;
  textModule.sparseCosine=(...args)=>{comparisons++;return original(...args);};
  try {
    const records=[question('source'),question('yes'),...Array.from({length:1000},(_,i)=>question('other'+i,{knowledge_nodes:['独立考点'+i]}))];
    assert.deepEqual(ids(run(records)),['yes']);assert.equal(comparisons,1);
  } finally {textModule.sparseCosine=original;}
});
