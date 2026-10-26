'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const js=fs.readFileSync(path.join(root,'main.js'),'utf8');
const css=JSON.parse(js.match(/module\.exports = \{typographyCss:("(?:\\.|[^"\\])*")\};/)[1]);
const cssAll=fs.readFileSync(path.join(root,'styles.css'),'utf8');
const source=js.slice(js.indexOf('function paginatePrintDocument('),js.indexOf('// Serialize a pure browser function.'));
const math=fs.readFileSync(path.join(__dirname,'fixtures/group-mathjax.svg.html'),'utf8');

// Browser tests use the real CSS box model, not synthetic constant heights.
// CHROME_PATH can be supplied on Windows/macOS; CI must not silently skip.
const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome','/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));
const obsidian={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},
 finishRenderMath:()=>Promise.resolve(),renderMath:()=>{throw Error('no DOM');}};
const context={module:{exports:{}},require:n=>n==='obsidian'?obsidian:require(n),Buffer,console};
vm.runInNewContext(js+'\nglobalThis.plan=handoutPlan;',context);

test('group pagination does not change answer/solution edition semantics or source Markdown',()=>{
 const src=['### 例一','求方程的根。','> [!answer]- 完整解答','> 因式分解得到两根。','> [!solution]- 思路','> 先观察结构。'].join('\n');
 const snapshot=src;
 assert.equal(context.plan(src,'student').solutionCount,1);
 assert.equal(context.plan(src,'student',{solutionSpaces:true}).solutionCount,2);
 assert.match(context.plan(src,'teacher').markdown,/先观察结构/);
 assert.doesNotMatch(context.plan(src,'teacher',{showSolution:false}).markdown,/先观察结构/);
 assert.equal(src,snapshot);
});

test('real Chromium: question-answer grouping, long steps and unchanged writing height',async t=>{
 if(!chrome){ if(process.env.CI)throw Error('CI requires Chrome/Chromium for grouping layout regression');t.skip('Set CHROME_PATH to run browser layout tests');return; }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-groups-'));
 const script=`${source}\n(${runCases.toString()})(${JSON.stringify(math)},${JSON.stringify(cssAll)});`;
 const html='<!doctype html><html><head><meta charset="utf-8"><style>'+css+'</style></head><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script></body></html>';
 try{
  const input=path.join(dir,'cases.html');fs.writeFileSync(input,html);
  const results=await runChromeDocument(chrome,input,path.join(dir,'profile'));
  for(const result of results) await t.test(result.name,()=>assert.equal(result.ok,true,result.error||''));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

// Chrome DevTools over anonymous pipes: no downloaded browser driver,
// no network service, no new plugin dependency. Also works in sandboxed CI.
const {runChromeDocument}=require('./helpers/run-chromium.cjs');

async function runCases(math,cssAll){
 const results=[];
 const p=(key,h,text=key)=>`<p data-key="${key}" style="min-height:${h}mm;margin:0">${text}</p>`;
 const heading=(text='例一',key='q1')=>`<h3 data-key="${key}" style="margin:0;height:10mm">${text}</h3>`;
 const answer=(steps,kind='answer')=>`<div class="callout" data-callout="${kind}"><div class="callout-title">${kind==='answer'?'完整解答':'解题思路'}</div><div class="callout-content">${steps.join('')}</div></div>`;
 const space=heights=>{const px=heights.map(v=>v*96/25.4);return `<div class="mwb-answer-space" data-mwb-space-px="${px.reduce((a,b)=>a+b,0)}">`+px.map((v,i)=>`<div class="mwb-answer-space-chunk" data-key="b${i}" style="height:${v}px"></div>`).join('')+'</div>';};
 const assert=(condition,message)=>{if(!condition)throw Error(message);};
 const filler=p('filler',220);
 let host;
 const layout=(html,preview=false)=>{
  if(host)host.remove();
  host=document.createElement('div');host.className=preview?'mwb-modal':'';
  const root=document.createElement('main');root.className='mwb-export-doc mwb-typography mwb-print-document'+(preview?' mwb-preview-pages':'');
  root.innerHTML=html;host.appendChild(root);document.body.appendChild(host);
  const original=[...root.querySelectorAll('[data-key]')].map(el=>({el,key:el.dataset.key,text:el.textContent}));
  const report=paginatePrintDocument(root,false,preview);
  const pages=[...root.querySelectorAll('.mwb-paper-body')];
  const pageOf=key=>pages.findIndex(pg=>[...pg.querySelectorAll('[data-key]')].some(el=>el.dataset.key===key));
  // No original leaf/paragraph nodes may be lost or reordered by grouping.
  const keys=pages.flatMap(pg=>[...pg.querySelectorAll('[data-key]')].map(el=>el.dataset.key));
  assert(JSON.stringify(keys)===JSON.stringify(original.map(x=>x.key)),'original keyed content lost, duplicated or reordered');
  return {report,pages,pageOf,root,original};
 };
 const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:e.stack||e.message});}};
 await document.fonts.ready;
 await check('short labeled handout: complete stem and answer move together',()=>{
  const r=layout(filler+heading()+p('s1',10)+p('s2',15)+answer([p('a1',28)]));
  assert(r.report.pages===2&&r.report.intactHandoutGroups===1,'not a two-page intact group');
  assert(r.pageOf('q1')===1&&r.pageOf('a1')===1&&r.pageOf('s1')===1,'question and answer separated');
 });
 await check('short folder-exam item keeps full answer with its question number',()=>{
  const r=layout(filler+'<section class="mwb-exam-question"><div class="mwb-exam-question-content">'+p('s',25,'<span class="mwb-question-index">1.</span>Question')+answer([p('a',30)])+'</div></section>');
  assert(r.report.intactQuestions===1&&r.pageOf('s')===r.pageOf('a'),'exam question split');
  assert(r.root.querySelectorAll('.mwb-question-index').length===1,'question number duplicated');
 });
 await check('long answer keeps first complete step and fills remaining current-page space',()=>{
  const r=layout(filler+heading()+p('s',25)+answer(Array.from({length:8},(_,i)=>p('a'+i,35))));
  assert(r.report.keptPromptAnswer===1,'no answer binding');
  assert(r.pageOf('s')===r.pageOf('a0'),'first step orphaned');
  assert(r.pageOf('a1')===r.pageOf('s'),'remaining steps unnecessarily moved as one large block');
  assert(r.pageOf('a7')>r.pageOf('s'),'long answer did not continue');
  assert([...r.root.querySelectorAll('.callout-title')].some(el=>el.textContent.includes('（续）')),'no continuation title');
 });
 await check('long optional solution never splits an otherwise short stem+answer',()=>{
  const r=layout(filler+heading()+p('s',25)+answer([p('a',25)])+answer(Array.from({length:6},(_,i)=>p('sol'+i,50)),'solution'));
  assert(r.pageOf('s')===r.pageOf('a'),'solution pushed answer away from question');
  assert(r.pageOf('sol5')>r.pageOf('a'),'long solution not continued');
 });
 await check('student: multi-paragraph stem binds first real chunk; total height unchanged',()=>{
  const r=layout(filler+heading()+p('s1',10)+p('s2',15)+space(Array(18).fill(20)));
  assert(r.pageOf('s1')===r.pageOf('b0')&&r.pageOf('s2')===r.pageOf('b0'),'student first space separated');
  assert(r.report.answerSpaceChunks===18&&Math.abs(r.report.answerSpaceDeltaPx)<0.01,'student writing space changed');
  assert(r.pageOf('b17')>r.pageOf('b0'),'long writing space not continued');
 });
 await check('adjacent examples never merge into a single question group',()=>{
  const r=layout(p('f',180)+heading()+p('s1',20)+answer([p('a1',20)])+heading('变式一','q2')+p('s2',20)+answer([p('a2',20)]));
  assert(r.report.handoutGroups===2,'wrong group count');
  assert(r.pageOf('q1')===0&&r.pageOf('q2')===1,'adjacent questions merged or moved together');
 });
 await check('list answers break between li steps and preserve numbering on continuation pages',()=>{
  const list='<ol start="3">'+Array.from({length:8},(_,i)=>`<li data-key="li${i}" style="height:40mm">step${i}</li>`).join('')+'</ol>';
  const r=layout(filler+heading()+p('s',25)+answer([list]));
  assert(r.pageOf('s')===r.pageOf('li0'),'first list step orphaned');
  let next=3;
  for(const ol of r.root.querySelectorAll('.callout-content > ol')){assert(ol.start===next,'continued list start wrong');next+=ol.children.length;}
  assert(next===11,'list items lost');
 });
 await check('a failed whole-stem binding restores order and records the relaxed constraint',()=>{
  const r=layout(heading()+p('s1',145)+p('s2',110)+answer([p('a1',30),p('a2',20)]));
  assert(r.report.relaxedGroupBindings.length===1,'oversized binding not reported');
  assert(r.pageOf('s2')===r.pageOf('a1'),'last prompt block not bound to answer');
 });
 await check('nearest unnumbered stem or single numbered item can bind its answer',()=>{
  const r=layout(filler+'<ol start="7"><li data-key="s" style="height:25mm">Question seven</li></ol>'+answer([p('a',30)]));
  assert(r.report.handoutGroups===1&&r.pageOf('s')===r.pageOf('a'),'numbered item unbound');
  assert(r.root.querySelector('ol').start===7,'question numbering changed');
 });
 await check('section boundaries and horizontal rules do not merge theory into the next question',()=>{
  const r=layout(p('f',190)+heading('知识点回顾','section')+p('theory',10)+'<hr>'+heading()+p('s',20)+answer([p('a',30)]));
  assert(r.report.handoutGroups===1&&r.pageOf('theory')===0&&r.pageOf('q1')===1,'incorrect question boundary');
 });
 await check('question subparts (1) and (2) remain in the same explicit question group',()=>{
  const r=layout(filler+heading()+p('p1',10,'（1）求根。')+p('p2',10,'（2）讨论参数。')+answer([p('a',30)]));
  assert(r.report.handoutGroups===1&&r.pageOf('p1')===r.pageOf('a'),'subparts split into new questions');
 });
 await check('MathJax SVG and leading sentence move as one first step without re-typesetting',()=>{
  const formula='<div data-key="math">'+math+'</div>';
  const r=layout(p('f',220)+heading()+p('s',25)+answer([p('lead',5,'由条件可得：'),formula,...Array.from({length:6},(_,i)=>p('step'+i,50))]));
  assert(r.pageOf('s')===r.pageOf('lead')&&r.pageOf('lead')===r.pageOf('math'),'math lead/formula separated');
  assert(r.original.find(x=>x.key==='math').el.isConnected,'original MathJax DOM was cloned away');
  assert(r.root.querySelectorAll('mjx-container').length===1,'math lost or duplicated');
 });
 await check('preview and PDF modes use identical group-to-page assignments',()=>{
  const fixture=filler+heading()+p('s',25)+answer(Array.from({length:8},(_,i)=>p('step'+i,35)));
  const a=layout(fixture);const expected=a.pages.map(pg=>[...pg.querySelectorAll('[data-key]')].map(el=>el.dataset.key));
  // Host stylesheet is present in the actual Obsidian modal, not in the PDF.
  const style=document.createElement('style');style.textContent=cssAll;document.head.appendChild(style);
  const b=layout(fixture,true);const actual=b.pages.map(pg=>[...pg.querySelectorAll('[data-key]')].map(el=>el.dataset.key));
  style.remove();assert(JSON.stringify(actual)===JSON.stringify(expected),'preview/PDF pagination mismatch');
 });
 await check('unsafe over-height first step reports an error rather than hiding/cropping content',()=>{
  let failure;try{layout(heading()+p('s',20)+answer(['<figure data-key="giant" style="height:400mm">unsplittable illustration</figure>']));}catch(e){failure=e.message;}
  assert(failure&&/超过 A4|不可拆分|溢出/.test(failure),'oversized first step silently cropped');
 });
 for (const tag of ['ol','ul']) for (const intro of ['按如下步骤解答：','Proceed as follows:','小节标题']) {
  await check('audit F03: '+tag+' with '+intro+' binds only first list item',()=>{
   const lead=intro==='小节标题'?'<h4 data-key="intro">'+intro+'</h4>':p('intro',5,intro);
   const list='<'+tag+(tag==='ol'?' start="3"':'')+'>'+Array.from({length:8},(_,i)=>`<li data-key="step${i}" ${tag==='ol'&&i===3?'value="11"':''} style="min-height:40mm">第 ${i+1} 步</li>`).join('')+'</'+tag+'>';
   const r=layout(filler+heading()+p('s',25)+answer([lead,list]));
   assert(r.pageOf('s')===r.pageOf('intro')&&r.pageOf('intro')===r.pageOf('step0'),'intro/first step separated');
   assert(r.pageOf('step7')>r.pageOf('step0'),'long list not continued');
   if(tag==='ol'){
    const values=[];
    for(const ol of r.root.querySelectorAll('.callout-content > ol')){
     let value=Number(ol.getAttribute('start')||1);
     for(const li of ol.children){if(li.hasAttribute('value'))value=Number(li.getAttribute('value'));values.push(value++);}
    }
    assert(JSON.stringify(values)==='[3,4,5,11,12,13,14,15]','explicit list numbering changed: '+JSON.stringify(values));
   }
  });
 }
 await check('audit F03: failed prefix binding restores intro and list before relaxed placement',()=>{
  const list='<ol start="4">'+Array.from({length:8},(_,i)=>`<li data-key="li${i}" style="height:40mm">item${i}</li>`).join('')+'</ol>';
  const r=layout(heading()+p('s1',140)+p('s2',110)+answer([p('intro',5,'先计算：'),list]));
  assert(r.report.relaxedGroupBindings.length===1,'expected relaxed binding');
  assert(r.pageOf('s2')===r.pageOf('intro')&&r.pageOf('intro')===r.pageOf('li0'),'last stem/first step lost binding');
 });
 await check('audit F03: natural long list with colon no longer fails',()=>{
  const list='<ol>'+Array.from({length:8},(_,i)=>`<li data-key="n${i}">${'利用条件逐步计算并整理代数表达式。'.repeat(20)}</li>`).join('')+'</ol>';
  const r=layout(heading()+p('s',10)+answer([p('intro',5,'按如下步骤解答：'),list]));
  assert(r.report.pages>=2&&r.pageOf('n7')>r.pageOf('n0'),'natural long list should continue');
 });
 if(host)host.remove();
 const result=document.createElement('pre');result.id='mwb-test-results';result.textContent=JSON.stringify(results);document.body.appendChild(result);
}
