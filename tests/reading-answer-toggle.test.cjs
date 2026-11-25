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
  const obsidian={Plugin:BasePlugin,ItemView:class{},Component:class{},Modal:class{},Notice:class{},MarkdownView:class{},MarkdownRenderer:{},parseYaml:JSON.parse,finishRenderMath:async()=>{}};
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
  await check('escaped demonstrations in the whole note do not disable answers in a virtualized section',()=>{
    const root=document.createElement('p');mount.append(root);
    root.innerHTML='结果 ?{REAL_42}，选择 !{B}。';
    const source=String.raw`语法演示 \?{literal}、\!{literal}。

结果 ?{REAL_42}，选择 !{B}。`;
    ok(api.decorate(root,source)===2,'unrelated escaped markers disabled the section');
    ok(root.querySelector('.mwb-fill-answer')?.textContent==='REAL_42','fill answer not decorated');
    ok(root.querySelector('.mwb-choice-answer')?.textContent==='B','choice answer not decorated');
    ok(api.decorate(root,source)===0,'a repeated postprocessor wrapped answers twice');
  });
  await check('literal candidates remain visible while distinct parsed answers are decorated',()=>{
    const root=document.createElement('div');mount.append(root);
    root.innerHTML='<p>演示 ?{LITERAL}，实际 ?{REAL}。</p><p><code>?{CODE}</code> <a href="#x">!{LINK}</a></p><pre>?{HTML}</pre><p>?{UNLISTED}</p>';
    const source=String.raw`演示 \?{LITERAL}，实际 ?{REAL}。`+
      '\n\n`?{CODE}` [!{LINK}](#x)\n\n<pre>?{HTML}</pre>';
    const count=api.decorate(root,source);
    ok(count===1,'expected one parsed answer, got '+count+': '+root.innerHTML);
    ok(root.querySelector('mark')?.textContent==='REAL','the real answer was not selected');
    for(const marker of ['?{LITERAL}','?{CODE}','!{LINK}','?{HTML}','?{UNLISTED}'])
      ok(root.textContent.includes(marker),'literal marker changed: '+marker);
  });
  await check('CRLF section source uses the same token offsets as the Markdown parser',()=>{
    const root=document.createElement('p');mount.append(root);root.textContent='结果 ?{REAL}。';
    const source=String.raw`演示 \?{LITERAL}。`+'\r\n'+Array(30).fill('说明').join('\r\n')+'\r\n结果 ?{REAL}。';
    ok(api.decorate(root,source)===1,'CRLF offsets turned a parsed answer into a literal');
    ok(root.querySelector('mark')?.textContent==='REAL','the real answer was not decorated');
  });
  await check('only identical ambiguous spellings are skipped, not the rest of the note',()=>{
    const root=document.createElement('p');mount.append(root);
    root.textContent='演示 ?{42}，实际 ?{42}，其他 ?{7}，选项 !{A}。';
    const source=String.raw`演示 \?{42}，实际 ?{42}，其他 ?{7}，选项 !{A}。`;
    ok(api.decorate(root,source)===2,'ambiguity affected an unrelated slot');
    ok((root.textContent.match(/\?\{42\}/g)||[]).length===2,'an indistinguishable escaped token was hidden');
    ok([...root.querySelectorAll('mark')].map(mark=>mark.textContent).join(',')==='7,A','wrong slots decorated');
  });
  await check('parsed visible HTML text remains an answer while attribute tokens remain literal',()=>{
    const root=document.createElement('div');mount.append(root);
    root.innerHTML='<div title="?{ATTRIBUTE}"><p>?{HTML}</p></div><p>?{ATTRIBUTE}</p>';
    const source='<div title="?{ATTRIBUTE}"><p>?{HTML}</p></div>';
    ok(api.decorate(root,source)===1,'visible HTML text no longer follows the typed-slot parser');
    ok(root.querySelector('mark')?.textContent==='HTML','HTML attribute was treated as an answer');
    ok(root.firstChild.getAttribute('title')==='?{ATTRIBUTE}'&&root.lastChild.textContent==='?{ATTRIBUTE}','an attribute marker escaped its protected source context');
  });
  await check('outer math answers retain their native MathJax nodes beside escaped examples',()=>{
    const root=document.createElement('p');mount.append(root);
    root.innerHTML='演示 ?{literal}，公式 ?{<span class="math-inline"><mjx-container><svg width="32" height="20"><text y="16">x=2</text></svg></mjx-container></span>}。';
    const math=root.querySelector('mjx-container');
    const source=String.raw`演示 \?{literal}，公式 ?{$x=2$}。`;
    ok(api.decorate(root,source)===1,'outer math answer was disabled by an escaped text example');
    ok(root.querySelector('mark')?.classList.contains('mwb-reading-answer-math'),'outer math lost its answer class');
    ok(root.querySelector('mark mjx-container')===math,'native MathJax node was recreated');
    ok(root.textContent.includes('?{literal}'),'escaped example changed');
  });
  await check('bold italic inline HTML and entities keep their existing reading decoration',()=>{
    const root=document.createElement('p');mount.append(root);
    root.innerHTML='?{<strong>42</strong>}，?{<em>text</em>}，?{<em>43</em>}，?{A&amp;B}，?{<span title="?{ATTRIBUTE}">44</span>}。';
    const span=root.querySelector('span'),strong=root.querySelector('strong');
    const source=String.raw`演示 \?{literal}。`+
      '\n\n?{**42**}，?{*text*}，?{<em>43</em>}，?{A&amp;B}，?{<span title="?{ATTRIBUTE}">44</span>}。';
    ok(api.decorate(root,source)===5,'inline formatting or an attribute marker suppressed a real answer');
    ok(root.querySelector('mark strong')===strong&&root.querySelector('mark span')===span,'formatted native nodes were recreated');
    ok(span.getAttribute('title')==='?{ATTRIBUTE}','attribute text was interpreted as another answer');
  });
  await check('escaped formatted and entity spellings remain ambiguous only for matching answers',()=>{
    const root=document.createElement('p');mount.append(root);
    root.innerHTML='演示 ?{<strong>42</strong>}、?{A&amp;B}，实际 ?{42}、?{A&amp;B}，其他 ?{OK}。';
    const source=String.raw`演示 \?{**42**}、\?{A&amp;B}，实际 ?{42}、?{A&B}，其他 ?{OK}。`;
    ok(api.decorate(root,source)===1,'an escaped formatted/entity token was mistaken for an answer');
    ok(root.querySelector('mark')?.textContent==='OK','unrelated answer was suppressed');
  });
  await check('rendered entities are not decoded a second time or mistaken for inline HTML',()=>{
    const root=document.createElement('p');mount.append(root);
    root.innerHTML='演示 ?{&lt;b&gt;X&lt;/b&gt;}，实际 ?{X}，实体 ?{&amp;amp;}。';
    const source=String.raw`演示 \?{&lt;b&gt;X&lt;/b&gt;}，实际 ?{X}，实体 ?{&amp;amp;}。`;
    ok(api.decorate(root,source)===2,'rendered entity text was decoded twice');
    ok([...root.querySelectorAll('mark')].map(mark=>mark.textContent).join(',')==='X,&amp;','an escaped encoded tag was hidden');
    ok(root.textContent.includes('?{<b>X</b>}'),'the escaped example changed');
  });
  await check('candidates spanning protected DOM and formulas without an outer slot stay unchanged',()=>{
    const root=document.createElement('div');mount.append(root);
    root.innerHTML='<p>?{<a href="#x">LINK</a>}</p><p>?{<code>CODE</code>}</p><p><span class="math-inline"><mjx-container>?{2}</mjx-container></span>，真实 ?{OK}</p>';
    const source='?{[LINK](#x)}\n\n?{`CODE`}\n\n$x=?{2}$，真实 ?{OK}';
    ok(api.decorate(root,source)===1,'protected DOM or formula-internal tokens were decorated');
    ok(root.querySelectorAll('mark').length===1&&root.querySelector('mark').textContent==='OK','wrong real candidate');
    ok(root.querySelector('a')?.textContent==='LINK'&&root.querySelector('code')?.textContent==='CODE','protected nodes changed');
    ok(root.querySelector('mjx-container')?.textContent==='?{2}','formula-internal syntax changed');
  });
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
    const app={vault:{...emitter},metadataCache:{...emitter,getFileCache:()=>({frontmatter:{}})},workspace:{...emitter,
      getLeavesOfType:type=>type==='markdown'?views.map(view=>({view})):[],getActiveViewOfType:()=>active,onLayoutReady:callback=>callback()}};
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
