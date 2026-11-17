'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','/usr/bin/google-chrome','/usr/bin/chromium'].find(value=>value&&fs.existsSync(value));

// DOM/lifetime tests use the real modal. Persistence, source snapshots and
// strong digests are exercised independently by assembly-usage.test.cjs.
async function browserCases(source){
  const results=[],clone=value=>JSON.parse(JSON.stringify(value)),pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const ok=(value,message)=>{if(!value)throw Error(message);},equal=(a,b,message)=>ok(JSON.stringify(a)===JSON.stringify(b),message);
  const until=async(fn,message)=>{const end=Date.now()+3000;while(!fn()&&Date.now()<end)await pause();ok(fn(),message);};
  const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
  const module={exports:{}};new Function('module',source)(module);const createModal=module.exports;
  const context={classId:'甲班',courseId:'代数'};
  async function fixture({open=true,initial=context,partial=false}={}){
    const host=document.createElement('div');document.body.append(host);const notices=[],owners=[],calls={prepare:[],record:[],load:[],revoke:[],changed:[]},controls={};let sequence=0,events=[],revoked=[];
    class Modal{constructor(app){this.app=app;this.modalEl=document.createElement('section');this.contentEl=document.createElement('div');this.modalEl.append(this.contentEl);}open(){host.append(this.modalEl);return this.onOpen();}close(){this.onClose();this.modalEl.remove();}}
    class Component{constructor(){this.clean=[];}register(fn){this.clean.push(fn);}unload(){for(const fn of this.clean.splice(0))fn();}}
    const item={entryId:'entry-A',kind:'question',itemId:'A',path:'题库/A.md',title:'原题',role:'例题',sourceFingerprint:'fp',revisionSha256:'b'.repeat(64),markdown:'原始答案 <script>window.usageLeak=1</script>',fragmentRef:partial?{kind:'question-part',ids:['p2'],scores:{p2:4}}:null,score:partial?4:null};
    const service={newActionId:()=>`action-${++sequence}`,
      async preparePlanUsage(input,options){calls.prepare.push({input:clone(input),options});if(controls.prepareGate)await controls.prepareGate.promise;if(!options.isCurrent())throw Error('来源或窗口已变化');return {schemaVersion:1,context:clone(input.context),action:input.action,occurredAt:input.occurredAt,planSnapshotSha256:'a'.repeat(64),planTitle:input.plan.title,items:[clone(item)]};},
      async recordPlanUsage(candidate,args,options){calls.record.push({candidate:clone(candidate),args:clone(args),options});if(controls.recordGate)await controls.recordGate.promise;const event={...clone(candidate),eventId:'event-'+events.length,createdAt:candidate.occurredAt};events.push(event);return {event,state:'saved',idempotent:false};},
      async loadUsage(input,options){calls.load.push({input:clone(input),options});if(controls.loadError)throw Error(controls.loadError);if(controls.loadGate)await controls.loadGate.promise;return {schemaVersion:1,context:clone(input.context),contextId:'context',events:clone(events),activeEvents:clone(events.filter(e=>e.action!=='revoke'&&!revoked.includes(e.eventId))),revokedEventIds:[...revoked]};},
      async revokeUsage(eventId,args,options){calls.revoke.push({eventId,args:clone(args),options});const event={schemaVersion:1,eventId:'revoke-'+events.length,action:'revoke',supersedes:eventId,context:clone(args.context),createdAt:new Date().toISOString(),occurredAt:new Date().toISOString(),reason:args.reason};events.push(event);revoked.push(eventId);return {event,state:'saved'};}};
    const view={plan:{schemaVersion:3,title:'本次讲义',entries:[{entryId:'entry-A',kind:'question'}]},settings:{questionRoots:['题库']},closed:false,actionBusy:false,scanBusy:false},plugin={addChild(owner){owners.push(owner);},removeChild(owner){owner.unload();}};
    const Type=createModal({Modal,Component,Notice:class{constructor(value){notices.push(value);}},core:{},service});
    const modal=new Type({},plugin,view,{context:initial,onChanged:async value=>{calls.changed.push(value);if(controls.callbackError)throw Error('refresh failed');}});view.usageModal=modal;
    const result={host,modal,view,service,calls,controls,owners,notices,close(){if(!modal.closed)modal.close();host.remove();},unload(){for(const owner of owners)owner.unload();}};
    if(open)await modal.open();return result;
  }
  const check=async(name,fn)=>{let f;try{f=await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}finally{f?.close();}};
  await check('opening the modal never registers use; blank context does not read a global ledger',async()=>{
    const f=await fixture({initial:{classId:'',courseId:''}});ok(!f.calls.load.length&&!f.calls.prepare.length&&!f.calls.record.length,'opening created an action');ok(f.modal.recordButton.disabled,'unprepared record button active');ok(!f.modal.actionInput.querySelector('option[value="exported"]'),'exports mixed into teaching actions');return f;
  });
  await check('explicit preparation and confirmation forward context, action, date and immutable plan',async()=>{
    const f=await fixture(),before=clone(f.view.plan);f.modal.actionInput.value='assigned';await f.modal.prepare();ok(!f.calls.record.length&&!f.modal.recordButton.disabled,'preparation committed or failed to enable confirmation');await f.modal.record();
    equal(f.calls.prepare[0].input.context,context,'wrong context');ok(f.calls.prepare[0].input.action==='assigned'&&/Z$/.test(f.calls.prepare[0].input.occurredAt),'action/date missing');ok(f.calls.record.length===1&&f.calls.changed.length===1,'not one explicit action');equal(f.view.plan,before,'modal mutated plan');ok(f.modal.recordButton.disabled,'completed candidate can be reused unintentionally');return f;
  });
  await check('rapid duplicate confirmation invokes one persistent action with a stable action ID',async()=>{
    const f=await fixture();await f.modal.prepare();const id=f.modal.actionId;f.controls.recordGate=deferred();f.modal.recordButton.click();f.modal.recordButton.click();await until(()=>f.calls.record.length===1,'no record call');ok(f.calls.record[0].args.actionId===id,'action ID changed on submission');f.controls.recordGate.resolve();await until(()=>!f.modal.busy,'record did not settle');ok(f.calls.record.length===1,'duplicate submission');return f;
  });
  await check('context changes while preparing discard results and clear the old history',async()=>{
    const f=await fixture();f.controls.prepareGate=deferred();const promise=f.modal.prepare();await until(()=>f.calls.prepare.length===1,'prepare not started');f.modal.classInput.value='乙班';f.modal.classInput.dispatchEvent(new Event('change'));f.controls.prepareGate.resolve();await promise;ok(!f.modal.candidate&&!f.calls.record.length,'stale context accepted');ok(f.modal.history.childElementCount===0,'prior context remained visible');return f;
  });
  await check('plan changes after confirmation preparation cannot register the old plan accidentally',async()=>{
    const f=await fixture();await f.modal.prepare();f.view.plan.title='已更改';await f.modal.record();ok(f.calls.record.length===0,'changed plan submitted');ok(f.modal.statusEl.textContent.includes('已变化'),'no stale warning');return f;
  });
  await check('a damaged ledger is shown explicitly without a fallback empty-history write',async()=>{
    const f=await fixture();f.controls.loadError='使用账本存在损坏或不兼容记录，未覆盖';await f.modal.refresh();ok(f.modal.statusEl.textContent.includes('损坏')&&!f.calls.record.length&&!f.calls.revoke.length,'corruption was hidden');return f;
  });
  await check('partial usage retains selected IDs/scores and displays historical Markdown as literal text',async()=>{
    const f=await fixture({partial:true});await f.modal.prepare();ok(f.modal.preview.textContent.includes('部分使用：小问 p2')&&f.modal.preview.textContent.includes('4 分'),'partial scope omitted');await f.modal.record();ok(f.modal.history.textContent.includes('含部分使用'),'history claims full use');const details=f.modal.history.querySelector('details');details.open=true;details.dispatchEvent(new Event('toggle'));ok(details.querySelector('pre').textContent.includes('<script>'),'historical text not shown');ok(!details.querySelector('script')&&!window.usageLeak,'historical source executed');return f;
  });
  await check('revoke appends a scoped correction and refreshes eligibility without erasing history',async()=>{
    const f=await fixture();await f.modal.prepare();await f.modal.record();const event=f.modal.ledger.activeEvents[0];await f.modal.revoke(event,'误登记');ok(f.calls.revoke.length===1&&f.calls.revoke[0].eventId===event.eventId,'wrong target');equal(f.calls.revoke[0].args.context,context,'wrong revoke context');ok(f.modal.ledger.events.length===2&&f.modal.ledger.activeEvents.length===0,'original erased or revoke not applied');ok(f.modal.history.textContent.includes('已撤销')&&f.modal.history.textContent.includes('误登记'),'correction not visible');return f;
  });
  await check('close and unload abort reads and never revive a stale modal',async()=>{
    const f=await fixture();f.controls.prepareGate=deferred();const pending=f.modal.prepare();await until(()=>f.calls.prepare.length===1,'prepare not started');f.unload();ok(f.calls.prepare[0].options.signal.aborted,'unload did not abort');f.controls.prepareGate.resolve();await pending;ok(f.modal.closed&&!f.modal.candidate&&!f.modal.contentEl.childElementCount&&!f.view.usageModal,'late results revived modal');return f;
  });
  await check('an already submitted write finishing after close still notifies persistence once',async()=>{
    const f=await fixture();await f.modal.prepare();f.controls.recordGate=deferred();const pending=f.modal.record();await until(()=>f.calls.record.length===1,'write not submitted');f.modal.close();f.controls.recordGate.resolve();await pending;ok(f.calls.changed.length===1,'saved fact lost on close');ok(!f.modal.contentEl.childElementCount&&!f.view.usageModal,'late write reopened modal');return f;
  });
  await check('a post-save workspace refresh error never relabels the saved event as failed',async()=>{
    const f=await fixture();await f.modal.prepare();f.controls.callbackError=true;await f.modal.record();ok(f.notices.some(text=>text.includes('已保存')&&text.includes('刷新未完成')),'refresh warning omitted');ok(f.modal.ledger.activeEvents.length===1&&!f.modal.candidate,'saved fact lost');return f;
  });
  const out=document.createElement('pre');out.id='mwb-test-results';out.textContent=JSON.stringify(results);document.body.append(out);
}
test('actual usage modal DOM, explicit actions and lifecycle in Chromium',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for usage UI tests');t.skip('Set CHROME_PATH');return;}
  const source=fs.readFileSync(path.resolve(__dirname,'../src/assembly-usage-ui.cjs'),'utf8');
  const script='('+browserCases.toString()+')('+JSON.stringify(source)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-usage-ui-')),html=path.join(dir,'test.html');
  try{fs.writeFileSync(html,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');const results=await runChromeDocument(chrome,html,path.join(dir,'profile'));for(const row of results)await t.test(row.name,()=>assert.equal(row.ok,true,row.error));}
  finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
