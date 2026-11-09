'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {compileMarkdown}=require('../src/assembly-markdown.cjs');
const createService=require('../src/assembly-service.cjs');
const createView=require('../src/assembly-view.cjs');

const source=(metadata,body)=>`---\n${JSON.stringify(metadata)}\n---\n${body}`;
const q=(id='Q1',body='函数最小值为 ?{1}。')=>source({id,subject:'高中数学',question_type:'fill_blank',role:'训练',knowledge_nodes:['[[集合]]']},body);
const k=(id='K1')=>source({id,type:'知识点',title:'集合',aliases:['集合表示']},'# 集合\n\n完整知识正文。\n\n## 子集\n\n每个小节保留。');

function fixture(initial={},saved={}) {
  const nodes=new Map(),writes=[],reads=[],opened=[],previews=[];
  const listeners=new Set();
  const trigger=(event,...args)=>{for(const ref of [...listeners])if(ref.event===event)ref.callback(...args);};
  function folder(path) {
    if(nodes.has(path))return nodes.get(path);
    const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null;
    const node={path,name:path.split('/').pop(),children:[]}; nodes.set(path,node); if(parent)parent.children.push(node); return node;
  }
  function file(path,content) {
    const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null;
    const name=path.split('/').pop();
    const node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.split('.').pop(),content,parent,stat:{mtime:1,size:content.length}};
    nodes.set(path,node);if(parent)parent.children.push(node);return node;
  }
  Object.entries(initial).forEach(([path,body])=>file(path,body));
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,
    on:(event,callback)=>{const ref={event,callback};listeners.add(ref);return ref;},
    offref:ref=>listeners.delete(ref),
    getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),
    async read(node){if(!node||node.children)throw Error('not file');reads.push(node.path);return node.content;},
    async createFolder(path){if(nodes.has(path))throw Error('exists');writes.push(['folder',path]);return folder(path);},
    async create(path,text){if(nodes.has(path))throw Error('exists');writes.push(['create',path]);const node=file(path,text);trigger('create',node);return node;},
    async modify(node,text){if(node.children)throw Error('not file');writes.push(['modify',node.path]);node.content=text;node.stat.mtime++;trigger('modify',node);},
  };
  let stored=JSON.parse(JSON.stringify(saved));
  const plugin={app:{vault,metadataCache:{getFirstLinkpathDest:(target,from)=>{
    const direct=nodes.get(target)||nodes.get(target+'.md'); if(direct)return direct;
    const prefix=from.includes('/')?from.slice(0,from.lastIndexOf('/')+1):'';
    return nodes.get(prefix+target)||nodes.get(prefix+target+'.md')||null;
  }},workspace:{getLeaf:()=>({openFile:async node=>opened.push(node.path)})}},
    loadData:async()=>stored,saveData:async next=>{stored=JSON.parse(JSON.stringify(next));}};
  const deps={core,compileMarkdown,parseYaml:JSON.parse,previewFile:async node=>previews.push(node.path)};
  return {nodes,writes,reads,opened,previews,vault,plugin,deps,file,folder,trigger,listenerCount:()=>listeners.size,
    service:createService(plugin,deps),getStored:()=>stored,
    rename(oldPath,newPath){const node=nodes.get(oldPath);assert(node);nodes.delete(oldPath);node.parent.children=node.parent.children.filter(n=>n!==node);node.path=newPath;node.name=newPath.split('/').pop();node.basename=node.name.replace(/\.md$/,'');node.parent=folder(newPath.slice(0,newPath.lastIndexOf('/')));node.parent.children.push(node);nodes.set(newPath,node);trigger('rename',node,oldPath);},
    remove(path){const node=nodes.get(path);assert(node);nodes.delete(path);node.parent.children=node.parent.children.filter(n=>n!==node);trigger('delete',node);}
  };
}
const roots={questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true};
async function prepared(extra={}) {
  const f=fixture({'题库/题.md':q(),'知识/集合.md':k(),...extra});
  await f.service.saveSettings(roots); const index=await f.service.scan();
  let plan=core.createPlan('集合复习');
  plan=core.addItem(plan,index.items.find(i=>i.kind==='knowledge'));
  plan=core.addItem(plan,index.items.find(i=>i.id==='Q1'));
  return {...f,index,plan};
}

test('scan respects source roots, recursion and exclusions without writing notes',async()=>{
  const f=fixture({'题库/题.md':q(),'题库/子目录/二.md':q('Q2'),'题库/模板&规范/示例.md':q('Q3'),
    '题库/ExamExports/旧输出.md':q('Q4'),'题库/.trash/旧题.md':q('Q5'),
    '其他/无关.md':q('Q6'),'知识/集合.md':k(),'知识/README.md':k('K2'),
    '知识/_高中知识登记/索引.md':k('K3')});
  await f.service.saveSettings(roots);
  const before=[...f.nodes.values()].filter(n=>n.extension).map(n=>[n.path,n.content]);
  const index=await f.service.scan();
  assert.deepEqual(index.items.map(i=>i.id).sort(),['K1','Q1','Q2']);
  assert.equal(f.writes.length,0);
  assert.deepEqual(before,[...f.nodes.values()].filter(n=>n.extension).map(n=>[n.path,n.content]));
  assert(!f.reads.includes('其他/无关.md'));
  const shallow=await f.service.scan({...roots,recursive:false});
  assert.deepEqual(shallow.items.map(i=>i.id).sort(),['K1','Q1']);
});

test('an explicitly selected knowledge directory includes whole notes without YAML or invented IDs',async()=>{
  const f=fixture({'题库/题.md':q(),'知识/纯正文.md':'# 集合表示\n\n无元信息的完整知识正文。','知识/README.md':'目录导航'});
  await f.service.saveSettings(roots);
  const index=await f.service.scan(),item=index.items.find(item=>item.path==='知识/纯正文.md');
  assert(item,'Plain knowledge notes must be discoverable in the explicitly selected directory');
  assert.equal(item.kind,'knowledge');assert.equal(item.id,'');
  const plan=core.addItem(core.createPlan('普通知识讲义'),item);
  assert.match((await f.service.compile(plan,index)).markdown,/无元信息的完整知识正文/);
  assert.equal(f.writes.length,0);
});

test('settings reject traversal and non-folders, preserving unrelated plugin data',async()=>{
  const f=fixture({'题库/题.md':q(),'知识/集合.md':k()},{unrelated:{keep:true}});
  for(const path of ['', '/绝对路径','../题库','题库/../知识','题库//子目录','题库/题.md','不存在']){
    // Empty lists are valid disabled scopes; an explicit empty root is filtered.
    if(!path)continue;
    await assert.rejects(f.service.saveSettings({...roots,questionRoots:[path]}));
  }
  await f.service.saveSettings(roots);
  assert.deepEqual(f.getStored().unrelated,{keep:true});
  assert.deepEqual(await f.service.loadSettings(),roots);
  assert.equal(f.writes.length,0);
});

test('plans save and reload under their dedicated folder with no source writes',async()=>{
  const f=await prepared(); const path=await f.service.savePlan(f.plan);
  assert.match(path,/^Mathsemble\/组题方案\/集合复习_.*\.json$/);
  assert.deepEqual(await f.service.loadPlan(path),f.plan);
  assert.equal((await f.service.listPlans())[0].path,path);
  assert(f.writes.every(([,p])=>p.startsWith('Mathsemble')));
  const changed={...f.plan,title:'新标题'};
  assert.equal(await f.service.savePlan(changed,path),path);
  assert.equal((await f.service.loadPlan(path)).title,'新标题');
  await assert.rejects(f.service.savePlan(f.plan,'题库/题.md'),/方案只能/);
  await assert.rejects(f.service.loadPlan('知识/集合.md'),/方案只能/);
  assert.equal(f.nodes.get('题库/题.md').content,q());
});

test('saving a plan refuses to overwrite edits made outside the current service',async()=>{
  const f=await prepared(),path=await f.service.savePlan(f.plan);
  const external={...f.plan,title:'另一窗口修改'};
  await f.vault.modify(f.nodes.get(path),JSON.stringify(external,null,2)+'\n');
  const externalBytes=f.nodes.get(path).content,before=f.writes.length;
  await assert.rejects(f.service.savePlan({...f.plan,title:'本窗口修改'},path));
  assert.equal(f.nodes.get(path).content,externalBytes);assert.equal(f.writes.length,before);
  const loaded=await f.service.loadPlan(path);
  assert.equal(loaded.title,'另一窗口修改');
  await f.service.savePlan({...loaded,title:'重新读取后的修改'},path);
  assert.equal((await f.service.loadPlan(path)).title,'重新读取后的修改');
});

test('a service must load an existing plan before saving over its path',async()=>{
  const f=await prepared(),path=await f.service.savePlan(f.plan);
  const restarted=createService(f.plugin,f.deps),before=f.nodes.get(path).content;
  await assert.rejects(restarted.savePlan({...f.plan,title:'未读取的修改'},path));
  assert.equal(f.nodes.get(path).content,before);
  const loaded=await restarted.loadPlan(path);
  await restarted.savePlan({...loaded,title:'已读取的修改'},path);
  assert.equal((await restarted.loadPlan(path)).title,'已读取的修改');
});

test('one view cannot overwrite another view using its stale loaded plan',async()=>{
  const f=await prepared(),path=await f.service.savePlan(f.plan);
  const viewA=f.service.createPlanSession(),viewB=f.service.createPlanSession();
  const planA=await viewA.loadPlan(path),planB=await viewB.loadPlan(path);
  await viewA.savePlan({...planA,title:'窗口 A 已保存'},path);
  const before=f.nodes.get(path).content,writes=f.writes.length;
  await assert.rejects(viewB.savePlan({...planB,title:'窗口 B 旧编排'},path),/已被外部修改/);
  assert.equal(f.nodes.get(path).content,before);
  assert.equal(f.writes.length,writes);
  assert.equal(JSON.parse(before).title,'窗口 A 已保存');
});

test('concurrent view saves have one winner, and reloading permits a later save',async()=>{
  const f=await prepared(),path=await f.service.savePlan(f.plan);
  const viewA=f.service.createPlanSession(),viewB=f.service.createPlanSession();
  const [planA,planB]=await Promise.all([viewA.loadPlan(path),viewB.loadPlan(path)]);
  const before=f.writes.length;
  const outcomes=await Promise.allSettled([
    viewA.savePlan({...planA,title:'并发 A'},path),
    viewB.savePlan({...planB,title:'并发 B'},path)
  ]);
  assert.deepEqual(outcomes.map(result=>result.status),['fulfilled','rejected']);
  assert.match(outcomes[1].reason.message,/已被外部修改/);
  assert.equal(f.writes.length,before+1,'Only the winning save writes the plan');
  assert.equal(JSON.parse(f.nodes.get(path).content).title,'并发 A');
  const refreshed=await viewB.loadPlan(path);
  assert.equal(refreshed.title,'并发 A');
  await viewB.savePlan({...refreshed,title:'重开后的 B'},path);
  assert.equal(JSON.parse(f.nodes.get(path).content).title,'重开后的 B');
});

test('compile follows renamed IDs, keeps whole knowledge notes and does not create output until requested',async()=>{
  const f=await prepared();f.rename('题库/题.md','题库/改名.md');
  const result=await f.service.compile(f.plan,f.index);
  assert.match(result.markdown,/完整知识正文/);assert.match(result.markdown,/每个小节保留/);
  assert.match(result.markdown,/函数最小值为 \?\{1\}/);
  assert(result.markdown.indexOf('完整知识正文')<result.markdown.indexOf('函数最小值'));
  assert.equal(f.writes.length,0);
});

test('compile re-reads sources and blocks stale, removed or conflicted entries',async()=>{
  const f=await prepared();const original=f.nodes.get('题库/题.md').content;
  f.nodes.get('题库/题.md').content=q('Q1','内容变化');
  await assert.rejects(f.service.compile(f.plan,f.index),/来源已变化/);
  f.nodes.get('题库/题.md').content=original;
  f.file('题库/重复.md',q('Q1'));
  await assert.rejects(f.service.exportMarkdown(f.plan,f.index),/身份冲突/);
  f.nodes.delete('题库/重复.md');f.nodes.delete('题库/题.md');
  await assert.rejects(f.service.compile(f.plan,f.index),/缺失/);
  assert.equal(f.writes.length,0);
});

test('source edits during asynchronous compilation prevent output writes',async()=>{
  const f=await prepared();
  const service=createService(f.plugin,{...f.deps,compileMarkdown:async(...args)=>{
    const result=await compileMarkdown(...args);f.nodes.get('题库/题.md').content=q('Q1','异步期间变化');return result;
  }});
  await assert.rejects(service.exportMarkdown(f.plan,f.index),/生成期间源文发生变化/);
  assert.equal(f.writes.length,0);
});

test('explicit Markdown export creates unique snapshots and preserves all source bytes',async()=>{
  const f=await prepared();const before=new Map([...f.nodes].filter(([,n])=>n.extension==='md').map(([p,n])=>[p,n.content]));
  const first=await f.service.exportMarkdown(f.plan,f.index),second=await f.service.exportMarkdown(f.plan,f.index);
  assert.notEqual(first,second);assert.match(first,/^Mathsemble\/讲义\/.*\.md$/);
  assert.match(f.nodes.get(first).content,/完整知识正文/);
  for(const [path,content]of before)assert.equal(f.nodes.get(path).content,content);
  assert(f.writes.every(([,path])=>path.startsWith('Mathsemble')));
  assert.equal((await f.service.scan()).items.length,2,'Generated files must not become source records');
});

test('preview opens the generated snapshot, and openSource uses the original file',async()=>{
  const f=await prepared();await f.service.preview(f.plan,f.index);
  assert.equal(f.previews.length,1);assert.match(f.previews[0],/^Mathsemble\/讲义\//);
  await f.service.openSource('知识/集合.md');assert.deepEqual(f.opened,['知识/集合.md']);
  await assert.rejects(f.service.openSource('不存在.md'),/不存在/);
});

test('read errors remain visible and block output when a selected source cannot be read',async()=>{
  const f=await prepared();f.nodes.get('题库/题.md').content='---\ninvalid json metadata\n---\n正文';
  const index=await f.service.scan();
  assert.equal(index.items.length,1);assert.equal(index.issues[0].code,'read-error');
  assert.equal(index.issues[0].path,'题库/题.md');
  await assert.rejects(f.service.compile(f.plan,index),/来源已变化、缺失/);
});

test('source-relative links are resolved against the original source context',async()=>{
  const f=await prepared({'题库/图片.svg':'<svg/>'});
  f.nodes.get('题库/题.md').content=q('Q1','![题图](图片.svg)');
  const index=await f.service.scan();
  const plan=core.addItem(core.createPlan('题图讲义'),index.items.find(i=>i.id==='Q1'));
  const {markdown}=await f.service.compile(plan,index);
  assert.match(decodeURIComponent(markdown),/题库\/图片\.svg/);
  assert.equal(f.writes.length,0);
});

test('host compilation decodes Markdown URI paths once and keeps Wiki paths literal',async()=>{
  const f=await prepared({'题库/题.md':q('Q1','![literal](a%2520b.png)\n![space](a%20b.png)\n![[a%20b.png|120]]\n![percent](rate%25.png)\n![Chinese](%E5%9B%BE.png)\n[note](n%2520x.md)\n[[n%20x]]'),
    '题库/a%20b.png':'literal percent image','题库/a b.png':'space image','题库/rate%.png':'percent image','题库/图.png':'Chinese image',
    '题库/n%20x.md':'literal percent note','题库/n x.md':'space note'});
  const lookups=[],lookup=f.plugin.app.metadataCache.getFirstLinkpathDest;
  f.plugin.app.metadataCache.getFirstLinkpathDest=(target,from)=>{lookups.push(target);return lookup(target,from);};
  const {markdown}=await f.service.compile(f.plan,f.index);
  assert.deepEqual(lookups.toSorted(),['a%20b.png','a b.png','a%20b.png','rate%.png','图.png','n%20x.md','n%20x'].toSorted());
  assert(markdown.includes('![literal](../../%E9%A2%98%E5%BA%93/a%2520b.png)'));
  assert(markdown.includes('![space](../../%E9%A2%98%E5%BA%93/a%20b.png)'));
  assert(markdown.includes('![[题库/a%20b.png|120]]'));
  assert(markdown.includes('![percent](../../%E9%A2%98%E5%BA%93/rate%25.png)'));
  assert(markdown.includes('![Chinese](../../%E9%A2%98%E5%BA%93/%E5%9B%BE.png)'));
  assert(markdown.includes('[note](../../%E9%A2%98%E5%BA%93/n%2520x.md)'));
  assert(markdown.includes('[[题库/n%20x.md]]'));
  assert.equal(f.writes.length,0);
});

async function selectionFixture() {
  const initial=Object.fromEntries(Array.from({length:21},(_,i)=>[`题库/Q${String(i).padStart(2,'0')}.md`,q('Q'+i)]));
  const f=fixture(initial,{assemblySettings:roots});
  class ItemView {constructor(){this.app=f.plugin.app;this.contentEl={replaceChildren(){}};}}
  const View=createView({ItemView,Notice:class{},core,service:f.service});
  const view=new View({},f.plugin);view.closed=false;view.settings=roots;view.index=await f.service.scan(roots);
  for(const method of ['renderSelection','populateFilters','renderTree','renderOutline','renderResults','updateSummary'])view[method]=()=>{};
  view.setStatus=message=>{view.lastStatus=message;};
  view.plan=core.addSection(core.createPlan(),'保留已有编排');
  const result=core.selectQuestions(view.index,view.filters,view.plan,2,()=>0);
  view.selection={...result,index:view.index,context:view.selectionContext()};
  return {...f,view};
}

test('candidate application rejects source changes during later scan batches without publishing a stale index',async t=>{
  for(const [name,change] of [
    ['modify',async f=>{const node=f.nodes.get('题库/Q00.md');await f.vault.modify(node,node.content+'\n已修改');}],
    ['delete',f=>f.remove('题库/Q00.md')],
    ['rename',f=>f.rename('题库/Q00.md','题库/Q00-renamed.md')],
    ['create duplicate ID',f=>f.vault.create('题库/新增冲突.md',q('Q0'))],
    ['rename source root',f=>{const folder=f.nodes.get('题库');folder.path='其他';f.trigger('rename',folder,'题库');}],
  ]) await t.test(name,async()=>{
    const f=await selectionFixture(),{view}=f,planBefore=JSON.stringify(view.plan),indexBefore=view.index;
    const read=f.vault.read;let release,reached;
    const paused=new Promise(resolve=>{reached=resolve;});
    f.vault.read=async node=>{if(node.path==='题库/Q20.md'){reached();await new Promise(resolve=>{release=resolve;});}return read(node);};
    const applying=view.applySelection();await paused;
    const listenersDuringScan=f.listenerCount();
    try{await change(f);}finally{release();}
    await applying;
    assert.equal(JSON.stringify(view.plan),planBefore,'no selected candidate may be inserted');
    assert.equal(view.index,indexBefore,'the invalidated scan must not be published');
    assert.equal(view.selection,null);assert.match(view.lastStatus,/来源在核对期间发生变化/);
    assert.equal(listenersDuringScan,4);assert.equal(f.listenerCount(),0);assert.equal(view.actionBusy,false);
  });
});

test('candidate source watchers are released on success, scan error and close',async t=>{
  await t.test('successful application ignores unrelated files and releases listeners',async()=>{
    const f=await selectionFixture(),read=f.vault.read;
    f.vault.read=async node=>{if(node.path==='题库/Q20.md')f.trigger('modify',{path:'其他/笔记.md',extension:'md'});return read(node);};
    await f.view.applySelection();
    assert.equal(f.view.plan.entries.length,3);assert.equal(f.view.selection,null);
    assert.match(f.view.lastStatus,/已将 2 道题加入编排/);assert.equal(f.listenerCount(),0);
  });
  await t.test('scan error preserves plan and index and releases listeners',async()=>{
    const f=await selectionFixture(),planBefore=JSON.stringify(f.view.plan),indexBefore=f.view.index;
    f.vault.getMarkdownFiles=()=>{throw Error('模拟扫描异常');};
    await f.view.applySelection();
    assert.equal(JSON.stringify(f.view.plan),planBefore);assert.equal(f.view.index,indexBefore);
    assert.equal(f.view.selection,null);assert.equal(f.listenerCount(),0);assert.match(f.view.lastStatus,/模拟扫描异常/);
  });
  await t.test('close releases listeners before pending scan finishes',async()=>{
    const f=await selectionFixture(),planBefore=JSON.stringify(f.view.plan),indexBefore=f.view.index;
    const read=f.vault.read;let release,reached;
    const paused=new Promise(resolve=>{reached=resolve;});
    f.vault.read=async node=>{if(node.path==='题库/Q20.md'){reached();await new Promise(resolve=>{release=resolve;});}return read(node);};
    const applying=f.view.applySelection();await paused;
    assert.equal(f.listenerCount(),4);await f.view.onClose();assert.equal(f.listenerCount(),0);
    release();await applying;
    assert.equal(JSON.stringify(f.view.plan),planBefore);assert.equal(f.view.index,indexBefore);
    assert.equal(f.listenerCount(),0);assert.equal(f.view.actionBusy,false);
  });
});
