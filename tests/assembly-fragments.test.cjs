'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fragments=require('../src/assembly-fragments.cjs'),core=require('../src/assembly-core.cjs');
const region=(type,id,body)=>`<!-- mathsemble:${type}${id?' '+id:''} -->\n\n${body}\n\n<!-- mathsemble:end -->`;
const question=(order=['p-a','p-b'])=>({kind:'question',path:'题库/题.md',markdown:'# 综合题\n\n'+region('stem','','共用题干 ![共图](stem.png)')+'\n\n'+order.map(id=>region('part',id,`## ${id==='p-a'?'第一问':'第二问'}\n\n输入 ?{${id==='p-a'?1:2}}\n\n> [!answer]- 答案\n> ${id} 完整步骤\n\n> [!solution]- 解析\n> ${id} 解析 ![图](${id}.png)`)).join('\n\n')});
const ref=(ids=['p-a'],scores)=>({kind:'question-part',ids,...(scores?{scores}:{})});
const planFor=item=>{const index=core.buildIndex([{...item,metadata:{id:'Q1'}}]);return {index,plan:core.addItem(core.createPlan(),index.items[0])};};
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};

test('unmarked legacy material remains whole and gains no invented fragment identity',()=>{
  const item={kind:'question',markdown:'# 题\n\n(1) 输入\n\n## 小问二\n正文 ^block-id'};
  assert.deepEqual(fragments.listFragments(item),{supported:false,valid:true,kind:'question',fragments:[],issues:[]});
  assert.throws(()=>fragments.resolveFragment(item,ref()),/稳定片段锚点/);
});
test('selected part contains shared stem, inline answer, full answer, solution and image dependencies only',()=>{
  const item=deepFreeze(question()),before=JSON.stringify(item),out=fragments.resolveFragment(item,ref());
  for(const value of ['共用题干','stem.png','?{1}','p-a 完整步骤','p-a 解析','p-a.png'])assert(out.markdown.includes(value),value);
  for(const value of ['第二问','?{2}','p-b','mathsemble:'])assert(!out.markdown.includes(value),value);
  assert.equal(JSON.stringify(item),before);
});
test('anchor identity survives source reordering and title edits; explicit selected order is retained',()=>{
  const a=question(),b=question(['p-b','p-a']);
  b.markdown=b.markdown.replace('第一问','换过标题');
  assert.match(fragments.resolveFragment(b,ref()).markdown,/换过标题/);
  const out=fragments.resolveFragment(a,ref(['p-b','p-a']));
  assert(out.markdown.indexOf('第二问')<out.markdown.indexOf('第一问'));
  assert.deepEqual(out.reference.ids,['p-b','p-a']);
});
test('removed anchor refuses title/position fallback even if source fingerprint was accepted',()=>{
  const item=question(),{plan}=planFor(item),selected=core.updateEntry(plan,plan.entries[0].entryId,{fragmentRef:ref()});
  const changed={...item,markdown:item.markdown.replace('part p-a','part renamed')};
  const index=core.buildIndex([{...changed,metadata:{id:'Q1'}}]);
  const accepted=core.updateEntry(selected,selected.entries[0].entryId,{sourceFingerprint:index.items[0].fingerprint});
  const resolved=core.resolvePlan(accepted,index);
  assert.equal(resolved.entries[0].status,'fragment-missing');assert.match(resolved.issues[0].message,/p-a/);
});
test('knowledge sections use stable IDs and include each section complete without question stem',()=>{
  const item={kind:'knowledge',markdown:'# 函数\n\n'+region('section','definition','## 定义\n\n完整定义 ![图](def.png)')+'\n\n'+region('section','example','## 例子\n\n未选例子')};
  const out=fragments.resolveFragment(item,{kind:'knowledge-section',ids:['definition']});
  assert.match(out.markdown,/完整定义.*def.png/);assert(!out.markdown.includes('未选例子'));
  assert.throws(()=>fragments.resolveFragment(item,ref()),/类型/);
});
test('duplicate anchors, missing end, nesting, unassigned content and missing shared stem are invalid',()=>{
  for(const markdown of [question().markdown.replace('part p-b','part p-a'),question().markdown.replace(/<!-- mathsemble:end -->$/,''),
    region('stem','','共用')+'\n\n<!-- mathsemble:part p-a -->\n<!-- mathsemble:part p-b -->\n正文\n<!-- mathsemble:end -->',
    question().markdown+'\n\n未归属答案',region('part','p-a','没有共用题干')]){
    const item={kind:'question',markdown};assert.equal(fragments.listFragments(item).valid,false);
    assert.throws(()=>fragments.resolveFragment(item,ref()),/契约无效/);
  }
});
test('fake anchors in fenced code, math, quoted blocks, comments and raw HTML are ignored',()=>{
  const fake='<!-- mathsemble:part fake -->\n文字\n<!-- mathsemble:end -->';
  for(const markdown of ['```md\n'+fake+'\n```','$$\n'+fake+'\n$$','\\[\n'+fake+'\n\\]',
    '<!--\n<!-- mathsemble:part fake -->\n-->','<pre>\n'+fake+'\n</pre>','<span>\n'+fake+'\n</span>',
    '<div><div>nested</div>\n'+fake+'\n</div>','<img alt="\n'+fake+'\n" src="image.png">',
    fake.split('\n').map(l=>'> '+l).join('\n'),
    fake.split('\n').map(l=>'    '+l).join('\n'),'`跨行\n'+fake+'\n`']) {
    assert.equal(fragments.listFragments({kind:'question',markdown}).supported,false,markdown);
  }
});
test('literal fake markers inside a real part remain content rather than fragment IDs',()=>{
  const item=question();item.markdown=item.markdown.replace('输入 ?{1}','输入 ?{1}\n\n```md\n<!-- mathsemble:part fake -->\n<!-- mathsemble:end -->\n```');
  assert.deepEqual(fragments.listFragments(item).fragments.map(p=>p.id),['p-a','p-b']);
  assert.match(fragments.resolveFragment(item,ref()).markdown,/part fake/);
});
test('selected reference images and footnotes cannot silently lose definitions stored in unselected parts',()=>{
  const item={kind:'question',markdown:region('stem','','共用题干')+'\n\n'+region('part','p-a','![图][g]\n\n文字[^n]')+'\n\n'+region('part','p-b','另一问\n\n[g]: image.png\n[^n]: 必需脚注')};
  assert.throws(()=>fragments.resolveFragment(item,ref()),/缺少图片、链接或脚注定义/);
  const both=fragments.resolveFragment(item,ref(['p-a','p-b']));assert.match(both.markdown,/image.png/);
  item.markdown=item.markdown.replace('共用题干','共用题干\n\n[g]: image.png\n[^n]: 必需脚注');
  assert.match(fragments.resolveFragment(item,ref()).markdown,/image.png/);
});
test('code and math reference syntax are literal, while collapsed and shortcut references need closure',()=>{
  const item={kind:'question',markdown:region('stem','','共用')+'\n\n'+region('part','p-a','`![x][g]`\n\n$$[x][g]$$\n\n```md\n![x][g]\n```')+'\n\n'+region('part','p-b','另一问\n\n[g]: image.png')};
  assert.doesNotThrow(()=>fragments.resolveFragment(item,ref()));
  for(const usage of ['![g]','![g][]','[g]','[text][g]']){
    const withUse={...item,markdown:item.markdown.replace('`![x][g]`',usage)};
    assert.throws(()=>fragments.resolveFragment(withUse,ref()),/缺少图片/);
  }
});
test('reference validation rejects getters, symbols, sparse arrays, duplicate and dangerous IDs',()=>{
  const getter={kind:'question-part',get ids(){throw Error('getter executed');}};
  for(const bad of [getter,ref(['p-a','p-a']),ref(['__proto__']),ref(['constructor']),ref(['one two']),ref(Array(1)),
    {...ref(),[Symbol('x')]:1},{...ref(),extra:1},Object.assign(Object.create({inherited:true}),ref())])
    assert.throws(()=>fragments.validateFragmentRef(bad));
  const ids=['p-a'];Object.defineProperty(ids,'0',{get(){throw Error('getter executed');}});assert.throws(()=>fragments.validateFragmentRef(ref(ids)),/列表无效/);
});
test('score precision, bounds, non-numbers and negative values are validated consistently',()=>{
  for(const value of [0,0.01,0.1,12.25,1000000])assert.equal(fragments.validateScore(value),value);
  for(const value of [-1,NaN,Infinity,'1',null,1.001,1000000.01])assert.throws(()=>fragments.validateScore(value),/分值/);
});
test('part scores must exactly cover selected parts; total is cent-exact and defensive',()=>{
  const input=deepFreeze(ref(['p-a','p-b'],{'p-a':0.1,'p-b':0.2}));
  const valid=fragments.validateFragmentRef(input);assert.equal(fragments.totalScore(valid),0.3);
  valid.scores['p-a']=5;assert.equal(input.scores['p-a'],0.1);
  for(const scores of [{'p-a':1},{'p-a':1,'p-b':2,extra:3},{'p-a':1000000,'p-b':1}])assert.throws(()=>fragments.validateFragmentRef(ref(['p-a','p-b'],scores)));
  assert.throws(()=>fragments.validateFragmentRef({kind:'knowledge-section',ids:['s1'],scores:{s1:1}}),/知识小节/);
});
test('whole scores opt into v4, zero is preserved, removal returns feature-free v3',()=>{
  const {plan}=planFor(question()),id=plan.entries[0].entryId;
  const score=core.updateEntry(deepFreeze(plan),id,{score:0});
  assert.equal(plan.schemaVersion,3);assert.equal(score.schemaVersion,4);assert.equal(score.entries[0].score,0);
  assert.deepEqual(core.validatePlan(JSON.parse(JSON.stringify(score))),score);
  const clear=core.updateEntry(score,id,{score:null});assert.equal(clear.schemaVersion,3);assert(!Object.hasOwn(clear.entries[0],'score'));
  assert.throws(()=>core.validatePlan({...score,schemaVersion:3}),/未知字段/);
});
test('v1/v2/v3 migrate in memory without new required entry fields or mutation',()=>{
  const {plan}=planFor(question());
  for(const version of [1,2,3]) {
    const raw={...plan,schemaVersion:version};if(version===1){delete raw.course;delete raw.output;}
    deepFreeze(raw);const before=JSON.stringify(raw),next=core.validatePlan(raw);
    assert.equal(next.schemaVersion,3);assert.equal(JSON.stringify(raw),before);assert.deepEqual(Object.keys(next.entries[0]),Object.keys(plan.entries[0]));
  }
});
test('part scoring derives entry total, rejects contradictions and recalculates selected-score edits',()=>{
  const {plan}=planFor(question()),id=plan.entries[0].entryId;
  const first=core.updateEntry(plan,id,{fragmentRef:ref(['p-a','p-b'],{'p-a':1.25,'p-b':2.5})});
  assert.equal(first.entries[0].score,3.75);
  assert.throws(()=>core.updateEntry(first,id,{score:4}),/分值.*之和/);
  const second=core.updateEntry(first,id,{fragmentRef:ref(['p-a','p-b'],{'p-a':2.25,'p-b':2.5})});
  assert.equal(second.entries[0].score,4.75);
  const whole=core.updateEntry(second,id,{fragmentRef:null});assert.equal(whole.schemaVersion,3);
});
test('selecting different content clears former aggregate score unless explicit score supplied',()=>{
  const {plan}=planFor(question()),id=plan.entries[0].entryId;
  const whole=core.updateEntry(plan,id,{score:20});
  const part=core.updateEntry(whole,id,{fragmentRef:ref()});assert(!Object.hasOwn(part.entries[0],'score'));
  const scored=core.updateEntry(part,id,{score:3});
  assert(!Object.hasOwn(core.updateEntry(scored,id,{fragmentRef:ref(['p-b'])}).entries[0],'score'));
  assert.equal(core.updateEntry(scored,id,{fragmentRef:ref(['p-b']),score:5}).entries[0].score,5);
});
test('knowledge and section scores reject; source replacement cannot silently transfer a fragment ID',()=>{
  const {plan}=planFor(question()),id=plan.entries[0].entryId,selected=core.updateEntry(plan,id,{fragmentRef:ref()});
  assert.throws(()=>core.updateEntry(selected,id,{sourceId:'Q2',sourcePath:'题库/新.md'}),/不能转移/);
  assert.equal(core.updateEntry(selected,id,{sourcePath:'题库/重命名.md'}).entries[0].fragmentRef.ids[0],'p-a');
  let other=core.addSection(core.createPlan(),'分区');assert.throws(()=>core.updateEntry(other,other.entries[0].entryId,{score:1}),/仅题目/);
  other=core.addItem(core.createPlan(),core.buildIndex([{kind:'knowledge',path:'知识/k.md',markdown:'知识',metadata:{}}]).items[0]);
  assert.throws(()=>core.updateEntry(other,other.entries[0].entryId,{score:1}),/仅题目/);
});
