'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(value=>value&&fs.existsSync(value));
const hostCss=`:root{--text-normal:#202124;--text-muted:#60656c;--text-accent:#6252b4;--text-error:#b52f3a;
--interactive-accent:#6d5bd0;--background-primary:#fff;--background-secondary:#f6f7f9;--background-modifier-border:#d8dce2;
--radius-s:5px;--radius-m:9px;--font-small:13px;--font-smallest:12px;font:14px/1.45 system-ui,sans-serif}
*{box-sizing:border-box}body{margin:0}#view{width:1300px;height:820px}button,input,select,textarea{font:inherit;color:inherit}
button,input,select,textarea{padding:5px 7px;border:1px solid #d8dce2;border-radius:4px}button{background:#fff}`;

async function browserCases(sources,css) {
  const results=[],fixtures=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const equal=(actual,expected,message)=>ok(JSON.stringify(actual)===JSON.stringify(expected),message+'\nactual: '+JSON.stringify(actual)+'\nexpected: '+JSON.stringify(expected));
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const check=async(name,fn)=>{
    const before=fixtures.length;
    try{await fn();results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:String(error.stack||error)});}
    finally{for(const f of fixtures.splice(before)){await f.view.onClose();await pause();f.frame.remove();}}
  };
  const records=['P','Q1','K1','Q2','Q3','Q4','K2','Q5'].map(id=>({path:(id.startsWith('Q')?'题库/':'知识/')+id+'.md',
    kind:id.startsWith('Q')?'question':'knowledge',metadata:{id,title:'源-'+id,subject:'高中数学',question_type:'fill_blank',role:'训练'},
    markdown:'# 原文 '+id+'\n\n正文-'+id+'，保留原始内容。'}));
  const originalSources=JSON.stringify(records);
  async function fixture() {
    const frame=document.createElement('iframe');frame.style.cssText='width:1340px;height:860px;border:0';
    const loaded=new Promise(resolve=>{frame.onload=resolve;});frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style><div id="view"></div>';
    document.body.append(frame);await loaded;
    const win=frame.contentWindow,doc=frame.contentDocument,host=doc.querySelector('#view');
    // Rendering content is irrelevant to ordering. Keep the real scheduler
    // and owners, with a deterministic observer and a minimal host renderer.
    win.IntersectionObserver=class{observe(){}unobserve(){}disconnect(){}};
    const load=source=>{const module={exports:{}};new win.Function('module',source)(module);return module.exports;};
    const clone=value=>win.JSON.parse(JSON.stringify(value));
    const core=load(sources.core),compiler=load(sources.markdown),index=core.buildIndex(clone(records));
    const saved=[],previews=[],notices=[],opened=[];let stored=null;
    class Component{load(){}unload(){}}
    class ItemView extends Component{
      constructor(){super();this.contentEl=host;this.children=new Set();this.app={workspace:{requestSaveLayout(){},async revealLeaf(){}}};}
      addChild(child){this.children.add(child);child.load();}removeChild(child){this.children.delete(child);child.unload();}
    }
    const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}),scan:async()=>index,
      listPlans:async()=>stored?[{path:'方案/分区.json',title:stored.title}]:[],saveSettings:async()=>{},
      savePlan:async plan=>{stored=clone(plan);saved.push(stored);return '方案/分区.json';},loadPlan:async()=>clone(stored),
      openSource:async path=>{opened.push(path);},exportMarkdown:async()=>{throw Error('moving must not export Markdown');},
      preview:async(plan,latest,options)=>{
        ok(options.isCurrent(),'preview lost its live arrangement binding');
        const resolved=core.resolvePlan(plan,latest);ok(!resolved.issues.length,'moved sources no longer resolve');
        const markdown=await compiler.compileMarkdown(plan,resolved.entries,{outputPath:'Mathsemble/讲义/__preview__.md'});
        previews.push({plan:clone(plan),markdown});
      },beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
    const View=load(sources.view)({ItemView,Component,Notice:class{constructor(message){notices.push(message);}},core,service,
      renderMarkdown:async(markdown,node)=>{const p=doc.createElement('p');p.textContent=markdown;node.append(p);}});
    const leaf={},view=new View(leaf,{});leaf.view=view;
    const f={frame,win,doc,host,view,core,service,index,saved,previews,notices,opened,clone};fixtures.push(f);await view.onOpen();
    let plan=core.createPlan('分区编排');
    const item=id=>index.items.find(item=>item.id===id);
    for(const id of ['P','A','Q1','K1','Q2','B','Q3','C','D','Q4','K2'])
      plan=['A','B','C','D'].includes(id)?core.addSection(plan,id):core.addItem(plan,item(id));
    const q=plan.entries.find(entry=>entry.sourceId==='Q1');plan=core.updateEntry(plan,q.entryId,clone({title:'本次题目标题',role:'例题'}));
    plan.course.teacher='李老师';plan.course.title='本次课题';plan.output.layout='trial';plan.output.mode='teacher';plan.output.spaceSettings.ratio=125;
    view.setPlan(core.validatePlan(plan));view.switchWorkspaceMode('arrangement');await pause();
    f.original=clone(view.plan);f.ids=new Map(view.plan.entries.map(entry=>[entry.kind==='section'?entry.title:entry.sourceId,entry.entryId]));return f;
  }
  const labels=entries=>entries.map(entry=>entry.kind==='section'?entry.title:entry.sourceId);
  const sequence=f=>labels(f.view.plan.entries);
  const rows=f=>[...f.view.arrangementList.querySelectorAll('.mwb-assembly-arrangement-entry')];
  const row=(f,key)=>rows(f).find(node=>node.dataset.entryId===f.ids.get(key));
  const action=(f,key,name)=>{const node=row(f,key)?.querySelector('[data-arrangement-action="'+name+'"]');ok(node,'missing '+key+' '+name);return node;};
  const act=async(f,key,name)=>{
    const node=action(f,key,name),menu=node.closest('details');if(menu)menu.open=true;node.focus();node.click();await pause();
  };
  const invariant=f=>{
    equal(f.view.plan.entries.map(entry=>JSON.stringify(entry)).sort(),f.original.entries.map(entry=>JSON.stringify(entry)).sort(),'move altered entries or lost/duplicated content');
    equal(f.view.plan.course,f.original.course,'move changed course settings');equal(f.view.plan.output,f.original.output,'move changed output settings');
    equal(rows(f).map(node=>node.dataset.entryId),f.view.plan.entries.map(entry=>entry.entryId),'DOM order differs from draft');
    ok(JSON.stringify(records)===originalSources,'source records were modified');ok(!f.core.resolvePlan(f.view.plan,f.index).issues.length,'move changed accepted source references');
  };
  const beginDrag=(f,key)=>{
    const transfer=new f.win.DataTransfer();action(f,key,'drag').dispatchEvent(new f.win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:transfer}));return transfer;
  };
  const drop=async(f,transfer,key)=>{
    const node=key===null?f.view.arrangementList:row(f,key);ok(node,'missing drop destination '+key);
    node.dispatchEvent(new f.win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));await pause();
  };
  const drag=async(f,from,to)=>{const transfer=beginDrag(f,from);await drop(f,transfer,to);};
  const position=async(f,key,value)=>{
    row(f,key).querySelector('details').open=true;
    const input=row(f,key).querySelector('[data-arrangement-field="position"]');input.value=String(value);await act(f,key,'move');return input;
  };

  await check('section arrows swap complete neighboring blocks while keeping unsectioned content fixed',async()=>{
    const f=await fixture();ok(action(f,'A','up').disabled,'first section must not move into its preamble');ok(action(f,'D','down').disabled,'last section down must be disabled');
    await act(f,'A','down');equal(sequence(f),['P','B','Q3','A','Q1','K1','Q2','C','D','Q4','K2'],'down did not swap full sections');
    ok(f.doc.activeElement?.closest('[data-entry-id]')?.dataset.entryId===f.ids.get('A'),'section move lost keyboard focus');invariant(f);
    await act(f,'A','up');equal(sequence(f),labels(f.original.entries),'up did not restore complete original order');invariant(f);
    await act(f,'C','down');equal(sequence(f),['P','A','Q1','K1','Q2','B','Q3','D','Q4','K2','C'],'empty section failed to pass the final nonempty section');
    ok(action(f,'C','down').disabled,'empty last section has an enabled down control');invariant(f);
  });

  await check('section drag targets snap to whole destination sections and own content is a no-op',async()=>{
    const f=await fixture(),transfer=beginDrag(f,'A');
    equal(rows(f).filter(node=>node.classList.contains('is-dragging')).map(node=>node.dataset.entryId),['A','Q1','K1','Q2'].map(key=>f.ids.get(key)),'drag highlight must cover exactly the moving section');
    await drop(f,transfer,'Q4');ok(!rows(f).some(node=>node.classList.contains('is-dragging')),'drop left stale section highlights');
    equal(sequence(f),['P','B','Q3','C','D','Q4','K2','A','Q1','K1','Q2'],'downward drop split or absorbed the destination section');invariant(f);
    await drag(f,'A','Q3');equal(sequence(f),labels(f.original.entries),'upward drop did not place the section before the complete destination');invariant(f);
    const unchanged=f.view.plan;await drag(f,'A','K1');equal(sequence(f),labels(f.original.entries),'drop on own content reordered its section');
    ok(f.view.plan===unchanged,'no-op drop dirtied/replaced the draft');
    await drag(f,'D','P');equal(sequence(f),['P','D','Q4','K2','A','Q1','K1','Q2','B','Q3','C'],'drop on preamble moved or absorbed unsectioned content');invariant(f);
  });

  await check('dropping a section on list whitespace moves the full block to the end',async()=>{
    const f=await fixture();await drag(f,'A',null);
    equal(sequence(f),['P','B','Q3','C','D','Q4','K2','A','Q1','K1','Q2'],'list whitespace drop moved only the header');invariant(f);
    const before=f.view.plan;await drag(f,'A',null);ok(f.view.plan===before,'last section whitespace drop must be a no-op');
  });

  await check('no-op section operations keep a saved draft and its pending candidate unchanged',async()=>{
    const f=await fixture();await f.view.saveCurrentPlan();f.view.selectionCount='1';f.view.drawSelection();
    const before=f.view.plan,selection=f.view.selection;ok(selection?.items.length===1&&f.view.selectionIsCurrent(),'fixture lacks a valid pending candidate');
    await drag(f,'A','K1');await position(f,'A',1);await act(f,'A','up');await act(f,'D','down');
    ok(f.view.plan===before&&!f.view.dirty,'no-op section operation replaced or dirtied a saved draft');
    ok(f.view.selection===selection&&f.view.selectionIsCurrent(),'no-op section operation discarded a valid pending candidate');
    invariant(f);
  });

  await check('numeric section placement uses section ranks and persists the same preview order',async()=>{
    const f=await fixture();const field=row(f,'A').querySelector('[data-arrangement-field="position"]');
    ok(field.max==='4'&&field.value==='1','section rank field uses total item positions');ok(row(f,'A').textContent.includes('移到第几分区'),'section rank field has an ambiguous label');
    await position(f,'A',4);equal(sequence(f),['P','B','Q3','C','D','Q4','K2','A','Q1','K1','Q2'],'numeric section placement split a block');invariant(f);
    const before=JSON.stringify(f.view.plan);for(const invalid of [0,5,1.5]){await position(f,'A',invalid);ok(JSON.stringify(f.view.plan)===before,'invalid section rank changed the plan');}
    await f.view.saveCurrentPlan();ok(f.saved.length===1&&!f.view.dirty,'explicit save did not save the moved draft');equal(f.saved[0],f.view.plan,'save lost moved order or settings');
    const preview=[...f.view.root.querySelectorAll('button')].find(node=>node.textContent==='预览 A4');ok(preview,'missing A4 entry');preview.click();await pause();
    ok(f.previews.length===1,'A4 action did not receive the moved plan');equal(f.previews[0].plan,f.view.plan,'A4 preview used stale order');
    equal(f.previews[0].markdown.match(/^## [ABCD]$/gm),['## B','## C','## D','## A'],'compiled handout section order is stale');
    const wanted=['正文-P','正文-Q3','正文-Q4','正文-K2','正文-Q1','正文-K1','正文-Q2'];let last=-1;
    for(const token of wanted){const at=f.previews[0].markdown.indexOf(token);ok(at>last,'compiled source order changed at '+token);last=at;}
    const savedOrder=sequence(f);f.view.savedSelect.value='方案/分区.json';await f.view.loadSelectedPlan();equal(sequence(f),savedOrder,'reopen lost section order');invariant(f);
  });

  await check('questions and knowledge still move as individual items and section removal only removes its title',async()=>{
    const f=await fixture();await act(f,'Q2','down');equal(sequence(f),['P','A','Q1','K1','B','Q2','Q3','C','D','Q4','K2'],'question down moved a surrounding block');invariant(f);
    await drag(f,'K1','Q4');equal(sequence(f),['P','A','Q1','B','Q2','Q3','C','D','Q4','K1','K2'],'knowledge drag moved other entries');invariant(f);
    ok(action(f,'A','remove').textContent==='移除分区标题','section removal must name its header-only behavior');
    const before=f.view.plan.entries.filter(entry=>entry.entryId!==f.ids.get('A'));await act(f,'A','remove');equal(f.view.plan.entries,before,'removing a section title removed its content');
    ok(JSON.stringify(records)===originalSources,'removal wrote original sources');
  });

  await check('external, stale and detached drag gestures cannot move a current section',async()=>{
    const f=await fixture(),external=new f.win.DataTransfer();external.setData('application/x-mathsemble-entry',f.ids.get('A'));
    const before=f.view.plan;await drop(f,external,'D');ok(f.view.plan===before,'external payload reordered a section without an internal dragstart');
    const transfer=beginDrag(f,'A'),oldHandle=action(f,'A','drag'),oldDown=action(f,'A','down');
    const current=f.core.updateEntry(f.view.plan,f.ids.get('Q1'),f.clone({title:'拖动后修改'}));f.view.setPlan(current);
    await drop(f,transfer,'D');ok(f.view.plan===current,'stale drag moved a section after the draft changed');
    oldDown.click();await pause();ok(f.view.plan===current,'detached section button changed the new draft');
    const detached=new f.win.DataTransfer();oldHandle.dispatchEvent(new f.win.DragEvent('dragstart',{bubbles:true,cancelable:true,dataTransfer:detached}));
    await drop(f,detached,'D');ok(f.view.plan===current,'detached handle authorized a new section drag');
    const repaint=beginDrag(f,'A');f.view.renderArrangement();await drop(f,repaint,'D');
    ok(f.view.plan===current,'a same-plan redraw retained an obsolete drag gesture');
  });

  await check('busy, inactive and closed workspaces block section movement without pending writes',async()=>{
    const f=await fixture();
    for(const flag of ['actionBusy','scanBusy']){
      const transfer=beginDrag(f,'A'),before=f.view.plan;f.view[flag]=true;f.view.updateSummary();
      ok(action(f,'A','down').disabled,'busy section action remained enabled');await act(f,'A','down');await drop(f,transfer,'D');
      ok(f.view.plan===before,'busy workspace moved a section');f.view[flag]=false;f.view.updateSummary();
      const resumed=beginDrag(f,'A');f.view[flag]=true;f.view.updateSummary();f.view[flag]=false;f.view.updateSummary();
      await drop(f,resumed,'D');ok(f.view.plan===before,'ending '+flag+' revived a gesture started before the busy period');
    }
    const transfer=beginDrag(f,'A'),oldList=f.view.arrangementList,before=f.view.plan;f.view.switchWorkspaceMode('library');
    oldList.dispatchEvent(new f.win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:transfer}));await pause();ok(f.view.plan===before,'inactive workspace accepted a section drop');
    f.view.switchWorkspaceMode('arrangement');const closeTransfer=beginDrag(f,'A'),oldRow=row(f,'D'),oldButton=action(f,'A','down');await f.view.onClose();
    oldButton.click();oldRow.dispatchEvent(new f.win.DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:closeTransfer}));await pause();
    ok(f.view.plan===before,'closed workspace accepted a late section action');ok(f.saved.length===0&&f.previews.length===0,'movement triggered an implicit write or preview');
  });

  const out=document.createElement('pre');out.id='mwb-test-results';out.textContent=JSON.stringify(results);document.body.append(out);
}

test('whole-section movement preserves boundaries through real arrangement actions',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for section movement checks');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries(['core','view','markdown'].map(name=>[name,fs.readFileSync(path.join(root,'src/assembly-'+name+'.cjs'),'utf8')]));
  const css=hostCss+fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-section-move-'));
  try{
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+','+JSON.stringify(css)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'sections.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
