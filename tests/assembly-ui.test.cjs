'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(value=>value&&fs.existsSync(value));

test('assembly native view preserves drafts, handles async scans, and recovers invalid title edits', {skip:!chrome}, async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-assembly-ui-'));
 const source=name=>JSON.stringify(fs.readFileSync(path.join(root,'src',name),'utf8')).replace(/</g,'\\u003c');
 const html=`<!doctype html><meta charset="utf-8"><div id="view"></div><script>
(async()=>{
 const checks=[];
 const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
 let fragmentApi;
 const load=source=>{const module={exports:{}};new Function('module','MWB_ASSEMBLY_FRAGMENTS',source)(module,fragmentApi);return module.exports;};
 fragmentApi=load(${source('assembly-fragments.cjs')});
 const core=load(${source('assembly-core.cjs')});
 const records=[{path:'知识/集合.md',kind:'knowledge',metadata:{id:'K1',title:'集合',subject:'高中数学',teaching_tier:['基础','培优'],knowledge_nodes:['集合表示法']},markdown:'# 集合\\n完整知识正文'},
 {path:'题库/第一题.md',kind:'question',metadata:{id:'Q1',subject:'高中数学',question_type:'choice',role:'训练',knowledge_nodes:['集合表示法','[[~]]'],methods:['[[分类讨论]]',[]]},markdown:'题干（!{B}）'},
 {path:'知识/集合辨析.md',kind:'knowledge',metadata:{id:'K2',title:'集合辨析',subject:'高中数学',knowledge_nodes:['集合表示法']},markdown:'# 集合辨析\\n补充知识正文'}];
 let index=core.buildIndex(records),saved=null,lastSavePath=null;const markdownFormats=[];
 const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),saveSettings:async()=>{},scan:async()=>index,
 listPlans:async()=>saved?[{path:'方案/test.json',title:saved.title}]:[],savePlan:async (plan,path)=>{lastSavePath=path;saved=JSON.parse(JSON.stringify(plan));return '方案/test.json';},loadPlan:async()=>saved,
 exportMarkdown:async(plan,index,options)=>{markdownFormats.push(options.questionFormat);return 'out/test.md';},preview:async()=>{},openSource:async()=>{}};
 let sessions=0,sessionWrites=0,sessionReads=0;
 service.createPlanSession=()=>{sessions++;return {
   savePlan:async(...args)=>{sessionWrites++;return service.savePlan(...args);},
   loadPlan:async(...args)=>{sessionReads++;return service.loadPlan(...args);}
 };};
 class Component {load(){} unload(){}}
 class ItemView extends Component {constructor(){super();this.contentEl=document.querySelector('#view');this.app={workspace:{requestSaveLayout(){}}};}addChild(c){c.load();}removeChild(c){c.unload();}}
 const View=load(${source('assembly-view.cjs')})({ItemView,Notice:class{},Component,core,service,renderMarkdown:async(md,container)=>{container.textContent=md;}});
 const view=new View({},{}),workspace=view.app.workspace;let whenReady;
 workspace.layoutReady=false;workspace.onLayoutReady=callback=>{whenReady=callback;};
 await view.onOpen();
 check(!view.index.items.length && typeof whenReady==='function','layout restore defers indexing until the vault inventory is ready');
 workspace.layoutReady=true;whenReady();
 const deadline=Date.now()+2000;
 while((view.indexState!=='ready'||view.scanBusy)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,5));
 check(view.index.items.length===3&&sessions===1,'scan configured sources with a per-view plan session');
 const tiers=[...view.filterSelects.tier.options].map(option=>option.value);
 check(tiers.includes('基础')&&tiers.includes('培优')&&!tiers.includes('基础 / 培优'),'each knowledge tier has its own filter option');
 check(![...view.filterSelects.knowledge.options].some(option=>option.value==='[[~]]'),'placeholder labels are absent from filter options');
 view.filters={kind:'knowledge',tier:'培优'};view.renderResults();check(view.results.textContent.includes('基础 / 培优')&&!view.results.textContent.includes('集合辨析'),'knowledge tier filtering and summary preserve multiple levels');
 view.filters={kind:'question',knowledge:'id:K2'};view.renderResults();check(view.results.textContent.includes('第一题')&&view.results.textContent.includes('关联知识：集合、集合辨析'),'a covered knowledge note filters related questions and shows both notes');
 await view.showItem(index.items[1]);check([...view.preview.querySelectorAll('button')].some(button=>button.textContent==='集合辨析'),'question preview offers every covering knowledge note');
 view.filters={kind:'question'};
 view.filters.method='分类讨论';view.renderResults();check(view.results.textContent.includes('第一题'),'wiki method filter');view.filters.method='';
 view.add(index.items[0]);view.add(index.items[1]);check(view.plan.entries.length===2,'mixed knowledge and question');
 view.setPlan(core.addSection(view.plan,'训练区'));
 const questionId=view.plan.entries[1].entryId;view.setPlan(core.moveEntry(view.plan,questionId,0));check(view.plan.entries[0].sourceId==='Q1','manual order retained');
 check(records[1].metadata.role==='训练','source role unchanged');
 await view.showItem(index.items[0]);check(view.preview.textContent.includes('完整知识正文'),'whole knowledge preview');
 const before=JSON.stringify(view.plan);view.add(index.items[0]);check(JSON.stringify(view.plan)===before,'duplicate rejected without changing plan');
 const click=async label=>{[...view.root.querySelectorAll('button')].find(b=>b.textContent===label).click();await new Promise(resolve=>setTimeout(resolve,10));};
 await click('保存讲义（引用题卡）');await click('保存展开副本');
 check(markdownFormats.join(',')==='reference,expanded'&&JSON.stringify(view.plan)===before,'reference and expanded actions preserve the draft');
 await click('保存方案');check(saved&&view.dirty===false&&sessionWrites===1,'explicit session save clears dirty');
 await click('另存方案');check(lastSavePath===undefined&&view.dirty===false&&view.planPath==='方案/test.json','save as creates a new plan without overwrite path');
 await click('预览编排');
 const questionTitle=view.arrangementList.querySelector('[data-entry-id="'+questionId+'"] [data-arrangement-field="title"]');questionTitle.value='本次标题';questionTitle.dispatchEvent(new Event('change'));check(view.dirty&&view.plan.entries.find(entry=>entry.entryId===questionId).title==='本次标题','inline entry edit marks dirty');
 await click('新建');check(view.plan.entries.length===3,'first new click preserves unsaved draft');
 await click('新建');check(view.plan.entries.length===0,'second new click confirms discard');
 view.savedSelect.value='方案/test.json';await view.loadSelectedPlan();check(view.plan.entries[0].sourceId==='Q1'&&sessionReads===1,'saved order restored through view session');
 records[1].markdown+='\\n修改后的正文';index=core.buildIndex(records);await view.updateReferences();check(core.resolvePlan(view.plan,index).issues.length===0,'explicit refresh accepts changed source');
 view.titleInput.value='';view.titleInput.dispatchEvent(new Event('input'));view.renderOutline();check(view.plan.title==='新讲义','empty plan title has valid fallback');
 const section=view.plan.entries.find(entry=>entry.kind==='section');const sectionTitle=view.arrangementList.querySelector('[data-entry-id="'+section.entryId+'"] [data-arrangement-field="title"]');sectionTitle.value='';sectionTitle.dispatchEvent(new Event('change'));check(view.plan.entries.find(entry=>entry.entryId===section.entryId).title==='训练区'&&view.arrangementList.querySelector('[data-entry-id="'+section.entryId+'"] [data-arrangement-field="title"]').value==='训练区','invalid section title preserves and restores old value');
 const requests=[];
 service.browseIndex=(_settings,options)=>new Promise((resolve,reject)=>requests.push({options,resolve,reject}));
 const stale=core.buildIndex([{path:'题库/旧题.md',kind:'question',metadata:{id:'old',title:'缓存题目',question_type:'choice'},markdown:'旧正文'}]);
 const issues=[{code:'read-error',path:'题库/失败题.md',retryable:true,message:'读取超时'},
   {code:'read-error',path:'题库/另一题.md',retryable:true,message:'文件暂不可用'},{code:'diagnostic',message:'其他提示'}];
 const a=view.scan(),first=requests.at(-1);
 first.options.onCachedIndex(stale);
 check(view.indexState==='cached' && view.results.textContent.includes('缓存题目') && view.statusEl.textContent.includes('正在核对来源'),'cached results are available for browsing while verification continues');
 const oldRow=view.results.querySelector('.mwb-assembly-result'),planBefore=view.plan;
 view.add(stale.items[0]);view.drawSelection();let wrote=false;await view.runAction('导出',()=>{wrote=true;});
 check(oldRow.querySelector('.mwb-assembly-add').disabled && view.plan===planBefore && !view.selection && !wrote,'snapshot cannot enter a plan, selection or export');
 first.options.onProgress({processed:2,total:5,failed:1});
 check(view.statusEl.textContent.includes('2 / 5') && view.statusEl.textContent.includes('失败 1') && view.results.querySelector('.mwb-assembly-result')===oldRow,'progress counts are shown without replacing the list');
 const b=view.scan(),second=requests.at(-1);
 first.options.onCachedIndex(stale);first.options.onProgress({processed:97,total:99,failed:4});
 check(!view.statusEl.textContent.includes('97 / 99') && view.index!==stale,'superseded callbacks cannot restore provisional results or progress');
 second.resolve({...index,issues});await b;first.resolve(stale);await a;
 check(view.index.items.length===3 && first.options.signal.aborted && !second.options.signal.aborted,'outdated scan cannot replace latest results');
 check(view.indexState==='ready' && view.statusEl.textContent.includes('3 份素材可用') && view.statusEl.textContent.includes('2 个文件读取失败'),'partial success reports available materials and failed files');
 const failures=view.scanFailures.querySelector('details');failures.open=true;await new Promise(resolve=>setTimeout(resolve,10));
 check(failures.textContent.includes('题库/失败题.md') && failures.textContent.includes('题库/另一题.md') && !view.tree.textContent.includes('题库/失败题.md'),'failure list displays retryable paths separately from other diagnostics');
 view.retryFilesButton.click();await new Promise(resolve=>setTimeout(resolve,10));const retry=requests.at(-1);
 check(requests.length===3 && view.scanBusy && view.retryFilesButton.disabled,'retry uses normal incremental browsing and cannot be submitted twice');
 retry.resolve(index);await new Promise(resolve=>setTimeout(resolve,10));
 check(!view.scanBusy && view.scanFailures.hidden && !view.retryFilesButton,'successful retry clears the failure list');
 const failing=view.scan(),bad=requests.at(-1);bad.options.onCachedIndex(stale);bad.reject(Error('校验失败'));await failing;
 check(view.index===index && !view.results.textContent.includes('缓存题目') && view.statusEl.textContent.includes('校验失败'),'failed verification restores last checked index');
 view.settings={...view.settings,questionRoots:['不同范围']};
 const changed=view.scan(),other=requests.at(-1);other.options.onCachedIndex(stale);other.reject(Error('新目录不可用'));await changed;
 check(view.index.items.length===0 && !view.results.textContent.includes('缓存题目'),'failed verification after directory switch cannot fall back to the old scope');
 const closingScan=view.scan(),closing=requests.at(-1);await view.onClose();
 closing.options.onProgress({processed:9,total:10,failed:0});closing.options.onCachedIndex(stale);closing.resolve(index);await closingScan;
 check(closing.options.signal.aborted && document.querySelector('#view').childElementCount===0,'close aborts active scan and releases view');
 const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(output);
})().catch(error=>{const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify({passed:false,error:String(error.stack||error)});document.body.appendChild(output);});
</script>`;
 try {
  const file=path.join(dir,'ui.html');fs.writeFileSync(file,html);
  const result=await runChromeDocument(chrome,file,path.join(dir,'profile'));
  assert.equal(result.passed,true,result.error);
  assert.ok(result.checks.length>=30);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
