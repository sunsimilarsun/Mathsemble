'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE || path.join(root,'src/plugin.js'),'utf8');
const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
const expose = '\nglobalThis.qa={PreviewModal,mwbUniqueDiagnosticLine,mwbCaptureDiagnosticMath,exportHtml,mwbHandoutQuestionPlan};';
const notices = [];
const obsidian = {Plugin:class{},Modal:class{},Notice:class{constructor(message){notices.push(message);}},MarkdownRenderer:{},MarkdownView:class{}};
const context = {module:{exports:{}},require:name => name==='obsidian'?obsidian:require(name),console,Buffer};
vm.runInNewContext(source+expose,context);
const {PreviewModal,mwbUniqueDiagnosticLine} = context.qa;

test('formula source mapping uses original lines and rejects ambiguous or literal matches',()=>{
  const cases = [
    ['---\ntitle: "$x+1$"\n---\n\n##### 题目\n结果 $x+1$。','x+1',6],
    ['前言\r\n$$\r\nx+1\r\n$$','x+1',3],
    ['> [!answer]\n> $x+1$','x+1',2],
    ['$$x+1$$\n$x+1$','x+1',null],
    ['```tex\n$x+1$\n```','x+1',null],
    ['`$x+1$`','x+1',null],
    ['<!-- $x+1$ -->','x+1',null],
    ['[label $x+1$](target)','x+1',null],
    ['\\$x+1$','x+1',null],
    ['$$x+1\\)','x+1',null],
    ['公式 $x+1$','x+2',null],
  ];
  for (const [markdown,tex,line] of cases) assert.equal(mwbUniqueDiagnosticLine(markdown,tex),line,markdown);
  assert.equal(mwbUniqueDiagnosticLine('前言\n![[missing.png]]','missing.png','image'),2);
  assert.equal(mwbUniqueDiagnosticLine('![[a.png]]\n![[a.png]]','a.png','image'),null);
});

function sourceFixture({disk,edited,reading=false}={}) {
  const markdown = '---\ntitle: source\n---\n##### 题目\n$x+1$';
  const file = {path:'questions/a.md',extension:'md'};
  const calls = [];
  let mode = reading ? 'preview' : 'source';
  const editor = {getValue:()=>edited ?? markdown,setCursor:position=>calls.push(['cursor',position]),
    scrollIntoView:(range,center)=>calls.push(['scroll',range,center]),focus:()=>calls.push(['focus'])};
  const leaf = {view:{file,editor,getMode:()=>mode},openFile:async (opened,options)=>{
    calls.push(['open',opened.path,options]);
    if(options.state?.mode==='source')mode='source';
  }};
  const modal = Object.assign(Object.create(PreviewModal.prototype),{file,markdown,generation:3,sourceRevision:2,
    closed:false,renderBusy:false,sourceDirty:false,sourceReadJob:null,close(){this.closed=true;calls.push(['close']);},
    app:{vault:{getAbstractFileByPath:()=>file,read:async()=>disk ?? markdown},
      workspace:{getLeavesOfType:()=>[leaf],getLeaf:()=>leaf,revealLeaf:async()=>calls.push(['reveal'])}}});
  const target = {path:file.path,line:5,generation:3,revision:2};
  return {modal,target,calls,leaf,editor,markdown};
}

test('source jump opens edit mode from Reading View, places cursor, scrolls and focuses without writes',async()=>{
  const {modal,target,calls,leaf} = sourceFixture({reading:true});
  await modal.navigateDiagnosticSource(target);
  assert.equal(leaf.view.getMode(),'source');
  assert.equal(calls.find(c=>c[0]==='open')[2].state.mode,'source');
  assert.equal(calls.find(c=>c[0]==='cursor')[1].line,4);
  assert.equal(calls.find(c=>c[0]==='scroll')[1].from.line,4);
  assert.equal(calls.find(c=>c[0]==='scroll')[2],true);
  assert.deepEqual(calls.slice(-2).map(c=>c[0]),['close','focus']);
});

test('source jump rejects saved changes, unsaved editors, deleted files and obsolete previews',async()=>{
  for (const [name,mutate] of [
    ['saved change',f=>{f.modal.app.vault.read=async()=>f.markdown+'\nchanged';}],
    ['unsaved editor',f=>{f.editor.getValue=()=>f.markdown+' pending';}],
    ['deleted file',f=>{f.modal.app.vault.getAbstractFileByPath=()=>null;}],
    ['new generation',f=>{f.modal.generation++;}],
    ['new source revision',f=>{f.modal.sourceRevision++;}],
    ['generation changes during read',f=>{f.modal.app.vault.read=async()=>{f.modal.generation++;return f.markdown;};}],
    ['another editor has pending changes',f=>{f.modal.app.workspace.getLeavesOfType=()=>[f.leaf,{view:{file:f.modal.file,editor:{getValue:()=>f.markdown+' pending'}}}];}],
  ]) {
    const fixture=sourceFixture();mutate(fixture);
    await assert.rejects(()=>fixture.modal.navigateDiagnosticSource(fixture.target),/已变化|移动或删除|尚未同步/,name);
    assert.equal(fixture.calls.some(c=>c[0]==='cursor'||c[0]==='scroll'||c[0]==='open'),false,name);
  }
});

test('a concurrent mode switch or failed edit-mode request never reports a hidden-editor line jump',async()=>{
  const fixture=sourceFixture();
  fixture.leaf.openFile=async()=>{fixture.modal.generation++;};
  await assert.rejects(()=>fixture.modal.navigateDiagnosticSource(fixture.target),/已变化/);
  assert.equal(fixture.calls.some(c=>c[0]==='cursor'),false);
  const reading=sourceFixture({reading:true});
  reading.leaf.openFile=async()=>{};
  await reading.modal.navigateDiagnosticSource(reading.target);
  assert.equal(reading.calls.some(c=>c[0]==='cursor'),false);
  assert.match(notices.at(-1),/当前视图不支持行定位/);
});

test('export failures offer file-level sources and dual workers transfer verified locations without DOM or TeX',async()=>{
  const {modal,target}=sourceFixture();
  let entries=modal.exportDiagnosticItems(new Error('isolated paginator error'));
  assert.equal(entries.length,1);
  assert.equal(modal.resolveDiagnosticTarget(entries[0].target).line,null);
  assert.equal(modal.resolveDiagnosticTarget(entries[0].target).path,target.path);
  modal.exam={items:[{file:{path:'a.md'},markdown:'a'},{file:{path:'b.md'},markdown:'b'}]};
  entries=modal.exportDiagnosticItems(new Error('isolated math timeout'));
  assert.deepEqual(entries.map(item=>item.target.path),['a.md','b.md']);
  assert.equal(entries.every(item=>item.target.line==null),true);
  const worker={ready:false,lastRenderError:'render failed',renderMode:async()=>{},cancelPreview(){},
    diagnosticItems:[{target:{}}],resolveDiagnosticTarget:()=>({path:'b.md',line:1,precision:'formula',node:{secret:'PRIVATE'}})};
  let disposed=false;
  modal.assertDualExport=()=>{};
  modal.createDualExportWorker=()=>({worker,dispose:()=>{disposed=true;}});
  const job={input:{},controller:new AbortController()};
  let failure;
  try{await modal.generateDualEdition(job,'teacher','test.pdf');}catch(error){failure=error;}
  assert.equal(disposed,true);
  assert.equal(failure.mwbDiagnosticLocations[0].path,'b.md');
  assert.equal(failure.mwbDiagnosticLocations[0].line,1);
  assert.equal(JSON.stringify(failure.mwbDiagnosticLocations).includes('PRIVATE'),false);
  entries=modal.exportDiagnosticItems(failure);
  assert.equal(entries.length,1);
  assert.equal(modal.resolveDiagnosticTarget(entries[0].target).line,1);
});

async function browserCases() {
  const results=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
  const decorate=node=>{
    node.setText=text=>{node.textContent=text;};node.empty=()=>node.replaceChildren();
    node.createEl=(tag,options={})=>{const child=decorate(document.createElement(tag));child.textContent=options.text||'';child.className=options.cls||'';node.append(child);return child;};
    node.createDiv=options=>node.createEl('div',options);return node;
  };
  function modal(markdown='##### 题目\n$x+1$') {
    const contentEl=decorate(document.createElement('section'));contentEl.className='mwb-modal';document.body.append(contentEl);
    const page=contentEl.createDiv({cls:'mwb-page'});
    const rendered=page.createEl('main',{cls:'mwb-typography mwb-print-document'});
    return Object.assign(Object.create(qa.PreviewModal.prototype),{contentEl,page,rendered,generation:2,sourceRevision:1,mode:'student',
      file:{path:'private/SOURCE_SECRET.md',extension:'md'},markdown,closed:false,renderBusy:false,
      diagnosticItems:[],diagnosticTargets:new Map(),diagnosticSequence:0,layout:'default',
      renderWarnings:[],status:contentEl.createDiv(),updateCompactStatus(){},
      diagnosticResourceSummary:contentEl.createDiv(),diagnosticResourceDetails:contentEl.createDiv()});
  }
  function math(parent,tex='x+1') {
    const wrapper=document.createElement('span');wrapper.className='math';wrapper.textContent=tex;parent.append(wrapper);
    qa.mwbCaptureDiagnosticMath(parent);
    wrapper.classList.add('is-loaded');wrapper.textContent='';
    const result=document.createElement('mjx-container');result.textContent='x + 1';wrapper.append(result);return result;
  }
  await check('identical formula text in different exam files resolves within its own source',()=>{
    const view=modal();
    view.exam={items:[{file:{path:'a.md'},markdown:'$x+1$'},
      {file:{path:'b.md'},markdown:'---\ntitle: b\n---\n\n$x+1$'}]};
    for(const [index,item] of view.exam.items.entries()){
      const q=view.rendered.createEl?view.rendered.createDiv():document.createElement('section');
      q.className='mwb-exam-question';q.dataset.mwbSourcePath=item.file.path;q.dataset.mwbQuestionId='q'+index;view.rendered.append(q);
      math(q);
    }
    view.recordDiagnosticIssues(view.rendered,['公式 #2超出打印版心']);
    const target=view.resolveDiagnosticTarget(view.diagnosticItems[0].target);
    ok(target.path==='b.md'&&target.line===5&&target.precision==='formula','formula mapped to wrong file/line');
    view.updateDiagnostics();
    ok(view.diagnosticResourceDetails.textContent.includes('原文第 5 行'),'precise line not shown');
    view.contentEl.remove();
  });
  await check('repeated formulas degrade to a labelled H5 block; student navigation adds no source secrets',async()=>{
    const view=modal('##### 标题 ?{ANSWER_SECRET}\n$x+1$\n$x+1$');
    view.rendered.innerHTML='<section data-mwb-question-id="q1" data-mwb-source-start="1" data-mwb-source-end="3"><h5>题目</h5><p>公开题干</p></section>';
    const q=view.rendered.firstElementChild,node=math(q);q.dataset.mwbSourcePath=view.file.path;
    view.recordDiagnosticIssues(view.rendered,['公式 #1超出打印版心，附近 ANSWER_SECRET']);
    const target=view.resolveDiagnosticTarget(view.diagnosticItems[0].target);
    ok(target.precision==='block'&&target.line===1,'repeated formula guessed a line');
    view.updateDiagnostics();
    ok(view.diagnosticResourceDetails.textContent.includes('所属块第 1 行'),'block fallback not explicit');
    ok(!/ANSWER_SECRET|SOURCE_SECRET/.test(view.diagnosticResourceDetails.outerHTML),'navigation leaked source text/path');
    node.classList.add('mwb-diagnostic-focus');
    const before=view.rendered.outerHTML;
    const html=await qa.exportHtml(view.rendered,'safe','',document);
    ok(!/data-mwb-diagnostic-id|mwb-diagnostic-focus|ANSWER_SECRET|SOURCE_SECRET|定位原文/.test(html),'export contains preview navigation metadata');
    ok(view.rendered.outerHTML===before,'export changed source DOM');view.contentEl.remove();
  });
  await check('projected answers never claim matching literal formulas in another block or the same file',()=>{
    const tex='\\underline{\\hspace{2.640em}}';
    const view=modal('##### 原公式\n$'+tex+'$\n\n##### 答案题\n$?{1}$');
    view.rendered.innerHTML='<section data-mwb-question-id="q2" data-mwb-source-start="4" data-mwb-source-end="5"><h5>答案题</h5></section>';
    const node=math(view.rendered.firstElementChild,tex);
    const target=view.resolveDiagnosticTarget(view.diagnosticTarget(node));
    ok(target.precision==='block'&&target.line===4,'projected blank claimed another question line');
    view.rendered.firstElementChild.removeAttribute('data-mwb-source-start');
    view.rendered.firstElementChild.removeAttribute('data-mwb-source-end');
    const fileTarget=view.resolveDiagnosticTarget(view.diagnosticTarget(node));
    ok(fileTarget.precision==='file'&&fileTarget.line===null,'unmapped projected blank claimed another source formula');
    view.contentEl.remove();
  });
  await check('broken image and malformed boundary retain original source lines',()=>{
    const view=modal('前言\n![[missing.png]]');
    const img=document.createElement('img');img.alt='missing.png';view.rendered.append(img);
    view.recordDiagnosticIssues(view.rendered,['存在未加载或加载失败的图片']);
    const target=view.resolveDiagnosticTarget(view.diagnosticItems[0].target);
    ok(target.line===2&&target.precision==='image','image source line not retained');
    view.markdown='#####题目 ?{BOUNDARY_SECRET}\n正文';view.questionPlan=qa.mwbHandoutQuestionPlan(view.markdown);
    view.questionBoundaryPanel=view.contentEl.createDiv();view.updateQuestionBoundaryReport();
    ok(view.questionBoundaryPanel.querySelector('button')?.textContent==='定位原文','boundary source navigation absent');
    ok(!view.questionBoundaryPanel.outerHTML.includes('BOUNDARY_SECRET'),'student boundary navigation leaked answer');
    view.contentEl.remove();
  });
  await check('long question pagination selects the matching later fragment and continuous fallback discards clone references',()=>{
    const view=modal();
    view.rendered.dataset.mwbQuestionPolicy='strict-h5';
    view.rendered.innerHTML='<section class="mwb-handout-question" data-mwb-question-id="long" data-mwb-source-start="1" data-mwb-source-end="2"><div class="mwb-exam-question-content"><h5>长题</h5>'+Array.from({length:80},(_,i)=>'<p>独立步骤 '+i+'：按顺序完成本题计算。</p>').join('')+'</div></section>';
    const node=math(view.rendered.querySelector('p:last-child'));
    view.recordDiagnosticIssues(view.rendered,['公式 #1超出打印版心']);
    const target=view.resolveDiagnosticTarget(view.diagnosticItems[0].target);
    const report=view.showPaginatedPreview();ok(report.pages>1,'fixture did not span pages');
    view.navigateDiagnosticPreview(target);
    let selected=view.previewPages.querySelector('.mwb-diagnostic-focus');
    ok(selected?.dataset.mwbDiagnosticId===target.id,'wrong clone selected');
    ok(selected.closest('.mwb-paper')!==view.previewPages.querySelector('.mwb-paper'),'jump selected first question fragment');
    view.clearPaginatedPreview();view.navigateDiagnosticPreview(target);
    ok(node.classList.contains('mwb-diagnostic-focus'),'fallback did not select continuous content');
    view.generation++;let rejected=false;try{view.navigateDiagnosticPreview(target);}catch{rejected=true;}
    ok(rejected,'old-generation target accepted');view.contentEl.remove();
  });
  await check('A4 overflow records an opaque source target and offers continuous preview navigation',()=>{
    const view=modal();const p=document.createElement('p');view.rendered.append(p);const node=math(p);
    node.style.cssText='display:inline-block;width:1400px;height:40px;white-space:nowrap';
    let error;try{view.showPaginatedPreview();}catch(caught){error=caught;}
    ok(error&&error.mwbDiagnosticTarget,'overflow error lost target');
    ok(!view.previewPages&&view.diagnosticItems.length===1,'failed clone retained or diagnostic absent');
    const target=view.resolveDiagnosticTarget(view.diagnosticItems[0].target);
    view.navigateDiagnosticPreview(target);ok(view.rendered.querySelector('.mwb-diagnostic-focus')?.contains(node),'overflow not located in continuous view');
    view.updateDiagnostics();ok(view.diagnosticResourceDetails.querySelectorAll('button').length===2,'overflow buttons missing');view.contentEl.remove();
  });
  await check('single and dual export failures render actionable file-level buttons without inventing lines',()=>{
    const view=modal();view.isCurrentExport=()=>true;view.selectDiagnosticsTab=()=>{};
    view.reportExportFailure({savedPath:null},new Error('isolated print failed'));
    ok(view.diagnosticResourceDetails.textContent.includes('文件级定位'),'single export fallback missing');
    ok(view.diagnosticResourceDetails.querySelector('button')?.textContent==='打开原文件','single export missing source button');
    view.dualReportEl=view.contentEl.createDiv();
    const report={summary:'双版失败',items:[{label:'学生版',state:'failed'}],error:'isolated print failed',diagnosticItems:view.exportDiagnosticItems(new Error('failed'))};
    view.lastDualExportReport=report;view.showDualExportReport(report);
    ok(view.dualReportEl.querySelector('button')?.textContent==='打开原文件','dual failure missing source button');
    ok(!view.dualReportEl.outerHTML.includes('SOURCE_SECRET'),'dual navigation leaked private source path');view.contentEl.remove();
  });
  await check('diagnostic buttons locate a paginated root and open the validated original editor line',async()=>{
    const view=modal('前言\n$x+1$');view.rendered.innerHTML='<p>公式</p>';math(view.rendered.firstElementChild);
    view.recordDiagnosticIssues(view.rendered,['MathJax/KaTeX 返回了公式错误']);
    view.showPaginatedPreview();view.updateDiagnostics();
    const buttons=[...view.diagnosticResourceDetails.querySelectorAll('button')];
    buttons.find(button=>button.textContent==='定位预览').click();await new Promise(resolve=>setTimeout(resolve,0));
    ok(view.previewPages.classList.contains('mwb-diagnostic-focus'),'generic root preview button failed');
    const calls=[];let mode='preview';
    const leaf={view:{file:view.file,getMode:()=>mode,editor:{getValue:()=>view.markdown,setCursor:position=>calls.push(['cursor',position.line]),
      scrollIntoView:range=>calls.push(['scroll',range.from.line]),focus(){}}},
      async openFile(file,options){mode=options.state.mode;}};
    view.app={vault:{getAbstractFileByPath:()=>view.file,read:async()=>view.markdown},
      workspace:{getLeavesOfType:()=>[leaf],revealLeaf:async()=>{}}};
    view.close=()=>{view.closed=true;};
    buttons.find(button=>button.textContent==='定位原文').click();await new Promise(resolve=>setTimeout(resolve,0));
    ok(mode==='source'&&calls.some(call=>call[0]==='cursor'&&call[1]===1)&&calls.some(call=>call[0]==='scroll'&&call[1]===1),'source button did not scroll visible editor');
    view.contentEl.remove();
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('real Chromium diagnostic navigation and export isolation',async t=>{
  const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium','/usr/bin/google-chrome'].find(candidate=>candidate&&fs.existsSync(candidate));
  if(!chrome){if(process.env.CI)throw Error('Chrome required');t.skip('Set CHROME_PATH');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'mwb-diagnostic-navigation-')),input=path.join(directory,'case.html');
  const stub='const module={exports:{}};const stub={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{}};function require(n){return n==="obsidian"?stub:{}};';
  const script='(async()=>{'+stub+'\n'+source+expose+'\nawait ('+browserCases.toString()+')();})().catch(error=>{const output=document.createElement("pre");output.id="mwb-test-results";output.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(output);});';
  fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
  const results=await runChromeDocument(chrome,input,path.join(directory,'profile'));
  for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
});
