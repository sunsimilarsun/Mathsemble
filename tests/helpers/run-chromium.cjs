'use strict';
const fs=require('node:fs');
const {spawn}=require('node:child_process');
async function runChromeDocument(executable, input, profile){
 const proc=spawn(executable,['--headless','--no-sandbox','--disable-dev-shm-usage',
  '--disable-background-networking','--disable-extensions','--disable-component-update',
  '--disable-features=Translate,MediaRouter,OptimizationHints','--no-first-run','--no-default-browser-check',
  '--remote-debugging-pipe','--no-startup-window','--user-data-dir='+profile],
  {stdio:['ignore','ignore','pipe','pipe','pipe']});
 const closed=new Promise(resolve=>proc.once('close',resolve));
 let stderr='',received='';const pending=new Map();let id=0;
 proc.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-4000);});
 proc.stdio[4].on('data',chunk=>{
  received+=chunk.toString();let end;
  while((end=received.indexOf('\0'))>=0){
   const packet=received.slice(0,end);received=received.slice(end+1);if(!packet)continue;
   const msg=JSON.parse(packet),entry=pending.get(msg.id);if(!entry)continue;
   pending.delete(msg.id);clearTimeout(entry.timer);
   if(msg.error)entry.reject(Error(msg.error.message));else entry.resolve(msg.result);
  }
 });
 const send=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
  // Cold hosted runners may spend more than 20s initializing fonts/DBus.
  // Only browser startup gets extra time; layout/assertion deadlines stay bounded.
  const timeout=method==='Target.createTarget'?60000:20000;
  const key=++id,timer=setTimeout(()=>{pending.delete(key);reject(Error('Chrome timeout: '+method+' '+stderr));},timeout);
  pending.set(key,{resolve,reject,timer});proc.stdio[3].write(JSON.stringify({id:key,method,params,sessionId})+'\0');
 });
 const rejectAll=error=>{for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(error);}pending.clear();};
 proc.on('error',rejectAll);
 proc.stdio[3].on('error',rejectAll);
 try{
  const {targetId}=await send('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
  const {frameTree}=await send('Page.getFrameTree',{},sessionId);
  await send('Page.setDocumentContent',{frameId:frameTree.frame.id,html:fs.readFileSync(input,'utf8')},sessionId);
  const deadline=Date.now()+25000;
  while(Date.now()<deadline){
   const response=await send('Runtime.evaluate',{expression:"document.getElementById('mwb-test-results')?.textContent",returnByValue:true},sessionId);
   if(response.result?.value)return JSON.parse(response.result.value);
   await new Promise(r=>setTimeout(r,50));
  }
  throw Error('Browser layout tests did not finish: '+stderr);
 }finally{
  // Let Chromium stop its renderer/profile writers before deleting the
  // temporary profile. Killing only the parent raced with child writes in CI.
  let shutdownTimer;
  try {
   if(proc.exitCode===null && proc.signalCode===null){
    void send('Browser.close').catch(()=>{});
    await Promise.race([closed,new Promise(resolve=>{shutdownTimer=setTimeout(resolve,2000);})]);
    if(proc.exitCode===null && proc.signalCode===null)proc.kill('SIGKILL');
   }
   await closed;
  } finally {
   clearTimeout(shutdownTimer);
   for(const entry of pending.values())clearTimeout(entry.timer);
   pending.clear();
  }
 }
}

module.exports = {runChromeDocument};
