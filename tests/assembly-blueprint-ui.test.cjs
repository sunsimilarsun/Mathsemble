'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));

// Real Chromium DOM and actual core/allocation logic; only Obsidian ownership,
// Markdown rendering and persistence/I/O scheduling are controlled seams.
async function browserCases(sources) {
  const results=[],fixtures=[],clone=v=>JSON.parse(JSON.stringify(v));
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const eq=(a,b,message)=>ok(JSON.stringify(a)===JSON.stringify(b),message+'\n'+JSON.stringify(a)+' != '+JSON.stringify(b));
  const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  const until=async(fn,message)=>{const end=Date.now()+3000;while(!fn()&&Date.now()<end)await pause(10);ok(fn(),message);};
  const load=source=>{const module={exports:{}};new Function('module',source)(module);return module.exports;};
  const core=load(sources.core),engine=load(sources.engine).createBlueprintEngine({core});
  const createModal=load(sources.ui),createView=load(sources.view);
  const button=(node,label)=>[...node.querySelectorAll('button')].find(el=>el.textContent===label);
  const field=(node,label)=>node.querySelector('[aria-label="'+label+'"]');
  const change=(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));};
  const choose=(node,values)=>{for(const option of node.options)option.selected=values.includes(option.value);node.dispatchEvent(new Event('change',{bubbles:true}));};
  const check=async(name,fn)=>{
    const before=fixtures.length;
    try{await fn();results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:String(error.stack||error)});}
    finally{for(const f of fixtures.splice(before)){f.close();f.finish();f.host.remove();}await pause();}
  };
  class Component {
    constructor(){this.callbacks=[];this.loaded=false;}
    register(fn){this.callbacks.push(fn);}
    load(){this.loaded=true;}
    unload(){if(!this.loaded)return;this.loaded=false;for(const fn of this.callbacks.splice(0).reverse())fn();}
  }
  class Modal {
    constructor(app){this.app=app;this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);app.host.append(this.modalEl);}
    open(){return this.onOpen();}
    close(){if(this._closing)return;this._closing=true;this.onClose();this.modalEl.remove();}
  }
  class ItemView {
    constructor(leaf){this.app=leaf.app;this.contentEl=document.createElement('div');leaf.app.host.append(this.contentEl);}
  }
  class Notice {constructor(message){this.message=message;}}
  const records=(extra=0)=>[
    {path:'题库/C.md',kind:'question',metadata:{id:'C',title:'选择题 C',subject:'高中数学',question_type:'choice',role:'训练'},markdown:'---\ntitle: 私有元信息\n---\n选择题 C，求 $1+1$。'},
    ...Array.from({length:1+extra},(_,i)=>({path:'题库/F'+i+'.md',kind:'question',metadata:{id:'F'+i,title:'填空题 F'+i,subject:'高中数学',question_type:'fill_blank',role:'训练'},markdown:'填空题 F'+i+'，$1+1=?{2}$。'}))
  ];
  const blueprint=()=>({schemaVersion:1,blueprintId:'test-blueprint',revision:1,title:'双行配额',rows:[
    {rowId:'A',label:'任意题',count:1,filters:{}},{rowId:'B',label:'选择题',count:1,filters:{questionType:['choice']}}
  ],constraints:{uniqueQuestion:true,maxPerFamily:null}});

  async function fixture({extra=0,previewDeferred=false}={}) {
    const host=document.createElement('section');document.body.append(host);
    const index=core.buildIndex(records(extra)),owners=[],renderCalls=[],pending=[],named=new Map(),calls={generate:[],apply:[],save:[],load:[],replace:[],lock:[]};
    const control={generateGate:null,applyGate:null,ignoreApplyCurrent:false},app={host,workspace:{requestSaveLayout(){}}};
    const plugin={app,addChild(owner){owners.push(owner);owner.load();},removeChild(owner){owner.unload();}};
    const current=options=>{if(options.signal?.aborted||options.isCurrent&&!options.isCurrent())throw Object.assign(Error('操作已取消或上下文变化'),{name:'AbortError'});};
    const wrap=(args,prepared,allocation)=>({schemaVersion:1,status:allocation?.status||prepared.status,index,blueprint:engine.validateBlueprint(args.blueprint),
      basePlanSnapshot:core.validatePlan(args.plan),locks:clone(allocation?.locks||args.locks||[]),excludedKeys:[],context:allocation?.context||prepared.context,
      allocation:allocation||null,issues:prepared.issues||[]});
    const prepare=c=>engine.prepareAllocation({index,plan:c.basePlanSnapshot,blueprint:c.blueprint,locks:c.locks,excludedKeys:[]});
    const service={
      listBlueprints:async()=>[...named].map(([path,bp])=>({path,title:bp.title})),listBlueprintRuns:async()=>[],
      createBlueprintSession:()=>({
        async saveBlueprint(bp,path){calls.save.push({bp:clone(bp),path});path=path||'Mathsemble/组卷蓝图/'+bp.blueprintId+'.json';named.set(path,clone(bp));return path;},
        async loadBlueprint(path){calls.load.push(path);if(!named.has(path))throw Error('missing blueprint');return clone(named.get(path));}
      }),
      async generateBlueprintCandidate(args,options){
        calls.generate.push({args:clone(args),options});if(control.generateGate)await control.generateGate.promise;current(options);
        const prepared=engine.prepareAllocation({index,...args});
        return wrap(args,prepared,prepared.status==='ready'?engine.allocateQuestions(prepared.problem,{seed:args.seed,signal:options.signal}):null);
      },
      updateBlueprintLocks(c,locks){calls.lock.push(clone(locks));const allocation=engine.updateAllocationLocks({index,plan:c.basePlanSnapshot,blueprint:c.blueprint,locks,allocation:c.allocation});return {...c,allocation,locks:allocation.locks,context:allocation.context};},
      replaceBlueprintCandidate(c,options){
        calls.replace.push(options);const before=prepare(c),prepared=engine.prepareReplacement({problem:before.problem,allocation:c.allocation,...options});
        const allocation=prepared.status==='ready'?engine.allocateQuestions(prepared.problem,{seed:options.seed}):null;
        return {...c,status:allocation?.status||prepared.status,allocation,context:allocation?.context||prepared.context,issues:prepared.issues||[]};
      },
      async applyBlueprintCandidate(plan,c,options){
        calls.apply.push({plan:clone(plan),candidate:c,options});if(control.applyGate)await control.applyGate.promise;if(!control.ignoreApplyCurrent)current(options);
        const entryIdsBySlot=Object.fromEntries(c.allocation.assignments.filter(a=>a.origin==='candidate').map((a,i)=>[a.slotId,'new-entry-'+i]));
        const result=engine.applyAllocation({freshIndex:index,plan,blueprint:c.blueprint,locks:c.locks,allocation:c.allocation,expectedContext:c.context,entryIdsBySlot});
        return {plan:result.plan,index,run:{schemaVersion:1,assignments:result.bindings,blueprintSnapshot:clone(c.blueprint)}};
      }
    };
    const view={plan:core.createPlan('原讲义'),settings:{questionRoots:['题库'],knowledgeRoots:[],recursive:true},index,closed:false,actionBusy:false,scanBusy:false,dirty:false,
      populateFilters(){},renderTree(){},setPlan(plan){this.plan=plan;this.dirty=true;},setStatus(message){this.status=message;}};
    const renderMarkdown=(md,node,sourcePath,owner,signal)=>{
      const gate=deferred();renderCalls.push({md,node,sourcePath,owner,signal});pending.push(gate);
      if(!previewDeferred)gate.resolve();return gate.promise.then(()=>{if(!signal.aborted)node.textContent=md;});
    };
    const Type=createModal({Modal,Component,Notice,core,engine,service,renderMarkdown}),modal=new Type(app,plugin,view);view.blueprintModal=modal;
    const f={host,app,plugin,index,view,modal,service,control,calls,owners,renderCalls,named,
      close(){if(!modal.closed)modal.close();},finish(){for(const gate of pending)gate.resolve();control.generateGate?.resolve();control.applyGate?.resolve();},
      async setBlueprint(bp=blueprint()){modal.blueprint=bp;modal.changed();modal.renderEditor();},
      unload(){for(const owner of [...owners])owner.unload();}};
    fixtures.push(f);await modal.open();return f;
  }

  await check('multiple DOM quota rows allocate globally, display row ownership, and apply only a complete result',async()=>{
    const f=await fixture(),m=f.modal,before=JSON.stringify(f.view.plan);
    change(field(m.rowsEl,'配额行名称'),'任意题');button(m.contentEl,'添加配额行').click();await pause();
    const panels=[...m.rowsEl.children];ok(panels.length===2,'add-row click failed');change(field(panels[1],'配额行名称'),'选择题');choose(field(panels[1],'题型'),['choice']);
    button(m.contentEl,'生成候选').click();await until(()=>m.candidate&&!m.busy,'candidate did not finish');
    eq(m.candidate.allocation.assignments.map(a=>a.sourceId),['F0','C'],'overlapping rows did not use global allocation');
    ok(m.results.querySelectorAll('tbody tr').length===2,'quota summary omitted a row');
    const cards=[...m.results.querySelectorAll('.mwb-blueprint-candidate')];
    eq(cards.map(c=>c.dataset.slotId),m.candidate.allocation.assignments.map(a=>a.slotId),'card ownership differs from assignment');
    ok(cards[0].querySelector('strong').textContent.startsWith('任意题 · ')&&cards[1].querySelector('strong').textContent.startsWith('选择题 · '),'row labels are wrong');
    eq(JSON.stringify(f.view.plan),before,'preview mutated current plan');ok(!m.applyButton.disabled,'complete result not applicable');
    button(m.contentEl,'应用完整配额').click();await until(()=>m.closed,'complete candidate was not applied');
    ok(f.view.plan.entries.length===2&&f.view.pendingBlueprintRun.assignments.length===2&&f.view.dirty,'plan and pending sidecar were not published together');
    eq(Object.keys(f.view.plan).sort(),['course','entries','output','schemaVersion','title'],'plan v3 was extended');
  });

  await check('insufficient quotas remain visible but cannot partially apply',async()=>{
    const f=await fixture();await f.setBlueprint();change(field(f.modal.rowsEl,'题数'),3);await f.modal.generate(false);
    ok(f.modal.candidate.allocation.status==='infeasible','insufficient pool not reported');
    ok(f.modal.applyButton.disabled&&f.modal.results.querySelectorAll('.mwb-blueprint-candidate').length===0,'partial assignment was offered for use');
    ok(f.modal.results.querySelector('tbody').textContent.includes('任意题'),'failed quota has no row summary');
    await f.modal.apply();ok(f.calls.apply.length===0&&f.view.plan.entries.length===0,'incomplete candidate reached apply');
  });

  await check('a checkbox lock keeps its exact assignment during redraw and blocks replacement/removal',async()=>{
    const f=await fixture({extra:3});await f.setBlueprint();await f.modal.generate(false);
    const assignment=clone(f.modal.candidate.allocation.assignments.find(a=>a.rowId==='A')),seed=f.modal.seed;
    const checkbox=f.modal.results.querySelector('[data-slot-id="A:1"] input[type=checkbox]');checkbox.click();await pause();
    ok(f.calls.lock.length===1&&f.modal.locks.length===1,'DOM checkbox did not persist a lock');
    ok(button(f.modal.results.querySelector('[data-slot-id="A:1"]'),'换一道').disabled,'locked slot can still be replaced');
    button(f.modal.rowsEl.querySelector('[data-row-id="A"]'),'移除此行').click();await pause();ok(f.modal.blueprint.rows.length===2,'locked row was removed');
    await f.modal.generate(true);ok(f.modal.seed!==seed,'redraw reused the previous seed');
    eq(f.modal.candidate.allocation.assignments.find(a=>a.slotId==='A:1'),assignment,'redraw changed a locked assignment');
    ok(f.calls.generate.at(-1).args.locks.length===1&&f.modal.candidate.allocation.rowStats.find(r=>r.rowId==='A').locked===1,'lock not passed through allocation');
  });

  await check('failed replacement preserves the exact original candidate and successful replacement preserves other rows',async()=>{
    const f=await fixture();await f.setBlueprint();await f.modal.generate(false);const old=f.modal.candidate,serialized=JSON.stringify(old.allocation);
    await f.modal.replace('A:1');ok(f.modal.candidate===old,'failed replacement discarded original candidate');eq(JSON.stringify(old.allocation),serialized,'failed replacement mutated original allocation');
    ok(f.modal.statusEl.classList.contains('is-error')&&!f.modal.applyButton.disabled,'failure is hidden or valid previous candidate lost');
    const g=await fixture({extra:2});await g.setBlueprint();await g.modal.generate(false);const previous=clone(g.modal.candidate.allocation.assignments);
    await g.modal.replace('A:1');const next=g.modal.candidate.allocation.assignments;
    ok(next.find(a=>a.rowId==='A').sourceId!==previous.find(a=>a.rowId==='A').sourceId,'replacement did not change its target');
    eq(next.find(a=>a.rowId==='B'),previous.find(a=>a.rowId==='B'),'replacement changed another quota row');
  });

  await check('an existing question explicitly bound to a quota retains entry ID, position, title and role',async()=>{
    const f=await fixture();f.view.plan=core.addSection(f.view.plan,'原分区');f.view.plan=core.addItem(f.view.plan,f.index.items.find(item=>item.id==='C'));
    const entry=f.view.plan.entries[1];f.view.plan=core.updateEntry(f.view.plan,entry.entryId,{title:'卷内标题',role:'例题'});const before=clone(f.view.plan.entries);
    await f.setBlueprint();const panel=f.modal.rowsEl.querySelector('[data-row-id="B"]');change(field(panel,'将编排中的题目计入此行'),entry.entryId);button(panel,'固定到此行').click();await pause();
    ok(f.modal.locks[0].existingEntryId===entry.entryId&&f.modal.locks[0].rowId==='B','existing entry was bound to the wrong quota');
    await f.modal.generate(false);await f.modal.apply();eq(f.view.plan.entries.slice(0,2),before,'application rewrote existing entries');
    ok(f.view.plan.entries.length===3,'existing question was appended twice');
    ok(f.view.pendingBlueprintRun.assignments.find(a=>a.rowId==='B').entryId===entry.entryId,'run lost existing entry ownership');
  });

  await check('cancel and close abort outstanding generation without publishing late results',async()=>{
    for(const close of [false,true]){
      const f=await fixture();await f.setBlueprint();f.control.generateGate=deferred();const work=f.modal.generate(false);
      await until(()=>f.calls.generate.length===1,'generation did not start');const options=f.calls.generate[0].options;
      if(close)f.modal.close();else f.modal.cancelButton.click();await pause();ok(options.signal.aborted,'generation signal was not aborted');
      f.control.generateGate.resolve();await work;ok(!f.modal.candidate&&f.view.plan.entries.length===0,'aborted generation published a candidate');
      if(close)ok(!f.modal.contentEl.childElementCount&&!f.view.blueprintModal,'closed modal retained UI');else ok(!f.modal.busy,'cancel left UI busy');
    }
  });

  await check('plugin unload aborts the modal and queued previews and releases all component owners',async()=>{
    const f=await fixture({extra:4,previewDeferred:true});const bp=blueprint();bp.rows[0].count=4;await f.setBlueprint(bp);await f.modal.generate(false);
    ok(f.renderCalls.length===2,'preview rendering was not initially bounded at two');const calls=f.renderCalls.slice();
    f.unload();ok(f.modal.closed&&!f.view.blueprintModal,'plugin unload did not close its modal');
    ok(calls.every(c=>c.signal.aborted&&!c.owner.loaded),'unload retained preview signals/components');f.finish();await pause();
    ok(f.renderCalls.length===2&&f.owners.every(o=>!o.loaded),'late completion restarted preview work');
    ok(!f.modal.contentEl.childElementCount&&!f.modal.candidate,'closed modal retained candidate context');
  });

  await check('named blueprint save, revision, load and save-as preserve plan state',async()=>{
    const f=await fixture(),before=JSON.stringify(f.view.plan);await f.setBlueprint();change(f.modal.titleInput,'阶段检测配额');await f.modal.save(false);
    const firstPath=f.modal.blueprintPath,firstId=f.modal.blueprint.blueprintId;ok(firstPath&&f.named.get(firstPath).title==='阶段检测配额','named save missing');
    change(f.modal.titleInput,'阶段检测修订');ok(f.modal.blueprint.revision===2,'edited named blueprint revision did not advance');await f.modal.save(false);
    ok(f.calls.save[1].path===firstPath&&f.named.get(firstPath).revision===2,'save did not update the loaded path');
    await f.modal.generate(false);await f.modal.save(true);ok(f.modal.blueprintPath!==firstPath&&f.modal.blueprint.blueprintId!==firstId&&f.modal.blueprint.revision===1,'save-as reused identity or revision');
    change(f.modal.savedSelect,firstPath);await f.modal.load();ok(f.modal.blueprint.title==='阶段检测修订'&&f.modal.blueprint.revision===2&&!f.modal.candidate&&!f.modal.locks.length,'named load did not reset generated state');
    eq(JSON.stringify(f.view.plan),before,'blueprint persistence modified the current plan');
  });

  await check('late apply cannot overwrite concurrent plan or directory changes, even if a service returns anyway',async()=>{
    for(const mutation of ['plan','settings','busy']){
      const f=await fixture();await f.setBlueprint();await f.modal.generate(false);f.control.applyGate=deferred();f.control.ignoreApplyCurrent=true;
      const work=f.modal.apply();await until(()=>f.calls.apply.length===1,'apply did not start');
      if(mutation==='plan')f.view.plan=core.addSection(f.view.plan,'并发编辑');
      else if(mutation==='settings')f.view.settings={...f.view.settings,questionRoots:['其他题库']};else f.view.actionBusy=true;
      const expected=JSON.stringify(f.view.plan);ok(!f.calls.apply[0].options.isCurrent(),'stale context remains current');
      f.control.applyGate.resolve();await work;eq(JSON.stringify(f.view.plan),expected,'late apply overwrote concurrent state');
      ok(!f.view.pendingBlueprintRun&&!f.modal.closed&&f.modal.statusEl.classList.contains('is-error'),'stale apply published run or failed silently');
    }
  });

  function saveFixture() {
    const host=document.createElement('section');document.body.append(host);const writes=[],recordWrites=[],control={failRecord:true,planGate:null,recordGate:null};let layoutSaves=0;
    const app={host,workspace:{requestSaveLayout(){layoutSaves++;}}};
    const service={createPlanSession:()=>({async savePlan(plan,path){writes.push({plan:clone(plan),path});if(control.planGate)await control.planGate.promise;return path||'Mathsemble/组卷方案/原讲义.json';}}),
      listPlans:async()=>[{path:'Mathsemble/组卷方案/原讲义.json',title:'原讲义'}],
      async saveBlueprintRun(run,options){recordWrites.push({run,options});if(control.recordGate)await control.recordGate.promise;if(control.failRecord)throw Error('侧车写入失败');return 'Mathsemble/组卷记录/run.json';}};
    const Type=createView({ItemView,Component,Notice,core,service,renderMarkdown:async()=>{}}),view=new Type({app},{app});
    view.closed=false;view.dirty=true;view.statusEl=document.createElement('div');host.append(view.statusEl);view.pendingBlueprintRun={runId:'pending-1'};
    // These unrelated visual regions are absent in the minimal save fixture;
    // saveCurrentPlan/runAction/refreshPlans/setStatus remain actual methods.
    view.renderSelection=()=>{};view.refreshPlanSettings=()=>{};
    const f={host,view,control,writes,recordWrites,close(){view.closed=true;},finish(){control.planGate?.resolve();control.recordGate?.resolve();},layoutSaves:()=>layoutSaves};fixtures.push(f);return f;
  }
  await check('actual AssemblyView save retains successful plan path and clean state when the sidecar fails, then retries',async()=>{
    const f=saveFixture(),pending=f.view.pendingBlueprintRun;await f.view.saveCurrentPlan();
    ok(f.view.planPath==='Mathsemble/组卷方案/原讲义.json'&&!f.view.dirty,'sidecar failure lost the successful plan save');
    ok(f.view.pendingBlueprintRun===pending&&f.view.statusEl.textContent.includes('方案已保存')&&f.view.statusEl.textContent.includes('配额记录尚未保存'),'sidecar failure was hidden or retry lost');
    ok(!f.view.actionBusy&&f.layoutSaves()===1,'failed sidecar left action busy or layout unpersisted');
    f.control.failRecord=false;await f.view.saveCurrentPlan();
    ok(f.recordWrites.length===2&&f.recordWrites.every(w=>w.run===pending)&&f.view.pendingBlueprintRun===null,'retry did not save the same pending run');
    ok(f.writes[1].path===f.view.planPath&&!f.view.dirty&&f.view.statusEl.textContent.includes('配额与锁定记录已保存'),'retry did not retain named plan path');
    eq(Object.keys(f.writes[0].plan).sort(),['course','entries','output','schemaVersion','title'],'saved plan v3 acquired sidecar fields');
  });

  await check('actual save preserves concurrent dirty edits and a newer pending run while an older sidecar completes',async()=>{
    const f=saveFixture();f.control.failRecord=false;f.control.recordGate=deferred();const previous=f.view.pendingBlueprintRun,work=f.view.saveCurrentPlan();
    await until(()=>f.recordWrites.length===1,'sidecar write did not start');f.view.plan=core.addSection(f.view.plan,'保存期间新增分区');f.view.pendingBlueprintRun={runId:'pending-2'};
    const latest=f.view.pendingBlueprintRun;f.control.recordGate.resolve();await work;
    ok(f.view.dirty&&f.view.plan.entries.length===1,'late save marked concurrent edit clean');
    ok(f.view.pendingBlueprintRun===latest&&f.recordWrites[0].run===previous,'late sidecar completion cleared the newer pending run');
  });

  await check('an authorized sidecar save finishes after the view closes without updating detached UI',async()=>{
    const f=saveFixture();f.control.failRecord=false;f.control.planGate=deferred();const work=f.view.saveCurrentPlan();await until(()=>f.writes.length===1,'plan write did not start');
    f.view.closed=true;const oldStatus=f.view.statusEl.textContent;f.control.planGate.resolve();await work;
    ok(f.recordWrites.length===1&&f.view.pendingBlueprintRun===null,'closing view discarded authorized sidecar persistence');
    ok(f.view.statusEl.textContent===oldStatus&&f.layoutSaves()===0&&!f.view.actionBusy,'closed view received late UI work');
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('blueprint modal quotas, lifecycle and native AssemblyView persistence in Chromium',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for blueprint UI tests');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries([['core','assembly-core.cjs'],['engine','assembly-blueprint.cjs'],['ui','assembly-blueprint-ui.cjs'],['view','assembly-view.cjs']].map(([key,file])=>[key,fs.readFileSync(path.join(root,'src',file),'utf8')]));
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-blueprint-ui-'));
  try{
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'blueprint.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
