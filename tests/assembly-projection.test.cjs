'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {compileMarkdown}=require('../src/assembly-markdown.cjs');
const pluginPath=path.resolve(__dirname,'../src/plugin.js');
const realRequire=createRequire(pluginPath);
const source=fs.readFileSync(pluginPath,'utf8');
const obsidian={Plugin:class{},Modal:class{},ItemView:class{},Component:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve(),renderMath:()=>{throw Error('No browser DOM in projection tests');}};
const context={module:{exports:{}},require:n=>n==='obsidian'?obsidian:realRequire(n),console,Buffer,setTimeout,clearTimeout,performance,AbortController,URL,TextEncoder};
vm.runInNewContext(source+'\n;globalThis.assemblyProjection={mwbHandoutQuestionPlan,handoutPlan};',context,{timeout:15000});
const api=context.assemblyProjection;
function bundle() {
 const sources=[
  {kind:'knowledge',title:'知识甲',path:'知识/甲.md',markdown:'# 甲\n\n## 定义甲\nKNOWLEDGE_ALPHA\n\n$$x^2+1>0$$\n\n##### 高阶补充\nCOMPLETE_KNOWLEDGE_TAIL'},
  {kind:'question',title:'第一道',path:'题库/甲/q1.md',markdown:'QUESTION_ONE !{A_SECRET}\n\n> [!solution]- 解析\n> SOLUTION_ONE_PRIVATE'},
  {kind:'knowledge',title:'知识乙',path:'知识/乙.md',markdown:'# 乙\n\nKNOWLEDGE_BETA\n\n> [!note] 共有说明\n> SHARED_NOTE'},
  {kind:'question',title:'第二道',path:'题库/乙/q2.md',markdown:'QUESTION_TWO ?{FILL_PRIVATE}\n\n## 作答要求\n保留全部步骤。\n\n> [!answer]- 标准答案\n> ANSWER_TWO_PRIVATE\n\n> [!solution]- 补充\n> SOLUTION_TWO_PRIVATE'}
 ];
 const entries=sources.map((item,i)=>({entryId:'id'+i,kind:item.kind,title:item.title,role:i===1?'例题':'训练',sourcePath:item.path}));
 return {plan:{title:'混编讲义',entries},resolved:entries.map((entry,i)=>({entry,item:sources[i],status:'ok'}))};
}
test('mixed compiled handout uses real projection without losing knowledge or exposing answers',async()=>{
 const data=bundle(); const original=JSON.stringify(data);
 const markdown=await compileMarkdown(data.plan,data.resolved);
 const boundaries=api.mwbHandoutQuestionPlan(markdown);
 assert.equal(boundaries.errors.length,0);assert.equal(boundaries.groups.length,2);
 assert.deepEqual(Array.from(boundaries.groups,g=>g.title),['例题1 第一道','训练2 第二道']);
 const first=boundaries.groups[0];
 const lines=markdown.split('\n');
 assert.equal(lines[first.end],'## 知识乙');
 const student=api.handoutPlan(boundaries.markdown,'student');
 const teacher=api.handoutPlan(boundaries.markdown,'teacher');
 const markers=['KNOWLEDGE_ALPHA','QUESTION_ONE','KNOWLEDGE_BETA','QUESTION_TWO'];
 for(const output of [student.markdown,teacher.markdown]){
  let previous=-1;
  for(const marker of markers){assert.equal(output.split(marker).length-1,1);assert(output.indexOf(marker)>previous);previous=output.indexOf(marker);}
  assert(output.includes('COMPLETE_KNOWLEDGE_TAIL'));assert(output.includes('SHARED_NOTE'));assert(output.includes('保留全部步骤。'));
 }
 for(const secret of ['A_SECRET','FILL_PRIVATE','SOLUTION_ONE_PRIVATE','ANSWER_TWO_PRIVATE','SOLUTION_TWO_PRIVATE']){
  assert(!student.markdown.includes(secret),secret+' leaked');assert(teacher.markdown.includes(secret),secret+' missing');
 }
 assert.equal(student.solutionCount,1,'Only standard answer allocates default handwriting space');
 assert.equal(JSON.stringify(data),original);
});
test('recompiled image paths resolve from the actual generated document directory',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-assembly-links-'));
 try{
  const imagePath='题库/甲/assets/示意(1).png';
  fs.mkdirSync(path.dirname(path.join(dir,imagePath)),{recursive:true});fs.writeFileSync(path.join(dir,imagePath),'image fixture');
  const data=bundle();data.resolved[1].item.markdown+='\n\n![图](assets/示意(1).png)\n\n![[assets/示意(1).png|200]]';
  const outputPath='Mathsemble/讲义/混编.md';
  const markdown=await compileMarkdown(data.plan,data.resolved,{outputPath,resolveLink:async(target,sourcePath)=>({path:path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath),target)),extension:'png'})});
  const ordinary=/!\[图\]\(([^)]+)\)/.exec(markdown)[1];
  assert(fs.existsSync(path.resolve(dir,path.posix.dirname(outputPath),decodeURIComponent(ordinary))));
  const wiki=/!\[\[([^|]+)\|200\]\]/.exec(markdown)[1];assert(fs.existsSync(path.join(dir,wiki)));
  for(const mode of ['student','teacher']){const projection=api.handoutPlan(markdown,mode).markdown;assert(projection.includes(ordinary));assert(projection.includes(wiki));}
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
