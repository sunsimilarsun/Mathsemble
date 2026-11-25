'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));

// Real service + core + both engines in Chrome. Only Vault/Obsidian/rendering
// are controlled host seams. A loopback endpoint supplies actual node:crypto
// SHA-256 synchronously, preserving the service's strong-digest and WeakMap
// contracts instead of reimplementing its candidate/run rules in a UI mock.
async function browserCases(sources) {
  const results=[],fixtures=[],clone=v=>JSON.parse(JSON.stringify(v));
  const ok=(v,message)=>{if(!v)throw Error(message);},eq=(a,b,message)=>ok(JSON.stringify(a)===JSON.stringify(b),message+'\n'+JSON.stringify(a)+' != '+JSON.stringify(b));
  const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  const until=async(fn,message)=>{const end=Date.now()+3000;while(!fn()&&Date.now()<end)await pause(10);ok(fn(),message);};
  const nodeCrypto={randomUUID:()=>crypto.randomUUID(),createHash(name){ok(name==='sha256','unexpected hash algorithm');let text='';return {update(value){text+=value;return this;},digest(format){ok(format==='hex','unexpected digest format');const xhr=new XMLHttpRequest();xhr.open('POST','/sha256',false);xhr.send(text);ok(xhr.status===200,'SHA endpoint failed');return xhr.responseText;}};}};
  let fragmentApi;
  const load=source=>{const module={exports:{}};new Function('module','require','MWB_ASSEMBLY_FRAGMENTS',source)(module,name=>{if(name==='node:crypto')return nodeCrypto;throw Error('Unexpected browser require '+name);},fragmentApi);return module.exports;};
  fragmentApi=load(sources.fragments);
  const core=load(sources.core),blueprintEngine=load(sources.blueprint).createBlueprintEngine({core}),familyEngine=load(sources.family).createFamilyEngine({core});
  const createService=load(sources.service),createModal=load(sources.ui),createView=load(sources.view);
  const button=(node,label)=>[...node.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
  const change=(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));};
  const check=async(name,fn)=>{const before=fixtures.length;try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}finally{for(const f of fixtures.splice(before)){await f.close();f.finish();f.host.remove();}await pause();}};
  class Component {constructor(){this.loaded=false;this.callbacks=[];this.children=new Set();}register(fn){this.callbacks.push(fn);}load(){this.loaded=true;}unload(){if(!this.loaded)return;this.loaded=false;for(const c of [...this.children])this.removeChild(c);for(const fn of this.callbacks.splice(0).reverse())fn();}addChild(c){this.children.add(c);c.load();}removeChild(c){this.children.delete(c);c.unload();}}
  class Modal {constructor(app){this.app=app;this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);app.host.append(this.modalEl);}open(){return this.onOpen();}close(){if(this._closing)return;this._closing=true;this.onClose();this.modalEl.remove();}}
  class ItemView extends Component {constructor(leaf){super();this.app=leaf.app;this.contentEl=document.createElement('div');leaf.app.host.append(this.contentEl);}}
  const question=(id,{family='同族甲',type='choice',difficulty=2,...other}={})=>'---\n'+JSON.stringify({id,title:id==='A'?'卷内原题标题':'候选 '+id,subject:'高中数学',question_type:type,difficulty,role:id==='A'?'例题':'训练',family_id:family,...other})+'\n---\n'+id+' 合成题干 $1+1=?{2}$。';
  async function fixture({mode='none',locked=false,filters={kind:'question',query:''},extra=0,previewDeferred=false,open=true}={}) {
    const host=document.createElement('section');host.style.cssText='width:1200px;height:860px;';document.body.append(host);
    const nodes=new Map(),listeners=new Set(),writes=[],owners=[],renderCalls=[],pending=[];
    const trigger=(event,...args)=>{for(const row of [...listeners])if(row.event===event)row.fn(...args);};
    const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,name:path.split('/').pop(),children:[]};nodes.set(path,node);parent?.children.push(node);return node;};
    const file=(path,content)=>{const parent=folder(path.slice(0,path.lastIndexOf('/'))),name=path.split('/').pop(),node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent};nodes.set(path,node);parent.children.push(node);trigger('create',node);return node;};
    file('题库/A.md',question('A'));let stored={assemblySettings:{questionRoots:['题库'],knowledgeRoots:[],recursive:true}};
    const app={host,workspace:{requestSaveLayout(){}}};app.vault={getAbstractFileByPath:path=>nodes.get(path)||null,getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),
      on:(event,fn)=>{const row={event,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),read:async node=>node.content,
      createFolder:async path=>{if(nodes.has(path))throw Error('exists');writes.push(path);return folder(path);},create:async(path,text)=>{if(nodes.has(path))throw Error('exists');writes.push(path);return file(path,text);},modify:async(node,text)=>{writes.push(node.path);node.content=text;trigger('modify',node);}};
    const plugin={app,loadData:async()=>stored,saveData:async value=>{stored=value;},addChild(owner){owners.push(owner);owner.load();},removeChild(owner){owner.unload();}};
    const service=createService(plugin,{core,blueprintEngine,familyEngine,parseYaml:JSON.parse}),base=core.addSection(core.createPlan('原讲义'),'原分区');let index=await service.scan(),plan,run,paths=[];
    if(mode!=='none'){
      const blueprint={schemaVersion:1,blueprintId:'ui-family',revision:1,title:'原选择配额',rows:[{rowId:'R',label:'选择题',count:1,filters:{questionType:['choice']}}],constraints:{uniqueQuestion:true,maxPerFamily:1}};
      let candidate=await service.generateBlueprintCandidate({plan:base,blueprint,seed:'ui-family'});if(locked)candidate=service.updateBlueprintLocks(candidate,candidate.allocation.assignments.map(clone));
      const applied=await service.applyBlueprintCandidate(base,candidate);plan=applied.plan;run=applied.run;
      if(mode!=='pending'){
        const planPath=await service.savePlan(plan);paths.push(await service.saveBlueprintRun(run,{planPath}));
        if(mode==='multiple')paths.push(await service.saveBlueprintRun(run,{planPath}));
      }
    }else plan=core.addItem(base,index.items[0]);
    file('题库/B.md',question('B'));file('题库/C.md',question('C',{type:'fill_blank',difficulty:4}));file('题库/D.md',question('D',{family:'另一族'}));
    for(let i=0;i<extra;i++)file('题库/X'+i+'.md',question('X'+i));index=await service.scan();
    const view={plan,settings:clone(stored.assemblySettings),filters:clone(filters),index,closed:false,actionBusy:false,scanBusy:false,
      pendingBlueprintRun:mode==='pending'?run:null,populateFilters(){},renderTree(){},setPlan(value){this.plan=value;this.dirty=true;},setStatus(text){this.status=text;}};
    const calls={list:[],load:[],prepare:[],apply:[]},control={listGate:null,prepareGate:null,applyGate:null,applyResultReady:false},original={};
    for(const [key,method]of [['list','listMatchingBlueprintRuns'],['load','loadBlueprintRun'],['prepare','prepareFamilyReplacement'],['apply','applyFamilyReplacement']]){
      original[key]=service[method].bind(service);service[method]=async(...args)=>{
        calls[key].push(args);if(key==='list'&&control.listGate)await control.listGate.promise;if(key==='prepare'&&control.prepareGate)await control.prepareGate.promise;
        const result=await original[key](...args);if(key==='apply'){control.applyResultReady=true;if(control.applyGate)await control.applyGate.promise;}return result;
      };
    }
    const renderMarkdown=(md,node,path,owner,signal)=>{const gate=deferred();renderCalls.push({md,node,path,owner,signal});pending.push(gate);if(!previewDeferred)gate.resolve();return gate.promise.then(()=>{if(!signal?.aborted)node.textContent=md;});};
    const Type=createModal({Modal,Component,core,service,renderMarkdown}),entryId=plan.entries.find(e=>e.kind==='question').entryId,modal=new Type(app,plugin,view,entryId);view.familyModal=modal;
    const f={host,nodes,file,app,plugin,service,index,view,entryId,modal,run,paths,calls,control,owners,renderCalls,listeners,writes,renderMarkdown,
      close(){if(!modal.closed)modal.close();},finish(){for(const gate of pending)gate.resolve();for(const key of ['listGate','prepareGate','applyGate'])control[key]?.resolve();},unload(){for(const owner of [...owners])owner.unload();}};
    fixtures.push(f);if(open)await modal.open();return f;
  }
  const cards=f=>[...f.modal.results.querySelectorAll('.mwb-family-candidate')];
  const chooseCard=(f,id)=>cards(f).find(card=>card.dataset.candidateKey==='id:'+id);
  const refresh=async f=>{button(f.modal.contentEl,'刷新候选').click();await until(()=>!f.modal.busy&&f.modal.candidate,'candidate refresh did not complete');};

  await check('no matching sidecar uses same family and current filters with actual service wrappers',async()=>{
    const f=await fixture(),before=clone(f.view.plan),wrapper=f.modal.candidate;
    ok(f.modal.runSelect.value==='legacy'&&f.modal.runSelect.disabled,'legacy path is not explicit');ok(f.calls.load.length===0&&f.calls.prepare[0][0].run===undefined,'legacy path fabricated a run');
    eq(cards(f).map(card=>card.dataset.candidateKey),['id:B','id:C'],'wrong same-family candidates');
    ok(f.modal.results.textContent.includes('不推断历史配额'),'legacy boundary not explained');
    button(chooseCard(f,'B'),'选用此题').click();await until(()=>f.modal.closed,'ordinary replacement did not finish');
    ok(f.calls.apply[0][1]===wrapper,'UI cloned the WeakMap-issued wrapper');const expected=clone(before),item=f.view.index.items.find(i=>i.id==='B');
    Object.assign(expected.entries[1],{sourceId:item.id,sourcePath:item.path,sourceFingerprint:item.fingerprint});eq(f.view.plan,expected,'replacement changed position/title/role or other plan data');
    ok(!f.view.pendingBlueprintRun&&f.view.dirty,'ordinary replacement fabricated a run or lost dirty state');
  });

  await check('one exact saved run is selected automatically and its row constraints remain active',async()=>{
    const f=await fixture({mode:'single'});ok(f.modal.runSelect.value===f.paths[0]&&f.calls.load.length===1,'unique run not loaded automatically');
    eq(cards(f).map(card=>card.dataset.candidateKey),['id:B'],'saved choice row was relaxed');
    ok(f.modal.run.runId===f.run.runId&&f.modal.results.textContent.includes('保留原配额行条件'),'loaded run not retained');
    const old=clone(f.run);await f.modal.apply('id:B');ok(f.modal.closed&&f.view.pendingBlueprintRun.runId!==old.runId,'run replacement not queued as a new immutable run');
    eq(f.run,old,'old run mutated');ok(f.view.pendingBlueprintRun.assignments[0].sourceId==='B','new run binding is wrong');
  });

  await check('multiple exact records require explicit selection before any preparation',async()=>{
    const f=await fixture({mode:'multiple'});ok(f.modal.runSelect.value===''&&!f.modal.candidate&&f.calls.prepare.length===0,'ambiguous run was silently selected');
    await f.modal.prepare();ok(f.calls.prepare.length===0&&f.modal.statusEl.classList.contains('is-error'),'missing selection fell back to legacy');
    change(f.modal.runSelect,f.paths[1]);await refresh(f);ok(f.calls.load.at(-1)[0]===f.paths[1]&&f.modal.run.runId===f.run.runId,'explicit record choice was not used');
    eq(cards(f).map(card=>card.dataset.candidateKey),['id:B'],'selected row constraints were omitted');
  });

  await check('pending run takes precedence over persisted lookup and locked replacement requires explicit unlock',async()=>{
    const f=await fixture({mode:'pending',locked:true}),old=clone(f.run);ok(f.calls.list.length===0&&f.calls.load.length===0,'pending record still triggered persisted selection');
    ok(f.modal.runSelect.value==='pending'&&f.modal.runSelect.disabled&&f.modal.run===f.run,'pending identity not retained');
    ok(f.modal.candidate.status==='conflict'&&cards(f).length===0&&!f.modal.unlockInput.checked,'locked candidate was offered or implicitly unlocked');
    f.modal.unlockInput.click();await pause();ok(!f.modal.candidate,'unlock choice did not invalidate old candidates');await refresh(f);
    ok(f.calls.prepare.at(-1)[0].unlock===true&&cards(f).length===1,'explicit unlock did not reprepare under row constraints');eq(f.run,old,'checking unlock mutated old run');
    await f.modal.apply('id:B');ok(f.view.pendingBlueprintRun.runId!==old.runId&&!f.view.pendingBlueprintRun.locks.length,'new pending run lost explicit unlock');eq(f.run,old,'replacement rewrote old pending record');
  });

  await check('turning off current filters still preserves known quota filters and no-candidate state cannot apply',async()=>{
    const f=await fixture({mode:'single',filters:{kind:'question',questionType:'fill_blank',query:''}});
    ok(f.modal.candidate.status==='ready'&&!cards(f).length&&f.modal.statusEl.textContent.includes('没有满足'),'empty intersection was hidden or relaxed');
    ok(!button(f.modal.results,'选用此题'),'zero matches offered an apply control');
    f.modal.useFiltersInput.click();await pause();await refresh(f);eq(cards(f).map(card=>card.dataset.candidateKey),['id:B'],'disabling current filters also removed original row filter');
    eq(f.calls.prepare.at(-1)[0].filters,{kind:'question'},'current UI filter opt-out not reflected in request');
  });

  await check('a corrupted selected record fails explicitly and never falls back to an unconstrained candidate',async()=>{
    const f=await fixture({mode:'multiple'});f.nodes.get(f.paths[0]).content='{"schemaVersion":99}';change(f.modal.runSelect,f.paths[0]);await f.modal.prepare();
    ok(!f.modal.candidate&&!cards(f).length&&f.calls.prepare.length===0&&f.modal.statusEl.classList.contains('is-error'),'invalid selected record fell back or failed silently');
    ok(f.view.plan.entries[1].sourceId==='A','bad record changed the plan');
  });

  await check('plan, settings, filters and pending-record changes during apply prevent late publication atomically',async()=>{
    for(const mutation of ['plan','settings','filters','pending']){
      const f=await fixture({mode:'single'});f.control.applyGate=deferred();const work=f.modal.apply('id:B');await until(()=>f.control.applyResultReady,'actual service apply did not complete');
      if(mutation==='plan')f.view.plan=core.addSection(f.view.plan,'并发修改');else if(mutation==='settings')f.view.settings={...f.view.settings,recursive:false};else if(mutation==='filters')f.view.filters={...f.view.filters,query:'不同条件'};else f.view.pendingBlueprintRun={runId:'newer-pending'};
      const before=clone(f.view.plan),pending=f.view.pendingBlueprintRun;ok(!f.calls.apply[0][3].isCurrent(),'concurrent context remains current');
      f.control.applyGate.resolve();await work;eq(f.view.plan,before,'late result overwrote concurrent plan');ok(f.view.pendingBlueprintRun===pending&&!f.modal.closed&&f.modal.statusEl.classList.contains('is-error'),'late result overwrote pending or falsely closed');
    }
  });

  await check('close and plugin unload abort preparation and release preview ownership without late work',async()=>{
    const f=await fixture({open:false});f.control.prepareGate=deferred();const opening=f.modal.open();await until(()=>f.calls.prepare.length===1,'initial prepare not started');f.modal.close();
    ok(f.calls.prepare[0][1].signal.aborted,'closing did not abort preparation');f.control.prepareGate.resolve();await opening;ok(!f.modal.candidate&&!f.modal.contentEl.childElementCount&&!f.view.familyModal,'late preparation revived modal');ok(f.listeners.size===0,'cancel leaked service source listeners');
    const g=await fixture({extra:4,previewDeferred:true});ok(g.renderCalls.length===2,'preview queue was not bounded');const old=g.renderCalls.slice();g.unload();g.finish();await pause();
    ok(g.modal.closed&&old.every(call=>call.signal.aborted&&!call.owner.loaded)&&g.owners.every(owner=>!owner.loaded),'unload did not release component/preview lifetimes');
    ok(g.renderCalls.length===2&&!g.modal.candidate&&!g.view.familyModal,'unload restarted queued previews or retained candidate');
  });

  await check('preview uses original source paths and card actions use candidate identity independently of index UI keys',async()=>{
    const f=await fixture();ok(f.renderCalls.length===2&&f.renderCalls.every(call=>call.path.startsWith('题库/')&&!call.md.startsWith('---')),'preview source context/frontmatter boundary incorrect');
    const wrapper=f.modal.candidate,original=wrapper.index.items.find(item=>item.id==='B');original.key='path:'+original.path;f.modal.renderCandidates();
    ok(chooseCard(f,'B'),'candidate card depended on a presentation index key');await f.modal.apply('id:B');ok(f.modal.closed&&f.view.plan.entries[1].sourceId==='B','candidate identity not forwarded to actual service');
  });

  await check('actual AssemblyView exposes family filters, family navigation and per-entry replacement without changing plan schema',async()=>{
    const f=await fixture({open:false});f.modal.close();const opened=[];
    const Type=createView({ItemView,Component,Notice:class{},core,service:f.service,renderMarkdown:f.renderMarkdown,openFamily:(view,entryId)=>opened.push({view,entryId})});
    const view=new Type({app:f.app},f.plugin);f.realView=view;await view.onOpen();
    ok(view.filterSelects.familyId&&view.filterSelects.familyState,'family filters missing from actual view');
    const option=[...view.filterSelects.familyId.options].find(option=>option.value==='同族甲');ok(option&&option.textContent.includes('3 题'),'family filter group count incorrect');
    const card=[...view.results.querySelectorAll('.mwb-assembly-result')].find(card=>card.dataset.sourcePath==='题库/A.md');button(card,'查看题族').click();await pause();
    ok(view.filters.familyId==='同族甲'&&view.filters.kind==='question'&&view.results.querySelectorAll('.mwb-assembly-result').length===3,'family navigation did not filter actual cards');
    const restored=clone(view.getState());const Type2=createView({ItemView,Component,Notice:class{},core,service:f.service,renderMarkdown:f.renderMarkdown});const other=new Type2({app:f.app},f.plugin);await other.setState(restored,{});ok(other.filters.familyId==='同族甲','family filter did not round-trip workspace state');
    view.setPlan(clone(f.view.plan));view.switchWorkspaceMode('arrangement');const action=view.contentEl.querySelector('[data-arrangement-action="family"]')||button(view.contentEl,'同族换题');ok(action,'entry replacement action absent');action.click();await pause();
    ok(opened.length===1&&opened[0].view===view&&opened[0].entryId===f.entryId,'replacement entry callback used wrong identity');
    eq(Object.keys(view.plan).sort(),['course','entries','output','schemaVersion','title'],'family UI extended plan v3');await view.onClose();await other.onClose();
  });

  const questionCards=view=>[...view.results.querySelectorAll('.mwb-assembly-result')];
  const activeFilters=view=>Object.fromEntries(Object.entries(view.filters).filter(([key,value])=>key==='kind'||key==='query'||value!==''));
  const familyButton=(view,path)=>button(questionCards(view).find(card=>card.dataset.sourcePath===path),'查看题族');
  async function openNavigationView(f,extra={}) {
    f.modal.close();const Type=createView({ItemView,Component,Notice:class{},core,service:f.service,renderMarkdown:f.renderMarkdown,...extra});
    const view=new Type({app:f.app},f.plugin),close=f.close;f.realView=view;
    f.close=async()=>{if(!view.closed)await view.onClose();await close();};
    await view.onOpen();view.setPlan(clone(f.view.plan));return view;
  }
  const navigationSnapshot=f=>({plan:clone(f.realView.plan),writes:[...f.writes],sources:[...f.nodes.values()].filter(node=>node.extension==='md').map(node=>[node.path,node.content])});
  const assertNoNavigationWrite=(f,before)=>eq(navigationSnapshot(f),before,'family navigation changed the plan or source notes');

  await check('view-family click presents a focused family overview and re-enters an already selected family',async()=>{
    const f=await fixture({open:false}),view=await openNavigationView(f),before=navigationSnapshot(f);
    view.filters={kind:'question',query:'A',subject:'高中数学'};view.searchInput.value='A';view.populateFilters();view.renderResults();
    familyButton(view,'题库/A.md').click();await pause();
    const overview=view.results.querySelector('.mwb-assembly-family-overview'),heading=overview?.querySelector('.mwb-assembly-family-title');
    ok(heading&&heading.textContent==='题族：同族甲','view-family click did not show the family destination');
    eq(activeFilters(view),{kind:'question',query:'',familyId:'同族甲'},'family navigation retained old content filters');
    ok(questionCards(view).length===3&&document.activeElement===heading,'family overview did not receive focus or show all three members');
    ok(typeof view.showFamily==='function'&&typeof view.navigateQuestionResults==='function','family navigation is not routed through the shared navigation methods');
    const sameFamilyButton=familyButton(view,'题库/A.md'),source=view.index.items.find(item=>item.id==='A');
    await view.showItem(source,'results');view.resultsDisclosure.open=false;
    view.workspaceAnchors.library={path:source.path,kind:'question',top:300};view.workspaceScroll.library=300;
    view.switchPane('filters');
    sameFamilyButton.click();await pause();
    const nextHeading=view.results.querySelector('.mwb-assembly-family-title');
    ok(view.workspaceMode==='library'&&view.activePane==='library','same-family click did not return to the selection pane');
    ok(!view.center.classList.contains('is-previewing')&&!view.selectedItem&&!view.previewReturn,'old preview still hides the family list');
    ok(view.resultsDisclosure.open&&document.activeElement===nextHeading,'same-family click did not expand and focus the destination');
    ok(view.workspaceAnchors.library===null,'old reading anchor survived family navigation');
    assertNoNavigationWrite(f,before);
  });

  for(const usageState of ['ready','error','loading'])await check('view-family clears P2 usage filtering in '+usageState+' state before showing the complete family',async()=>{
    const f=await fixture({open:false}),usageCalls=[];
    const usageService={loadUsage:async()=>({events:[]}),summarizeUsage:()=>[],filterUsage(items,ledger,options){usageCalls.push(options.mode);return options.mode==='all'?items:items.filter(item=>item.id==='A');}};
    const view=await openNavigationView(f,{usageService}),before=navigationSnapshot(f);
    view.usageFilter={classId:'C1',courseId:'M1',mode:'unused',days:30};view.usageState='ready';view.usageLedger={events:[]};view.renderResults();
    ok(questionCards(view).length===1,'usage seam did not limit the initial visible cards');
    const target=familyButton(view,'题库/A.md');
    view.usageState=usageState;view.usageError='合成读取错误';if(usageState!=='ready')view.usageLedger=null;
    const generation=view.usageGeneration;target.click();await pause();
    ok(view.usageFilter.mode==='all'&&view.usageGeneration>generation,'view-family did not cancel the old usage condition');
    ok(questionCards(view).length===3,'usage '+usageState+' state still hides members of the family');
    ok(view.results.querySelector('.mwb-assembly-family-title')?.textContent==='题族：同族甲','usage state prevented family destination rendering');
    ok(!view.results.textContent.includes('使用记录待核对'),'family destination is blocked by an irrelevant usage ledger');
    assertNoNavigationWrite(f,before);
  });

  await check('single-member family explains the empty alternatives and return-all restores all four questions',async()=>{
    const f=await fixture({open:false}),view=await openNavigationView(f),before=navigationSnapshot(f);
    familyButton(view,'题库/D.md').click();await pause();
    const overview=view.results.querySelector('.mwb-assembly-family-overview');
    ok(overview?.querySelector('.mwb-assembly-family-title')?.textContent==='题族：另一族','singleton family destination missing');
    ok(overview.textContent.includes('当前仅收录这一题，暂无其他同族题。'),'singleton family looks like a non-working button');
    ok(questionCards(view).length===1&&questionCards(view)[0].dataset.sourcePath==='题库/D.md','singleton lookup removed its own source');
    const back=button(overview,'返回全部题目');ok(back,'family overview has no return path');back.click();await pause();
    eq(activeFilters(view),{kind:'question',query:''},'return-all retained a family or content filter');
    ok(questionCards(view).length===4&&!view.results.querySelector('.mwb-assembly-family-overview'),'return-all did not restore the complete question list');
    ok(view.workspaceMode==='library'&&view.activePane==='library'&&view.resultsDisclosure.open,'return-all did not make the destination visible');
    assertNoNavigationWrite(f,before);
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('family modal and AssemblyView contracts with the actual service in Chromium',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for family UI tests');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries([['fragments','assembly-fragments.cjs'],['core','assembly-core.cjs'],['blueprint','assembly-blueprint.cjs'],['family','assembly-family.cjs'],['service','assembly-service.cjs'],['ui','assembly-family-ui.cjs'],['view','assembly-view.cjs']].map(([key,file])=>[key,fs.readFileSync(path.join(root,'src',file),'utf8')]));
  const script='('+browserCases.toString()+')('+JSON.stringify(sources)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
  const html='<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';
  const server=http.createServer((request,response)=>{
    if(request.method==='POST'&&request.url==='/sha256'){let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>8*1024*1024)request.destroy();});request.on('end',()=>{response.setHeader('Content-Type','text/plain');response.end(crypto.createHash('sha256').update(body).digest('hex'));});}
    else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);}
  });
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-family-ui-'));
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
    const results=await runChromeDocument(chrome,null,path.join(dir,'profile'),{url});
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
