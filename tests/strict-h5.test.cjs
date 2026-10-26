'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../main.js'),'utf8');
const stub=`const module={exports:{}};const stub={Plugin:class{},Modal:class{constructor(app){this.app=app;}},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve(),renderMath:()=>{throw Error('not Obsidian');}};function require(n){return n==='obsidian'?stub:{};}`;
const load=stub+'\n'+source+'\nglobalThis.h5={mwbHandoutQuestionPlan,mwbApplyHandoutQuestions,mwbQuestionTitle,mwbQuestionHeadingEdit,mwbWrapSingleQuestion,handoutPlan,studentSpacePlan,mwbTeacherMeasurementPlan,injectSpaceNodes,exportHtml,PreviewModal,paginate:paginatePreviewDocument};globalThis.mockObsidian=stub;';
const ctx={console,Buffer};vm.runInNewContext(load,ctx);const a=ctx.h5;
const named=['例1','例一','例题１','变式1','变式一','练习1','练习题2','检测1','检测题3','题1','第1题','例1 二次函数','【例1】 标题'];
test('strict H5: explicit vocabulary, fifth-level only, H6 subheads remain inside',()=>{
 for(const title of named){
  const plan=a.mwbHandoutQuestionPlan('##### '+title+'\n\n题干\n\n###### 第（1）问\n\n答案\n\n##### 方法总结\n内容');
  assert.equal(plan.groups.length,1,title);assert.equal(plan.groups[0].end,8,title);
 }
 for(const depth of [1,2,3,4,6]){
  const plan=a.mwbHandoutQuestionPlan('#'.repeat(depth)+' 例1\n正文');
  assert.equal(plan.groups.length,0);assert.ok(plan.warnings.length);
 }
});
test('strict H5: interleaved subquestion answers, rules, and plain text never split a question',()=>{
 const src='##### 例1\n共同条件\n\n（1）求值\n\n> [!answer]- 答案1\n> A1\n\n（2）证明\n\n> [!answer]- 答案2\n> A2\n\n---\n\n补充条件\n\n###### 解法二\n\n> [!solution]- 思路\n> S\n\n##### 方法总结\n一般正文\n\n##### 变式1\n另一个题目';
 const plan=a.mwbHandoutQuestionPlan(src);
 assert.equal(plan.groups.length,2);assert.equal(plan.groups[0].answerCount,2);assert.equal(plan.groups[0].solutionCount,1);
 assert.equal(plan.groups[0].end,22);assert.equal(plan.groups[1].start,25);
 assert.equal(plan.markdown.split('\n').length,src.split('\n').length,'markers cannot change Callout source line IDs');
 for(const solutionSpaces of [false,true]){
  const off=a.studentSpacePlan(src,{solutionSpaces}),tagged=a.studentSpacePlan(plan.markdown,{solutionSpaces});
  assert.deepEqual(Array.from(off.targets,t=>t.id),Array.from(tagged.targets,t=>t.id));
 }
});
test('strict H5: fenced and indented code, quotes, comments, HTML and math do not create questions',()=>{
 const invalid=['```md\n##### 例1\n```','~~~~\n##### 例1\n~~~~','    ##### 例1','> ##### 例1','> [!note]\n> ##### 例1','<!--\n##### 例1\n-->','<pre>\n##### 例1\n</pre>','<div>\n##### 例1\n</div>','$$\n##### 例1\n$$','\\[\n##### 例1\n\\]','---\nname: t\n##### 例1\n---'];
 for(const text of invalid){const p=a.mwbHandoutQuestionPlan(text+'\n\n##### 题2\n真实题干');assert.equal(p.groups.length,1,text);assert.equal(p.groups[0].title,'题2');}
});
test('strict H5: non-question H1-H5 and setext close, but empty titles are errors',()=>{
 for(let depth=1;depth<=5;depth++){
  const p=a.mwbHandoutQuestionPlan('##### 例1\n题干\n\n'+'#'.repeat(depth)+' 总结\n正文');
  assert.equal(p.groups[0].end,3);
 }
 assert.equal(a.mwbHandoutQuestionPlan('##### 例1\n题干\n\n总结\n====\n说明').groups[0].end,3);
 assert.equal(a.mwbHandoutQuestionPlan('##### 例1\n\n##### 例2\n题干').errors.length,1);
 assert.equal(a.mwbHandoutQuestionPlan('##### 例1\n<!--\n备注\n-->').errors.length,1);
});
test('strict H5: legacy labels/orphan answers warn; repeated labels have distinct source IDs',()=>{
 const p=a.mwbHandoutQuestionPlan('**例1**\n题干\n\n> [!answer]- 解\n> a\n\n##### 例1\n正文\n\n##### 例1\n正文');
 assert.equal(p.groups.length,2);assert.notEqual(p.groups[0].id,p.groups[1].id);
 assert.ok(p.warnings.some(w=>w.code==='legacy-label'));assert.ok(p.warnings.some(w=>w.code==='orphan-answer'));
 assert.equal(a.mwbQuestionHeadingEdit('**例1** 二次函数',1),'##### 例1 二次函数');
 assert.equal(a.mwbQuestionHeadingEdit('```\n例1\n```',2),null);
 assert.equal(a.mwbQuestionHeadingEdit('> 例1',1),null);
});
test('strict H5: source markers preserve H1 edition projection and teacher-only choices',()=>{
 const src='# 标题（教师版）\n\n##### 例1\n题干\n\n> [!answer]- 解\n> SECRET\n\n> [!solution]- 思路\n> SECRET2';
 const p=a.mwbHandoutQuestionPlan(src);
 const student=a.handoutPlan(p.markdown,'student');
 assert.match(student.markdown,/标题（学生版）/);assert.doesNotMatch(student.markdown,/SECRET/);
 assert.match(a.handoutPlan(p.markdown,'teacher',{showSolution:false}).markdown,/SECRET/);
 assert.doesNotMatch(a.handoutPlan(p.markdown,'teacher',{showSolution:false}).markdown,/SECRET2/);
 assert.ok(src.includes('SECRET'),'source remains unchanged');
});

test('strict H5 real Chromium mapping and print geometry',async t=>{
 const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable'].find(p=>p&&fs.existsSync(p));
 if(!chrome){if(process.env.CI)throw Error('CI requires Chromium');t.skip('Set CHROME_PATH');return;}
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-h5-'));
 const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');
 const fixtures=fs.existsSync(path.join(__dirname,'fixtures/strict-h5-commonmark.json'))?JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/strict-h5-commonmark.json'),'utf8')):[];
 const math=fs.readFileSync(path.join(__dirname,'fixtures/group-mathjax.svg.html'),'utf8');
 const script=load+'\n('+browserCases.toString()+')('+JSON.stringify(fixtures)+','+JSON.stringify(math)+');';
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';
 const input=path.join(dir,'test.html');fs.writeFileSync(input,html);
 try{for(const r of await runChromeDocument(chrome,input,path.join(dir,'profile')))await t.test(r.name,()=>assert.equal(r.ok,true,r.error||''));}
 finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
async function browserCases(fixtures,math){
 const out=[],a=h5;
 const check=async(name,f)=>{try{await f();out.push({name,ok:true});}catch(e){out.push({name,ok:false,error:e.stack});}};
 const ok=(x,m)=>{if(!x)throw Error(m);};
 const p=(k,h)=>`<p data-key="${k}" style="height:${h}mm;margin:0">${k}</p>`;
 const ans=(parts)=>`<div class="callout" data-callout="answer"><div class="callout-title">完整解答</div><div class="callout-content">${parts.join('')}</div></div>`;
 const question=(id,parts)=>`<section class="mwb-handout-question" data-mwb-question-id="${id}" data-mwb-question-label="${id}"><div class="mwb-exam-question-content">${parts.join('')}</div></section>`;
 const space=(heights)=>{const px=heights.map(h=>h*96/25.4);return `<div class="mwb-answer-space" data-mwb-space-px="${px.reduce((a,b)=>a+b,0)}">`+px.map((v,i)=>`<div class="mwb-answer-space-chunk" data-key="b${i}" style="height:${v}px"></div>`).join('')+'</div>';};
 let host;
 const layout=(html,preview=false)=>{
  host?.remove();host=document.createElement('div');host.className=preview?'mwb-modal':'';document.body.appendChild(host);
  const root=document.createElement('main');root.className='mwb-typography mwb-print-document mwb-export-doc'+(preview?' mwb-preview-pages':'');root.setAttribute('data-mwb-question-policy','strict-h5');root.innerHTML=html;host.appendChild(root);
  const origNodes=[...root.querySelectorAll('[data-key]')];
  const orig=origNodes.map(n=>n.dataset.key);
  const report=a.paginate(root,false,preview),pages=[...root.querySelectorAll('.mwb-paper-body')];
  ok(JSON.stringify(pages.flatMap(p=>[...p.querySelectorAll('[data-key]')].map(e=>e.dataset.key)))===JSON.stringify(orig),'original contents lost/reordered');
  ok(origNodes.every(n=>root.contains(n)),'rendered nodes recreated or lost');
  return {root,report,pages,pageOf:k=>pages.findIndex(p=>[...p.querySelectorAll('[data-key]')].some(n=>n.dataset.key===k))};
 };
 await document.fonts.ready;
 await check('short whole question stays current when it fits',()=>{
  const r=layout(p('f',90)+question('Q1',[p('s1',30),ans([p('a1',35)])]));
  ok(r.report.pages===1,'unnecessary new page');ok(r.report.strictQuestionPages[0].short,'wrong classification');
 });
 await check('short whole question moves intact rather than starting at previous page tail',()=>{
  const r=layout(p('f',210)+question('Q1',[p('s1',30),ans([p('a1',40)])]));
  ok(r.pageOf('s1')===1&&r.pageOf('a1')===1,'short question split');
  ok(r.report.strictQuestionPages[0].pages.length===1,'short audit failed');
 });
 await check('long question always starts fresh even if previous page could hold stem and first step',()=>{
  const r=layout(p('f',25)+question('Q1',[p('s1',25),ans(Array.from({length:8},(_,i)=>p('a'+i,35)))]));
  ok(r.pageOf('s1')===1,'long question incorrectly consumed previous page remainder');
  ok(r.pageOf('a0')===1&&r.pageOf('a1')===1,'long answer incorrectly moved wholesale');
  ok(!r.report.strictQuestionPages[0].short,'long classification');
 });
 await check('long question at beginning creates no leading blank sheet',()=>{
  const r=layout(question('Q1',[p('s',25),ans(Array.from({length:8},(_,i)=>p('a'+i,35)))]));
  ok(r.pageOf('s')===0&&r.pageOf('a0')===0,'leading blank');
 });
 await check('interleaved subquestions and answers remain one indivisible short question',()=>{
  const r=layout(p('f',185)+question('Q1',[p('s',15),ans([p('a1',15)]),p('s2',15),ans([p('a2',15)])]));
  ok(['s','a1','s2','a2'].every(k=>r.pageOf(k)===1),'interleaved question split');ok(r.report.strictQuestionPages.length===1,'split logical group');
 });
 await check('long displayed solution contributes to the strict fresh-page classification',()=>{
  const sol=ans(Array.from({length:6},(_,i)=>p('sol'+i,45))).replace('data-callout="answer"','data-callout="solution"');
  const r=layout(p('f',20)+question('Q1',[p('s',20),ans([p('a',20)]),sol]));
  ok(r.pageOf('s')===1&&r.pageOf('a')===1,'solution did not classify entire group');
 });
 await check('long student question starts fresh and preserves all space chunks and height',()=>{
  const r=layout(p('f',15)+question('Q1',[p('s',20),space(Array(18).fill(20))]));
  ok(r.pageOf('s')===1&&r.pageOf('b0')===1,'student starts in old remainder');
  ok(r.report.answerSpaceChunks===18&&Math.abs(r.report.answerSpaceDeltaPx)<.01,'lost writing space');
 });
 await check('first long exam can share its new page with title, without a title-only sheet',()=>{
  const r=layout('<h1 class="mwb-exam-title">试卷标题</h1><div class="mwb-exam-edition">教师版</div>'+question('Q1',[p('s',20),ans(Array.from({length:8},(_,i)=>p('a'+i,35)))]));
  ok(r.pageOf('s')===0,'title-only sheet created');
 });
 await check('strict mode never treats legacy H3 labels as protected groups',()=>{
  const r=layout('<h3>例1</h3>'+p('s',30)+ans([p('a',30)]));
  ok(r.report.strictQuestionPages.length===0&&r.report.handoutGroups===0,'legacy guessing still enabled');
 });
 await check('folder exam uses strict policy with source question number once',()=>{
  const q='<section class="mwb-exam-question" data-mwb-source-path="q.md"><div class="mwb-exam-question-content">'+p('s',20).replace('>s<','><span class="mwb-question-index">1.</span>题干<')+ans(Array.from({length:8},(_,i)=>p('a'+i,35)))+'</div></section>';
  const r=layout(p('f',10)+q);ok(r.pageOf('s')===1,'exam did not start new');ok(r.root.querySelectorAll('.mwb-question-index').length===1,'question number duplicated');
 });
 await check('strict short question retains the existing MathJax SVG without re-typesetting',()=>{
  const r=layout(p('f',225)+question('Q1',[p('s',10),`<div data-key="math">${math}</div>`,ans([p('a',15)])]));
  ok(r.pageOf('s')===r.pageOf('a')&&r.pageOf('s')===r.pageOf('math'),'formula separated from short question');
  ok(r.root.querySelector('mjx-container svg'),'MathJax SVG missing');
 });
 await check('strict preview and print use identical question-to-page assignments',()=>{
  const html=p('f',20)+question('Q1',[p('s',25),ans(Array.from({length:8},(_,i)=>p('a'+i,35)))]);
  const first=layout(html).report.strictQuestionPages,second=layout(html,true).report.strictQuestionPages;
  ok(JSON.stringify(first)===JSON.stringify(second),'preview/print difference');
 });
 // Controlled heading renderer checks mapping logic; full CommonMark fixtures below
 // additionally exercise code/list/root boundaries and reference scope.
 const source='##### 例1\n题干\n\n###### （1）小问\n\n> [!answer]- 解\n> a\n\n（2）题干\n\n> [!answer]- 解\n> b\n\n##### 方法总结\n普通正文\n\n##### 变式1\n题干';
 const plan=a.mwbHandoutQuestionPlan(source);
 const raw=()=>{
  const root=document.createElement('div');
  for(const header of plan.headings){const h=document.createElement('h'+header.level);h.innerHTML=`<span data-mwb-heading-token="${header.token}"></span>${header.title}`;root.appendChild(h);const b=document.createElement('p');b.textContent='body';root.appendChild(b);}
  return root;
 };
 await check('source mapping makes exactly two source-ID questions and excludes standalone summary',()=>{
  const root=raw();a.mwbApplyHandoutQuestions(root,plan,'notes.md');
  ok(root.querySelectorAll('.mwb-handout-question').length===2,'wrong wrappers');
  ok(root.children[1].tagName==='H5'&&root.children[1].textContent==='方法总结','summary swallowed');
  ok(!root.querySelector('[data-mwb-heading-token]'),'internal marker retained');
 });
 await check('missing marker aborts before content is moved',()=>{
  const root=raw();root.querySelector('[data-mwb-heading-token]').remove();const html=root.innerHTML;
  let failed=false;try{a.mwbApplyHandoutQuestions(root,plan);}catch(e){failed=true;}
  ok(failed&&html===root.innerHTML,'unsafe fallback or mutation');
 });
 await check('unexpected or reordered headings abort rather than guessing',()=>{
  for(const reverse of [false,true]){
   const root=raw();if(reverse)root.prepend(root.lastElementChild.previousElementSibling);else root.appendChild(document.createElement('h4'));
   let failed=false;try{a.mwbApplyHandoutQuestions(root,plan);}catch(e){failed=true;}ok(failed,'bad header mapping accepted');
  }
 });
 for(const fixture of fixtures)await check('CommonMark fixture: '+fixture.name,()=>{
  const plan=a.mwbHandoutQuestionPlan(fixture.source),projection=a.handoutPlan(plan.markdown,fixture.mode,fixture.options||{});
  ok(projection.markdown===fixture.projected,'fixture is stale');
  const root=document.createElement('div');root.innerHTML=fixture.html;a.mwbApplyHandoutQuestions(root,plan,'fixture.md');
  ok(root.querySelectorAll('.mwb-handout-question').length===fixture.count,'CommonMark question count');
  if(fixture.mode==='student')ok(!root.textContent.includes('SECRET'),'student answer leaked');
  if(fixture.ref)ok(root.querySelector('a')?.getAttribute('href')===fixture.ref,'document-wide reference lost');
 });
 await check('PDF serialization keeps strict policy and leaves original source intact',async()=>{
  const root=raw();root.className='mwb-print-document mwb-typography';a.mwbApplyHandoutQuestions(root,plan,'fixture.md');
  const before=root.innerHTML;
  const html=await a.exportHtml(root,'test','',document);
  ok(html.includes('data-mwb-question-policy="strict-h5"'),'PDF lost policy flag');
  ok(root.innerHTML===before,'export changed source DOM');
 });

 await check('production modal renders source-mapped H5 teacher groups and refreshes the range overlay',async()=>{
  HTMLElement.prototype.createEl=function(tag,opts={}){const e=document.createElement(tag);if(opts.cls)e.className=opts.cls;if(opts.text)e.textContent=opts.text;this.appendChild(e);return e;};
  HTMLElement.prototype.createDiv=function(opts){return this.createEl('div',opts);};
  HTMLElement.prototype.empty=function(){this.replaceChildren();};HTMLElement.prototype.setText=function(t){this.textContent=t;};
  const fixture=fixtures.find(f=>f.name==='interleaved-teacher');ok(fixture,'missing rendering fixture');
  host?.remove();host=document.createElement('div');host.className='mwb-modal';document.body.appendChild(host);
  const modal=new a.PreviewModal({}, {manifest:{version:'test'}},{path:'notes.md',basename:'notes'},fixture.source,null,{documentMode:true});
  modal.page=host.createDiv({cls:'mwb-page'});modal.rendered=modal.page.createDiv({cls:'mwb-typography mwb-print-document'});
  modal.status=host.createDiv({});modal.questionBoundaryPanel=host.createDiv({});
  const oldRender=mockObsidian.MarkdownRenderer.render;
  mockObsidian.MarkdownRenderer.render=async(_app,src,target)=>{ok(src===fixture.projected,'whole-document source changed');target.innerHTML=fixture.html;};
  try {
    await modal.renderMode('teacher');
    ok(modal.ready,modal.lastRenderError||'not ready');ok(modal.questionPlan.groups.length===2,'wrong production boundary count');
    ok(modal.previewPaginationReport?.strictQuestionPages.length===2,modal.status.textContent);
    ok(modal.rendered.querySelectorAll('[data-mwb-heading-token]').length===0,'markers were not removed');
    modal.showQuestionBounds=true;modal.updateQuestionBounds();
    ok(modal.previewPages.classList.contains('mwb-show-question-bounds'),'range overlay not enabled');
    ok(!modal.rendered.classList.contains('mwb-show-question-bounds'),'overlay contaminated PDF source');
    ok(modal.questionBoundaryPanel.textContent.includes('answer 2'),'source grouping diagnostics missing');
  }finally{mockObsidian.MarkdownRenderer.render=oldRender;modal.clearPaginatedPreview();}
 });
 const result=document.createElement('pre');result.id='mwb-test-results';result.textContent=JSON.stringify(out);document.body.appendChild(result);
}
