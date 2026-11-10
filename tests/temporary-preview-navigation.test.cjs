'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const {compileMarkdown} = require('../src/assembly-markdown.cjs');
const {runChromeDocument} = require('./helpers/run-chromium.cjs');

const root = path.resolve(__dirname,'..');
const source = fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE || path.join(root,'src/plugin.js'),'utf8');
const css = fs.readFileSync(path.join(root,'styles.css'),'utf8');
const expose = '\nglobalThis.qa={PreviewModal,mwbHandoutQuestionPlan,mwbApplyHandoutQuestions,mwbCaptureDiagnosticMath,exportHtml};';
const obsidian = {Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{}};
const context = {module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),console,Buffer};
vm.runInNewContext(source+expose,context);

async function fixture() {
  const sources = [
    {path:'知识/SOURCE_K.md',kind:'knowledge',title:'知识梳理',markdown:'---\nid: K01\ntitle: 原知识\n---\n# 原标题\n\n## 定义\n$k+1$\n\n### 推导\n$k+2$\n\n#### 补充\n$k+3$'},
    {path:'题库/SOURCE_A.md',kind:'question',title:'例题甲',markdown:'---\nid: Q01\n---\n# 原题甲\n\n$x+1$\n\n$r+1$\n\n$r+1$'},
    {path:'题库/SOURCE_B.md',kind:'question',title:'例题乙',markdown:'---\nid: Q02\ntitle: 原题乙\nauthor: 老师\n---\n# 原题乙\n\n说明。\n\n$x+1$'},
  ];
  const entries = sources.map((item,i)=>({entryId:'e'+i,kind:item.kind,title:item.title,sourcePath:item.path,role:'example'}));
  entries.splice(1,0,{entryId:'section',kind:'section',title:'训练分区'});
  const resolved = entries.map(entry=>({entry,status:'ok',item:sources.find(item=>item.path===entry.sourcePath)}));
  let sourceMap;
  const markdown = await compileMarkdown({title:'临时讲义\n多行标题',course:{objectives:'目标一\n目标二'},entries},resolved,
    {onSourceMap:rows=>{sourceMap=rows;}});
  return {markdown,sourceMap,sources,virtualPath:'Mathsemble/讲义/__preview__.md'};
}

test('temporary diagnostic VM keeps generated boundary lines separate from original source lines',async()=>{
  const data=await fixture(),proto=context.qa.PreviewModal.prototype;
  const modal=Object.assign(Object.create(proto),{file:{path:data.virtualPath},markdown:data.markdown,
    assemblyPreview:data,sourceSnapshot:{entries:data.sources.map(item=>({record:{file:{path:item.path},markdown:item.markdown}}))}});
  const row=data.sourceMap.find(item=>item.path===data.sources[2].path);
  const target=modal.resolveDiagnosticTarget({path:data.virtualPath,line:row.startLine+2});
  assert.equal(target.path,data.sources[2].path);
  assert.equal(target.line,null);
  assert.equal(target.precision,'file');
  assert.equal(modal.diagnosticRecord(data.virtualPath),null);
  assert.deepEqual(Array.from(modal.diagnosticSourceItems(),item=>item.file.path),data.sources.map(item=>item.path));
  const verified=modal.resolveDiagnosticTarget({path:data.sources[2].path,line:10,precision:'formula'});
  assert.equal(verified.line,10);
  assert.equal(verified.precision,'formula');
  const fallback=modal.exportDiagnosticItems(new Error('isolated print failure'));
  assert.deepEqual(Array.from(fallback,item=>item.target.path),data.sources.map(item=>item.path));
  assert(fallback.every(item=>modal.resolveDiagnosticTarget(item.target).line===null));
});

async function browserCases(data) {
  const results=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
  const decorate=node=>{
    node.setText=text=>{node.textContent=text;};node.empty=()=>node.replaceChildren();
    node.createEl=(tag,options={})=>{const child=decorate(document.createElement(tag));child.textContent=options.text||'';child.className=options.cls||'';node.append(child);return child;};
    node.createDiv=options=>node.createEl('div',options);return node;
  };
  function modal() {
    const contentEl=decorate(document.createElement('section'));contentEl.className='mwb-modal';document.body.append(contentEl);
    const page=contentEl.createDiv({cls:'mwb-page'}),rendered=page.createEl('main',{cls:'mwb-typography mwb-print-document'});
    return Object.assign(Object.create(qa.PreviewModal.prototype),{contentEl,page,rendered,
      file:{path:data.virtualPath,basename:'临时讲义',extension:'md'},markdown:data.markdown,
      assemblyPreview:data,sourceSnapshot:{entries:data.sources.map(item=>({record:{file:{path:item.path},markdown:item.markdown}}))},
      documentMode:true,generatedHandout:true,generation:2,sourceRevision:1,mode:'document',
      closed:false,renderBusy:false,sourceDirty:false,sourceReadJob:null,layout:'default',
      diagnosticItems:[],diagnosticTargets:new Map(),diagnosticSequence:0,renderWarnings:[],
      status:contentEl.createDiv(),diagnosticResourceSummary:contentEl.createDiv(),diagnosticResourceDetails:contentEl.createDiv(),
      plugin:{manifest:{version:'0.2.4'}},app:{},renderQueue:Promise.resolve(),ready:false,silentRender:true,
      solutionOptions:{solutionSpaces:false,showSolution:true},metaSelections:{student:[],teacher:[]},
      updateCompactStatus(){this.updateDiagnostics();}});
  }
  function math(parent,tex) {
    const wrapper=document.createElement('span');wrapper.className='math';wrapper.textContent=tex;parent.append(wrapper);
    qa.mwbCaptureDiagnosticMath(parent);wrapper.classList.add('is-loaded');wrapper.textContent='';
    const result=document.createElement('mjx-container');result.textContent=tex;wrapper.append(result);return result;
  }
  // Use the compiler's actual Markdown and the plugin's heading projection.
  // This small renderer only substitutes Obsidian rendering for these fixtures.
  function renderProjection(view) {
    view.questionPlan=qa.mwbHandoutQuestionPlan(view.markdown);
    const nodes=new Map();let frontmatter=false;
    for(const [index,line] of view.questionPlan.markdown.split('\n').entries()) {
      if(index===0&&line==='---'){frontmatter=true;continue;}
      if(frontmatter){if(line==='---')frontmatter=false;continue;}
      if(!line.trim())continue;
      const heading=/^(#{1,6}) (.*)$/.exec(line);
      if(heading){const node=document.createElement('h'+heading[1].length);node.innerHTML=heading[2];view.rendered.append(node);continue;}
      const p=document.createElement('p');view.rendered.append(p);
      const formula=/^\$(.+)\$$/.exec(line);
      if(formula){const list=nodes.get(formula[1])||[];list.push(math(p,formula[1]));nodes.set(formula[1],list);}
      else p.textContent=line;
    }
    return nodes;
  }
  function originalLine(item,tex) {return item.markdown.split('\n').findIndex(line=>line==='$'+tex+'$')+1;}
  function sourcePaths(view) {return view.diagnosticItems.map(item=>view.resolveDiagnosticTarget(item.target).path).filter(Boolean);}
  function checkFallback(view,label) {
    const paths=sourcePaths(view);
    ok(data.sources.every(item=>paths.includes(item.path)),label+' did not include all real sources');
    ok(!paths.includes(data.virtualPath),label+' exposed a virtual diagnostic destination');
    view.updateDiagnostics();
    const buttons=[...view.diagnosticResourceDetails.querySelectorAll('button')];
    ok(buttons.filter(button=>button.textContent==='打开原文件').length===data.sources.length,label+' missing file buttons');
    ok(!view.diagnosticResourceDetails.outerHTML.includes('__preview__'),label+' leaked virtual path');
    return buttons;
  }

  await check('knowledge H3/H4 and question formulas map to their own original files and lines',()=>{
    const view=modal(),nodes=renderProjection(view);view.bindAssemblySourceNodes();
    ok(view.rendered.querySelectorAll('h3,h4').length>=3,'fixture lost internal knowledge headings');
    for(const tex of ['k+1','k+2','k+3']){
      const target=view.resolveDiagnosticTarget(view.diagnosticTarget(nodes.get(tex)[0]));
      ok(target.path===data.sources[0].path&&target.line===originalLine(data.sources[0],tex)&&target.precision==='formula',tex+' lost knowledge origin');
    }
    qa.mwbApplyHandoutQuestions(view.rendered,view.questionPlan,view.file.path);
    for(const [index,node] of nodes.get('x+1').entries()){
      const item=data.sources[index+1],target=view.resolveDiagnosticTarget(view.diagnosticTarget(node));
      ok(target.path===item.path&&target.line===originalLine(item,'x+1'),'identical formula mapped to another source');
    }
    const group=view.rendered.querySelectorAll('[data-mwb-question-id]')[0];
    const target=view.resolveDiagnosticTarget(view.diagnosticTarget(group));
    ok(target.path===data.sources[1].path&&target.line===null&&target.precision==='file','generated group start became original line');
    view.contentEl.remove();
  });
  await check('generated boundary lines only choose a file; repeated formulas and sections never invent original lines',()=>{
    const view=modal(),nodes=renderProjection(view);view.bindAssemblySourceNodes();
    const row=data.sourceMap.find(row=>row.path===data.sources[1].path);
    const formula=view.resolveDiagnosticTarget({...view.diagnosticTarget(nodes.get('x+1')[0],data.virtualPath),line:row.startLine+2});
    ok(formula.path===data.sources[1].path&&formula.line===originalLine(data.sources[1],'x+1'),'generated formula line was reused');
    const boundary=view.resolveDiagnosticTarget({path:data.virtualPath,line:row.startLine+2});
    ok(boundary.path===data.sources[1].path&&boundary.line===null&&boundary.precision==='file','boundary claimed original line');
    for(const node of nodes.get('r+1')){
      const target=view.resolveDiagnosticTarget(view.diagnosticTarget(node));
      ok(target.path===data.sources[1].path&&target.line===null&&target.precision==='file','ambiguous formula guessed original line');
    }
    const section=[...view.rendered.querySelectorAll('h2')].find(node=>node.textContent==='训练分区');
    ok(view.resolveDiagnosticTarget(view.diagnosticTarget(section)).path==='','section borrowed preceding knowledge origin');
    view.contentEl.remove();
  });
  for(const mutation of ['missing','duplicate','out-of-order']) await check(mutation+' heading token invalidates the entire source-node binding',()=>{
    const view=modal(),nodes=renderProjection(view),heads=[...view.rendered.querySelectorAll('h5')];
    if(mutation==='missing')heads[1].querySelector('[data-mwb-heading-token]').remove();
    if(mutation==='duplicate')heads[1].append(heads[1].querySelector('[data-mwb-heading-token]').cloneNode(true));
    if(mutation==='out-of-order')view.rendered.insertBefore(heads[1],heads[0]);
    view.bindAssemblySourceNodes();
    for(const node of [nodes.get('k+1')[0],...nodes.get('x+1')]){
      const target=view.resolveDiagnosticTarget(view.diagnosticTarget(node));
      ok(target.path===''&&target.line===null,'invalid heading map attributed a formula to '+target.path);
    }
    view.contentEl.remove();
  });
  await check('unknown A4 pagination failure exposes real source files without a virtual destination',()=>{
    const view=modal(),unmapped=document.createElement('div');
    // No eligible diagnostic element wraps this block, so the real paginator
    // must take its unknown-location path, not a fabricated target ID.
    unmapped.style.cssText='width:1400px;height:40px;white-space:nowrap';unmapped.textContent='不可拆分内容';view.rendered.append(unmapped);
    let failure;try{view.showPaginatedPreview();}catch(error){failure=error;}
    ok(failure&&!failure.mwbDiagnosticTarget,'fixture did not exercise unknown pagination failure');
    ok(!view.previewPages&&!view.contentEl.querySelector('.mwb-preview-pages'),'failed pagination clone survived');
    checkFallback(view,'pagination');view.contentEl.remove();
  });
  await check('export failure with a known root target still falls back to all real source files',()=>{
    const view=modal();renderProjection(view);view.bindAssemblySourceNodes();
    const target=view.diagnosticTarget(view.rendered),error=new Error('isolated root print failure');
    error.mwbDiagnosticTarget=target.id;
    view.diagnosticItems=view.exportDiagnosticItems(error);
    checkFallback(view,'root export');
    ok(view.diagnosticItems.every(item=>view.resolveDiagnosticTarget(item.target).line===null),'root export invented original line');
    view.contentEl.remove();
  });
  await check('generic root render failure retains preview navigation and adds clickable real-source file links',async()=>{
    const view=modal();
    view.renderDocumentSource=async()=>{renderProjection(view);};
    // Fault injection at the real render-guard boundary exercises renderMode's
    // catch with an existing root diagnostic, which has no exact source file.
    view.collectRenderWarnings=async(stage,root)=>{
      view.recordDiagnosticIssues(root,['MathJax/KaTeX 返回了公式错误']);throw Error('test generic render guard failure');
    };
    await view.renderMode('document');
    ok(!view.ready&&view.lastRenderError.includes('test generic render guard failure'),'render catch not reached');
    const buttons=checkFallback(view,'generic rendering');
    ok(buttons.some(button=>button.textContent==='定位预览'),'root preview location was lost');
    const opened=[];
    view.app={vault:{getAbstractFileByPath:path=>data.sources.find(item=>item.path===path)&&{path,extension:'md'},
      read:async file=>data.sources.find(item=>item.path===file.path).markdown},workspace:{getLeavesOfType:()=>[],
      getLeaf:()=>({view:{},openFile:async file=>opened.push(file.path)}),revealLeaf:async()=>{}}};
    view.close=()=>{view.closed=true;};
    buttons.filter(button=>button.textContent==='打开原文件')[2].click();await new Promise(resolve=>setTimeout(resolve,0));
    ok(opened.length===1&&opened[0]===data.sources[2].path,'file fallback opened a virtual or wrong source');
    view.contentEl.remove();
  });
  await check('temporary formula source button opens the original editor line and print output omits source metadata',async()=>{
    const view=modal(),nodes=renderProjection(view);view.bindAssemblySourceNodes();
    qa.mwbApplyHandoutQuestions(view.rendered,view.questionPlan,view.file.path);
    view.addDiagnosticItem('公式超出打印版心',nodes.get('x+1')[1]);view.updateDiagnostics();
    const buttons=[...view.diagnosticResourceDetails.querySelectorAll('button')];
    ok(buttons.some(button=>button.textContent==='定位原文')&&!buttons.some(button=>button.textContent.includes('讲义')),'temporary navigation uses saved-handout labels');
    const original=data.sources[2],opened=[],positions=[];
    const leaf={view:{file:{path:original.path},getMode:()=> 'source',editor:{getValue:()=>original.markdown,
      setCursor:position=>positions.push(position.line),scrollIntoView(){},focus(){}}},openFile:async file=>opened.push(file.path)};
    view.app={vault:{getAbstractFileByPath:path=>path===original.path?{path,extension:'md'}:null,read:async()=>original.markdown},
      workspace:{getLeavesOfType:()=>[],getLeaf:()=>leaf,revealLeaf:async()=>{}}};view.close=()=>{view.closed=true;};
    buttons.find(button=>button.textContent==='定位原文').click();await new Promise(resolve=>setTimeout(resolve,0));
    ok(opened[0]===original.path&&positions[0]===originalLine(original,'x+1')-1,'source button reused compiled line');
    const before=view.rendered.outerHTML,html=await qa.exportHtml(view.rendered,'safe','',document);
    ok(!/SOURCE_[KAB]|__preview__|data-mwb-source-path|data-mwb-heading-token|data-mwb-diagnostic-id/.test(html),'print HTML leaked diagnostic source metadata');
    ok(view.rendered.outerHTML===before,'print export mutated preview origin DOM');view.contentEl.remove();
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('real Chromium temporary preview source navigation and conservative fallbacks',async t=>{
  const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/chromium','/usr/bin/google-chrome'].find(candidate=>candidate&&fs.existsSync(candidate));
  if(!chrome){if(process.env.CI)throw Error('Chrome required');t.skip('Set CHROME_PATH');return;}
  const data=await fixture(),directory=fs.mkdtempSync(path.join(os.tmpdir(),'mwb-temporary-preview-navigation-')),input=path.join(directory,'case.html');
  const stub='const module={exports:{}};const stub={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:()=>Promise.resolve()};function require(n){return n==="obsidian"?stub:{}};';
  const script='(async()=>{'+stub+'\n'+source+expose+'\nawait ('+browserCases.toString()+')('+JSON.stringify(data)+');})().catch(error=>{const output=document.createElement("pre");output.id="mwb-test-results";output.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(output);});';
  fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>'+css+'</style><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
  try {
    const results=await runChromeDocument(chrome,input,path.join(directory,'profile'));
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
