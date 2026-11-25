'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
const hostCss=`:root{--text-normal:#202124;--text-muted:#60656c;--text-accent:#6252b4;--text-error:#b52f3a;
--interactive-accent:#6d5bd0;--background-primary:#fff;--background-secondary:#f6f7f9;--background-modifier-border:#d8dce2;
--radius-s:5px;--radius-m:9px;--font-small:13px;--font-smallest:12px;font:14px/1.45 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0}#view{width:1300px;height:820px}button,input,select,textarea{font:inherit;color:inherit}
button,input,select,textarea{padding:5px 7px;border:1px solid #d8dce2;border-radius:4px}button{background:#fff}`;

// Real Chromium DOM, native event dispatch, actual view/core/CSS. This verifies
// interaction and layout behavior without claiming native Obsidian rendering.
async function browserCases(sources,css) {
  const results=[],fixtures=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const equal=(actual,expected,message)=>ok(JSON.stringify(actual)===JSON.stringify(expected),message+'\nactual: '+JSON.stringify(actual)+'\nexpected: '+JSON.stringify(expected));
  const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
  const check=async(name,fn)=>{
    const before=fixtures.length;
    try{await fn();results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:String(error.stack||error)});}
    finally{for(const f of fixtures.splice(before)){await f.view.onClose();await pause();f.frame.remove();}}
  };
  const records=['P','Q1','K1','Q2','Q3','Q4','K2','Q5'].map(id=>({path:(id.startsWith('Q')?'题库/':'知识/')+id+'.md',
    kind:id.startsWith('Q')?'question':'knowledge',metadata:{id,title:'源-'+id,subject:'高中数学',question_type:'fill_blank',role:'训练'},
    markdown:'<!-- mathsemble:stem -->\n共同条件-'+id+'\n<!-- mathsemble:end -->\n\n<!-- mathsemble:part one -->\n正文-'+id+'，保留原始内容。\n<!-- mathsemble:end -->'}));
  const originalSources=JSON.stringify(records);
  async function fixture({empty=false,background=false}={}) {
    const frame=document.createElement('iframe');frame.style.cssText='width:1340px;height:860px;border:0';
    const loaded=new Promise(resolve=>{frame.onload=resolve;});frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style><div id="view"></div>';
    document.body.append(frame);await loaded;
    const win=frame.contentWindow,doc=frame.contentDocument,host=doc.querySelector('#view');
    if(background)host.style.display='none';
    win.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    let fragments;
    const load=source=>{const module={exports:{}};new win.Function('module','MWB_ASSEMBLY_FRAGMENTS',source)(module,fragments);return module.exports;};
    fragments=load(sources.fragments);
    const clone=value=>win.JSON.parse(JSON.stringify(value));
    const core=load(sources.core),compiler=load(sources.markdown),index=core.buildIndex(clone(records));
    const saved=[],previews=[],notices=[],opened=[];let stored=null;
    class Component{load(){}unload(){}}
    class ItemView extends Component{
      constructor(){super();this.contentEl=host;this.children=new Set();this.app={workspace:{requestSaveLayout(){},async revealLeaf(){}}};}
      addChild(child){this.children.add(child);child.load();}removeChild(child){this.children.delete(child);child.unload();}
    }
    const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),scan:async()=>index,
      listPlans:async()=>stored?[{path:'方案/排序.json',title:stored.title}]:[],saveSettings:async()=>{},
      savePlan:async plan=>{stored=clone(plan);saved.push(stored);return '方案/排序.json';},loadPlan:async()=>clone(stored),
      openSource:async source=>{opened.push(source);},exportMarkdown:async()=>{throw Error('ordering must not export Markdown');},
      preview:async(plan,latest,options)=>{
        ok(options.isCurrent(),'preview lost its current draft binding');
        const resolved=core.resolvePlan(plan,latest);ok(!resolved.issues.length,'sources no longer resolve');
        previews.push({plan:clone(plan),markdown:await compiler.compileMarkdown(plan,resolved.entries,{outputPath:'Mathsemble/讲义/__preview__.md'})});
      },beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
    const View=load(sources.view)({ItemView,Component,Notice:class{constructor(message){notices.push(message);}},core,service,
      renderMarkdown:async(markdown,node)=>{const p=doc.createElement('p');p.textContent=markdown;node.append(p);}});
    const leaf={},view=new View(leaf,{});leaf.view=view;
    const f={frame,win,doc,host,view,core,compiler,service,index,saved,previews,notices,opened,clone};fixtures.push(f);await view.onOpen();
    let plan=core.createPlan('目录排序验收');
    if(!empty)for(const id of ['P','A','Q1','K1','Q2','B','Q3','C','D','Q4','K2'])
      plan=['A','B','C','D'].includes(id)?core.addSection(plan,id):core.addItem(plan,index.items.find(item=>item.id===id));
    if(!empty)plan=core.updateEntry(plan,plan.entries.find(e=>e.sourceId==='Q1').entryId,clone({title:'本次题目标题',role:'例题'}));
    plan.course.teacher='李老师';plan.course.title='本次课题';plan.output.layout='trial';plan.output.mode='teacher';plan.output.spaceSettings.ratio=125;
    view.setPlan(core.validatePlan(plan));view.switchWorkspaceMode('arrangement');await pause();
    f.original=clone(view.plan);f.ids=new Map(view.plan.entries.map(e=>[e.kind==='section'?e.title:e.sourceId,e.entryId]));return f;
  }
  const labels=entries=>entries.map(e=>e.kind==='section'?e.title:e.sourceId);
  const sequence=f=>labels(f.view.plan.entries);
  const rows=f=>[...f.view.orderingList.querySelectorAll('.mwb-assembly-order-row')];
  const row=(f,key)=>rows(f).find(node=>node.dataset.entryId===f.ids.get(key));
  const previewRow=(f,key)=>[...f.view.arrangementList.children].find(node=>node.dataset.entryId===f.ids.get(key));
  const action=(f,key,name)=>{const node=row(f,key)?.querySelector('[data-order-action="'+name+'"]');ok(node,'missing '+key+' '+name);return node;};
  const act=async(f,key,name)=>{const node=action(f,key,name);node.focus();node.click();await pause();};
  const invariant=f=>{
    equal(f.view.plan.entries.map(e=>JSON.stringify(e)).sort(),f.original.entries.map(e=>JSON.stringify(e)).sort(),'move altered metadata or lost/duplicated an entry');
    equal(f.view.plan.course,f.original.course,'move changed course');equal(f.view.plan.output,f.original.output,'move changed output settings');
    equal(rows(f).map(node=>node.dataset.entryId),f.view.plan.entries.map(e=>e.entryId),'directory order differs from draft');
    equal([...f.view.arrangementList.querySelectorAll('.mwb-assembly-arrangement-entry')].map(node=>node.dataset.entryId),f.view.plan.entries.map(e=>e.entryId),'preview order differs from draft');
    ok(JSON.stringify(records)===originalSources,'original records were modified');ok(!f.core.resolvePlan(f.view.plan,f.index).issues.length,'move changed source references');
  };
  const beginDrag=(f,key)=>{
    const transfer=new f.win.DataTransfer();action(f,key,'drag').dispatchEvent(new f.win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));return transfer;
  };
  const drop=async(f,transfer,key,after=false)=>{
    const node=key===null?f.view.orderingList:row(f,key);ok(node,'missing target '+key);const rect=node.getBoundingClientRect();
    node.dispatchEvent(new f.win.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+20,clientY:after?rect.bottom-2:rect.top+2}));
    node.dispatchEvent(new f.win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+20,clientY:after?rect.bottom-2:rect.top+2}));await pause();
  };
  const position=async(f,key,value)=>{await act(f,key,'jump');f.view.orderingPosition.value=String(value);f.view.orderingMove.click();await pause();};

  await check('right directory mirrors mixed content with compact labels and independent scrolling',async()=>{
    const f=await fixture();ok(f.view.orderingSidebar&&f.view.orderingList,'missing ordering sidebar');invariant(f);
    const sidebar=f.view.orderingSidebar.getBoundingClientRect(),preview=f.view.arrangementList.getBoundingClientRect();
    ok(sidebar.left>=preview.right-1,'directory is not to the right of preview');ok(sidebar.width>=220&&sidebar.width<=340,'directory is not compact');
    ok(row(f,'Q1').textContent.includes('本次题目标题')&&row(f,'Q1').textContent.includes('例题'),'directory lost override title or role');
    ok(row(f,'K1').textContent.includes('知识'),'knowledge item not distinguished');ok(row(f,'A').textContent.includes('A'),'section title missing');
    ok(!f.view.orderingList.textContent.includes('正文-Q1'),'directory should not duplicate complete source previews');
    const before=f.view.arrangementList.scrollTop;f.view.orderingList.scrollTop=100;await pause();ok(f.view.arrangementList.scrollTop===before,'directory scroll moved preview');
  });

  await check('clicking directory locates the preview without modifying a saved plan',async()=>{
    const f=await fixture();await f.view.saveCurrentPlan();const plan=f.view.plan;
    await act(f,'K2','jump');ok(f.view.orderingSelectedId===f.ids.get('K2'),'click did not select directory entry');
    const list=f.view.arrangementList.getBoundingClientRect(),target=previewRow(f,'K2').getBoundingClientRect();
    ok(target.top<list.bottom&&target.bottom>list.top,'clicked item is outside preview viewport');
    ok(f.view.plan===plan&&!f.view.dirty,'navigation changed or dirtied a saved plan');ok(f.saved.length===1&&f.opened.length===0,'navigation wrote or opened a source');
  });

  await check('directory arrows preserve metadata and keep keyboard focus on the moved entry',async()=>{
    const f=await fixture();await act(f,'Q1','down');equal(sequence(f),['P','A','K1','Q1','Q2','B','Q3','C','D','Q4','K2'],'down moved wrong item');invariant(f);
    ok(f.doc.activeElement?.closest('.mwb-assembly-order-row')?.dataset.entryId===f.ids.get('Q1'),'move lost directory keyboard focus');
    await act(f,'Q1','up');equal(sequence(f),labels(f.original.entries),'up did not restore order');invariant(f);
    await act(f,'K1','down');equal(sequence(f),['P','A','Q1','Q2','K1','B','Q3','C','D','Q4','K2'],'knowledge did not move individually');invariant(f);
    action(f,'K1','jump').focus();action(f,'K1','jump').dispatchEvent(new f.win.KeyboardEvent('keydown',{key:'ArrowUp',altKey:true,bubbles:true,cancelable:true}));await pause();
    equal(sequence(f),labels(f.original.entries),'Alt + ArrowUp did not reorder the focused entry');invariant(f);
    ok(f.saved.length===0&&f.previews.length===0,'ordering implicitly saved or exported');
  });

  await check('section directory arrows move complete blocks and expose boundary states',async()=>{
    const f=await fixture();ok(action(f,'A','up').disabled,'first section up must be disabled');ok(action(f,'D','down').disabled,'last section down must be disabled');
    await act(f,'A','down');equal(sequence(f),['P','B','Q3','A','Q1','K1','Q2','C','D','Q4','K2'],'section arrow split its contents');invariant(f);
    await act(f,'A','up');equal(sequence(f),labels(f.original.entries),'section move did not restore order');
    await act(f,'C','down');equal(sequence(f),['P','A','Q1','K1','Q2','B','Q3','D','Q4','K2','C'],'empty section failed to move');invariant(f);
  });

  await check('position control uses item positions and section ranks, rejecting invalid values',async()=>{
    const f=await fixture();await position(f,'Q1',11);equal(sequence(f),['P','A','K1','Q2','B','Q3','C','D','Q4','K2','Q1'],'explicit position did not move item');invariant(f);
    await act(f,'A','jump');ok(f.view.orderingPosition.max==='4','section control must use section count');
    await position(f,'A',4);equal(sequence(f),['P','B','Q3','C','D','Q4','K2','Q1','A','K1','Q2'],'explicit section position split block');invariant(f);
    for(const invalid of ['',0,5,1.5]){const before=f.view.plan;await position(f,'A',invalid);ok(f.view.plan===before,'invalid section position changed draft');}
    await act(f,'Q1','jump');ok(f.view.orderingPosition.max==='11','question position uses question-only count instead of mixed item count');
  });

  await check('directory drag inserts before or after the indicated row without off-by-one errors',async()=>{
    const f=await fixture();await drop(f,beginDrag(f,'Q1'),'Q2',true);
    equal(sequence(f),['P','A','K1','Q2','Q1','B','Q3','C','D','Q4','K2'],'downward after insertion has wrong order');invariant(f);
    await drop(f,beginDrag(f,'Q1'),'K1',false);equal(sequence(f),labels(f.original.entries),'upward before insertion has wrong order');invariant(f);
    await drop(f,beginDrag(f,'K2'),'P',false);equal(sequence(f),['K2','P','A','Q1','K1','Q2','B','Q3','C','D','Q4'],'top insertion failed');invariant(f);
    await drop(f,beginDrag(f,'K2'),null);equal(sequence(f),labels(f.original.entries),'end whitespace insertion failed');invariant(f);
  });

  await check('directory section drag snaps to complete sections and own content is a no-op',async()=>{
    const f=await fixture();await drop(f,beginDrag(f,'A'),'Q4',true);
    equal(sequence(f),['P','B','Q3','C','D','Q4','K2','A','Q1','K1','Q2'],'section after insertion split contents');invariant(f);
    await drop(f,beginDrag(f,'A'),'B',false);equal(sequence(f),labels(f.original.entries),'section before insertion failed');invariant(f);
    await f.view.saveCurrentPlan();const before=f.view.plan;await drop(f,beginDrag(f,'A'),'K1',true);
    ok(f.view.plan===before&&!f.view.dirty,'dropping on own section contents changed saved draft');
  });

  await check('section drag indicators mark the actual whole-section insertion boundary',async()=>{
    const f=await fixture();await f.view.saveCurrentPlan();const plan=f.view.plan;
    const hover=(transfer,key,after)=>{
      const node=row(f,key),rect=node.getBoundingClientRect();
      node.dispatchEvent(new f.win.DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:transfer,clientX:rect.left+20,clientY:after?rect.bottom-2:rect.top+2}));
    };
    const indicators=()=>rows(f).filter(node=>node.classList.contains('is-drop-before')||node.classList.contains('is-drop-after'))
      .map(node=>({id:node.dataset.entryId,side:node.classList.contains('is-drop-after')?'after':'before'}));
    let transfer=beginDrag(f,'A');hover(transfer,'Q4',false);
    equal(indicators(),[{id:f.ids.get('D'),side:'before'}],'before hover inside a section should mark its header, not the hovered question');
    hover(transfer,'Q4',true);
    equal(indicators(),[{id:f.ids.get('K2'),side:'after'}],'after hover inside a section should mark its last member, not the hovered question');
    hover(transfer,'C',false);equal(indicators(),[{id:f.ids.get('C'),side:'before'}],'empty section before marker is misplaced');
    hover(transfer,'C',true);equal(indicators(),[{id:f.ids.get('C'),side:'after'}],'empty section after marker is misplaced');
    for(const after of [false,true]){hover(transfer,'K1',after);equal(indicators(),[],'own-section no-op must not advertise an insertion boundary');}
    transfer=beginDrag(f,'D');hover(transfer,'P',true);
    equal(indicators(),[{id:f.ids.get('A'),side:'before'}],'preamble hover should snap to the first section boundary');
    action(f,'D','drag').dispatchEvent(new f.win.DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));equal(indicators(),[],'drag end left a stale section marker');
    transfer=beginDrag(f,'Q1');hover(transfer,'Q4',false);
    equal(indicators(),[{id:f.ids.get('Q4'),side:'before'}],'individual question hover incorrectly snapped to a section boundary');
    hover(transfer,'Q4',true);equal(indicators(),[{id:f.ids.get('Q4'),side:'after'}],'individual question after marker is misplaced');
    ok(f.view.plan===plan&&!f.view.dirty,'hovering insertion markers changed a saved draft');
  });

  await check('external and stale directory gestures cannot reorder a changed draft',async()=>{
    const f=await fixture(),external=new f.win.DataTransfer();external.setData('application/x-mathsemble-entry',f.ids.get('Q1'));
    const before=f.view.plan;await drop(f,external,'Q4',true);ok(f.view.plan===before,'external payload moved an entry');
    const transfer=beginDrag(f,'Q1'),oldHandle=action(f,'Q1','drag'),oldDown=action(f,'Q1','down');
    f.view.setPlan(f.core.updateEntry(f.view.plan,f.ids.get('Q2'),f.clone({title:'拖动后修改'})));const current=f.view.plan;
    await drop(f,transfer,'Q4',true);ok(f.view.plan===current,'stale drag moved a changed draft');oldDown.click();await pause();ok(f.view.plan===current,'detached control changed the new draft');
    const detached=new f.win.DataTransfer();oldHandle.dispatchEvent(new f.win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:detached}));
    await drop(f,detached,'Q4',true);ok(f.view.plan===current,'detached drag handle authorized movement');
  });

  await check('busy, inactive and closed workspaces reject directory mutation',async()=>{
    const f=await fixture();
    for(const flag of ['actionBusy','scanBusy']){
      const before=f.view.plan,transfer=beginDrag(f,'Q1');f.view[flag]=true;f.view.updateSummary();
      ok(action(f,'Q1','down').disabled&&f.view.orderingMove.disabled,'busy directory controls remain enabled');
      await act(f,'Q1','down');await drop(f,transfer,'Q4',true);ok(f.view.plan===before,'busy directory mutated draft');f.view[flag]=false;f.view.updateSummary();
    }
    const before=f.view.plan,oldDown=action(f,'Q1','down');f.view.switchWorkspaceMode('library');oldDown.click();await pause();ok(f.view.plan===before,'inactive directory mutated draft');
    f.view.switchWorkspaceMode('arrangement');const oldButton=action(f,'Q1','down');await f.view.onClose();oldButton.click();await pause();ok(f.view.plan===before,'closed directory mutated draft');
  });

  await check('preview title and role edits synchronize directory labels immediately',async()=>{
    const f=await fixture(),preview=previewRow(f,'Q1');
    const title=preview.querySelector('[data-arrangement-field="title"]');title.value='更新后的卷内题名';title.dispatchEvent(new f.win.Event('change',{bubbles:true}));await pause();
    ok(row(f,'Q1').textContent.includes('更新后的卷内题名'),'directory title stayed stale');
    const role=previewRow(f,'Q1').querySelector('[data-arrangement-field="role"]');role.value='变式';role.dispatchEvent(new f.win.Event('change',{bubbles:true}));await pause();
    ok(row(f,'Q1').textContent.includes('变式'),'directory role stayed stale');ok(JSON.stringify(records)===originalSources,'title editing wrote source');
  });

  await check('collapse gives space back to preview and narrow panes remain usable',async()=>{
    const f=await fixture(),before=f.view.arrangementList.getBoundingClientRect().width;
    f.view.orderingToggle.click();await pause();ok(f.view.orderingToggle.getAttribute('aria-expanded')==='false','collapse lacks accessible state');
    ok(f.view.arrangementList.getBoundingClientRect().width>before+180,'collapse did not return sidebar space');
    f.view.orderingToggle.click();await pause();ok(f.view.orderingToggle.getAttribute('aria-expanded')==='true','expand lacks accessible state');
    f.host.style.width='560px';await pause(60);
    ok(f.view.root.scrollWidth<=f.view.root.clientWidth+2,'narrow workspace has horizontal overflow');
    ok(f.view.orderingToggle.getBoundingClientRect().width>0,'narrow workspace lost directory toggle');
    if(f.view.orderingSidebar.getClientRects().length){const side=f.view.orderingSidebar.getBoundingClientRect(),rootBounds=f.view.root.getBoundingClientRect();ok(side.left>=rootBounds.left-1&&side.right<=rootBounds.right+1,'narrow sidebar leaves viewport');}
    const beforePlan=f.view.plan;f.view.orderingToggle.click();await pause();ok(f.view.plan===beforePlan,'layout toggle changed draft');
  });

  await check('a background restored view defaults to an open directory when revealed on desktop',async()=>{
    const f=await fixture({background:true});ok(f.host.clientWidth===0,'background fixture was laid out visibly');
    ok(f.view.orderingSidebarOpen===true,'zero-width hidden host incorrectly initialized the desktop directory as collapsed');
    f.host.style.display='';await pause(40);
    ok(f.host.clientWidth>=760,'fixture did not return to desktop width');
    ok(!f.view.orderingSidebar.hidden&&f.view.orderingSidebar.getBoundingClientRect().width>0,'revealed desktop view hides its ordering directory');
    ok(f.view.orderingToggle.getAttribute('aria-expanded')==='true','revealed directory toggle has stale collapsed state');
    const side=f.view.orderingSidebar.getBoundingClientRect(),preview=f.view.arrangementList.getBoundingClientRect();
    ok(side.left>=preview.right-1,'revealed directory is not beside its preview');invariant(f);
  });

  await check('empty plans show a safe directory and selection recovers after removing an entry',async()=>{
    const empty=await fixture({empty:true});ok(rows(empty).length===0,'empty plan has phantom directory rows');ok(empty.view.orderingMove.disabled,'empty plan allows move');
    const f=await fixture();await act(f,'Q1','jump');f.view.setPlan(f.core.removeEntry(f.view.plan,f.ids.get('Q1')));await pause();
    ok(!row(f,'Q1'),'removed entry remains in directory');ok(!f.view.orderingSelectedId||f.view.plan.entries.some(e=>e.entryId===f.view.orderingSelectedId),'selection points at removed entry');
  });

  await check('directory order persists and generated Markdown contains only plan content',async()=>{
    const f=await fixture();await position(f,'A',4);await f.view.saveCurrentPlan();equal(f.saved[0],f.view.plan,'saving lost directory order');
    const button=[...f.view.root.querySelectorAll('button')].find(node=>node.textContent==='预览 A4');ok(button,'missing A4 action');button.click();await pause();
    ok(f.previews.length===1,'A4 did not receive reordered draft');equal(f.previews[0].plan,f.view.plan,'preview got stale draft');
    equal(f.previews[0].markdown.match(/^## [ABCD]$/gm),['## B','## C','## D','## A'],'compiled section order differs');
    ok(!/排序目录|mwb-assembly-order|移到第几/.test(f.previews[0].markdown),'directory UI leaked into output');
    const order=sequence(f);f.view.savedSelect.value='方案/排序.json';await f.view.loadSelectedPlan();equal(sequence(f),order,'reopening lost directory order');invariant(f);
  });

  if(sources.supportsV4!==false)await check('ordering preserves optional P2 scores and selected stable fragments',async()=>{
    const f=await fixture();let plan=f.core.updateEntry(f.view.plan,f.ids.get('Q1'),f.clone({fragmentRef:{kind:'question-part',ids:['one'],scores:{one:5}}}));
    plan=f.core.updateEntry(plan,f.ids.get('Q2'),f.clone({score:9.5}));f.view.setPlan(plan);f.original=f.clone(f.view.plan);
    await act(f,'Q1','down');await position(f,'A',4);invariant(f);
    ok(f.view.plan.schemaVersion===4&&f.view.plan.entries.find(e=>e.sourceId==='Q1').fragmentRef.ids[0]==='one','P2 fragment selection lost');
    ok(f.view.plan.entries.find(e=>e.sourceId==='Q2').score===9.5,'P2 score lost');
  });
  const out=document.createElement('pre');out.id='mwb-test-results';out.textContent=JSON.stringify(results);document.body.append(out);
}

test('right ordering directory keeps navigation, mixed order and source identity coherent',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome required for ordering sidebar checks');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries(['fragments','core','view','markdown'].map(name=>[name,fs.readFileSync(path.join(root,'src/assembly-'+name+'.cjs'),'utf8')]));
  const css=hostCss+fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-ordering-'));
  try{
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+','+JSON.stringify(css)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'ordering.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
