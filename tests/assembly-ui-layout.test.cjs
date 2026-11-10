'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(value=>value&&fs.existsSync(value));

// Functional layout checks only. This small host style models control sizing
// and theme tokens; it is not a screenshot or real Obsidian visual acceptance.
const hostCss=`
:root { --text-normal:#202124; --text-muted:#60656c; --text-faint:#8c939a;
  --text-accent:#6252b4; --text-error:#b52f3a; --text-on-accent:#fff;
  --interactive-accent:#6d5bd0; --interactive-hover:#efedf9;
  --background-primary:#fff; --background-secondary:#f6f7f9;
  --background-modifier-border:#d8dce2; --background-modifier-hover:#eceff3;
  --background-modifier-form-field:#fff; --radius-s:5px; --radius-m:9px;
  --font-small:13px; --font-smallest:12px; --font-ui-small:13px; --font-ui-smaller:12px;
  font:14px/1.45 system-ui,sans-serif; color:var(--text-normal); }
* { box-sizing:border-box; } body { margin:0; background:var(--background-primary); }
#view { width:1240px; height:860px; }
button,input,select,textarea { font:inherit; color:inherit; }
button { border:1px solid var(--background-modifier-border); border-radius:5px;
  padding:5px 10px; background:var(--background-primary); cursor:pointer; }
button:disabled { opacity:.5; cursor:default; }
input,select,textarea { border:1px solid var(--background-modifier-border); border-radius:4px; padding:5px 7px; }
summary { cursor:pointer; } .mod-cta { background:var(--interactive-accent); color:var(--text-on-accent); }
`;

async function browserCases(sources,css) {
  const results=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const load=source=>{const module={exports:{}};new Function('module',source)(module);return module.exports;};
  // An embedded wide document gives a fixed, wide viewport independently of
  // the headless runner's initial window. Only the plugin pane gets narrower.
  const frame=document.createElement('iframe');frame.style.cssText='width:1440px;height:920px;border:0;';
  const loaded=new Promise(resolve=>{frame.onload=resolve;});
  frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style><div id="view"></div>';
  document.body.append(frame);await loaded;
  const doc=frame.contentDocument,host=doc.querySelector('#view');
  const core=load(sources.core);
  const longTitle='长标题：'+('函数性质与分类讨论'.repeat(17));
  const records=Array.from({length:22},(_,i)=>({path:'题库/'+(i===0?'long_path_'.repeat(15):'')+'Q'+i+'.md',kind:'question',
    metadata:{id:'Q'+i,title:i===0?longTitle:'题目 '+i,subject:'高中数学',question_type:i===21?'proof':'choice',
      teaching_tier:i===21?'培优':'基础',role:'训练',difficulty:'1',knowledge_nodes:['集合'],methods:['分类讨论'],source:'练习册'},
    markdown:'题干 '+i+'：根据条件确定函数的取值。'}));
  records.push({path:'知识/集合.md',kind:'knowledge',metadata:{id:'K1',title:'集合',subject:'高中数学',knowledge_nodes:['集合']},markdown:'集合知识正文'});
  let index=core.buildIndex(records),saved=null;const opened=[];
  const scan=async()=>index;
  const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),scan,
    listPlans:async()=>saved?[{path:'方案/布局.json',title:saved.title}]:[],saveSettings:async()=>{},openSource:async source=>{opened.push(source);},
    savePlan:async plan=>{saved=JSON.parse(JSON.stringify(plan));return '方案/布局.json';},loadPlan:async()=>saved,
    exportMarkdown:async()=> 'out/布局.md',preview:async()=>{},
    beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
  class Component {load(){}unload(){this.unloaded=true;}}
  class ItemView extends Component {constructor(){super();this.contentEl=host;this.app={workspace:{requestSaveLayout(){}}};}addChild(c){c.load();}removeChild(c){c.unload();}}
  const View=load(sources.view)({ItemView,Notice:class{},Component,core,service,renderMarkdown:async(md,node)=>{node.textContent=md;}});
  const view=new View({},{});await view.onOpen();
  const button=(node,label)=>[...node.querySelectorAll('button')].find(value=>value.textContent.trim()===label);
  const click=async(node,label)=>{const target=button(node,label);ok(target,'Missing button '+label);target.click();await pause();return target;};
  const filter=(key,value)=>{view.filterSelects[key].value=value;view.filterSelects[key].dispatchEvent(new Event('change'));};
  const search=value=>{view.searchInput.value=value;view.searchInput.dispatchEvent(new Event('input'));};
  const isVisible=node=>!!node?.getClientRects().length&&doc.defaultView.getComputedStyle(node).visibility!=='hidden';
  const visiblePane=key=>view.root.querySelector('.mwb-assembly-pane-nav [data-pane="'+key+'"]');
  const fit=label=>{
    ok(host.scrollWidth<=host.clientWidth+1,label+': host has horizontal overflow '+host.scrollWidth+'/'+host.clientWidth);
    ok(view.root.scrollWidth<=view.root.clientWidth+1,label+': plugin has horizontal overflow '+view.root.scrollWidth+'/'+view.root.clientWidth);
    const bounds=view.root.getBoundingClientRect();
    for(const pane of [view.left,view.center,view.arrangementPane].filter(isVisible)) {
      const rect=pane.getBoundingClientRect();
      ok(rect.left>=bounds.left-1&&rect.right<=bounds.right+1,label+': '+pane.className+' escapes plugin width '+JSON.stringify({left:rect.left,right:rect.right,rootLeft:bounds.left,rootRight:bounds.right}));
      ok(pane.scrollWidth<=pane.clientWidth+1,label+': '+pane.className+' has horizontal overflow '+pane.scrollWidth+'/'+pane.clientWidth);
    }
  };

  await check('primary actions stay separate from secondary plan controls and all controls retain native semantics',async()=>{
    const menu=view.root.querySelector('details.mwb-assembly-plan-menu');
    ok(menu&&!menu.open,'secondary plan menu should start collapsed');
    ok(button(menu,'新建')&&button(menu,'另存方案')&&button(menu,'打开方案'),'secondary plan actions are absent');
    ok(!button(view.root,'保存方案').closest('.mwb-assembly-plan-menu'),'save should remain directly available');
    ok(!button(view.root,'预览 A4').closest('.mwb-assembly-plan-menu'),'preview should remain directly available');
    ok(!button(view.root,'保存方案').disabled,'initial source scan left saving disabled');
    for(const field of view.root.querySelectorAll('input:not([type="checkbox"]),select,textarea'))
      ok(field.labels?.length||field.getAttribute('aria-label'),'field has no accessible name');
    for(const control of view.root.querySelectorAll('button'))ok(control.type==='button'&&control.textContent.trim(),'button lost native semantics or name');
    menu.querySelector('summary').focus();ok(doc.activeElement===menu.querySelector('summary'),'plan menu summary cannot receive keyboard focus');
    ok(!view.root.querySelector('.mwb-assembly-right'),'selection still reserves a third outline column');
    ok(view.center.getBoundingClientRect().width>=900,'removing the outline did not return its width to question content');
    ok(view.root.querySelectorAll('.mwb-assembly-mode-nav').length===1,'workspace navigation is duplicated');
    fit('wide workspace');
  });

  await check('advanced criteria stay discoverable through filter chips and single-chip clearing preserves other criteria',async()=>{
    const advanced=view.root.querySelector('details.mwb-assembly-advanced-filters');
    ok(advanced&&!advanced.open,'advanced filters should start collapsed');
    advanced.querySelector('summary').click();ok(advanced.open,'native summary does not open advanced filters');
    filter('questionType','choice');filter('role','训练');search('题干');
    advanced.open=false;
    const chip=view.root.querySelector('.mwb-assembly-active-filters [data-filter-key="role"]');
    ok(chip&&isVisible(chip)&&chip.getAttribute('aria-label')?.includes('清除'),'active advanced criterion has no clearable chip');
    view.selectionCount='2';view.drawSelection();ok(view.selection.items.length===2,'test candidates missing');
    chip.focus();ok(doc.activeElement===chip,'filter chip cannot receive keyboard focus');chip.click();await pause();
    ok(!view.filters.role&&view.filters.questionType==='choice'&&view.filters.query==='题干','chip clearing discarded unrelated filters');
    ok(view.selection===null,'chip clearing did not invalidate candidates');
    ok(view.results.querySelectorAll('.mwb-assembly-result').length===21,'chip clearing did not update search results');
  });

  await check('selection and preview identify the same long-title source and preserve the added state',async()=>{
    await click(view.left,'清除筛选');
    const item=index.items.find(item=>item.id==='Q0');
    const title=[...view.results.querySelectorAll('.mwb-assembly-result-title')].find(node=>node.textContent===item.title);
    title.focus();view.center.scrollTop=120;const returnTop=view.center.scrollTop;
    title.click();await pause();
    const selected=view.results.querySelector('.mwb-assembly-result.is-selected');
    ok(selected?.querySelector('.mwb-assembly-result-title')?.getAttribute('aria-pressed')==='true','selected result has no accessible selected state');
    ok(view.selectedItem.path===item.path&&view.preview.textContent.includes(item.markdown),'selected result and preview disagree');
    await click(view.preview,'加入编排');
    const selectedAgain=view.results.querySelector('.mwb-assembly-result.is-selected');
    ok(selectedAgain&&button(selectedAgain,'已加入')?.disabled,'adding lost the selected or disabled added state');
    ok(view.root.querySelector('.mwb-assembly-save-state')?.textContent.includes('未保存'),'edited plan has no unsaved indication');
    fit('long title and source path');
    await click(view.preview,'收起预览');
    ok(!view.selectedItem&&isVisible(view.results),'closing preview did not restore the result list');
    ok(doc.activeElement?.closest('.mwb-assembly-result')?.dataset.sourcePath===item.path,'closing preview did not restore focus to the source title after adding redrew the list');
    ok(Math.abs(view.center.scrollTop-returnTop)<=1,'closing preview lost the result scroll position');
  });

  await check('selected-count entry leads to editable arrangement while move, source and remove stay available',async()=>{
    const q1=index.items.find(item=>item.id==='Q1');view.add(q1);
    const id=view.plan.entries.find(entry=>entry.sourceId==='Q0').entryId;
    const selected=view.root.querySelector('.mwb-assembly-selected-count');
    ok(selected&&isVisible(selected)&&selected.textContent.includes('2'),'selected question count is not visible');
    selected.focus();selected.click();await pause();
    ok(view.workspaceMode==='arrangement'&&isVisible(view.arrangementPane),'selected-count entry did not open the dedicated arrangement');
    const row=()=>view.arrangementList.querySelector('[data-entry-id="'+id+'"]');
    const title=row().querySelector('[data-arrangement-field="title"]');
    title.focus();ok(doc.activeElement===title,'inline title is not keyboard editable');
    title.value='本次短标题';title.dispatchEvent(new Event('change'));await pause();
    ok(view.plan.entries.find(entry=>entry.entryId===id).title==='本次短标题','inline title did not persist');
    const role=row().querySelector('[data-arrangement-field="role"]');role.focus();role.value='例题';role.dispatchEvent(new Event('change'));await pause();
    ok(view.plan.entries.find(entry=>entry.entryId===id).role==='例题','inline role did not persist');
    const action=async key=>{
      const target=row().querySelector('[data-arrangement-action="'+key+'"]'),menu=target?.closest('details');
      ok(target,'missing arrangement action '+key);
      if(menu&&!menu.open){menu.querySelector('summary').click();await pause();}
      target.focus();target.click();await pause();
    };
    await action('down');ok(view.plan.entries.at(-1).entryId===id,'down control did not move source');
    await action('up');ok(view.plan.entries[0].entryId===id,'up control did not move source');
    await action('source');ok(opened.at(-1)===records[0].path,'source menu opened the wrong note');
    await action('remove');ok(!view.plan.entries.some(entry=>entry.entryId===id),'remove control did not remove source');
    ok(records[0].metadata.role==='训练','UI edit changed source metadata');
    view.root.querySelector('.mwb-assembly-mode-nav [data-mode="library"]').click();await pause();
    await click(view.root,'保存方案');ok(!view.dirty&&view.root.querySelector('.mwb-assembly-save-state')?.textContent.includes('已保存'),'save indication did not update');
  });

  await check('narrow panes respond to their container inside a wide viewport without hiding any workflow',async()=>{
    ok(frame.contentWindow.innerWidth>=1400,'fixture viewport is not wide');
    for(const width of [640,420]) {
      host.style.width=width+'px';await pause();
      const nav=view.root.querySelector('.mwb-assembly-pane-nav');ok(isVisible(nav),'pane navigation absent at '+width);
      for(const [key,pane] of [['filters',view.left],['library',view.center]]) {
        const control=visiblePane(key);ok(isVisible(control),'missing pane button '+key);control.focus();
        ok(doc.activeElement===control,'pane button cannot receive keyboard focus');control.click();await pause();
        ok(view.root.dataset.activePane===key&&isVisible(pane),'pane did not activate '+key);
        ok(control.getAttribute('aria-pressed')==='true'||control.getAttribute('aria-selected')==='true','active pane has no accessible selected state');
        ok([view.left,view.center].filter(isVisible).length===1,'narrow workspace shows competing panes');
        fit(width+'px '+key);
      }
    }
    visiblePane('library').click();await pause();
    search('没有这道题');ok(!view.results.querySelector('.mwb-assembly-result'),'empty results fixture did not filter everything');
    const clear=button(view.results,'清除筛选');ok(clear&&isVisible(clear),'empty results have no locally reachable recovery');
    clear.click();await pause();ok(view.results.querySelector('.mwb-assembly-result'),'empty result recovery did not restore sources');
    host.style.width='1240px';await pause();
    ok([view.left,view.center].every(isVisible),'wide workspace did not restore both selection panes');fit('restored desktop');
  });

  await check('related questions in a narrow knowledge tree leave focused preview and reveal their filtered results',async()=>{
    try {
      host.style.width='420px';await pause();
      const knowledge=index.items.find(item=>item.kind==='knowledge');
      await view.showItem(knowledge);const owner=view.previewOwner;
      ok(view.preview.textContent.includes(knowledge.markdown),'knowledge title did not preview its full body');
      visiblePane('filters').click();view.tree.querySelector('details').open=true;
      const related=button(view.tree,'关联题');related.focus();related.click();await pause();
      ok(view.filters.kind==='question'&&view.filters.knowledge===knowledge.key,'related action did not keep the selected knowledge criterion');
      ok(view.root.dataset.activePane==='library'&&isVisible(view.results)&&view.resultsDisclosure.open,'related action failed to reveal the question results pane');
      ok(!view.center.classList.contains('is-previewing')&&!view.selectedItem&&owner.unloaded,'related action kept the previous knowledge preview active');
      ok(view.results.querySelectorAll('.mwb-assembly-result').length===22,'related knowledge action did not show its covered questions');
      ok(doc.activeElement===view.resultsSummary,'related action did not move keyboard focus to its results summary');
      fit('narrow related questions');
    } finally {host.style.width='1240px';await click(view.left,'清除筛选');}
  });

  await check('desktop and short containers keep result scrolling and pagination controls reachable',async()=>{
    try {
      for(const [width,height] of [[1240,860],[420,600]]) {
        host.style.width=width+'px';host.style.height=height+'px';visiblePane('library').click();
        search('');view.limit=10;view.renderResults();await pause();
        // Setting scrollTop alone is not a user gesture. Release the saved
        // reading anchor before simulating the wheel's normal scrolling.
        view.center.dispatchEvent(new frame.contentWindow.WheelEvent('wheel',{deltaY:500,bubbles:true}));
        ok(view.workspaceAnchors.library===null,'user scrolling retained the old reading anchor');
        view.results.scrollTop=view.results.scrollHeight;
        const more=button(view.results,'再显示 100 条');ok(more,'pagination fixture missing');
        for(let ancestor=view.results.parentElement;ancestor&&ancestor!==view.root;ancestor=ancestor.parentElement)
          if(['auto','scroll'].includes(doc.defaultView.getComputedStyle(ancestor).overflowY))ancestor.scrollTop=ancestor.scrollHeight;
        let stableFrames=0,previousGeometry='';const deadline=Date.now()+2500;
        while(stableFrames<2&&Date.now()<deadline){
          await new Promise(resolve=>frame.contentWindow.requestAnimationFrame(resolve));
          const bounds=view.center.getBoundingClientRect(),buttonBounds=more.getBoundingClientRect();
          const visiblePending=[...view.results.querySelectorAll('.mwb-assembly-snippet[data-preview-state="pending"]')].some(node=>{
            const rect=node.getBoundingClientRect();return rect.bottom>bounds.top&&rect.top<bounds.bottom;
          });
          const geometry=[view.center.scrollTop,view.center.scrollHeight,buttonBounds.top,buttonBounds.bottom].join(',');
          stableFrames=!visiblePending&&!view.inlinePreviewActive&&geometry===previousGeometry?stableFrames+1:0;
          previousGeometry=geometry;
        }
        ok(stableFrames===2,'visible previews and pagination geometry did not settle');
        const rect=more.getBoundingClientRect(),pane=view.center.getBoundingClientRect();
        const list=view.results.getBoundingClientRect(),visibleHeight=Math.min(list.bottom,pane.bottom)-Math.max(list.top,pane.top);
        ok(visibleHeight>=30,width+'px result scroll region remains clipped after scrolling: '+JSON.stringify({paneTop:pane.top,paneBottom:pane.bottom,listTop:list.top,listBottom:list.bottom}));
        ok(rect.top>=pane.top&&rect.bottom<=pane.bottom,width+'px pagination cannot be reached by scrolling the pane: '+JSON.stringify({buttonTop:rect.top,buttonBottom:rect.bottom,paneTop:pane.top,paneBottom:pane.bottom}));
        more.click();await pause();ok(view.results.querySelectorAll('.mwb-assembly-result').length===22,'reachable pagination did not reveal remaining results');
        fit(width+'x'+height+' container');
      }
    } finally {host.style.width='1240px';host.style.height='860px';view.limit=100;view.renderResults();await pause();}
  });

  await check('changing the requested count invalidates candidates without leaving an empty candidate panel or stealing input focus',async()=>{
    search('');view.selectionCount='2';view.renderSelection();await click(view.selectionPanel,'生成候选');
    ok(view.selection?.items.length===2&&view.selectionPanel.classList.contains('has-candidates')&&!view.resultsDisclosure.open,'candidate generation did not focus its review list');
    const count=view.selectionCountInput,apply=view.applySelectionButton,before=view.plan.entries.length;
    count.focus();count.value='3';count.dispatchEvent(new Event('input'));await pause();
    ok(view.selection===null&&view.selectionRows.children.length===0,'count editing kept stale candidates');
    ok(!view.selectionPanel.classList.contains('has-candidates')&&!view.candidatesShown&&view.resultsDisclosure.open,'count editing left an expanded empty candidate panel or collapsed results');
    ok(apply.hidden&&apply.disabled,'invalid candidates still expose an enabled confirmation action');
    ok(doc.activeElement===count&&view.selectionCountInput===count,'count editing replaced the focused input');
    ok(button(view.selectionPanel,'生成候选')&&view.selectionPanel.textContent.includes('按当前筛选随机选择'),'count editing left stale review labels');
    apply.click();await pause();ok(view.plan.entries.length===before,'stale native confirmation inserted candidates');
    await click(view.selectionPanel,'生成候选');ok(view.selection.items.length===3,'regeneration ignored the edited quantity');
    view.clearSelection();
  });

  await check('candidate confirmation stays separate from generation and busy feedback blocks repeat insertion',async()=>{
    search('');view.selectionCount='2';view.drawSelection();
    const before=view.plan.entries.length;
    ok(view.selection.items.length===2&&view.plan.entries.length===before,'generation unexpectedly changed the outline');
    const candidates=view.selection.items.map(item=>item.id).join(',');
    const firstCandidate=view.selection.items[0],candidateTitle=view.selectionRows.querySelector('.mwb-assembly-result-title');
    candidateTitle.focus();candidateTitle.click();await pause();
    ok(view.center.classList.contains('is-previewing'),'preview did not enter its focused content state');
    await click(view.preview,'收起预览');
    ok(view.selection.items.map(item=>item.id).join(',')===candidates,'closing preview discarded or redrew candidates');
    ok(doc.activeElement?.closest('.mwb-assembly-selection-row')?.dataset.sourcePath===firstCandidate.path,'closing candidate preview did not restore focus to its title');
    let release;service.scan=()=>new Promise(resolve=>{release=resolve;});
    const task=view.applySelection();await pause();
    ok(view.actionBusy&&view.applySelectionButton.disabled,'busy confirmation allows duplicate insertion');
    release(index);await task;service.scan=scan;
    ok(view.plan.entries.length===before+2&&!view.selection&&!view.actionBusy,'confirmed candidates not added as one batch');
    ok(view.selectionSummary.textContent.includes('已将 2 道题加入编排'),'successful confirmation lacks feedback');
    fit('candidate insertion');
  });

  await check('source rescans preserve unchanged preview ownership and release a changed source preview',async()=>{
    const original=index;
    try {
      const selected=index.items.find(item=>item.id==='Q2');await view.showItem(selected);
      const owner=view.previewOwner;
      index=core.buildIndex(records);await view.scan();
      ok(view.selectedItem?.path===selected.path&&view.previewOwner===owner&&!owner.unloaded,'unchanged source lost the selected preview or its render owner');
      ok(view.results.querySelector('.is-selected')?.dataset.sourcePath===selected.path,'rescan lost unchanged selection highlight');
      index=core.buildIndex(records.map(record=>record.metadata.id==='Q2'?{...record,markdown:record.markdown+' 新增条件'}:record));
      await view.scan();
      ok(view.selectedItem===null&&view.previewOwner===null&&owner.unloaded,'changed source did not clear selection and release its render owner');
      ok(!view.center.classList.contains('is-previewing')&&!view.results.querySelector('.is-selected'),'changed source left the interface in stale focused preview state');
      ok(view.preview.textContent.includes('来源已变化'),'changed source lacks a reselect explanation');
    } finally {index=original;await view.scan();}
  });

  await check('native primary buttons recover after scans, failures and an asynchronous save',async()=>{
    const primary=()=>['保存方案','预览 A4'].map(label=>button(view.root,label));
    ok(primary().every(node=>node&&!node.disabled),'populated idle plan has disabled primary actions');
    let release;service.scan=()=>new Promise(resolve=>{release=resolve;});
    const reading=view.scan();await pause();
    ok(view.scanBusy&&primary().every(node=>node.disabled),'reading did not disable primary actions');
    ok(view.sourceStateEl.textContent.includes('正在刷新素材'),'source state still claims a completed check while reading');
    release(index);await reading;
    ok(!view.scanBusy&&primary().every(node=>!node.disabled),'successful scan left primary actions disabled');
    service.scan=async()=>{throw Error('测试读取失败');};await view.scan();
    ok(!view.scanBusy&&primary().every(node=>!node.disabled),'failed scan left primary actions disabled');
    ok(view.sourceStateEl.textContent.includes('待核对')&&view.sourceStateEl.title.includes('刷新未完成'),'failed scan misleadingly reports sources as checked');
    service.scan=scan;
    const save=service.savePlan;
    service.savePlan=()=>new Promise(resolve=>{release=resolve;});
    button(view.root,'保存方案').click();await pause();
    ok(view.actionBusy&&primary().every(node=>node.disabled),'save did not disable primary actions');
    release('方案/异步.json');await pause();await pause();
    ok(!view.actionBusy&&primary().every(node=>!node.disabled),'completed save left primary actions disabled');
    service.savePlan=save;
  });

  await view.onClose();frame.remove();
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('assembly UI supports compact editing, filter recovery and container-width navigation',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for assembly UI checks');t.skip('Set CHROME_PATH');return;}
  const sources={core:fs.readFileSync(path.join(root,'src/assembly-core.cjs'),'utf8'),view:fs.readFileSync(path.join(root,'src/assembly-view.cjs'),'utf8')};
  const css=hostCss+fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-assembly-layout-'));
  try {
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+','+JSON.stringify(css)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'layout.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
