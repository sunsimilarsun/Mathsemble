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
  let fragmentApi,similarityTextApi;
  const load=source=>{const module={exports:{}};new Function('module','require','MWB_ASSEMBLY_FRAGMENTS','MWB_ASSEMBLY_SIMILARITY_TEXT',source)(module,name=>{if(name==='node:crypto')return nodeCrypto;throw Error('Unexpected browser require '+name);},fragmentApi,similarityTextApi);return module.exports;};
  fragmentApi=load(sources.fragments);
  similarityTextApi=load(sources.similarityText);
  const core=load(sources.core),blueprintEngine=load(sources.blueprint).createBlueprintEngine({core}),familyEngine=load(sources.family).createFamilyEngine({core}),similarityEngine=load(sources.similarity).createSimilarityEngine({core});
  const createService=load(sources.service),createModal=load(sources.ui),createView=load(sources.view);
  const button=(node,label)=>[...node.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
  const change=(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));};
  const check=async(name,fn)=>{const before=fixtures.length;try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}finally{for(const f of fixtures.splice(before)){await f.close();f.finish();f.host.remove();}await pause();}};
  class Component {constructor(){this.loaded=false;this.callbacks=[];this.children=new Set();}register(fn){this.callbacks.push(fn);}load(){this.loaded=true;}unload(){if(!this.loaded)return;this.loaded=false;for(const c of [...this.children])this.removeChild(c);for(const fn of this.callbacks.splice(0).reverse())fn();}addChild(c){this.children.add(c);c.load();}removeChild(c){this.children.delete(c);c.unload();}}
  class Modal {constructor(app){this.app=app;this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);app.host.append(this.modalEl);}open(){return this.onOpen();}close(){if(this._closing)return;this._closing=true;this.onClose();this.modalEl.remove();}}
  class ItemView extends Component {constructor(leaf){super();this.app=leaf.app;this.contentEl=document.createElement('div');leaf.app.host.append(this.contentEl);}}
  const question=(id,{family='同族甲',type='choice',difficulty=2,...other}={})=>'---\n'+JSON.stringify({id,title:id==='A'?'卷内原题标题':'候选 '+id,subject:'高中数学',question_type:type,difficulty,role:id==='A'?'例题':'训练',family_id:family,knowledge_nodes:['二次函数最值'],methods:['配方法'],...other})+'\n---\n'+id+' 合成题干 $1+1=?{2}$。';
  async function fixture({mode='none',locked=false,filters={kind:'question',query:''},extra=0,previewDeferred=false,open=true,browse=false}={}) {
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
    const service=createService(plugin,{core,blueprintEngine,familyEngine,similarityEngine,parseYaml:JSON.parse}),base=core.addSection(core.createPlan('原讲义'),'原分区');let index=await service.scan(),plan,run,paths=[];
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
    const calls={list:[],load:[],prepare:[],apply:[],find:[]},control={listGate:null,prepareGate:null,findGate:null,applyGate:null,applyResultReady:false},original={};
    for(const [key,method]of [['list','listMatchingBlueprintRuns'],['load','loadBlueprintRun'],['find','findSimilarQuestions'],['prepare','prepareSimilarityReplacement'],['apply','applySimilarityReplacement']]){
      original[key]=service[method].bind(service);service[method]=async(...args)=>{
        calls[key].push(args);if(key==='list'&&control.listGate)await control.listGate.promise;if(key==='prepare'&&control.prepareGate)await control.prepareGate.promise;if(key==='find'&&control.findGate)await control.findGate.promise;
        const result=await original[key](...args);if(key==='apply'){control.applyResultReady=true;if(control.applyGate)await control.applyGate.promise;}return result;
      };
    }
    const renderMarkdown=(md,node,path,owner,signal)=>{const gate=deferred();renderCalls.push({md,node,path,owner,signal});pending.push(gate);if(!previewDeferred)gate.resolve();return gate.promise.then(()=>{if(!signal?.aborted)node.textContent=md;});};
    const Type=createModal({Modal,Component,core,service,renderMarkdown}),entryId=plan.entries.find(e=>e.kind==='question').entryId,modal=new Type(app,plugin,view,browse?{sourceKey:"id:A"}:{entryId});view.similarityModal=modal;
    const f={host,nodes,file,app,plugin,service,index,view,entryId,modal,run,paths,calls,control,owners,renderCalls,listeners,writes,renderMarkdown,
      close(){if(!modal.closed)modal.close();},finish(){for(const gate of pending)gate.resolve();for(const key of ['listGate','prepareGate','findGate','applyGate'])control[key]?.resolve();},unload(){for(const owner of [...owners])owner.unload();}};
    fixtures.push(f);if(open)await modal.open();return f;
  }
  const cards=f=>[...f.modal.results.querySelectorAll('.mwb-similarity-candidate')];
  const chooseCard=(f,id)=>cards(f).find(card=>card.dataset.candidateKey==='id:'+id);
  const refresh=async f=>{const previous=f.modal.candidate;button(f.modal.contentEl,'刷新候选').click();await until(()=>!f.modal.busy&&f.modal.candidate&&f.modal.candidate!==previous,'candidate refresh did not complete');};


  await check('browse offers three modes and explained candidates without mutating a plan or fetching quota records',async()=>{
    const f=await fixture({browse:true}),before=clone(f.view.plan);
    eq([...f.modal.modeSelect.options].map(o=>[o.value,o.textContent]),[['family','同族'],['knowledge','同考点'],['method','同方法']],'three modes not accessible');
    ok(f.calls.find.length===1&&f.calls.list.length===0&&f.calls.prepare.length===0,'browse used a replacement or quota request');
    eq(f.calls.find[0][0],{sourceKey:'id:A',mode:'knowledge',filters:{kind:'question'},excludedKeys:[]},'browse request wrong');
    ok(chooseCard(f,'B')&&chooseCard(f,'D'),'cross-family knowledge candidates missing');
    ok(cards(f).every(card=>card.querySelector('.mwb-similarity-reasons')?.textContent.includes('匹配依据')),'candidate explanations missing');
    ok(chooseCard(f,'C').querySelector('.mwb-similarity-difficulty').textContent.includes('高 2 级'),'difficulty difference missing');
    ok(!button(f.modal.results,'选用此题'),'read-only browsing exposed replacement');
    eq(f.view.plan,before,'browse changed plan');ok(!f.writes.length,'browse wrote content');
  });

  await check('mode change invalidates old wrappers and preview owners before recomputing the new relation',async()=>{
    const f=await fixture({browse:true,previewDeferred:true}),previous=f.modal.candidate,owners=f.renderCalls.slice();
    change(f.modal.modeSelect,'family');ok(!f.modal.candidate&&!cards(f).length,'mode change left stale candidates usable');
    ok(owners.every(call=>call.signal.aborted&&!call.owner.loaded),'mode change leaked old previews');
    await refresh(f);ok(f.modal.candidate!==previous&&f.calls.find.at(-1)[0].mode==='family','new mode reused old wrapper');
    ok(chooseCard(f,'B')&&!chooseCard(f,'D'),'family mode did not constrain family');
    change(f.modal.modeSelect,'method');await refresh(f);ok(f.calls.find.at(-1)[0].mode==='method'&&chooseCard(f,'D'),'method mode was not searched');
  });

  await check('metadata gaps remain visible without presenting a score as an equivalence probability',async()=>{
    const f=await fixture({browse:true});f.file('题库/E.md',question('E',{family:'另一族',difficulty:null,methods:[]}));await refresh(f);
    const card=chooseCard(f,'E');ok(card&&card.querySelector('.mwb-similarity-missing')?.textContent.includes('信息不足'),'missing evidence was hidden');
    ok(card.querySelector('.mwb-similarity-difficulty').textContent.includes('未填写难度'),'unknown difficulty looks compatible');
    ok(!/%|概率/.test(card.textContent),'ranking was presented as probability');
  });

  await check('legacy cards without labels explain the missing evidence in knowledge and method modes',async()=>{
    const f=await fixture({browse:true});f.nodes.get('题库/A.md').content=question('A',{knowledge_nodes:[],methods:[]});await refresh(f);
    ok(f.modal.candidate.status==='ready'&&!cards(f).length,'legacy card fabricated comparable knowledge');
    ok(f.modal.statusEl.textContent.includes('原题缺少可比较的知识点标签')&&f.modal.results.querySelector('.mwb-similarity-issues')?.textContent.includes('知识点标签'),'knowledge gap was reduced to generic empty results');
    change(f.modal.modeSelect,'method');await refresh(f);
    ok(!cards(f).length&&f.modal.statusEl.textContent.includes('原题缺少可比较的方法标签'),'method gap not explained');
    f.nodes.get('题库/A.md').content=question('A',{knowledge_nodes:['[[知识/不存在的知识页.md]]'],methods:[]});change(f.modal.modeSelect,'knowledge');await refresh(f);
    ok(f.modal.results.querySelector('.mwb-similarity-issues')?.textContent.includes('未解析'),'unresolved label diagnostic hidden');
    f.nodes.get('题库/A.md').content=question('A',{knowledge_nodes:['[[仅原题声明的标签]]'],methods:[]});await refresh(f);
    ok(!cards(f).length&&f.modal.results.querySelector('.mwb-similarity-issues')?.textContent.includes('仅按同名标签比较，原链接未解析'),'unresolved plain Wiki without candidates hid its diagnostic');
  });

  await check('replacement uses the actual service wrapper, preserves plan layout and accepts a different family',async()=>{
    const f=await fixture(),before=clone(f.view.plan),wrapper=f.modal.candidate;
    ok(chooseCard(f,'D'),'related different-family candidate absent');await f.modal.apply('id:D');
    ok(f.modal.closed&&f.calls.apply[0][1]===wrapper,'issued wrapper was cloned or replacement did not finish');
    const expected=clone(before),item=f.view.index.items.find(i=>i.id==='D');Object.assign(expected.entries[1],{sourceId:item.id,sourcePath:item.path,sourceFingerprint:item.fingerprint});
    eq(f.view.plan,expected,'replacement changed slot metadata or plan schema');ok(!f.view.pendingBlueprintRun,'legacy plan fabricated quota facts');
  });

  await check('multiple saved quota records require explicit selection and cannot be bypassed by turning filters off',async()=>{
    const f=await fixture({mode:'multiple',filters:{kind:'question',query:'',questionType:'fill_blank'}});
    ok(!f.modal.candidate&&f.calls.prepare.length===0&&f.modal.runSelect.value==='','ambiguous quota was silently selected');
    change(f.modal.runSelect,f.paths[1]);await refresh(f);ok(!cards(f).length,'current and row constraints were not intersected');
    f.modal.useFiltersInput.click();await refresh(f);ok(chooseCard(f,'B')&&chooseCard(f,'D')&&!chooseCard(f,'C'),'turning off current filters relaxed the saved choice row');
    await f.modal.apply('id:D');ok(f.modal.closed&&f.view.pendingBlueprintRun.runId!==f.run.runId,'new allocation record was not retained');
    ok(f.view.pendingBlueprintRun.assignments[0].sourceId==='D','new record points at the old item');
  });

  await check('pending quota locks require explicit unlock while retaining their row constraints',async()=>{
    const f=await fixture({mode:'pending',locked:true}),before=clone(f.run);
    ok(f.calls.list.length===0&&f.modal.runSelect.value==='pending','pending quota was not preferred');
    ok(f.modal.candidate.status!=='ready'&&!cards(f).length&&!f.modal.unlockInput.checked,'lock was implicitly released');
    f.modal.unlockInput.click();await refresh(f);ok(f.calls.prepare.at(-1)[0].unlock===true&&chooseCard(f,'D')&&!chooseCard(f,'C'),'explicit unlock bypassed row constraints');
    eq(f.run,before,'old run was mutated');
  });

  await check('plan, settings, filter and mode changes reject an apply result that finishes late',async()=>{
    for(const mutation of ['plan','settings','filters','mode']){
      const f=await fixture();f.control.applyGate=deferred();const work=f.modal.apply('id:D');await until(()=>f.control.applyResultReady,'apply did not reach publication gate');
      if(mutation==='plan')f.view.plan=core.addSection(f.view.plan,'并发变化');else if(mutation==='settings')f.view.settings={...f.view.settings,recursive:false};else if(mutation==='filters')f.view.filters={...f.view.filters,query:'新条件'};else change(f.modal.modeSelect,'family');
      const before=clone(f.view.plan);ok(!f.calls.apply[0][3].isCurrent(),'late operation still current');f.control.applyGate.resolve();await work;
      eq(f.view.plan,before,'late result overwrote newer workspace');ok(!f.modal.closed,'failed application falsely closed');
    }
  });

  await check('closing in-flight search and unloading previews release all owners and never revive results',async()=>{
    const f=await fixture({browse:true,open:false});f.control.findGate=deferred();const opening=f.modal.open();await until(()=>f.calls.find.length===1,'search did not start');f.modal.close();
    ok(f.calls.find[0][1].signal.aborted,'close did not abort search');f.control.findGate.resolve();await opening;
    ok(!f.modal.candidate&&!f.modal.contentEl.childElementCount&&!f.view.similarityModal,'late search revived modal');ok(f.listeners.size===0,'search leaked source watchers');
    const g=await fixture({browse:true,extra:35,previewDeferred:true});await pause();ok(g.renderCalls.length===2,'preview concurrency exceeded two');
    ok(cards(g).length===30&&button(g.modal.results,'再显示 30 道'),'candidate pagination missing');g.unload();g.finish();await pause();
    ok(g.modal.closed&&g.renderCalls.length===2&&g.owners.every(o=>!o.loaded),'unload restarted previews or retained owner');
    ok(g.renderCalls.every(call=>call.signal.aborted&&call.path.startsWith('题库/')&&!call.md.startsWith('---')),'preview source context or abort lost');
  });

  await check('actual AssemblyView exposes browsing and replacement entries, preserves the family entry and invalidates workspace changes',async()=>{
    const f=await fixture({open:false});f.modal.close();const opened=[];
    const Type=createView({ItemView,Component,Notice:class{},core,service:f.service,renderMarkdown:f.renderMarkdown,
      openFamily:(view,entryId)=>opened.push({kind:'family',view,entryId}),openSimilarity:(view,options)=>opened.push({kind:'similarity',view,options})});
    const view=new Type({app:f.app},f.plugin);await view.onOpen();
    const card=[...view.results.querySelectorAll('.mwb-assembly-result')].find(card=>card.dataset.sourcePath==='题库/A.md');button(card,'找相似题').click();await pause();
    ok(opened.length===1&&opened[0].view===view&&opened[0].options.sourceKey==='id:A','browse entry lost source identity');
    view.setPlan(clone(f.view.plan));view.switchWorkspaceMode('arrangement');const action=view.contentEl.querySelector('[data-arrangement-action="similarity"]');ok(action,'similarity replacement entry absent');action.click();await pause();
    ok(opened[1].options.entryId===f.entryId,'replacement entry lost slot identity');ok(view.contentEl.querySelector('[data-arrangement-action="family"]'),'existing family entry removed');
    let invalidated=0,checked=0,closed=0;view.similarityModal={invalidate(){invalidated++;},checkWorkspace(){checked++;},close(){closed++;}};
    view.setPlan(core.addSection(view.plan,'新增分区'));ok(invalidated&&checked,'plan changes did not invalidate similarity work');await view.onClose();ok(closed===1,'view close left similarity modal open');
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('similarity modal and AssemblyView contracts with the actual service in Chromium',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for similarity UI tests');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries([['fragments','assembly-fragments.cjs'],['core','assembly-core.cjs'],['blueprint','assembly-blueprint.cjs'],['family','assembly-family.cjs'],['similarityText','assembly-similarity-text.cjs'],['similarity','assembly-similarity.cjs'],['service','assembly-service.cjs'],['ui','assembly-similarity-ui.cjs'],['view','assembly-view.cjs']].map(([key,file])=>[key,fs.readFileSync(path.join(root,'src',file),'utf8')]));
  const script='('+browserCases.toString()+')('+JSON.stringify(sources)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
  const html='<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';
  const server=http.createServer((request,response)=>{
    if(request.method==='POST'&&request.url==='/sha256'){let body='';request.setEncoding('utf8');request.on('data',chunk=>{body+=chunk;if(body.length>8*1024*1024)request.destroy();});request.on('end',()=>{response.setHeader('Content-Type','text/plain');response.end(crypto.createHash('sha256').update(body).digest('hex'));});}
    else{response.setHeader('Content-Type','text/html; charset=utf-8');response.end(html);}
  });
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-similarity-ui-'));
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/';
    const results=await runChromeDocument(chrome,null,path.join(dir,'profile'),{url});
    for(const result of results)await t.test(result.name,()=>assert.equal(result.ok,true,result.error));
  }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
