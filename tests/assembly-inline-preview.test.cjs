'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {runChromeDocument}=require('./helpers/run-chromium.cjs');
const root=path.resolve(__dirname,'..');
const chrome=[process.env.CHROME_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome','/usr/bin/chromium','/usr/bin/chromium-browser'].find(value=>value&&fs.existsSync(value));

// This fixture checks DOM interactions, actual browser geometry and render
// ownership. The renderer seam models Obsidian; it is not visual acceptance.
const hostCss=`
:root { --text-normal:#202124; --text-muted:#60656c; --text-accent:#6252b4;
  --text-error:#b52f3a; --interactive-accent:#6d5bd0; --background-primary:#fff;
  --background-secondary:#f6f7f9; --background-modifier-border:#d8dce2;
  --radius-s:5px; --radius-m:9px; --font-small:13px; --font-smallest:12px;
  font:14px/1.45 system-ui,sans-serif; }
* { box-sizing:border-box; } body { margin:0; } #view { width:1400px; height:860px; }
button,input,select,textarea { font:inherit; color:inherit; }
button { border:1px solid var(--background-modifier-border); border-radius:5px;
  padding:5px 10px; background:#fff; } button:disabled { opacity:.5; }
input,select,textarea { border:1px solid #d8dce2; border-radius:4px; padding:5px 7px; }
summary { cursor:pointer; }
`;

async function browserCases(sources,css) {
  const results=[],fixtures=[];
  const ok=(value,message)=>{if(!value)throw Error(message);};
  const pause=(ms=0)=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(condition,message)=>{
    const deadline=Date.now()+2500;
    while(!condition()&&Date.now()<deadline)await pause(15);
    ok(condition(),message);
  };
  const check=async(name,fn)=>{
    const before=fixtures.length;
    try {const measurements=await fn();results.push({name,ok:true,...(measurements?{measurements}:{})});}
    catch(error){results.push({name,ok:false,error:String(error.stack||error)});}
    finally {for(const f of fixtures.splice(before)){await f.view.onClose();f.finishAll();await pause();f.frame.remove();}}
  };
  const records=Array.from({length:24},(_,i)=>({path:'题库/章节/Q'+i+'.md',kind:'question',
    metadata:{id:'Q'+i,title:'题目 '+i,subject:'高中数学',question_type:'choice',teaching_tier:'基础',knowledge_nodes:['集合']},
    markdown:'---\ntitle: 元信息不能进入预览\n---\n第 '+i+' 道完整题干。\n\n$$\n\\frac{1}{x+1}+\\frac{1}{x-1}=2\n$$\n\n```text\n完整代码围栏\n```\n\n![图](../../图片/图.png)\n\n末尾条件 '+i}));
  const body=md=>md.replace(/^---\n[\s\S]*?\n---\n/,'');

  async function fixture({manual=false,noObserver=false,deferred=false,fail=false,sourceRecords=records,extraParagraphs=8}={}) {
    const frame=document.createElement('iframe');frame.style.cssText='width:1440px;height:920px;border:0;';
    const loaded=new Promise(resolve=>{frame.onload=resolve;});
    frame.srcdoc='<!doctype html><meta charset="utf-8"><style>'+css.replace(/<\/style/gi,'<\\/style')+'</style><div id="view"></div>';
    document.body.append(frame);await loaded;
    const doc=frame.contentDocument,win=frame.contentWindow,host=doc.querySelector('#view'),observers=[];
    class Observer {
      constructor(callback,options){this.callback=callback;this.options=options;this.targets=new Set();this.observed=[];this.disconnected=false;observers.push(this);}
      observe(node){this.targets.add(node);this.observed.push(node);}
      unobserve(node){this.targets.delete(node);}
      disconnect(){this.targets.clear();this.disconnected=true;}
      emit(nodes=[...this.targets]){this.callback(nodes.map(target=>({target,isIntersecting:true,intersectionRatio:1})),this);}
    }
    if(manual)win.IntersectionObserver=Observer;
    if(noObserver)win.IntersectionObserver=undefined;
    const load=source=>{const module={exports:{}};new win.Function('module',source)(module);return module.exports;};
    const core=load(sources.core),owners=[],calls=[],pending=[];let active=0,maxActive=0,index=core.buildIndex(sourceRecords);
    class Component {
      constructor(){this.loaded=false;this.unloadCount=0;owners.push(this);}
      load(){this.loaded=true;}
      unload(){this.loaded=false;this.unloadCount++;}
    }
    class ItemView extends Component {
      constructor(){super();this.contentEl=host;this.children=new Set();this.app={workspace:{requestSaveLayout(){}}};}
      addChild(c){this.children.add(c);c.load();}
      removeChild(c){this.children.delete(c);c.unload();}
    }
    const service={loadSettings:async()=>({questionRoots:['题库'],knowledgeRoots:[],recursive:true}),scan:async()=>index,
      listPlans:async()=>[],saveSettings:async()=>{},openSource:async()=>{},
      beginSourceCheck:()=>({isCurrent:()=>true,assertCurrent(){},dispose(){}})};
    const renderMarkdown=async(md,node,sourcePath,owner,signal)=>{
      const inline=node.classList.contains('mwb-assembly-snippet-body');
      const call={md,node,sourcePath,owner,signal,inline};calls.push(call);
      if(inline){active++;maxActive=Math.max(maxActive,active);}
      try {
        if(inline&&deferred)await new Promise(resolve=>{call.finish=resolve;pending.push(call);});
        if(inline&&fail)throw Error('测试摘要渲染失败');
        const paragraph=doc.createElement('p');paragraph.textContent=md;node.append(paragraph);
        if(inline){
          const link=doc.createElement('a');link.href='#hidden';link.textContent='预览中的链接';node.append(link);
          // Give the compact preview real overflowing content without cutting
          // the Markdown sent to its renderer or inventing a MathJax layout.
          for(let i=0;i<extraParagraphs;i++){const p=doc.createElement('p');p.textContent='完整正文的后续内容 '+i;node.append(p);}
        }
      } finally {if(inline)active--;}
    };
    const View=load(sources.view)({ItemView,Notice:class{},Component,core,service,renderMarkdown});
    const view=new View({},{});
    const f={frame,doc,host,win,view,owners,calls,observers,service,
      active:()=>active,maxActive:()=>maxActive,inlineCalls:()=>calls.filter(c=>c.inline),
      finishAll:()=>pending.splice(0).forEach(c=>c.finish()),
      setDeferred:value=>{deferred=value;},setFail:value=>{fail=value;},
      setIndex:next=>{index=next;},core};
    fixtures.push(f);await view.onOpen();return f;
  }
  const button=(node,label)=>[...node.querySelectorAll('button')].find(el=>el.textContent.trim()===label);
  const snippets=node=>[...node.querySelectorAll('.mwb-assembly-snippet')];
  const emit=(f,node)=>{
    const targets=snippets(node);for(const observer of f.observers)observer.emit(targets.filter(target=>observer.targets.has(target)));
  };
  const search=(f,value)=>{f.view.searchInput.value=value;f.view.searchInput.dispatchEvent(new f.win.Event('input'));};
  const fit=f=>{
    ok(f.host.scrollWidth<=f.host.clientWidth+1,'host overflows horizontally');
    ok(f.view.center.scrollWidth<=f.view.center.clientWidth+1,'result panel overflows horizontally');
  };

  await check('visible result cards render intact Markdown with original source paths before any click',async()=>{
    const f=await fixture();
    await until(()=>f.inlineCalls().length>0&&snippets(f.view.results).some(node=>node.dataset.previewState==='ready'),'visible cards did not render automatically');
    ok(!f.view.selectedItem&&!f.view.center.classList.contains('is-previewing'),'automatic cards unexpectedly opened the full preview');
    const call=f.inlineCalls()[0],record=records.find(row=>row.path===call.sourcePath);
    ok(record&&call.md===body(record.markdown),'compact preview cut a formula, code fence, image or source body');
    ok(call.signal&&typeof call.signal.addEventListener==='function'&&!call.signal.aborted,'inline renderer did not receive a live AbortSignal');
    ok(f.inlineCalls().length<records.length,'offscreen cards rendered eagerly');
    const shell=call.node.closest('.mwb-assembly-snippet');
    ok(shell&&shell.inert,'clipped preview content remains keyboard-interactive');
    const link=call.node.querySelector('a');link.focus();ok(f.doc.activeElement!==link,'hidden snippet link can receive keyboard focus');
    const height=shell.getBoundingClientRect().height;
    ok(height>112&&height<=330,'long preview did not gain readable space while staying bounded: '+height);
  });

  await check('each question occupies one full row at every width and short previews use their natural height',async()=>{
    const f=await fixture();await until(()=>f.inlineCalls().length>0,'initial preview absent');
    const cards=()=>[...f.view.results.querySelectorAll('.mwb-assembly-result')];
    let a=cards()[0].getBoundingClientRect(),b=cards()[1].getBoundingClientRect();
    ok(Math.abs(a.left-b.left)<2&&b.top>=a.bottom-2,'wide workspace still puts questions beside one another');
    ok(a.width>=f.view.results.getBoundingClientRect().width-2,'question preview does not use the full result width');fit(f);
    const widePane=f.view.center.getBoundingClientRect();
    const fullCards=cards().filter(card=>{const rect=card.getBoundingClientRect();return rect.top>=widePane.top&&rect.bottom<=widePane.bottom;}).length;
    const columns=new Set(cards().map(card=>Math.round(card.getBoundingClientRect().left))).size;
    ok(columns===1,'wide result list contains multiple question columns');
    const measurements={wide:{width:1400,height:860,columns,fullyVisibleCards:fullCards,cardHeight:Math.round(a.height),previewHeight:Math.round(snippets(cards()[0])[0].getBoundingClientRect().height)}};
    f.host.style.width='420px';f.host.style.height='600px';f.view.switchPane('library');await pause(30);
    a=cards()[0].getBoundingClientRect();b=cards()[1].getBoundingClientRect();
    ok(Math.abs(a.left-b.left)<2&&b.top>=a.bottom-2,'narrow workspace does not keep one question per row');
    measurements.narrow={width:420,height:600,columns:new Set(cards().map(card=>Math.round(card.getBoundingClientRect().left))).size,cardHeight:Math.round(a.height),previewHeight:Math.round(snippets(cards()[0])[0].getBoundingClientRect().height)};
    f.view.limit=10;f.view.renderResults();await pause();
    const more=button(f.view.results,'再显示 100 条');ok(more,'paging action missing');
    f.view.center.scrollTop=f.view.center.scrollHeight;await pause();
    const rect=more.getBoundingClientRect(),pane=f.view.center.getBoundingClientRect();
    ok(rect.top>=pane.top&&rect.bottom<=pane.bottom,'paging action cannot be reached in the short pane');
    more.click();await pause();ok(cards().length===records.length,'reachable paging action did not add results');fit(f);
    const short=await fixture({sourceRecords:[{...records[0],markdown:'短题：求 $1+1$。'}],extraParagraphs:0});
    await until(()=>snippets(short.view.results).some(node=>node.dataset.previewState==='ready'),'short question preview absent');
    const shortShell=snippets(short.view.results)[0],shortHeight=shortShell.getBoundingClientRect().height;
    ok(shortHeight>0&&shortHeight<112,'short question is padded to the long preview height: '+shortHeight);
    ok(short.win.getComputedStyle(shortShell).maskImage==='none','short question text is faded despite fitting in the preview');
    measurements.short={previewHeight:Math.round(shortHeight)};
    return measurements;
  });

  await check('compact cards retain the full preview and its return target',async()=>{
    const f=await fixture();await until(()=>f.inlineCalls().some(c=>c.node.isConnected),'initial preview absent');
    const row=f.view.results.querySelector('.mwb-assembly-result'),title=row.querySelector('.mwb-assembly-result-title');
    title.focus();title.click();await pause();
    ok(f.view.selectedItem?.path===row.dataset.sourcePath,'title opens the wrong source');
    const full=f.calls.find(c=>!c.inline);
    ok(full&&full.md===body(records.find(record=>record.path===row.dataset.sourcePath).markdown),'full preview was replaced with a clipped snippet');
    button(f.view.preview,'收起预览').click();await pause();
    ok(!f.view.selectedItem&&f.doc.activeElement===title,'return from full preview lost its card title');
  });

  await check('render concurrency remains bounded across filtering and stale queued work is discarded',async()=>{
    const f=await fixture({manual:true,deferred:true});await pause();
    ok(f.inlineCalls().length===0,'cards started before IntersectionObserver visibility');
    emit(f,f.view.results);await pause();
    ok(f.inlineCalls().length===2&&f.active()===2,'visible renders were not limited to two');
    const old=f.inlineCalls().slice(),oldObservers=f.observers.slice();
    search(f,'末尾条件 23');await pause();
    ok(old.every(call=>call.signal.aborted&&!call.owner.loaded),'filtering failed to abort and release old card owners');
    ok(oldObservers.every(observer=>observer.disconnected),'filtering left old observers attached');
    for(const observer of oldObservers)observer.emit(observer.observed);
    emit(f,f.view.results);await pause();
    ok(f.inlineCalls().length===2&&f.maxActive()===2,'filter reset active count and launched renders over the limit');
    f.finishAll();await until(()=>f.inlineCalls().length===3,'new result failed to render after old slots settled');
    ok(f.inlineCalls().slice(2).every(call=>call.sourcePath==='题库/章节/Q23.md'),'obsolete queued cards still rendered');
    ok(!f.view.results.textContent.includes('第 0 道完整题干。'),'late old render polluted the replacement list');
    f.finishAll();await pause();
    ok(f.maxActive()===2&&old.every(call=>!call.node.isConnected&&!call.owner.loaded),'old card resources survived their late completion');
  });

  await check('candidate previews render without clicking and their invalidation leaves results owned independently',async()=>{
    const f=await fixture({manual:true});emit(f,f.view.results);
    await until(()=>f.inlineCalls().length>=2,'result cards did not render');await pause();
    const resultOwners=f.inlineCalls().map(call=>call.owner);
    f.setDeferred(true);f.view.selectionCount='2';f.view.drawSelection();emit(f,f.view.selectionRows);await pause();
    const candidateCalls=f.inlineCalls().filter(call=>!!call.node.closest('.mwb-assembly-selection-row'));
    ok(candidateCalls.length===2,'candidate cards require an extra preview click');
    const candidateRows=[...f.view.selectionRows.querySelectorAll('.mwb-assembly-selection-row')],a=candidateRows[0].getBoundingClientRect(),b=candidateRows[1].getBoundingClientRect();
    ok(Math.abs(a.left-b.left)<2&&b.top>=a.bottom-2&&a.width>=f.view.selectionRows.getBoundingClientRect().width-2,'candidate questions do not each occupy one full row');
    ok(f.view.plan.entries.length===0,'automatic candidate previews added content to the plan');
    const input=f.view.selectionCountInput;input.focus();input.value='3';input.dispatchEvent(new f.win.Event('input'));await pause();
    ok(candidateCalls.every(call=>call.signal.aborted&&!call.owner.loaded),'quantity editing left candidate renders alive');
    ok(resultOwners.every(owner=>owner.loaded),'candidate invalidation released the independent result previews');
    ok(f.doc.activeElement===input&&!f.view.selection,'candidate cleanup stole input focus or restored a stale batch');
    f.finishAll();await pause();
    ok(f.view.selectionRows.childElementCount===0&&candidateCalls.every(call=>!call.node.isConnected),'late candidate renders revived discarded candidates');
  });

  await check('a failed automatic preview exposes a fallback without blocking inclusion or full reading',async()=>{
    const f=await fixture({manual:true,fail:true});emit(f,f.view.results);
    await until(()=>snippets(f.view.results).some(node=>node.dataset.previewState==='error'),'render failure has no fallback state');
    const failed=snippets(f.view.results).find(node=>node.dataset.previewState==='error');
    ok(failed.textContent.trim(),'render failure is an empty card');
    const row=failed.closest('.mwb-assembly-result'),source=row.dataset.sourcePath;
    row.querySelector('.mwb-assembly-result-title').click();await pause();
    ok(f.view.selectedItem?.path===source&&f.view.preview.textContent.includes('末尾条件'),'failed snippet blocks full reading');
    button(f.view.preview,'加入题篮').click();await pause();
    ok(f.view.plan.entries.length===1&&f.view.plan.entries[0].sourcePath===source,'failed snippet blocks adding the source');
  });

  await check('closing aborts active renders, disconnects observers and prevents late work from reviving the view',async()=>{
    const f=await fixture({manual:true,deferred:true});emit(f,f.view.results);await pause();
    const calls=f.inlineCalls().slice();ok(calls.length===2,'close test lacks active render work');
    await f.view.onClose();
    ok(calls.every(call=>call.signal.aborted&&!call.owner.loaded),'close did not abort and release active render owners');
    ok(f.observers.every(observer=>observer.disconnected),'close left an observer attached');
    for(const observer of f.observers)observer.emit(observer.observed);
    f.finishAll();await pause();
    ok(f.inlineCalls().length===2&&!f.host.childElementCount,'late completion or observer callback restarted a closed view');
    ok(calls.every(call=>!call.node.isConnected&&!call.owner.loaded),'closed view retained active card resources');
  });

  await check('the no-observer fallback still limits automatic rendering and cancels it on close',async()=>{
    const f=await fixture({noObserver:true,deferred:true});await pause();
    ok(f.inlineCalls().length===2&&f.active()===2,'fallback did not start bounded automatic rendering');
    await f.view.onClose();f.finishAll();await pause();
    ok(f.inlineCalls().length===2&&f.maxActive()===2&&!f.host.childElementCount,'fallback queue continued after close');
  });

  const output=document.createElement('pre');output.id='mwb-test-results';output.textContent=JSON.stringify(results);document.body.append(output);
}

test('assembly cards preview before clicking and release asynchronous render work safely',async t=>{
  if(!chrome){if(process.env.CI)throw Error('Chrome is required for inline preview regression tests');t.skip('Set CHROME_PATH');return;}
  const sources={core:fs.readFileSync(path.join(root,'src/assembly-core.cjs'),'utf8'),view:fs.readFileSync(path.join(root,'src/assembly-view.cjs'),'utf8')};
  const css=hostCss+fs.readFileSync(path.join(root,'styles/assembly.css'),'utf8');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-inline-preview-'));
  try {
    const script='('+browserCases.toString()+')('+JSON.stringify(sources)+','+JSON.stringify(css)+').catch(error=>{const out=document.createElement("pre");out.id="mwb-test-results";out.textContent=JSON.stringify([{name:"fixture initialization",ok:false,error:String(error.stack||error)}]);document.body.append(out);});';
    const file=path.join(dir,'inline.html');fs.writeFileSync(file,'<!doctype html><meta charset="utf-8"><body><script>'+script.replace(/<\/script/gi,'<\\/script')+'</script>');
    const results=await runChromeDocument(chrome,file,path.join(dir,'profile'));
    for(const result of results)await t.test(result.name,t=>{assert.equal(result.ok,true,result.error);if(result.measurements)t.diagnostic(JSON.stringify(result.measurements));});
  } finally {fs.rmSync(dir,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
});
