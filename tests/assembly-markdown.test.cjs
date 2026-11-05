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
