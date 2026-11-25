'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const core=require('../src/assembly-core.cjs');
const {compileMarkdown}=require('../src/assembly-markdown.cjs');
const {slidesFromCompilation}=require('../src/assembly-presentation.cjs');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'C:/Program Files/Google/Chrome/Application/chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(value=>value&&fs.existsSync(value));

async function fixture() {
  const index=core.buildIndex([
    {path:'题库/a.md',kind:'question',metadata:{id:'A',title:'甲'},markdown:'PROMPT_A !{CHOICE_PRIVATE}\n\n## 题内标题\nSHARED_TAIL\n\n> [!answer]-\n> ANSWER_PRIVATE\n\n> [!solution]-\n> SOLUTION_PRIVATE'},
    {path:'知识/k.md',kind:'knowledge',metadata:{id:'K',title:'知识'},markdown:'# 定义\nKNOWLEDGE\n\n##### 内部标题\nKNOWLEDGE_TAIL'},
    {path:'题库/b.md',kind:'question',metadata:{id:'B',title:'乙'},markdown:'PROMPT_B $x=?{MATH_PRIVATE}$'}
  ]);
  let plan=core.addSection(core.createPlan('投影验证'),'前半节');
  for(const item of index.items)plan=core.addItem(plan,item);
  let sourceMap;
  const markdown=await compileMarkdown(plan,core.resolvePlan(plan,index).entries,{onSourceMap:value=>{sourceMap=value;}});
  return {plan,markdown,sourceMap};
}

test('presentation uses compiler ranges: internal headings never create extra slides',async()=>{
  const data=await fixture(),before=JSON.stringify(data),slides=slidesFromCompilation(data.plan,data);
  assert.equal(slides.length,3);assert(slides[0].markdown.includes('SHARED_TAIL'));
  assert(slides[1].markdown.includes('KNOWLEDGE_TAIL'));assert(!slides[0].markdown.includes('KNOWLEDGE'));
  assert.equal(slides[2].section,'前半节');assert(Object.isFrozen(slides[0]));assert.equal(JSON.stringify(data),before);
});
test('presentation refuses missing, reordered, overlapping or malformed source mappings',async()=>{
  const data=await fixture();
  for(const map of [data.sourceMap.slice(1),[...data.sourceMap].reverse(),
    data.sourceMap.map((row,i)=>i===1?{...row,startLine:1}:row),
    data.sourceMap.map((row,i)=>i===0?{...row,endLine:999999}:row),
    data.sourceMap.map((row,i)=>i===0?{...row,entryId:'wrong'}:row)])
    assert.throws(()=>slidesFromCompilation(data.plan,{...data,sourceMap:map}),/来源/);
});
test('real student and teacher projection removes hidden answers before classroom rendering',async()=>{
  const pluginPath=path.join(root,'src/plugin.js'),realRequire=createRequire(pluginPath);
  const obsidian={Plugin:class{},Modal:class{},ItemView:class{},Component:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{},finishRenderMath:async()=>{},renderMath:()=>{throw Error('No DOM');}};
  const ctx={module:{exports:{}},require:name=>name==='obsidian'?obsidian:realRequire(name),console,Buffer,setTimeout,clearTimeout,performance,AbortController,URL,TextEncoder};
  vm.runInNewContext(fs.readFileSync(pluginPath,'utf8')+'\n;globalThis.project=handoutPlan;',ctx,{timeout:15000});
  const data=await fixture(),slides=slidesFromCompilation(data.plan,data);
  for(const slide of slides){
    const student=ctx.project(slide.markdown,'student',{teacherVisibleCallouts:['solution']}).markdown;
    const teacher=ctx.project(slide.markdown,'teacher',{teacherVisibleCallouts:['solution']}).markdown;
    for(const token of ['CHOICE_PRIVATE','ANSWER_PRIVATE','SOLUTION_PRIVATE','MATH_PRIVATE']){
      assert(!student.includes(token),token+' leaked');if(slide.markdown.includes(token))assert(teacher.includes(token),token+' not revealed');
    }
  }
});

async function browserCases(moduleSource,css) {
  const results=[],check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
  const ok=(value,message)=>{if(!value)throw Error(message);},tick=()=>new Promise(resolve=>setTimeout(resolve,0));
  const module={exports:{}};new Function('module',moduleSource)(module);
  const style=document.createElement('style');style.textContent=css;document.head.append(style);
  class Modal {constructor(app){this.app=app;this.modalEl=document.createElement('div');this.modalEl.className='modal';this.contentEl=document.createElement('div');this.contentEl.className='modal-content';this.modalEl.append(this.contentEl);document.body.append(this.modalEl);}open(){return this.onOpen();}close(){this.onClose();this.modalEl.remove();}}
  class Component {load(){this.loaded=true;}unload(){this.loaded=false;}}
  function make({slow=false}={}) {
    let activeGuard=0,changed,gate,late;const owners=[],calls=[];
    const app={},plugin={addChild(owner){owners.push(owner);owner.load();},removeChild(owner){owner.unload();}};
    const plan={title:'课堂',entries:[{entryId:'a',kind:'question',title:'甲'},{entryId:'b',kind:'question',title:'乙'}],output:{solutionOptions:{}}};
    const view={plan,settings:{},index:{},closed:false};
    const service={beginSourceCheck(_,onChange){activeGuard++;let current=true;changed=()=>{current=false;onChange();};return{assertCurrent(){if(!current)throw Error('changed');},dispose(){activeGuard--;}};},
      async compile(){return {markdown:'A PRIVATE_A\n\nB PRIVATE_B',sourceMap:[{entryId:'a',kind:'question',path:'a.md',startLine:1,endLine:1},{entryId:'b',kind:'question',path:'b.md',startLine:3,endLine:3}]};}};
    const Type=module.exports.createPresentationModal({Modal,Component,core:{validatePlan:raw=>JSON.parse(JSON.stringify(raw))},service,
      projectMarkdown:(md,mode)=>mode==='student'?md.replace(/PRIVATE_[AB]/g,''):md,
      renderMarkdown:async(md,target,sourcePath,owner,signal)=>{ok(target.isConnected,'renderer staging disconnected');calls.push({md,sourcePath,owner,signal});if(slow&&md.includes('PRIVATE'))await new Promise(resolve=>{gate=resolve;late=()=>{target.textContent=md;};});target.textContent=md;}});
    const modal=new Type(app,plugin,view);
    return {modal,view,calls,owners,change:()=>changed(),release(){gate?.();late?.();},guards:()=>activeGuard};
  }
  await check('starts hidden; only current slide reveals; keyboard and previous reset answers',async()=>{
    const f=make();try{
      await f.modal.open();ok(!f.modal.contentEl.textContent.includes('PRIVATE'),'initial teacher content leaked');
      await f.modal.toggle();ok(f.modal.body.textContent.includes('PRIVATE_A')&&!f.modal.body.textContent.includes('PRIVATE_B'),'reveal affected other slide');
      f.modal.body.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));await tick();
      ok(f.modal.position===1&&!f.modal.revealed&&!f.modal.body.textContent.includes('PRIVATE'),'navigation retained answers');
      await f.modal.move(-1);ok(!f.modal.revealed&&!f.modal.body.textContent.includes('PRIVATE'),'return retained answers');
      ok(f.calls.every(call=>call.sourcePath==='Mathsemble/讲义/__presentation__.md'),'render path changed compiler-relative images');
      ok(f.modal.body.getBoundingClientRect().height>0,'presentation collapsed');
    }finally{f.modal.close();}ok(f.guards()===0&&f.owners.every(owner=>!owner.loaded),'watcher/component leaked');
  });
  await check('slow teacher render cannot reappear after hiding or navigation',async()=>{
    const f=make({slow:true});try{
      await f.modal.open();const revealing=f.modal.toggle();await tick();await f.modal.move(1);f.release();await revealing;
      ok(f.modal.position===1&&!f.modal.body.textContent.includes('PRIVATE'),'late teacher render leaked');
      ok(f.calls.find(call=>call.md.includes('PRIVATE')).signal.aborted,'old renderer not aborted');
    }finally{f.modal.close();}
  });
  await check('source change removes revealed content and blocks further actions',async()=>{
    const f=make();try{await f.modal.open();await f.modal.toggle();f.change();await f.modal.toggle();ok(!f.modal.body.textContent&&f.modal.reveal.disabled&&f.modal.invalid,'changed source kept visible answers');}finally{f.modal.close();}
  });
  await check('edited origin plan and a closed view cannot continue presenting a stale snapshot',async()=>{
    for(const mode of ['plan','close']){const f=make();try{await f.modal.open();if(mode==='plan')f.view.plan={...f.view.plan,title:'changed'};else f.view.closed=true;await f.modal.toggle();ok(f.modal.invalid&&!f.modal.body.textContent,'stale origin accepted');}finally{f.modal.close();}}
  });
  await check('closing a slow render releases state and ignores late completion',async()=>{
    const f=make({slow:true});await f.modal.open();const render=f.modal.toggle();await tick();f.modal.close();f.release();await render;
    ok(!f.modal.contentEl.textContent&&!f.modal.slides.length&&f.guards()===0&&f.owners.every(owner=>!owner.loaded),'close leaked state');
  });
  return results;
}
test('classroom presentation browser lifecycle and keyboard regression', {skip:!chrome&&!process.env.CI},async()=>{
  assert(chrome,'CI requires Chrome');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-presentation-'));
  try{
    const src=fs.readFileSync(path.join(root,'src/assembly-presentation.cjs'),'utf8'),css=fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8');
    const script=`(${browserCases.toString()})(${JSON.stringify(src)},${JSON.stringify(css)}).then(value=>{const el=document.createElement('pre');el.id='mwb-test-results';el.textContent=JSON.stringify(value);document.body.append(el);})`;
    const file=path.join(dir,'test.html');fs.writeFileSync(file,'<!doctype html><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const result=await runChromeDocument(chrome,file,path.join(dir,'profile'));assert.equal(result.length,5);assert.deepEqual(result.filter(row=>!row.ok),[]);
  }finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:20,retryDelay:100});}
});
