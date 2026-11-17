'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p=>p&&fs.existsSync(p));

async function browserCases(sources,css) {
  const results=[],ok=(value,message)=>{if(!value)throw Error(message);},tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const until=async(fn,label)=>{const end=Date.now()+7000;while(!fn()&&Date.now()<end)await tick();ok(fn(),label);};
  const nodeCrypto={randomUUID:()=>crypto.randomUUID(),createHash(){let text='';return {update(value){text+=value;return this;},digest(){const xhr=new XMLHttpRequest();xhr.open('POST','/sha256',false);xhr.send(text);ok(xhr.status===200,'sha failed');return xhr.responseText;}};}};
  let fragments;
  const load=source=>{const module={exports:{}};new Function('module','require','MWB_ASSEMBLY_FRAGMENTS',source)(module,name=>{if(name==='node:crypto')return nodeCrypto;throw Error(name);},fragments);return module.exports;};
  fragments=load(sources.fragments);const core=load(sources.core),createService=load(sources.service),usageApi=load(sources.usage),createView=load(sources.view);
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  class Component {constructor(){this.children=[];}load(){}unload(){for(const c of this.children)c.unload();}addChild(c){this.children.push(c);c.load();}removeChild(c){this.children=this.children.filter(x=>x!==c);c.unload();}}
  class ItemView extends Component {constructor(leaf){super();this.app=leaf.app;this.contentEl=document.createElement('div');this.contentEl.style.cssText='height:820px;width:1200px;';document.body.append(this.contentEl);}}
  const button=(node,label)=>[...node.querySelectorAll('button')].find(b=>b.textContent===label);
  const change=(node,value)=>{node.value=String(value);node.dispatchEvent(new Event('change',{bubbles:true}));};
  async function fixture(){
    const nodes=new Map(),listeners=new Set(),writes=[];
    const emit=(event,...args)=>{for(const row of [...listeners])if(row.event===event)row.fn(...args);};
    const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,children:[],name:path.split('/').pop()};nodes.set(path,node);parent?.children.push(node);return node;};
    const file=(path,content)=>{const parent=folder(path.slice(0,path.lastIndexOf('/'))),name=path.split('/').pop(),node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent};nodes.set(path,node);parent.children.push(node);emit('create',node);return node;};
    const body='<!-- mathsemble:stem -->\nSHARED\n<!-- mathsemble:end -->\n\n<!-- mathsemble:part a -->\n## 小问甲\nPROMPT_A ?{PRIVATE_A}\n<!-- mathsemble:end -->\n\n<!-- mathsemble:part b -->\n## 小问乙\nPROMPT_B\n<!-- mathsemble:end -->';
    for(const id of ['Q1','Q2','Q3'])file('题库/'+id+'.md','---\n'+JSON.stringify({id,question_type:'fill_blank',family_id:'F',subject:'初中数学'})+'\n---\n'+body);
    const app={workspace:{requestSaveLayout(){}}};app.vault={getAbstractFileByPath:path=>nodes.get(path)||null,getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),getFiles:()=>[...nodes.values()].filter(n=>n.extension),
      on:(event,fn)=>{const row={event,fn};listeners.add(row);return row;},offref:row=>listeners.delete(row),read:async node=>node.content,
      createFolder:async path=>folder(path),create:async(path,text)=>{if(nodes.has(path))throw Error('exists');writes.push(path);return file(path,text);},modify:async(node,text)=>{writes.push(node.path);node.content=text;emit('modify',node);}};
    let data={assemblySettings:{questionRoots:['题库'],knowledgeRoots:[],recursive:true}};
    const plugin={app,loadData:async()=>data,saveData:async value=>{data=value;}};
    const service=createService(plugin,{core,parseYaml:JSON.parse}),usage=usageApi.createUsageService({vault:app.vault,core,scanIndex:options=>service.scan(options.config,options)});
    const View=createView({ItemView,Component,Notice:class{},core,service,usageService:usage,renderMarkdown:async(md,node)=>{node.textContent=md;}}),view=new View({app},plugin);
    await view.onOpen();return {view,service,usage,nodes,writes,listeners,async close(){await view.onClose();view.contentEl.remove();}};
  }
  const check=async(name,fn)=>{let f;try{f=await fixture();await fn(f);results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}finally{await f?.close();}};
  await check('real entry editor selects stable part and score without rewriting sources; old plan requires Save As',async f=>{
    const before=f.nodes.get('题库/Q1.md').content;f.view.add(f.view.index.items[0]);
    await f.view.saveCurrentPlan();const oldPath=f.view.planPath,oldText=f.nodes.get(oldPath).content;
    f.view.switchWorkspaceMode('arrangement');let row=f.view.arrangementList.querySelector('[data-entry-id]');row.querySelector('.mwb-assembly-arrangement-more').open=true;
    const panel=row.querySelector('.mwb-assembly-part-settings');panel.open=true;const check=panel.querySelector('[data-part-id="b"]');ok(check,'stable part not listed');check.click();
    panel.querySelector('[data-part-score="b"]').value='4.5';button(panel,'应用内容与分值').click();
    await until(()=>!f.view.actionBusy&&f.view.plan.schemaVersion===4,'v4 entry editor did not apply');
    ok(f.view.plan.entries[0].fragmentRef.ids.join(',')==='b'&&f.view.plan.entries[0].score===4.5,'part identity or score lost');
    await until(()=>f.view.arrangementList.textContent.includes('PROMPT_B'),'selected snippet missing');
    ok(!f.view.arrangementList.textContent.includes('PROMPT_A'),'unselected part still shown in arrangement snippet');
    await f.view.saveCurrentPlan();ok(f.nodes.get(oldPath).content===oldText&&f.view.dirty,'old plan overwritten');ok(f.view.statusEl.textContent.includes('另存'),'missing migration instruction');
    await f.view.saveCurrentPlan(true);ok(f.view.planPath!==oldPath&&!f.view.dirty,'Save As failed');
    ok(JSON.parse(f.nodes.get(f.view.planPath).content).schemaVersion===4&&f.nodes.get('题库/Q1.md').content===before,'new plan or read-only source contract failed');
  });
  await check('partial per-part score input is rejected before plan modification',async f=>{
    f.view.add(f.view.index.items[0]);f.view.switchWorkspaceMode('arrangement');const before=JSON.stringify(f.view.plan),row=f.view.arrangementList.querySelector('[data-entry-id]'),panel=row.querySelector('.mwb-assembly-part-settings');
    for(const input of panel.querySelectorAll('[data-part-id]'))input.checked=true;panel.querySelector('[data-part-score="a"]').value='2';
    button(panel,'应用内容与分值').click();await tick();await tick();ok(JSON.stringify(f.view.plan)===before,'partial scores were persisted');ok(f.view.statusEl.textContent.includes('所有'),'missing partial-score explanation');
  });
  await check('class/course usage filters feed selection; another class and revoke restore eligible questions',async f=>{
    f.view.add(f.view.index.items[0]);const plan=JSON.parse(JSON.stringify(f.view.plan)),context={classId:'甲班',courseId:'数学'};
    const candidate=await f.usage.preparePlanUsage({plan,context,action:'taught'});const recorded=await f.usage.recordPlanUsage(candidate,{actionId:'one-class-use'});
    f.view.plan=core.createPlan();f.view.usageFilter={...context,mode:'unused',days:30};await f.view.refreshUsage();
    ok(f.view.results.querySelectorAll('[data-source-path]').length===2,'recently used question remains');
    f.view.selectionCount='3';f.view.drawSelection();ok(f.view.selection.items.length===2&&!f.view.selection.items.some(x=>x.id==='Q1'),'draw ignored usage filter');
    f.view.usageFilter.classId='乙班';await f.view.refreshUsage();ok(f.view.results.querySelectorAll('[data-source-path]').length===3,'class scope leaked');
    await f.usage.revokeUsage(recorded.event.eventId,{actionId:'undo-use',context});
    f.view.usageFilter.classId='甲班';await f.view.refreshUsage();ok(f.view.results.querySelectorAll('[data-source-path]').length===3,'revoke did not restore question');
  });
  await check('a new usage event after drawing is rechecked before adding candidates',async f=>{
    const context={classId:'甲',courseId:''};f.view.usageFilter={...context,mode:'unused',days:30};await f.view.refreshUsage();f.view.selectionCount='3';f.view.drawSelection();
    const plan=core.addItem(core.createPlan(),f.view.index.items[0]);const candidate=await f.usage.preparePlanUsage({plan,context,action:'assigned'});await f.usage.recordPlanUsage(candidate,{actionId:'new-use'});
    await f.view.applySelection();ok(f.view.plan.entries.length===0,'stale usage candidates were applied');ok(f.view.statusEl.classList.contains('is-error'),'stale selection not explained');
  });
  return results;
}
test('P2 real service and view integration in Chromium',{skip:!chrome&&!process.env.CI},async()=>{
  assert(chrome,'CI requires Chrome');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-p2-ui-'));let server;
  try{
    const sources=Object.fromEntries(['fragments','core','service','usage','view'].map(name=>[name,fs.readFileSync(path.join(root,'src/assembly-'+name+'.cjs'),'utf8')]));
    const css=fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8');
    const script=`(${browserCases.toString()})(${JSON.stringify(sources)},${JSON.stringify(css)}).then(value=>{const e=document.createElement('pre');e.id='mwb-test-results';e.textContent=JSON.stringify(value);document.body.append(e);}).catch(error=>{const e=document.createElement('pre');e.id='mwb-test-results';e.textContent=JSON.stringify([{ok:false,error:String(error.stack||error)}]);document.body.append(e);});`;
    const html='<!doctype html><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>';
    server=http.createServer((req,res)=>{if(req.method==='POST'){const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>res.end(crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html);}});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const result=await runChromeDocument(chrome,null,path.join(dir,'profile'),{url:'http://127.0.0.1:'+server.address().port});
    assert.deepEqual(result.filter(row=>!row.ok),[]);assert.equal(result.length,4);
  }finally{await new Promise(resolve=>server?server.close(resolve):resolve());fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
