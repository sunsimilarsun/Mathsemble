'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const source=fs.readFileSync(path.resolve(__dirname,'../src/plugin.js'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'../styles.css'),'utf8');

test('reading answer controls preserve native folds, virtualized math, per-view state and lifecycle',async t=>{
  const chrome=[process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome'].find(p=>p&&fs.existsSync(p));
  if(!chrome){if(process.env.CI)throw Error('Chrome required in CI');t.skip('Set CHROME_PATH');return;}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-reading-toggle-'));
  const stub=`const module={exports:{}};class BasePlugin{constructor(app){this.app=app;this.commands=[];this.cleanups=[];}register(fn){this.cleanups.push(fn);}registerEvent(){}registerView(){}addRibbonIcon(){}registerMarkdownPostProcessor(){}registerEditorExtension(){}addCommand(command){this.commands.push(command);}}
  const obsidian={Plugin:BasePlugin,ItemView:class{},Component:class{},Modal:class{},Notice:class{},MarkdownView:class{},MarkdownRenderer:{},finishRenderMath:async()=>{}};
  function require(name){return name==='obsidian'?obsidian:{WidgetType:class{},ViewPlugin:{fromClass(){return {}}},Decoration:{}};}`;
  const script=stub+'\n'+source+'\nglobalThis.api={Controller:MwbReadingAnswerController,Plugin:module.exports,decorate:mwbDecorateReadingTypedSlots};\n('+browserCases.toString()+')();';
  const input=path.join(dir,'reading.html');
  fs.writeFileSync(input,'<!doctype html><meta charset="utf-8"><style>:root{--text-normal:#141414;}'+css+'</style><main id="mount"></main><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
  try{for(const result of await runChromeDocument(chrome,input,path.join(dir,'profile')))await t.test(result.name,()=>assert.equal(result.ok,true,result.error||''));}
  finally{fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});

async function browserCases(){
  const results=[],mount=document.getElementById('mount'),controllers=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
  const check=async(name,action)=>{try{mount.replaceChildren();await action();results.push({name,ok:true});}
    catch(error){results.push({name,ok:false,error:error.stack||error.message});}
    finally{for(const controller of controllers.splice(0))controller.dispose();}};
  const markup=()=>'<p>填空 ?{SECRET_42}，公式 ?{<span class="math-inline"><mjx-container><svg width="32" height="20"><text y="16">x=2</text></svg></mjx-container></span>}。</p>'+
    '<div class="callout is-collapsible is-collapsed"><div class="callout-title"><span class="callout-fold">折叠</span><span>解答</span><a href="#target">链接</a></div><div class="callout-content" style="display:none">CALLOUT_SECRET</div></div>';
  const newView=(path='笔记.md')=>{
    const containerEl=document.createElement('section');containerEl.dataset.mode='preview';mount.append(containerEl);
    const reading=document.createElement('div');reading.className='markdown-preview-view';reading.innerHTML=markup();containerEl.append(reading);
    api.decorate(reading,'填空 ?{SECRET_42}，公式 ?{$x=2$}。');
    const counters={reset:0,queue:0,restored:[],plainReset:0};
    const view={containerEl,file:{path},getMode:()=>containerEl.dataset.mode,
      addAction(_icon,_label,callback){const button=document.createElement('button');containerEl.prepend(button);button.addEventListener('click',callback);return button;},
      previewMode:{getScroll:()=>7.25,setEphemeralState:state=>counters.restored.push(state.scroll),
        renderer:{sections:[{el:reading,resetCompute:()=>counters.reset++},{el:document.createElement('p'),resetCompute:()=>counters.plainReset++}],queueRender:()=>counters.queue++}}};
    return {view,reading,counters};
  };
  const control=f=>{const controller=new api.Controller(f.view);controllers.push(controller);return controller;};
  await check('the action reveals text, MathJax and native collapsed content without changing fold state',()=>{
    const f=newView(),controller=control(f),mark=f.reading.querySelector('mark'),math=f.reading.querySelector('mjx-container'),content=f.reading.querySelector('.callout-content');
    ok(controller.button.textContent==='显示答案'&&controller.button.getAttribute('aria-pressed')==='false','initial action state');
    ok(getComputedStyle(math).visibility==='hidden'&&getComputedStyle(content).display==='none','initial content must remain hidden');
    const before=mark.getBoundingClientRect();controller.button.click();
    ok(controller.shown&&controller.button.getAttribute('aria-pressed')==='true','action did not enable answers');
    ok(getComputedStyle(mark).webkitTextFillColor==='rgb(189, 37, 37)'&&getComputedStyle(math).visibility==='visible','answers were not revealed');
    ok(getComputedStyle(content).display==='block'&&content.style.display==='none'&&content.parentElement.classList.contains('is-collapsed'),'native fold was mutated');
    ok(Math.abs(mark.getBoundingClientRect().width-before.width)<.1&&getComputedStyle(mark).borderBottomWidth==='1px','answer reveal changed blank geometry');
    controller.button.click();
    ok(getComputedStyle(content).display==='none'&&getComputedStyle(math).visibility==='hidden','hiding did not restore native content');
    ok(f.counters.reset===2&&f.counters.queue===2&&f.counters.plainReset===0&&f.counters.restored.every(x=>x===7.25),'cached section geometry or scroll anchor not restored');
  });
  await check('virtualized sections inherit visibility and replacement reading roots restore scroll geometry',()=>{
    const f=newView(),controller=control(f);controller.toggle();
    const later=document.createElement('div');later.innerHTML=markup();f.reading.append(later);api.decorate(later,'填空 ?{SECRET_42}，公式 ?{$x=2$}。');
    ok(getComputedStyle(later.querySelector('mjx-container')).visibility==='visible'&&getComputedStyle(later.querySelector('.callout-content')).display==='block','new virtualized section ignored active answer mode');
    const replacement=f.reading.cloneNode(true);replacement.classList.remove('mwb-reading-show-answers');f.reading.replaceWith(replacement);controller.sync();
    ok(!f.reading.classList.contains('mwb-reading-show-answers')&&replacement.classList.contains('mwb-reading-show-answers'),'reading root replacement leaked or lost state');
    ok(f.counters.queue===2&&f.counters.restored.length===2,'replacement did not remeasure at its scroll anchor');
    controller.toggle();ok(getComputedStyle(replacement.querySelector('.callout-content')).display==='none','replacement root could not hide answers');
  });
  await check('separate views stay independent; mode changes hide the button and file changes reset answers',async()=>{
    const first=newView(),second=newView(),a=control(first),b=control(second);a.toggle();
    ok(a.shown&&!b.shown&&!second.reading.classList.contains('mwb-reading-show-answers'),'same-note views share answer state');
    first.view.containerEl.dataset.mode='source';await pause();ok(a.button.hidden,'source mode exposes reading action');
    a.toggle();ok(a.shown,'source mode command changed answer state');
    first.view.containerEl.dataset.mode='preview';await pause();ok(!a.button.hidden&&a.shown,'same-file mode switch lost answer state');
    first.view.file={path:'另一篇.md'};a.sync();ok(!a.shown&&!first.reading.classList.contains('mwb-reading-show-answers'),'new file inherited revealed answers');
    b.toggle();b.dispose();controllers.splice(controllers.indexOf(b),1);
    ok(!second.reading.classList.contains('mwb-reading-show-answers')&&!b.button.isConnected,'dispose left a revealed view or action');
    const before=second.counters.queue,buttonHidden=b.button.hidden;
    second.view.containerEl.dataset.mode='source';await pause();
    ok(second.counters.queue===before&&b.button.hidden===buttonHidden,'disposed observer still responds');
  });
  await check('revealed callouts suppress native folding while title links remain usable',()=>{
    const f=newView(),controller=control(f),title=f.reading.querySelector('.callout-title');
    const click=target=>{const event=new MouseEvent('click',{bubbles:true,cancelable:true});target.dispatchEvent(event);return event.defaultPrevented;};
    ok(!click(title.querySelector('span:nth-child(2)')),'ordinary native title prevented while hidden');
    controller.toggle();ok(click(title.querySelector('span:nth-child(2)')),'revealed title can collapse the original fold');
    ok(click(title.querySelector('.callout-fold')),'fold affordance was not guarded');
    ok(!click(title.querySelector('a')),'title link lost native interaction');
    controller.dispose();controllers.splice(controllers.indexOf(controller),1);ok(!click(title.querySelector('span:nth-child(2)')),'dispose retained click interception');
  });
  await check('plugin command follows active view, removes closed views and unloads every action',async()=>{
    const first=newView('甲.md'),second=newView('乙.md'),events=new Map();let views=[first.view,second.view],active=first.view;
    const emitter={on:(event,callback)=>{if(!events.has(event))events.set(event,[]);events.get(event).push(callback);return {event,callback};}};
    const app={metadataCache:{...emitter,getFileCache:()=>({frontmatter:{}})},workspace:{...emitter,
      getLeavesOfType:()=>views.map(view=>({view})),getActiveViewOfType:()=>active,onLayoutReady:callback=>callback()}};
    const plugin=new api.Plugin(app);await plugin.onload();
    const command=plugin.commands.find(entry=>entry.id==='toggle-reading-answers');ok(command&&command.checkCallback(true),'reading command is not discoverable');
    command.checkCallback(false);ok(first.reading.classList.contains('mwb-reading-show-answers')&&!second.reading.classList.contains('mwb-reading-show-answers'),'command ignored active view');
    active=second.view;active.containerEl.dataset.mode='source';ok(command.checkCallback(true)===false,'source-mode command should be unavailable');
    views=[second.view];for(const callback of events.get('layout-change')||[])callback();
    ok(!first.view.containerEl.querySelector('.mwb-reading-answer-toggle')&&!first.reading.classList.contains('mwb-reading-show-answers'),'closed leaf retained controller');
    for(const dispose of plugin.cleanups)dispose();ok(!mount.querySelector('.mwb-reading-answer-toggle'),'plugin unload retained reading actions');
  });
  const result=document.createElement('pre');result.id='mwb-test-results';result.textContent=JSON.stringify(results);document.body.append(result);
}
