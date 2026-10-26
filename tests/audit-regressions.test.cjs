'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const js=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const names='handoutPlan,transformQuestion,studentSpacePlan,mwbTeacherMeasurementPlan,mwbResolveMeasuredCallouts,teacherSolutionHeights,teacherOnlyCalloutIndices,answerSlots,mwbMapUnchangedAnswerSlots,mwbValidateTypedAnswers,mwbMarkdownLines,mwbCalloutDocument,PreviewModal';
const stub=`const mwbTestObsidian={Plugin:class{},Modal:class{constructor(app){this.app=app;}},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve(),renderMath:()=>{throw Error('not an actual Obsidian MathJax host');}};const module={exports:{}};function require(name){return name==='obsidian'?mwbTestObsidian:{};}`;
const load=stub+'\n'+js+'\nglobalThis.audit={'+names+'};globalThis.mockObsidian=mwbTestObsidian;';
const ctx={console,Buffer};vm.runInNewContext(load,ctx);const a=ctx.audit;
const nested='> [!note] 提示\n> 外层内容\n> > [!answer]- 标准答案\n> > SECRET_ANSWER\n> > [!solution]+ 解题思路\n> > SECRET_SOLUTION\n> 外层结束';
test('F01 nested teacher content is removed with its subtree and never leaked',()=>{
 const source=nested;
 for(const solutionSpaces of [false,true]){
  const plan=a.handoutPlan(source,'student',{solutionSpaces});
  assert.doesNotMatch(plan.markdown,/SECRET/);
  assert.match(plan.markdown,/外层内容/);assert.match(plan.markdown,/外层结束/);
  assert.equal(plan.solutionCount,solutionSpaces?2:1);
  assert.doesNotMatch(a.transformQuestion(source,'student'),/SECRET/);
 }
 assert.match(a.handoutPlan(source,'teacher').markdown,/SECRET_ANSWER/);
 assert.match(a.handoutPlan(source,'teacher').markdown,/SECRET_SOLUTION/);
 assert.doesNotMatch(a.handoutPlan(source,'teacher',{showSolution:false}).markdown,/SECRET_SOLUTION/);
 assert.equal(nested,source,'no source mutation');
});
test('F01 parent teacher block hides shared descendants; nested spaces are not double-counted',()=>{
 const source='> [!answer]- Complete\n> SECRET_PARENT\n> > [!note] Shared inside teacher\n> > SECRET_CHILD\n> > > [!answer]- Nested\n> > > SECRET_GRANDCHILD';
 const plan=a.studentSpacePlan(source);
 assert.equal(plan.count,1);assert.doesNotMatch(plan.markdown,/SECRET/);
 assert.equal(a.mwbTeacherMeasurementPlan(source).targets.length,1);
});
test('F02 source identities are stable even when omitted solution shifts DOM positions',()=>{
 const source='> [!note] A\n> > [!note] nested\n> > text\n\n> [!solution]- omitted\n> BAD_SOLUTION\n\n> [!answer]- target\n> text';
 const off=a.mwbTeacherMeasurementPlan(source),on=a.mwbTeacherMeasurementPlan(source,{solutionSpaces:true});
 assert.equal(off.blocks.length,3);assert.equal(on.blocks.length,4);
 assert.equal(off.targets[0].id,on.targets[1].id);
 assert.equal(off.targets[0].id,a.studentSpacePlan(source).targets[0].id);
 assert.deepEqual(Array.from(a.teacherOnlyCalloutIndices(source)),[3]);
});
test('F04 disabled solution is absent from every student measurement plan, enabled is retained',()=>{
 const source='> [!answer]- a\n> VALID\n\n> [!solution]- s\n> $BAD_FORMULA$\n> ![](BAD_IMAGE)';
 assert.doesNotMatch(a.mwbTeacherMeasurementPlan(source).markdown,/BAD_FORMULA|BAD_IMAGE/);
 assert.match(a.mwbTeacherMeasurementPlan(source,{solutionSpaces:true}).markdown,/BAD_FORMULA/);
 assert.match(a.mwbTeacherMeasurementPlan(source,{solutionSpaces:true,showSolution:false}).markdown,/BAD_IMAGE/);
 assert.doesNotMatch(a.handoutPlan(source,'student').markdown,/BAD_/);
});
function deletion(source,from,to){const changed=source.slice(0,from)+source.slice(to);const doc=text=>({sliceString:(a,b)=>text.slice(a,b),lineAt:()=>({from:0,text})});return {changed,update:{startState:{doc:doc(source)},state:{doc:doc(changed)},changes:{iterChanges:f=>f(from,to,from,from,{toString:()=>''}),mapPos:p=>p>to?p-(to-from):p}}};}
test('F05 edits joining typed markers force rescan, including empty cached indexes',()=>{
 for(const source of ['题干：?x{42}','题干：!x{A}','?文字{42}','!  {BC}']){
  const from=source.search(/[?!]/)+1,to=source.indexOf('{'),{changed,update}=deletion(source,from,to);
  assert.equal(a.mwbMapUnchangedAnswerSlots(a.answerSlots(source),update),null);
  assert.equal(a.answerSlots(changed).length,1);
 }
 const plain='普通题干文字';const {update}=deletion(plain,2,3);
 assert.notEqual(a.mwbMapUnchangedAnswerSlots([],update),null,'plain-body editing keeps fast path');
});
test('F06 code context is shared by index, preflight, answer rewrite, blank normalization and Callout projection',()=>{
 const codeSources=[
  '    ?{42} !{B} ___ ?{', '\t?{42} ___ ?{',
  '> [!note] 示例\n> ```md\n> ?{42} ___ ?{\n> > [!answer]- literal\n> > LITERAL_SECRET\n> ```',
  '> [!note] 示例\n>     ?{42} ___ ?{',
  '> > [!note] 示例\n> > ~~~~md\n> > ?{42} ___ ?{\n> > ~~~~',
  '```md\n> [!answer]- literal\n> ?{42} ___ ?{\n```'
 ];
 for(const source of codeSources){
  assert.equal(a.answerSlots(source).length,0);
  assert.deepEqual(Array.from(a.mwbValidateTypedAnswers(source)),[]);
  for(const mode of ['student','teacher']){
   const result=a.handoutPlan(source,mode).markdown;
   assert.doesNotMatch(result,/mwb-answer-slot|mwb-fixed-blank|mwb-choice-slot/);
   assert.match(result,/\?\{42\}/);assert.match(result,/___/);
  }
 }
});
test('F06 quoted fence does not consume following real answers or alter math state',()=>{
 const source='> [!note] 示例\n> ```md\n> $$ ?{BROKEN\n> ```\n\n实际 ?{$x^2$}';
 assert.equal(a.answerSlots(source).length,1);
 const output=a.handoutPlan(source,'student').markdown;
 assert.match(output,/\$\$ \?\{BROKEN/);assert.match(output,/mwb-answer-slot/);
});
test('multiple bundled editions use one projection implementation, not divergent copies',()=>{
 assert.equal((js.match(/return mwbProjectCallouts\(source, mode, options\)\.markdown;/g)||[]).length,4);
 assert.equal((js.match(/return mwbStudentSpacePlan\(markdown, options\);/g)||[]).length,2);
 assert.equal((js.match(/const measurement = mwbTeacherMeasurementPlan/g)||[]).length,3);
});

test('real Chromium: nested mapping, solution measurement isolation, title refresh',async t=>{
 const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(p=>p&&fs.existsSync(p));
 if(!chrome){if(process.env.CI)throw Error('Chrome required in CI');t.skip('Set CHROME_PATH');return;}
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-audit-'));
 const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
 const html='<!doctype html><meta charset="utf-8"><style>'+css+'</style><div id="mount"></div><script>'+(load+'\n('+browserCases.toString()+')();').replace(/<\/script/gi,'<\\/script')+'</script>';
 const input=path.join(temp,'test.html');fs.writeFileSync(input,html);
 try{for(const r of await runChromeDocument(chrome,input,path.join(temp,'profile')))await t.test(r.name,()=>assert.equal(r.ok,true,r.error||''));}
 finally{fs.rmSync(temp,{recursive:true,force:true});}
});
async function browserCases(){
 const results=[],a=audit,mount=document.getElementById('mount');
 const ok=(v,msg)=>{if(!v)throw Error(msg);};
 const check=async(name,fn)=>{try{mount.replaceChildren();await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.stack||e.message});}};
 const box=(type,text)=>'<div class="callout" data-callout="'+type+'"><div class="callout-title">'+type+'</div><div class="callout-content">'+text+'</div></div>';
 HTMLElement.prototype.createEl=function(tag,opts={}){const e=document.createElement(tag);if(opts.cls)e.className=opts.cls;if(opts.text)e.textContent=opts.text;for(const k of ['type','value'])if(opts[k])e[k]=opts[k];for(const [k,v]of Object.entries(opts.attr||{}))e.setAttribute(k,v);this.appendChild(e);return e;};
 HTMLElement.prototype.createDiv=function(opts){return this.createEl('div',opts);};
 HTMLElement.prototype.empty=function(){this.replaceChildren();};HTMLElement.prototype.addClass=function(c){this.classList.add(c);};
 HTMLElement.prototype.setText=function(t){this.textContent=t;};HTMLElement.prototype.appendText=function(t){this.appendChild(document.createTextNode(t));};
 await check('F02 nested shared block cannot steal a later answer height',()=>{
  const source='> [!note] outer\n> intro\n> > [!note] inner\n> > note\n\n> [!answer]- target\n> answer';
  const plan=a.mwbTeacherMeasurementPlan(source);
  mount.innerHTML=box('note','intro'+box('note','<p style="height:20px">nested</p>'))+box('answer','<p style="height:150px">answer</p>');
  const targets=a.mwbResolveMeasuredCallouts(mount,plan),actual=mount.lastElementChild;
  ok(targets.length===1&&targets[0]===actual,'wrong measured object');
  const heights=a.teacherSolutionHeights(mount,1,plan);ok(heights[0]>150,'wrong answer height');
  actual.setAttribute('data-callout','note');
  let failed=false;try{a.mwbResolveMeasuredCallouts(mount,plan);}catch(e){failed=true;}ok(failed,'type mismatch silently accepted');
 });
 await check('F02 nested teacher target keeps parent identity and rejects shape mismatch',()=>{
  const source='> [!note] parent\n> > [!answer]- target\n> > SECRET';
  const plan=a.mwbTeacherMeasurementPlan(source);
  mount.innerHTML=box('note',box('answer','<p>SECRET</p>'));
  const answer=mount.querySelector('[data-callout="answer"]');ok(a.mwbResolveMeasuredCallouts(mount,plan)[0]===answer,'nested target missing');
  mount.appendChild(answer);let failed=false;try{a.mwbResolveMeasuredCallouts(mount,plan);}catch(e){failed=true;}ok(failed,'parent mismatch accepted');
 });
 const md='求解。\n> [!answer]- answer\n> 正确解答\n\n> [!solution]- solution\n> $OVERSIZE$';
 for(const route of ['measureDocumentSolutions','measureSolutions','measureExamSolutions'])for(const enabled of [false,true]){
  await check('F04 '+route+' solutionSpaces='+enabled,async()=>{
   const host=mount.createDiv({cls:'mwb-modal'}),paper=host.createDiv({cls:'mwb-page'}),rendered=paper.createDiv({cls:'mwb-typography mwb-print-document'});
   const render=async(_app,src,target)=>{target.innerHTML=box('answer','<p>正确解答</p>')+(src.includes('OVERSIZE')?box('solution','<mjx-container style="display:block;width:1000px;height:20px">broken</mjx-container>'):'');};
   mockObsidian.MarkdownRenderer.render=render;
   const proto=a.PreviewModal.prototype,m={page:paper,rendered,app:{},plugin:{},file:{path:'sample.md'},markdown:md,generation:1,solutionOptions:{solutionSpaces:enabled,showSolution:false},status:{setText(){}},measurePage:null,removeMeasurement:proto.removeMeasurement,addRenderWarnings(){},validateExamContexts:proto.validateExamContexts,renderDocumentSource:async(src,target)=>render(null,src,target)};
   let value,error;try{value=await proto[route].call(m,...(route==='measureExamSolutions'?[[{file:{path:'sample.md'},markdown:md}]]:route==='measureDocumentSolutions'?[enabled?2:1,1]:[enabled?2:1]));}catch(e){error=e.message;}
   if(enabled)ok(error&&/版心|公式/.test(error),'enabled bad solution should be diagnosed');
   else ok(!error&&value&&(value instanceof Map?value.get('sample.md')[0]:value[0])>0,error||'measurement missing');
   ok(m.measurePage===null,'measurement DOM leaked');
  });
 }
 await check('F07 title change rebuilds the visible A4 clone, not just its hidden source',()=>{
  const m=new a.PreviewModal({}, {manifest:{version:'test'}},{basename:'sample',path:'sample.md'},'',{title:'旧标题',items:[],sections:[]});
  m.modalEl=mount.createDiv();m.contentEl=m.modalEl.createDiv({cls:'modal-content'});
  let renders=0;
  m.renderMode=function(){renders++;this.clearPaginatedPreview();this.rendered.empty();this.titleElement=this.rendered.createEl('h1',{text:this.examTitle});this.rendered.createEl('p',{text:'测试题干'});this.showPaginatedPreview();};
  m.onOpen();const before=m.previewPages;const input=m.contentEl.querySelector('.mwb-exam-title-input');input.value='新标题';input.dispatchEvent(new Event('change'));
  ok(renders===2,'no rerender scheduled');ok(!before.isConnected,'stale preview not removed');
  ok(m.previewPages.querySelector('h1').textContent==='新标题','visible clone stale');m.onClose();
 });
 const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.appendChild(output);
}
