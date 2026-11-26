'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(value=>value&&fs.existsSync(value));

test('conditional selection UI keeps review separate from atomic insertion and rejects stale sources', {skip:!chrome},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-selection-ui-'));
 const source=name=>JSON.stringify(fs.readFileSync(path.join(root,'src',name),'utf8')).replace(/</g,'\\u003c');
 const html=`<!doctype html><meta charset="utf-8"><div id="view"></div><script>
(async()=>{
 const checks=[];
 const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
 let fragmentApi;
 const load=source=>{const module={exports:{}};new Function('module','MWB_ASSEMBLY_FRAGMENTS',source)(module,fragmentApi);return module.exports;};
 fragmentApi=load(${source('assembly-fragments.cjs')});
 const core=load(${source('assembly-core.cjs')});
 const topics=[
   {chapter:'集合',section:'表示',knowledge_nodes:['集合','列举法']},
   {chapter:'集合',section:'运算',knowledge_nodes:['集合','并集']},
   {chapter:'函数',section:'表示',knowledge_nodes:['集合','图象']},
   {chapter:'函数',section:'性质',knowledge_nodes:['集合','单调性']},
   {knowledge_nodes:['集合','综合证明']}
 ];
 const records=topics.map((topic,i)=>({path:'题库/Q'+i+'.md',kind:'question',metadata:{
   id:'Q'+i,subject:'高中数学',question_type:i===4?'proof':'choice',teaching_tier:'基础',...topic
 },markdown:'题干 '+i}));
 records.push({path:'知识/集合.md',kind:'knowledge',metadata:{id:'K1',subject:'高中数学',knowledge_nodes:['集合']},markdown:'知识正文'});
 let scans=0;
 const read=async()=>{scans++;return core.buildIndex(records);};
 const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),scan:read,
   listPlans:async()=>[],saveSettings:async()=>{},openSource:async()=>{},
   beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
 class Component {load(){}unload(){}}
 class ItemView extends Component {constructor(){super();this.contentEl=document.querySelector('#view');this.app={workspace:{requestSaveLayout(){}}};}addChild(c){c.load();}removeChild(c){c.unload();}}
 const View=load(${source('assembly-view.cjs')})({ItemView,Notice:class{},Component,core,service,renderMarkdown:async(md,node)=>{node.textContent=md;}});
 const view=new View({},{});
 await view.setState({plan:view.plan,filters:{kind:'question',chapter:'集合',section:'表示',knowledge:'列举法'}});
 await view.onOpen();
 const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
 const button=(root,label)=>[...root.querySelectorAll('button')].find(node=>node.textContent===label);
 const click=async(root,label)=>{const node=button(root,label);check(!!node,'button exists: '+label);node.click();await pause();};
 const count=value=>{view.selectionCountInput.focus();view.selectionCountInput.value=value;view.selectionCountInput.dispatchEvent(new Event('input'));};
 const filter=(key,value)=>{view.filterSelects[key].value=value;view.filterSelects[key].dispatchEvent(new Event('change'));};
 const options=key=>[...view.filterSelects[key].options].map(option=>option.value);
 const results=()=>[...view.results.querySelectorAll('[data-source-path]')].map(row=>row.dataset.sourcePath).sort().join();
 check(view.filterSelects.chapter.value==='集合'&&view.filterSelects.section.value==='表示'&&
   view.filterSelects.knowledge.value==='列举法'&&results()==='题库/Q0.md','restored scope survives rendering before the initial scan');
 await click(view.left,'清除筛选');
 filter('knowledge','综合证明');
 check(results()==='题库/Q4.md','global knowledge filtering includes questions without a chapter');
 filter('chapter','集合');
 check(!view.filters.knowledge&&results()==='题库/Q0.md,题库/Q1.md','chapter change drops an unavailable knowledge point and limits results');
 check(options('section').includes('表示')&&options('section').includes('运算')&&!options('section').includes('性质'),
   'available sections belong to the selected chapter');
 check(options('knowledge').includes('列举法')&&options('knowledge').includes('并集')&&!options('knowledge').includes('图象'),
   'chapter-level knowledge options cover both sections and exclude the other chapter');
 filter('knowledge','集合');filter('section','运算');
 check(view.filterSelects.knowledge.value==='集合'&&results()==='题库/Q1.md'&&
   options('knowledge').includes('并集')&&!options('knowledge').includes('列举法'),'section change keeps a matching knowledge point and restricts its alternatives');
 filter('knowledge','并集');view.drawSelection();
 check(view.selection.items.map(item=>item.id).join()==='Q1','conditional draw uses the selected chapter and section');
 filter('chapter','函数');
 check(!view.selection&&!view.filters.section&&!view.filters.knowledge&&results()==='题库/Q2.md,题库/Q3.md',
   'switching chapters clears stale section, knowledge and draw candidates');
 filter('section','表示');
 check(results()==='题库/Q2.md'&&options('knowledge').includes('图象')&&!options('knowledge').includes('列举法'),
   'same-named sections stay within the selected chapter');
 const sectionChip=view.activeFilters.querySelector('[data-filter-key="section"]');
 check(!!sectionChip,'the selected section has a removable filter chip');sectionChip.click();await pause();
 check(view.filters.chapter==='函数'&&!view.filters.section&&options('knowledge').includes('单调性')&&results()==='题库/Q2.md,题库/Q3.md',
   'clearing the section chip restores the chapter scope');
 await click(view.left,'清除筛选');
 filter('questionType','choice');count('3');
 await click(view.selectionPanel,'生成候选');
 check(view.selection.items.length===3&&view.plan.entries.length===0,'drawing candidates does not change current plan');
 const first=view.selection.items[0];
 button(view.selectionRows,'1. '+first.title).click();await pause();
 check(view.preview.textContent.includes(first.markdown),'candidate can be previewed before inclusion');
 await click(view.preview,'收起预览');
 check(view.selection.items.length===3,'returning from candidate preview preserves the review batch');
 await click(view.selectionPanel,'移出候选');
 check(view.selection.items.length===2&&view.plan.entries.length===0,'removing a candidate leaves the plan alone');
 const kept=view.selection.items.map(item=>item.id),scanBefore=scans;
 await view.applySelection();
 check(scans===scanBefore+1,'application reads current source files again');
 check(view.plan.entries.map(entry=>entry.sourceId).join()===kept.join()&&!view.selection,'only reviewed remaining candidates are appended');
 check(view.dirty&&view.selectionSummary.textContent.includes('已将 2 道题加入编排'),'insertion stays editable and reports success');
 count('10');view.drawSelection();
 check(view.selection.items.length===2&&view.selectionSummary.textContent.includes('只有 2 道'),'shortage is explicit and filter is not relaxed to proof questions');
 const planBefore=JSON.stringify(view.plan);view.drawSelection();
 check(JSON.stringify(view.plan)===planBefore,'redrawing never replaces the current arrangement');
 const input=view.selectionCountInput;count('1');
 check(!view.selection&&document.activeElement===input&&view.applySelectionButton.disabled,'editing quantity invalidates candidates without stealing input focus');
 view.drawSelection();filter('tier','基础');
 // Selecting the same criterion keeps the same constraints; changing one invalidates.
 view.searchInput.value='Q';view.searchInput.dispatchEvent(new Event('input'));
 check(!view.selection,'query changes invalidate candidates');
 view.drawSelection();filter('questionType','proof');
 check(!view.selection,'select filters invalidate candidates');
 view.drawSelection();await click(view.left,'清除筛选');
 check(!view.selection,'clear filters invalidates candidates');
 view.drawSelection();await click(view.tabs,'知识');
 check(!view.selection&&view.selectionPanel.hidden,'knowledge tab cannot apply old question candidates');
 await click(view.tree,'关联题');
 check(view.filters.knowledge==='id:K1'&&view.filters.kind==='question','knowledge-tree selection uses existing related-question filter');
 view.drawSelection();const manual=view.selection.items[0];view.add(manual);
 check(!view.selection,'manual plan edits invalidate candidates');
 view.selectionCount='1';view.drawSelection();
 const edited=view.selection.items[0];const oldPlan=JSON.stringify(view.plan);
 records.find(item=>item.path===edited.path).markdown+=' 已修改';
 await view.applySelection();
 check(JSON.stringify(view.plan)===oldPlan&&!view.selection,'changed source blocks the whole application without altering plan');
 check(view.statusEl.textContent.includes('来源或筛选条件已变化'),'source-change failure explains regeneration');
 view.drawSelection();let finishRead;service.scan=()=>new Promise(resolve=>{finishRead=resolve;});
 const inFlight=view.applySelection();await pause();
 check(view.actionBusy&&view.applySelectionButton.disabled,'pending source verification prevents duplicate application');
 view.searchInput.value='other';view.searchInput.dispatchEvent(new Event('input'));
 finishRead(core.buildIndex(records));await inFlight;
 check(JSON.stringify(view.plan)===oldPlan&&!view.selection&&!view.actionBusy,'filter edits during source verification block late insertion');
 service.scan=read;view.filters={kind:'question'};view.renderResults();view.drawSelection();
 const currentIndex=view.index,previousSettings=view.settings;
 service.scan=()=>new Promise(resolve=>{finishRead=resolve;});
 const changingDirectories=view.applySelection();await pause();
 // A directory save started before applySelection can finish while its source
 // verification is waiting. Its old-directory scan must not become current.
 view.settings={...previousSettings,questionRoots:['另一题库']};
 const oldDirectoryResults=core.buildIndex(records);
 finishRead(oldDirectoryResults);await changingDirectories;
 check(JSON.stringify(view.plan)===oldPlan&&!view.selection,'directory changes during source verification preserve the whole plan');
 check(view.index===currentIndex&&view.index!==oldDirectoryResults,'old-directory results cannot replace the current index');
 check(!view.actionBusy&&!button(view.selectionPanel,'生成候选').disabled&&view.applySelectionButton.disabled,'failed source verification restores generation controls without reviving stale candidates');
 view.settings=previousSettings;service.scan=read;view.renderResults();view.drawSelection();
 service.scan=()=>new Promise(resolve=>{finishRead=resolve;});
 const scanning=view.scan();
 check(!view.selection&&view.scanBusy&&button(view.selectionPanel,'生成候选').disabled,'ordinary scans immediately invalidate and disable candidate generation');
 finishRead(core.buildIndex(records));await scanning;
 check(!view.scanBusy&&!button(view.selectionPanel,'生成候选').disabled,'candidate controls recover after scan');
 service.scan=read;view.drawSelection();service.scan=()=>new Promise(resolve=>{finishRead=resolve;});
 const closing=view.applySelection();await pause();await view.onClose();finishRead(core.buildIndex(records));await closing;
 check(JSON.stringify(view.plan)===oldPlan&&document.querySelector('#view').childElementCount===0,'closing the view prevents delayed insertion');
 const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify({passed:true,checks});document.body.appendChild(output);
})().catch(error=>{const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify({passed:false,error:String(error.stack||error)});document.body.appendChild(output);});
</script>`;
 try {
  const file=path.join(dir,'selection.html');fs.writeFileSync(file,html);
  const result=await runChromeDocument(chrome,file,path.join(dir,'profile'));
  assert.equal(result.passed,true,result.error);
  assert.ok(result.checks.length>=25);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
