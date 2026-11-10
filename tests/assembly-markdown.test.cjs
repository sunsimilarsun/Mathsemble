'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {compileMarkdown} = require('../src/assembly-markdown.cjs');
function fixture(contents) {
  const entries = contents.map((o,i)=>({entryId:'e'+i,kind:o.kind||'question',title:o.title||'测试 '+i,role:o.role||'例题',sourcePath:o.path||'题库/q'+i+'.md'}));
  const plan = {title:'集合讲义',entries};
  const resolved = entries.map((entry,i)=>({entry,status:contents[i].status||'ok',item:{kind:entry.kind,path:entry.sourcePath,title:entry.title,markdown:contents[i].markdown||'正文。'}}));
  return {plan,resolved};
}
async function run(contents,options={}) { const {plan,resolved}=fixture(contents); return compileMarkdown(plan,resolved,options); }
function outputProperties(markdown) {
  const frontmatter=markdown.match(/^---\n([\s\S]*?)\n---\n/)[1];
  return Object.fromEntries(frontmatter.split('\n').map(line=>{
    const separator=line.indexOf(':');return [line.slice(0,separator),JSON.parse(line.slice(separator+1).trim())];
  }));
}
const resolver=async(target,path)=>{
  if(target==='图.png')return{path:'题库/配图/图(1).png',extension:'png'};
  if(target==='note')return{path:'知识/note.md',extension:'md'};
  if(target==='missing')return null;
  return {path:'知识/'+target.replace(/^\.\.\//,''),extension:target.split('.').pop()};
};
test('whole knowledge and questions keep order, answer slots and source unchanged',async()=>{
 const data=fixture([{kind:'knowledge',title:'知识梳理',markdown:'---\nid: K01\n---\n# 原标题\n\n## 定义\n完整正文。\n\n$$A=\\{x\\mid x>0\\}$$\n\n### 例子\n所有例子。'}, {role:'变式',markdown:'# 原题名\n\n题干 ?{42}。\n\n## 方法\n> [!answer]- 答案\n> 标准解答。\n> [!solution]- 补充\n> 说明。'}]);
 const before=JSON.stringify(data); const out=await compileMarkdown(data.plan,data.resolved);
 assert(out.includes('## 知识梳理')); assert(!out.includes('原标题')); assert(out.includes('完整正文。')); assert(out.includes('所有例子。'));
 assert(out.includes('##### 变式1 测试 1')); assert(out.includes('###### 方法')); assert(out.includes('题干 ?{42}。')); assert(out.includes('> [!answer]- 答案')); assert(out.indexOf('知识梳理')<out.indexOf('##### 变式1'));
 assert.equal(JSON.stringify(data),before);
});
test('generated course properties follow the plan and safely quote multiline content',async()=>{
  const data=fixture([{markdown:'---\nauthor: 原题教师\ntitile: 原题课题\nsubject: 原题学科\n---\n题干 ?{42}。'}]);
  data.plan.course={teacher:'  李老师  ',student:'小甲: "A"',time:'周六\n09:00',subject:'数学',grade:'高一',
    title:null,objectives:'第一条\n---\nauthor: 不能注入\n第二条'};
  const before=JSON.stringify(data);
  const out=await compileMarkdown(data.plan,data.resolved),metadata=outputProperties(out);
  assert.deepEqual(metadata,{note_type:'handout',title:'集合讲义',titile:'集合讲义',author:'李老师',student:'小甲: "A"',
    class_time:'周六\n09:00',subject:'数学',grade:'高一',learning_objectives:'第一条\n---\nauthor: 不能注入\n第二条'});
  assert.equal(JSON.stringify(data),before);
  assert(!out.includes('原题教师'));assert(!out.includes('原题课题'));assert(out.includes('题干 ?{42}。'));
  data.plan.course.title='';data.plan.course.teacher=' \t ';
  const blank=outputProperties(await compileMarkdown(data.plan,data.resolved));
  assert.equal(blank.titile,'');assert.equal(blank.author,'孙老师');
  data.plan.course.title='  单独的课题  ';
  assert.equal(outputProperties(await compileMarkdown(data.plan,data.resolved)).titile,'单独的课题');
});
test('legacy direct compilation uses the handout title and teacher fallback without borrowing source metadata',async()=>{
  const properties=outputProperties(await run([{markdown:'---\nauthor: 原题作者\nstudent: 不可沿用\n---\n正文'}]));
  assert.equal(properties.titile,'集合讲义');assert.equal(properties.author,'孙老师');
  for(const key of ['student','class_time','subject','grade','learning_objectives'])assert.equal(properties[key],'');
});
test('section and knowledge headings end question boundaries',async()=>{
 const out=await run([{markdown:'题干一。'},{kind:'section',title:'知识与训练'},{kind:'knowledge',markdown:'## 二级\n正文\n##### 五级\n正文尾'},{role:'训练',markdown:'题干二。'}]);
 assert(out.includes('## 知识与训练')); assert(out.includes('#### 五级')); assert(out.includes('##### 训练2'));
 assert.equal((out.match(/^##### /gm)||[]).length,2);
});
test('code, quoted fences, inline math and display math remain literal',async()=>{
 const literal='`![例](图.png)`\n\n$$\n\\text{[[note]]}\\quad x_i\n$$\n\n```md\n# 代码标题\n![x](missing)\n```\n\n> ```md\n> [[note]]\n> ```';
 const out=await run([{markdown:literal+'\n\n真实 ![图](图.png)'}],{resolveLink:resolver});
 assert(out.includes(literal)); assert(out.includes('![图](../../题库'.split('题库')[0]+'%E9%A2%98%E5%BA%93'));
});
test('inline and wiki images resolve against original file and encode paths',async()=>{
 const calls=[]; const out=await run([{path:'题库/本节/q.md',markdown:'![图](图.png "说明")\n\n![[图.png|300]]\n\n[[note|知识页]]'}],{resolveLink:async(t,p)=>{calls.push([t,p]);return resolver(t,p);},outputPath:'成品/讲义.md'});
 assert(out.includes('![图](../%E9%A2%98%E5%BA%93/%E9%85%8D%E5%9B%BE/%E5%9B%BE%281%29.png "说明")'));
 assert(out.includes('![[题库/配图/图(1).png|300]]')); assert(out.includes('[[知识/note.md|知识页]]')); assert(calls.every(c=>c[1]==='题库/本节/q.md'));
});
test('balanced parentheses and angle image destinations are encoded',async()=>{
 const out=await run([{markdown:'![a](./img(1).png)\n![b](<./with space.png>)'}],{resolveLink:async t=>({path:'assets/'+t.replace(/^\.\//,''),extension:'png'})});
 assert(out.includes('img%281%29.png'));assert(out.includes('with%20space.png'));
});
test('reference images, links and footnotes are isolated per source',async()=>{
 const md='![图][same]\n[链接][same]\n[same][]\n[same]\n文本[^a]\n\n[same]: 图.png "图示"\n[^a]: 脚注。';
 const out=await run([{markdown:md},{markdown:md}],{resolveLink:resolver});
 for(const n of [1,2]) { assert(out.includes(`![图][mwb-${n}-same]`));assert(out.includes(`[same][mwb-${n}-same]`));assert(out.includes(`文本[^mwb-${n}-a]`));assert(out.includes(`[^mwb-${n}-a]: 脚注。`));assert(out.includes(`[mwb-${n}-same]: ../../`)); }
 assert(!out.includes('[same]:'));assert(!out.includes('[^a]'));
});
test('shortcut reference images also remain image blockers',async()=>{
 await assert.rejects(()=>run([{markdown:'![missing]\n\n[missing]: missing'}],{resolveLink:resolver}),/无法定位/);
});
test('Markdown note embeds are refused rather than leaking teacher content',async()=>{
 await assert.rejects(()=>run([{markdown:'![[note]]'}],{resolveLink:resolver}),/暂不支持嵌入 Markdown/);
 await assert.rejects(()=>run([{markdown:'![x](note)'}],{resolveLink:resolver}),/暂不支持嵌入 Markdown/);
});
test('missing images reject while unknown wiki text keeps original context',async()=>{
 await assert.rejects(()=>run([{markdown:'![[missing]]'}],{resolveLink:resolver}),/无法定位/);
 const out=await run([{markdown:'[[missing|待补知识]]',path:'题库/q.md'}],{resolveLink:resolver});
 assert(out.includes('[[题库/missing|待补知识]]'));
});
test('external image URLs stay intact and do not invoke local resolution',async()=>{
 const out=await run([{markdown:'![x](https://example.test/a.png)\n[[obsidian://open?vault=x]]'}],{resolveLink:async()=>{throw Error('unexpected lookup');}});
 assert(out.includes('https://example.test/a.png'));assert(out.includes('obsidian://open?vault=x'));
});
test('HTML img attributes rebase without altering literal code',async()=>{
 const out=await run([{markdown:'<img src="图.png" width="100">\n\n<code>![x](missing)</code>'}],{resolveLink:resolver});
 assert(out.includes('<img src="../../'));assert(out.includes('width="100"'));assert(out.includes('<code>![x](missing)</code>'));
});
test('changed, missing, conflicting and out of order sources are blockers',async()=>{
 for(const status of ['changed','missing','conflict']) await assert.rejects(()=>run([{status,markdown:'原文'}]),/来源/);
 const {plan,resolved}=fixture([{markdown:'第一题'},{markdown:'第二题'}]);
 await assert.rejects(()=>compileMarkdown(plan,resolved.reverse()),/顺序/);
});
test('setext question headings cannot terminate question scope',async()=>{
 const out=await run([{markdown:'标题\n====\n\n方法\n---\n内容\n\n------\n续页'}]);
 assert(!out.includes('===='));assert(out.includes('###### 方法'));assert(out.includes('\n------\n'));
});
test('malformed source structure and empty plans are rejected',async()=>{
 await assert.rejects(()=>run([{markdown:'---\nid: x\n正文'}]),/frontmatter/);
 await assert.rejects(()=>run([{markdown:'```js\n未闭合'}]),/围栏/);
 await assert.rejects(()=>compileMarkdown({entries:[]},[]),/先加入/);
});
test('nested protected math in Wiki labels restores without token leakage',async()=>{
 const out=await run([{markdown:'[[note|函数 $f(x)$]] 与 [[函数$x$]]'}],{resolveLink:resolver});
 assert(out.includes('[[知识/note.md|函数 $f(x)$]]'));assert(out.includes('函数$x$'));assert(!out.includes('MWBPROTECTEDTOKEN'));
});
test('indented code is literal while list continuation resources are rebased',async()=>{
 const out=await run([{markdown:'    ![literal](missing)\n\n- 列表\n\n    ![真实](图.png)'}],{resolveLink:resolver});
 assert(out.includes('    ![literal](missing)'));assert(out.includes('    ![真实](../../'));
});
test('unquoted relative HTML resources are explicit blockers',async()=>{
 await assert.rejects(()=>run([{markdown:'<img src=图.png>'}],{resolveLink:resolver}),/必须加引号/);
});
test('image nested inside a link resolves both destinations',async()=>{
 const out=await run([{markdown:'[![图](图.png)](note)'}],{resolveLink:resolver});
 assert(out.includes('[![图](../../%E9%A2%98%E5%BA%93/'));assert(out.includes(')](../../%E7%9F%A5%E8%AF%86/note.md)'));
});
test('empty occurrence role inherits source role while explicit overrides stay local',async()=>{
 const {plan,resolved}=fixture([{markdown:'题干'}]);plan.entries[0].role='';resolved[0].item.role='训练';
 let out=await compileMarkdown(plan,resolved);assert(out.includes('##### 训练1'));
 plan.entries[0].role='变式';out=await compileMarkdown(plan,resolved);assert(out.includes('##### 变式1'));assert.equal(resolved[0].item.role,'训练');
 plan.entries[0].role='';delete resolved[0].item.role;resolved[0].item.metadata={role:'example'};
 out=await compileMarkdown(plan,resolved);assert(out.includes('##### 例题1'));
});

test('source mapping covers final mixed-entry blocks without changing Markdown or exposing provenance',async()=>{
  const data=fixture([
    {kind:'section',title:'第一部分'},
    {kind:'knowledge',title:'知识\n梳理',path:'知识/原稿.md',markdown:'---\r\ntitle: 原文\r\nnotes: |\r\n  第一行\r\n  第二行\r\n---\r\n# 原知识标题\r\n\r\n## 定义\r\n说明一。\r\n\r\n```md\r\n##### 围栏中的题目\r\n\r\n末行\r\n```\r\n\r\n知识结束。\r\n'},
    {kind:'section',title:'第二部分'},
    {title:'训练题',role:'训练',path:'题库/原题.md',markdown:'---\nid: 来源身份\n---\n# 原题标题\n\n题干 ?{42}。\n\n![图](图.png "说明")\n\n$$\nx+1=2\n$$\n\n> [!answer]-\n> 完整答案。\n'},
    {title:'末题',markdown:'最后正文。\n\n'}
  ]);
  data.plan.title='课程\n标题';
  data.plan.course={title:null,teacher:'李老师',student:'',time:'',subject:'数学',grade:'',objectives:'目标一\n目标二'};
  const original=JSON.stringify(data),calls=[];
  const plain=await compileMarkdown(data.plan,data.resolved,{resolveLink:resolver,outputPath:'成品/预览.md'});
  const mapped=await compileMarkdown(data.plan,data.resolved,{resolveLink:resolver,outputPath:'成品/预览.md',onSourceMap:map=>calls.push(map)});
  assert.equal(mapped,plain);
  assert.equal(JSON.stringify(data),original);
  assert.equal(calls.length,1);
  const map=calls[0],lines=mapped.split('\n');
  assert.deepEqual(map.map(({entryId,kind,path})=>({entryId,kind,path})),[
    {entryId:'e1',kind:'knowledge',path:'知识/原稿.md'},
    {entryId:'e3',kind:'question',path:'题库/原题.md'},
    {entryId:'e4',kind:'question',path:'题库/q4.md'}
  ]);
  const expected=[
    '## 知识 梳理\n\n### 定义\n说明一。\n\n```md\n##### 围栏中的题目\n\n末行\n```\n\n知识结束。',
    '##### 训练1 训练题\n\n题干 ?{42}。\n\n![图](../%E9%A2%98%E5%BA%93/%E9%85%8D%E5%9B%BE/%E5%9B%BE%281%29.png "说明")\n\n$$\nx+1=2\n$$\n\n> [!answer]-\n> 完整答案。',
    '##### 例题2 末题\n\n最后正文。'
  ];
  for(let i=0;i<map.length;i++){
    const row=map[i];
    assert.equal(lines.slice(row.startLine-1,row.endLine).join('\n'),expected[i]);
    assert.equal(row.startLine,lines.indexOf(expected[i].split('\n')[0])+1);
    assert.equal(lines[row.startLine-2],'','the separator before an entry is not in its range');
    assert.equal(lines[row.endLine],'','the separator after an entry is not in its range');
  }
  assert.equal(map.at(-1).endLine,lines.length-1,'the terminal newline is outside the final body');
  for(const row of map)assert(Object.isFrozen(row));assert(Object.isFrozen(map));
  assert.throws(()=>{map[0].path='改写.md';},TypeError);
  data.resolved[1].item.path='后来改名.md';data.plan.entries[1].entryId='后来修改';
  assert.equal(map[0].path,'知识/原稿.md');assert.equal(map[0].entryId,'e1');
  assert(!mapped.includes('知识/原稿.md'));assert(!mapped.includes('题库/原题.md'));
  assert(!mapped.includes('data-mwb-source'));assert(!mapped.includes('MWBPROTECTEDTOKEN'));
});

test('source mapping is published only after all entries have compiled successfully',async()=>{
  for(const failure of [
    {markdown:'```md\n未闭合'},
    {markdown:'![缺图](missing)'},
    {markdown:'第二题',status:'changed'}
  ]){
    let calls=0;
    const data=fixture([{markdown:'第一题已完整处理。'},failure]);
    await assert.rejects(compileMarkdown(data.plan,data.resolved,{resolveLink:resolver,onSourceMap:()=>calls++}));
    assert.equal(calls,0,'partial maps must not be exposed after a later entry fails');
  }
});

test('source mapping does not invent a path when a direct compiler input lacks one',async()=>{
  const data=fixture([{markdown:'没有可定位路径的正文。'}]);
  delete data.resolved[0].item.path;
  let map;
  const output=await compileMarkdown(data.plan,data.resolved,{onSourceMap:value=>{map=value;}});
  assert.deepEqual(map,[]);
  assert(output.includes('没有可定位路径的正文。'));
});
