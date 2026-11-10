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

// Browser interactions and geometry use the real view/core/CSS. This compact
// renderer seam models host ownership without claiming Obsidian visual QA.
const hostCss=`
:root { --text-normal:#202124; --text-muted:#60656c; --text-accent:#6252b4;
  --text-error:#b52f3a; --interactive-accent:#6d5bd0; --background-primary:#fff;
  --background-secondary:#f6f7f9; --background-modifier-border:#d8dce2;
  --radius-s:5px; --radius-m:9px; --font-small:13px; --font-smallest:12px;
  font:14px/1.45 system-ui,sans-serif; }
* { box-sizing:border-box; } body { margin:0; } #view { width:1400px; height:860px; }
button,input,select,textarea { font:inherit; color:inherit; }
button { border:1px solid var(--background-modifier-border); border-radius:5px;
  padding:5px 10px; background:#fff; } button:disabled { opacity:.5; }
input,select,textarea { border:1px solid #d8dce2; border-radius:4px; padding:5px 7px; }
summary { cursor:pointer; }
`;

async function browserCases(sources,css) {
  const results=[],fixtures=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(condition,message)=>{
    const deadline=Date.now()+2500;
    while(!condition()&&Date.now()<deadline)await pause(15);
    ok(condition(),message);
  };
  const check=async(name,fn)=>{
    const before=fixtures.length;
    try {await fn();results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:String(error.stack||error)});}
    finally {for(const f of fixtures.splice(before)){await f.view.onClose();f.finishAll();await pause();f.frame.remove();}}
  };
  const records=Array.from({length:12},(_,i)=>({path:'题库/章节/Q'+i+'.md',kind:'question',
    metadata:{id:'Q'+i,title:'题目 '+i,subject:'高中数学',question_type:'choice',role:'训练',knowledge_nodes:['集合']},
    markdown:'---\ntitle: 不应显示的元信息\n---\n第 '+i+' 道完整题干。\n\n$$\n\\frac{1}{x+1}+\\frac{1}{x-1}=2\n$$\n\n![图](../../图片/图.png)\n\n> [!answer]- 答案\n> 参考答案 '+i+'\n\n> [!solution]- 解析\n> 完整解析 '+i}));
  records.push({path:'知识/集合.md',kind:'knowledge',metadata:{id:'K1',title:'集合知识',subject:'高中数学',knowledge_nodes:['集合']},markdown:'# 集合知识\n\n完整知识正文'});
  const originalSources=JSON.stringify(records);
  const body=md=>md.replace(/^---\n[\s\S]*?\n---\n/,'');

  async function fixture({manual=false,deferred=false,empty=false,wideFormula=false,state=null}={}) {
    const frame=document.createElement('iframe');frame.style.cssText='width:1440px;height:920px;border:0;';
    const loaded=new Promise(resolve=>{frame.onload=resolve;});
    frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style><div id="view"></div>';
    document.body.append(frame);await loaded;
    const doc=frame.contentDocument,win=frame.contentWindow,host=doc.querySelector('#view'),observers=[];
    class Observer {
      constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();this.observed=[];this.disconnected=false;observers.push(this);}
      observe(node){this.targets.add(node);this.observed.push(node);}
      unobserve(node){this.targets.delete(node);}
      disconnect(){this.targets.clear();this.disconnected=true;}
      emit(nodes=[...this.targets]){this.callback(nodes.map(target=>({target,isIntersecting:true,intersectionRatio:1})),this);}
    }
    if(manual)win.IntersectionObserver=Observer;
    const load=source=>{const module={exports:{}};new win.Function('module',source)(module);return module.exports;};
    const core=load(sources.core),owners=[],calls=[],pending=[],opened=[],saved=[],previews=[],notices=[];
    let active=0,maxActive=0,index=core.buildIndex(records),savedPlan=null;
    const clone=value=>win.JSON.parse(JSON.stringify(value));
    class Component {
      constructor(){this.loaded=false;this.unloadCount=0;owners.push(this);}
      load(){this.loaded=true;}
      unload(){this.loaded=false;this.unloadCount++;}
    }
    class ItemView extends Component {
      constructor(){super();this.contentEl=host;this.children=new Set();this.app={workspace:{requestSaveLayout(){}}};}
      addChild(c){this.children.add(c);c.load();}
      removeChild(c){this.children.delete(c);c.unload();}
    }
    const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),scan:async()=>index,
      listPlans:async()=>savedPlan?[{path:'方案/编排.json',title:savedPlan.title}]:[],saveSettings:async()=>{},
      openSource:async source=>{opened.push(source);},
      savePlan:async plan=>{savedPlan=clone(plan);saved.push(savedPlan);return '方案/编排.json';},
      loadPlan:async()=>clone(savedPlan),exportMarkdown:async()=> '输出/编排.md',
      preview:async(plan,latest)=>{if(core.resolvePlan(plan,latest).issues.length)throw Error('来源需核对');previews.push(clone(plan));},
      beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
    const renderMarkdown=async(md,node,sourcePath,owner,signal)=>{
      const inline=node.classList.contains('mwb-assembly-snippet-body');
      const arrangement=!!node.closest('.mwb-assembly-arrangement-entry');
      const call={md,node,sourcePath,owner,signal,inline,arrangement};calls.push(call);
      if(inline){active++;maxActive=Math.max(maxActive,active);}
      try {
        if(inline&&deferred)await new Promise(resolve=>{call.finish=resolve;pending.push(call);});
        const paragraph=doc.createElement('p');paragraph.textContent=md;node.append(paragraph);
        if(arrangement){
          for(let i=0;i<14;i++){const p=doc.createElement('p');p.textContent='长题的完整条件和推导 '+i;node.append(p);}
          if(wideFormula){
            const math=doc.createElement('mjx-container');math.style.display='block';
            const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('width','1600');svg.setAttribute('height','60');
            math.append(svg);node.append(math);
          }
          for(const type of ['answer','solution']){const block=doc.createElement('div');block.className='callout';block.dataset.callout=type;block.textContent='完整的 '+type+' 内容';node.append(block);}
          const link=doc.createElement('a');link.href='#source';link.textContent='原文中的可访问链接';node.append(link);
        }
      } finally {if(inline)active--;}
    };
    const View=load(sources.view)({ItemView,Notice:class{constructor(text){notices.push(text);}},Component,core,service,renderMarkdown});
    const view=new View({},{});
    const f={frame,doc,win,host,view,core,service,owners,calls,observers,opened,saved,previews,notices,
      active:()=>active,maxActive:()=>maxActive,finishAll:()=>pending.splice(0).forEach(c=>c.finish()),
      setDeferred:value=>{deferred=value;},setIndex:value=>{index=value;},index:()=>index,clone};
    fixtures.push(f);if(state)await view.setState(clone(state),{});await view.onOpen();
    if(!empty&&!state){
      let plan=core.addSection(core.createPlan('预览编排测试'),'知识梳理');
      plan=core.addItem(plan,index.items.find(item=>item.id==='K1'));
      plan=core.addItem(plan,index.items.find(item=>item.id==='Q0'));
      plan=core.addSection(plan,'训练区');
      for(const id of ['Q1','Q2'])plan=core.addItem(plan,index.items.find(item=>item.id===id));
      view.setPlan(plan);
    }
    return f;
  }
  const button=(node,label)=>[...node.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
  const click=async(node,label)=>{const target=button(node,label);ok(target,'missing button '+label);target.click();await pause();return target;};
  const mode=async(f,value)=>{const target=f.view.root.querySelector('.mwb-assembly-mode-nav [data-mode="'+value+'"]');ok(target,'missing workspace mode '+value);target.click();await pause();};
  const cards=f=>[...f.view.arrangementList.querySelectorAll('.mwb-assembly-arrangement-entry')];
  const card=(f,id)=>cards(f).find(node=>node.dataset.entryId===id);
  const action=(f,id,key)=>{const target=card(f,id)?.querySelector('[data-arrangement-action="'+key+'"]');ok(target,'missing '+key+' action for '+id);return target;};
  const act=async(f,id,key)=>{const target=action(f,id,key);target.focus();target.click();await pause();};
  const entry=(f,id)=>f.view.plan.entries.find(row=>row.sourceId===id);
  const order=f=>f.view.plan.entries.map(row=>row.entryId).join(',');
  const domOrder=f=>cards(f).map(row=>row.dataset.entryId).join(',');
  const visible=(f,node)=>!!node?.getClientRects().length&&f.win.getComputedStyle(node).display!=='none';
  const emit=(f,node)=>{const targets=[...node.querySelectorAll('.mwb-assembly-snippet')];for(const observer of f.observers)observer.emit(targets.filter(target=>observer.targets.has(target)));};
  const fit=f=>{
    ok(f.host.scrollWidth<=f.host.clientWidth+1,'workspace overflows horizontally');
    ok(f.view.arrangementPane.scrollWidth<=f.view.arrangementPane.clientWidth+1,'arrangement pane overflows horizontally');
    ok(f.view.arrangementList.scrollWidth<=f.view.arrangementList.clientWidth+1,'arrangement list overflows horizontally');
  };
  const setField=async(f,id,key,value)=>{
    const editor=card(f,id).querySelector('.mwb-assembly-arrangement-edit');if(editor&&!editor.open){editor.open=true;await pause();}
    const field=card(f,id).querySelector('[data-arrangement-field="'+key+'"]');ok(field,'missing '+key+' field');
    field.focus();field.value=value;field.dispatchEvent(new f.win.Event('change',{bubbles:true}));await pause();return field;
  };

  await check('dedicated arrangement shows mixed plan entries in order and renders original content without opening a question',async()=>{
    const f=await fixture();await mode(f,'arrangement');
    ok(f.view.workspaceMode==='arrangement'&&visible(f,f.view.arrangementPane),'dedicated mode did not become visible');
    ok(!visible(f,f.view.center)&&domOrder(f)===order(f),'selection pane competes with arrangement or mixed entry order differs');
    await until(()=>f.calls.some(call=>call.arrangement),'arrangement content required an extra click');
    const call=f.calls.find(call=>call.arrangement),source=records.find(record=>record.path===call.sourcePath);
    ok(source&&call.md===body(source.markdown),'arrangement altered Markdown or used the wrong source path');
    ok(call.signal&&!call.signal.aborted,'arrangement renderer has no cancellation signal');
    ok(cards(f).length===6&&cards(f).filter(node=>node.dataset.sourceStatus==='section').length===2,'section and knowledge entries were omitted');
    ok(f.view.arrangementPane.getBoundingClientRect().width>=f.view.root.clientWidth-40,'dedicated preview does not use workspace width');fit(f);
  });

  await check('workspace round trips preserve filters, candidates, unsaved content and selection scroll',async()=>{
    const f=await fixture();f.view.filters.query='完整题干';f.view.searchInput.value=f.view.filters.query;f.view.renderResults();
    f.view.selectionCount='4';f.view.drawSelection();
    const beforePlan=JSON.stringify(f.view.plan),beforeFilters=JSON.stringify(f.view.filters),selection=f.view.selection;
    ok(selection.items.length===4,'candidate fixture did not generate');
    f.view.center.scrollTop=140;const top=f.view.center.scrollTop;
    await mode(f,'arrangement');await mode(f,'library');
    ok(JSON.stringify(f.view.plan)===beforePlan&&JSON.stringify(f.view.filters)===beforeFilters&&f.view.dirty,'mode switch changed draft or filters');
    ok(f.view.selection===selection&&f.view.selectionIsCurrent(),'mode switch discarded or invalidated candidate review');
    ok(Math.abs(f.view.center.scrollTop-top)<2,'returning to selection lost list scroll position');
    await mode(f,'arrangement');
    const deepId=entry(f,'Q2').entryId;
    f.view.arrangementList.dispatchEvent(new f.win.WheelEvent('wheel',{deltaY:100,bubbles:true}));
    card(f,deepId).scrollIntoView({block:'start'});
    await until(()=>card(f,deepId).querySelector('.mwb-assembly-snippet')?.dataset.previewState==='ready','deep question did not render');
    card(f,deepId).scrollIntoView({block:'start'});await pause();
    await mode(f,'library');await mode(f,'arrangement');
    await until(()=>card(f,deepId).querySelector('.mwb-assembly-snippet')?.dataset.previewState==='ready','returning to arrangement lost the deep question anchor');
    const anchor=action(f,deepId,'drag').getBoundingClientRect(),pane=f.view.arrangementList.getBoundingClientRect();
    ok(anchor.top>=pane.top-1&&anchor.bottom<=pane.bottom+1,'returning to arrangement restored a pixel offset but lost the question being viewed');
    const restored=await fixture({state:f.view.getState()});
    ok(restored.view.workspaceMode==='arrangement'&&visible(restored,restored.view.arrangementPane)&&!visible(restored,restored.view.columns),'saved workspace mode was not restored on initial render');
    ok(order(restored)===order(f)&&JSON.stringify(restored.view.filters)===beforeFilters&&restored.view.dirty,'workspace restoration changed the unsaved plan or filters');
    await until(()=>restored.calls.some(call=>call.arrangement),'restored arrangement did not start its preview observer');
  });

  await check('up, down and numeric placement move entry identities through mixed content and preserve action focus',async()=>{
    const f=await fixture();await mode(f,'arrangement');const id=entry(f,'Q0').entryId;
    await act(f,id,'down');ok(f.view.plan.entries[3].entryId===id&&domOrder(f)===order(f),'down did not move across the section item');
    ok(f.doc.activeElement?.closest('[data-entry-id]')?.dataset.entryId===id,'move lost focus to another question');
    await act(f,id,'up');ok(f.view.plan.entries[2].entryId===id,'up did not restore the source item');
    await setField(f,id,'position','2');await act(f,id,'move');
    ok(f.view.plan.entries[1].entryId===id,'numeric placement treated 2 as a question number rather than the second plan item');
    const before=order(f);await setField(f,id,'position','999');await act(f,id,'move');ok(order(f)===before,'out-of-range target changed the plan');
    await act(f,id,'up');
    ok(f.view.plan.entries[0].entryId===id&&action(f,id,'up').disabled,'boundary move did not reach the first item');
    ok(f.doc.activeElement===action(f,id,'drag'),'disabled boundary action did not move focus to the stable drag handle');
    await until(()=>card(f,id).querySelector('.mwb-assembly-snippet')?.dataset.previewState==='ready','moved question did not finish its preview');
    const control=action(f,id,'drag').getBoundingClientRect(),pane=f.view.arrangementList.getBoundingClientRect();
    ok(control.top>=pane.top-1&&control.bottom<=pane.bottom+1,'late preview growth scrolled the moved question out of view');
    ok(domOrder(f)===order(f),'rendered order diverged after placement');
  });

  await check('drag handles reorder by stable entry identity and detached controls cannot move another item',async()=>{
    const f=await fixture();await mode(f,'arrangement');const source=entry(f,'Q2').entryId,target=f.view.plan.entries[0].entryId;
    const transfer=new f.win.DataTransfer();
    action(f,source,'drag').dispatchEvent(new f.win.DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));
    ok(transfer.getData('application/x-mathsemble-entry')===source,'drag handle did not carry stable entry identity');
    card(f,target).dispatchEvent(new f.win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));await pause();
    ok(f.view.plan.entries[0].entryId===source&&domOrder(f)===order(f),'drop moved the wrong item');
    const q0=entry(f,'Q0').entryId,oldDown=action(f,q0,'down');
    await setField(f,source,'position','4');await act(f,source,'move');
    const before=order(f),at=f.view.plan.entries.findIndex(row=>row.entryId===q0);
    const expected=f.core.moveEntry(f.view.plan,q0,at+1).entries.map(row=>row.entryId).join(',');
    oldDown.click();await pause();ok(order(f)===before||order(f)===expected,'detached button used an obsolete list index');
    const removed=action(f,q0,'remove');await act(f,q0,'remove');const remaining=order(f);removed.click();await pause();
    ok(order(f)===remaining,'old remove control affected a replacement row');
  });

  await check('editing, original-source navigation and persistence operate on the same plan without mutating source records',async()=>{
    const f=await fixture();await mode(f,'arrangement');const id=entry(f,'Q1').entryId;
    await setField(f,id,'title','本次讲义标题');await setField(f,id,'role','例题');
    ok(entry(f,'Q1').title==='本次讲义标题'&&entry(f,'Q1').role==='例题','arrangement fields did not update the plan');
    ok(card(f,id).querySelector('.mwb-assembly-arrangement-edit').open,'editing closed the currently used controls');
    await act(f,id,'source');ok(f.opened.at(-1)==='题库/章节/Q1.md','source action opened the wrong file');
    await setField(f,id,'position','2');await act(f,id,'move');ok(f.view.plan.entries[1].entryId===id,'persistence fixture did not change source order');
    const sectionInput=f.view.arrangementSectionInput||[...f.view.arrangementPane.querySelectorAll('input')].find(node=>node.closest('label')?.textContent.includes('分区'));
    ok(sectionInput,'arrangement has no section title field');sectionInput.value='课堂小结';await click(f.view.arrangementPane,'添加分区');
    ok(f.view.plan.entries.at(-1).kind==='section'&&f.view.plan.entries.at(-1).title==='课堂小结','section was not appended to the same plan');
    await click(f.view.root,'保存方案');ok(f.saved.length===1&&JSON.stringify(f.saved[0])===JSON.stringify(f.view.plan)&&!f.view.dirty,'saving used a different or stale plan');
    await click(f.view.root,'A4 预览 / PDF');ok(f.previews.length===1&&JSON.stringify(f.previews[0])===JSON.stringify(f.view.plan),'A4 preview used stale arrangement order or fields');
    ok(JSON.stringify(records)===originalSources,'plan edit changed original source data');
    const rememberDeepPosition=async()=>{
      await mode(f,'library');
      f.view.center.dispatchEvent(new f.win.WheelEvent('wheel',{deltaY:100,bubbles:true}));
      f.view.center.scrollTop=f.view.center.scrollHeight;await pause(30);await mode(f,'arrangement');
      const deepId=entry(f,'Q2').entryId;
      f.view.arrangementList.dispatchEvent(new f.win.WheelEvent('wheel',{deltaY:100,bubbles:true}));
      card(f,deepId).scrollIntoView({block:'start'});
      await until(()=>card(f,deepId).querySelector('.mwb-assembly-snippet')?.dataset.previewState==='ready','deep position fixture did not render');
      card(f,deepId).scrollIntoView({block:'start'});await pause();await mode(f,'library');await mode(f,'arrangement');
      ok(f.view.workspaceScroll.library>0&&f.view.workspaceScroll.arrangement>0&&f.view.workspaceAnchors.library&&f.view.workspaceAnchors.arrangement,'navigation fixture did not capture both old reading positions');
    };
    const positionsCleared=label=>{
      ok(Object.values(f.view.workspaceScroll).every(value=>value===0)&&Object.values(f.view.workspaceAnchors).every(value=>value===null),label+' retained an old plan reading position');
      ok(f.view.arrangementList.scrollTop===0,label+' scrolled the new arrangement to an old question');
    };
    const savedOrder=order(f);await rememberDeepPosition();
    f.view.savedSelect.value='方案/编排.json';await click(f.view.root,'打开方案');positionsCleared('reopening the same saved plan');
    await rememberDeepPosition();await click(f.view.root,'新建');positionsCleared('new plan');
    ok(f.view.workspaceMode==='arrangement'&&!cards(f).length&&!f.view.plan.entries.length,'new plan left old arrangement cards visible');
    await mode(f,'library');await pause(30);ok(f.view.center.scrollTop===0,'new plan selection reused the previous source anchor after previews settled');
    await mode(f,'arrangement');
    f.view.savedSelect.value='方案/编排.json';await click(f.view.root,'打开方案');
    positionsCleared('loading a saved plan');
    ok(order(f)===savedOrder&&domOrder(f)===savedOrder&&!f.view.dirty,'loaded plan did not replace arrangement cards with the saved order');
  });

  await check('expanding content reveals complete callouts in place and collapsing restores the safe excerpt',async()=>{
    const f=await fixture({wideFormula:true});await mode(f,'arrangement');const id=entry(f,'Q0').entryId;
    card(f,id).scrollIntoView({block:'start'});await until(()=>card(f,id).querySelector('.callout'),'arrangement renderer did not populate the scrolled question');
    let shell=card(f,id).querySelector('.mwb-assembly-snippet'),answer=shell.querySelector('[data-callout="answer"]');
    ok(shell.inert&&!visible(f,answer),'excerpt unexpectedly exposes interactive answer content');
    const before=shell.getBoundingClientRect().height;await act(f,id,'expand');
    shell=card(f,id).querySelector('.mwb-assembly-snippet');answer=shell.querySelector('[data-callout="answer"]');
    ok(!shell.inert&&visible(f,answer)&&visible(f,shell.querySelector('[data-callout="solution"]')),'expanded content still hides answers or remains inert');
    ok(shell.getBoundingClientRect().height>before&&f.view.workspaceMode==='arrangement','expand did not reveal more content in the same workspace');
    fit(f);
    const svg=shell.querySelector('svg');let scrollable=svg.parentElement;
    while(scrollable&&scrollable!==f.view.arrangementPane&&(!['auto','scroll'].includes(f.win.getComputedStyle(scrollable).overflowX)||scrollable.scrollWidth<=scrollable.clientWidth+1))scrollable=scrollable.parentElement;
    ok(scrollable&&scrollable!==f.view.arrangementPane,'expanded wide formula cannot be read with local horizontal scrolling');
    scrollable.scrollLeft=scrollable.scrollWidth;ok(scrollable.scrollLeft>0,'wide formula scroll control does not reveal the remainder');
    await act(f,id,'expand');shell=card(f,id).querySelector('.mwb-assembly-snippet');
    ok(shell.inert&&!visible(f,shell.querySelector('[data-callout="answer"]')),'collapse did not restore excerpt behavior');
  });

  await check('source changes, missing files and conflicting identities remain explicit until references are checked',async()=>{
    const f=await fixture({manual:true});await mode(f,'arrangement');const fingerprints=new Map(f.view.plan.entries.map(row=>[row.entryId,row.sourceFingerprint]));
    const changed=records.filter(record=>record.metadata.id!=='Q1').map(record=>record.metadata.id==='Q0'?{...record,markdown:record.markdown+'\n新增条件'}:record);
    changed.push({...records.find(record=>record.metadata.id==='Q2'),path:'题库/冲突.md'});
    f.setIndex(f.core.buildIndex(changed));await f.view.scan();
    for(const [source,status] of [['Q0','changed'],['Q1','missing'],['Q2','conflict']]){
      const row=entry(f,source),node=card(f,row.entryId);
      ok(node.dataset.sourceStatus===status&&node.querySelector('.mwb-assembly-error'),'source status not exposed for '+source);
      ok(row.sourceFingerprint===fingerprints.get(row.entryId),'source issue was silently accepted');
      ok(!node.querySelector('.mwb-assembly-snippet'),'unconfirmed source rendered as current content for '+source);
    }
    await click(f.view.root,'A4 预览 / PDF');ok(f.previews.length===0&&f.view.statusEl.classList.contains('is-error'),'unresolved sources bypassed the preview guard');
    await click(f.view.arrangementPane,'更新引用');
    ok(card(f,entry(f,'Q0').entryId).dataset.sourceStatus==='ok','explicit reference update did not accept the changed source');
    ok(card(f,entry(f,'Q1').entryId).dataset.sourceStatus==='missing'&&card(f,entry(f,'Q2').entryId).dataset.sourceStatus==='conflict','reference update hid unresolved identity problems');
  });

  await check('switching workspaces and closing release arrangement tasks without resetting the shared concurrency limit',async()=>{
    const f=await fixture({manual:true,deferred:true});await mode(f,'arrangement');emit(f,f.view.arrangementList);await pause();
    const old=f.calls.filter(call=>call.arrangement),observer=f.observers.find(value=>value.options.root===f.view.arrangementList&&!value.disconnected);
    ok(old.length===2&&f.active()===2&&observer,'arrangement lacks its own observer root or bounded rendering');
    await mode(f,'library');ok(old.every(call=>call.signal.aborted&&!call.owner.loaded)&&observer.disconnected,'leaving arrangement retained render resources');
    observer.emit(observer.observed);emit(f,f.view.results);await pause();
    ok(f.calls.length===2&&f.maxActive()===2,'mode switching reset active work and exceeded the limit');
    await mode(f,'arrangement');emit(f,f.view.arrangementList);f.setDeferred(false);f.finishAll();
    await until(()=>f.calls.filter(call=>call.arrangement).length>2,'new arrangement did not resume after old jobs settled');
    ok(f.maxActive()===2&&old.every(call=>!call.node.isConnected&&!call.owner.loaded),'old mode work survived in replacement cards');
    f.setDeferred(true);await mode(f,'library');await mode(f,'arrangement');emit(f,f.view.arrangementList);await pause();
    const closing=f.calls.filter(call=>call.arrangement&&call.owner.loaded);ok(closing.length>=1,'close fixture has no current owners');
    const count=f.calls.length;await f.view.onClose();f.finishAll();await pause();
    ok(closing.every(call=>call.signal.aborted&&!call.owner.loaded)&&f.observers.every(value=>value.disconnected),'close retained preview owners or observers');
    ok(f.calls.length===count&&!f.host.childElementCount,'late work revived a closed workspace');
  });

  await check('empty, narrow and short arrangement panes keep all editing and recovery actions reachable',async()=>{
    const empty=await fixture({empty:true});await mode(empty,'arrangement');
    ok(!cards(empty).length&&empty.view.arrangementPane.textContent.includes('选题'),'empty arrangement has no selection guidance');
    const f=await fixture();await mode(f,'arrangement');f.host.style.width='420px';f.host.style.height='600px';await pause(30);fit(f);
    const id=entry(f,'Q2').entryId,node=card(f,id);node.scrollIntoView({block:'start'});await pause();
    const editor=node.querySelector('.mwb-assembly-arrangement-edit');editor.open=true;await pause();
    const move=action(f,id,'move');move.scrollIntoView({block:'nearest'});await pause();
    const rect=move.getBoundingClientRect(),pane=f.view.arrangementList.getBoundingClientRect();
    ok(rect.top>=pane.top-1&&rect.bottom<=pane.bottom+1,'numeric reorder control cannot be scrolled into the short pane');
    await setField(f,id,'position','1');await act(f,id,'move');
    ok(f.view.plan.entries[0].entryId===id&&domOrder(f)===order(f),'short pane cannot reorder a distant question');fit(f);
  });

  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('dedicated arrangement preview preserves plan identity, navigation and render ownership',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for arrangement preview checks');t.skip('Set CHROME_PATH');return;}
  const sources={core:fs.readFileSync(path.join(root,'src/assembly-core.cjs'),'utf8'),view:fs.readFileSync(path.join(root,'src/assembly-view.cjs'),'utf8')};
  const css=hostCss+fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-arrangement-preview-'));
  try {
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+','+JSON.stringify(css)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'arrangement.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
