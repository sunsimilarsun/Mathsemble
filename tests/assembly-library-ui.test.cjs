'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..'),chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&fs.existsSync(p));
async function browserCases(sources){
  const results=[],fixtures=[],ok=(v,m)=>{if(!v)throw Error(m);},pause=()=>new Promise(r=>setTimeout(r,0));
  const until=async(fn,m)=>{const end=Date.now()+3500;while(!fn()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));ok(fn(),m);};
  const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
  class BrowserBuffer extends Uint8Array {
    static from(value,encoding){if(typeof value==='string'){if(encoding==='base64')return new BrowserBuffer(Uint8Array.from(atob(value),c=>c.charCodeAt(0)));return new BrowserBuffer(new TextEncoder().encode(value));}return new BrowserBuffer(value instanceof ArrayBuffer?new Uint8Array(value):value);}
    toString(encoding='utf8'){if(encoding==='base64'){let value='';for(let i=0;i<this.length;i+=32768)value+=String.fromCharCode(...this.subarray(i,i+32768));return btoa(value);}return new TextDecoder('utf-8',{ignoreBOM:true}).decode(this);}
  }
  const nodeCrypto={randomUUID:()=>crypto.randomUUID(),createHash(algorithm){ok(algorithm==='sha256','unexpected algorithm');const chunks=[];return {update(value){chunks.push(BrowserBuffer.from(value));return this;},digest(format){ok(format==='hex','unexpected digest format');const bytes=new Uint8Array(chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}const xhr=new XMLHttpRequest();xhr.open('POST','/sha256',false);xhr.send(bytes);ok(xhr.status===200,'hash bridge failed');return xhr.responseText;}};}};
  const load=source=>{const module={exports:{}};new Function('module','require',source)(module,name=>{if(name==='node:crypto')return nodeCrypto;if(name==='node:buffer')return {Buffer:BrowserBuffer};if(name==='./assembly-fragments.cjs')return load(sources.fragments);throw Error('unexpected require '+name);});return module.exports;};
  const core=load(sources.core),markdown=load(sources.markdown),createAssembly=load(sources.assembly),createLibrary=load(sources.library).createLibraryService,createModal=load(sources.ui);
  const button=(node,label)=>[...node.querySelectorAll('button')].find(b=>b.textContent===label);
  const click=async(node,label)=>{const b=button(node,label);ok(b&&!b.disabled,'missing/enabled '+label);b.click();await pause();};
  const question=(id,body='题干 ?{2}')=>'---\n'+JSON.stringify({id,subject:'数学',question_type:'fill_blank',family_id:null})+'\n---\n'+body;
  class Modal {constructor(app){this.app=app;this.modalEl=document.createElement('div');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);app.host.append(this.modalEl);}open(){return this.onOpen();}close(){if(this._closing)return;this._closing=true;this.onClose();this.modalEl.remove();}}
  async function fixture(initial={}){
    const host=document.createElement('section');document.body.append(host);const nodes=new Map(),listeners=new Set(),opened=[],writes=[];
    const trigger=(type,...args)=>{for(const row of [...listeners])if(row.type===type)row.fn(...args);};
    const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,name:path.split('/').pop(),children:[],parent};nodes.set(path,node);parent?.children.push(node);return node;};
    const file=(path,text)=>{const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,name=path.split('/').pop(),node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),bytes:BrowserBuffer.from(text),parent};nodes.set(path,node);parent?.children.push(node);trigger('create',node);return node;};
    folder('题库');for(const [p,text]of Object.entries(initial))file(p,text);
    const app={host,workspace:{getLeaf:()=>({openFile:async file=>opened.push(file.path)})}},vault=app.vault={getAbstractFileByPath:p=>nodes.get(p)||null,getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),getFiles:()=>[...nodes.values()].filter(n=>!n.children),
      on:(type,fn)=>{const row={type,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),read:async n=>n.bytes.toString(),readBinary:async n=>Uint8Array.from(n.bytes).buffer,
      createFolder:async p=>{if(nodes.has(p))throw Error('exists');const n=folder(p);trigger('create',n);return n;},create:async(p,text)=>{if(nodes.has(p))throw Error('exists');writes.push(p);return file(p,text);},createBinary:async(p,bytes)=>{if(nodes.has(p))throw Error('exists');writes.push(p);return file(p,bytes);},
      delete:async n=>{nodes.delete(n.path);if(n.parent)n.parent.children=n.parent.children.filter(c=>c!==n);trigger('delete',n);}};
    const plugin={app,loadData:async()=>({assemblySettings:{questionRoots:['题库'],knowledgeRoots:[],recursive:true}})},assembly=createAssembly(plugin,{core,parseYaml:JSON.parse});
    const service=createLibrary({vault,core,assemblyService:assembly,parseYaml:JSON.parse,collectMediaDependencies:markdown.collectMediaDependencies});
    const calls={commit:0,undo:0,stage:0,pack:0};for(const [key,name]of [['commit','commitBatch'],['undo','undoBatch'],['stage','stageImport'],['pack','exportTransfer']]){const fn=service[name];service[name]=async(...args)=>{calls[key]++;return fn(...args);};}
    let plan=core.createPlan('当前编排');const index=await assembly.scan();for(const item of index.items)plan=core.addItem(plan,item);
    const Type=createModal({Modal,Notice:class{},service,getPlan:()=>plan}),modal=new Type(app),f={host,nodes,file,vault,assembly,service,modal,calls,writes,opened,listeners,plan,close:()=>modal.close()};fixtures.push(f);await modal.open();return f;
  }
  const check=async(name,fn)=>{const before=fixtures.length;try{await fn();results.push({name,ok:true});}catch(e){results.push({name,ok:false,error:String(e.stack||e)});}finally{for(const f of fixtures.splice(before)){f.close();f.host.remove();}await pause();}};
  const upload=(modal,name,text)=>{const data=new DataTransfer();data.items.add(new File([text],name,{type:'text/markdown'}));modal.inputFiles.files=data.files;};
  const settle=async modal=>until(()=>!modal.busy,'UI operation did not settle');

  await check('diagnostics use the real service, expose omitted metadata cards and open the original note',async()=>{
    const f=await fixture({'题库/missing.md':'---\n{"subject":"数学"}\n---\n待核题干'});await click(f.modal.contentEl,'扫描当前题库');await settle(f.modal);
    ok(f.modal.diagnosticList.textContent.includes('question_type')&&f.modal.diagnosticList.textContent.includes('缺少元信息：id'),'unindexed metadata problems absent');
    await click(f.modal.diagnosticList,'打开原文');await settle(f.modal);ok(f.opened[0]==='题库/missing.md','diagnostic did not open real source');ok(!f.writes.length,'diagnostic wrote files');
  });
  await check('actual upload stages original bytes, requires confirmation, commits and undoes through buttons',async()=>{
    const f=await fixture();await click(f.modal.contentEl,'待入库批次');upload(f.modal,'A.md',question('A'));await click(f.modal.contentEl,'保存为待入库批次');await settle(f.modal);
    ok(f.modal.batch&&f.calls.stage===1&&!f.nodes.has('导入题库/A.md'),'staging directly published a card');ok(f.modal.commitButton.disabled,'commit enabled before confirmation');f.modal.commitButton.click();await pause();ok(!f.calls.commit,'disabled commit reached service');
    f.modal.confirm.click();ok(!f.modal.commitButton.disabled,'confirmation did not enable valid batch');await click(f.modal.contentEl,'确认入库');await settle(f.modal);ok(f.calls.commit===1&&f.nodes.has('导入题库/A.md'),'confirmed create did not reach actual service');ok(f.modal.batch.status==='committed','UI did not show committed state');
    ok(!f.modal.confirm.checked,'confirmation persisted across operation');f.modal.confirm.click();await click(f.modal.contentEl,'撤销本批创建');await settle(f.modal);ok(f.calls.undo===1&&!f.nodes.has('导入题库/A.md'),'undo did not reach actual service');ok(f.nodes.has(f.modal.batch.originals[0].stagePath)&&f.modal.batch.status==='undone','undo deleted evidence or state is wrong');
  });
  await check('same normalized ID conflicts disable confirmation even when its checkbox is checked',async()=>{
    const f=await fixture({'题库/old.md':question(' A ')});await click(f.modal.contentEl,'待入库批次');upload(f.modal,'incoming.md',question('A'));await click(f.modal.contentEl,'保存为待入库批次');await settle(f.modal);
    ok(f.modal.batch.issues.some(i=>i.code==='id-conflict'),'actual service conflict missing');f.modal.confirm.click();ok(f.modal.commitButton.disabled,'conflicting batch can be committed');f.modal.commitButton.click();await pause();ok(f.calls.commit===0&&!f.nodes.has('导入题库/incoming.md'),'conflict bypassed confirmation gate');
  });
  await check('current-plan packaging stages into another empty Vault and preserves a resolvable imported plan',async()=>{
    const source=await fixture({'题库/A.md':question('A','![图](../assets/a.png)'),'assets/a.png':new Uint8Array([0,255,1])});await click(source.modal.contentEl,'材料包');await click(source.modal.contentEl,'封装当前编排');await settle(source.modal);
    ok(source.calls.pack===1&&source.modal.packageText.value,'package button did not capture current plan');const value=JSON.parse(source.modal.packageText.value);ok(value.files.length===3,'source/image/plan package incomplete');
    const target=await fixture();await click(target.modal.contentEl,'材料包');target.modal.packageText.value=source.modal.packageText.value;await click(target.modal.contentEl,'将此材料包暂存待入库');await settle(target.modal);
    ok(target.modal.activePanel==='batch'&&target.modal.batch&&!target.nodes.has('导入题库/题库/A.md'),'package staging skipped review');target.modal.confirm.click();await click(target.modal.contentEl,'确认入库');await settle(target.modal);
    ok(target.nodes.has('导入题库/题库/A.md')&&target.nodes.has('导入题库/assets/a.png'),'package commit lost a source or image');
    const planFile=target.modal.batch.files.find(f=>f.kind==='plan'),plan=JSON.parse(target.nodes.get(planFile.targetPath).bytes.toString()),index=await target.assembly.scan({questionRoots:['导入题库/题库'],knowledgeRoots:[],recursive:true});ok(core.resolvePlan(plan,index).issues.length===0,'imported plan references were not remapped');
  });
  await check('unknown schema stays staged as original evidence with submission disabled',async()=>{
    const f=await fixture();await click(f.modal.contentEl,'材料包');f.modal.packageText.value='{"schemaVersion":99,"format":"mathsemble-transfer-v1"}';await click(f.modal.contentEl,'将此材料包暂存待入库');await settle(f.modal);
    ok(f.modal.batch.status==='blocked'&&f.nodes.has(f.modal.batch.originals[0].stagePath),'unknown schema original was not retained');f.modal.confirm.click();ok(f.modal.commitButton.disabled&&f.modal.batchSummary.textContent.includes('不支持'),'unknown schema can be committed or is unexplained');
  });
  await check('switching panels and closing abort operations and prevent late result publication',async()=>{
    for(const close of [false,true]){
      const f=await fixture(),gate=deferred(),actual=f.service.diagnose;let options;
      f.service.diagnose=async o=>{options=o;const report=await actual(o);await gate.promise;return report;};await click(f.modal.contentEl,'扫描当前题库');await until(()=>!!options,'diagnosis did not start');
      if(close)f.modal.close();else await click(f.modal.contentEl,'材料包');ok(options.signal.aborted,'navigation/close did not abort signal');gate.resolve();await settle(f.modal);
      ok(!f.modal.diagnosticList.childElementCount,'late diagnosis published stale results');if(close)ok(!f.modal.contentEl.childElementCount,'close revived modal content');else ok(f.modal.activePanel==='transfer'&&!f.modal.panels.transfer.hidden,'late operation changed selected panel');
    }
  });
  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}
test('library diagnosis, transfer and confirmed import UI with actual services in Chromium',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome required');t.skip('Set CHROME_PATH');return;}
  const sources=Object.fromEntries([['fragments','assembly-fragments.cjs'],['core','assembly-core.cjs'],['markdown','assembly-markdown.cjs'],['assembly','assembly-service.cjs'],['library','assembly-library.cjs'],['ui','assembly-library-ui.cjs']].map(([key,name])=>[key,fs.readFileSync(path.join(root,'src',name),'utf8')]));
  const script='('+browserCases.toString()+')('+JSON.stringify(sources)+').catch(error=>{const p=document.createElement("pre");p.id="mwb-test-results";p.textContent=JSON.stringify([{name:"fixture",ok:false,error:String(error.stack||error)}]);document.body.append(p);});';
  const html='<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>',server=http.createServer((req,res)=>{if(req.method==='POST'&&req.url==='/sha256'){const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>res.end(crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}}),dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-library-ui-'));
  try{await new Promise(r=>server.listen(0,'127.0.0.1',r));const result=await runChromeDocument(chrome,null,path.join(dir,'profile'),{url:'http://127.0.0.1:'+server.address().port+'/'});for(const row of result)await t.test(row.name,()=>assert.equal(row.ok,true,row.error));}
  finally{await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
