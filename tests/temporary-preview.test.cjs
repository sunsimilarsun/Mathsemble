'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE||path.resolve(__dirname,'../src/plugin.js'),'utf8');
const virtualPath='Mathsemble/讲义/__preview__.md';
const note=(metadata,body)=>`---\n${JSON.stringify(metadata)}\n---\n${body}`;
const question=note({id:'Q1',question_type:'fill_blank',title:'集合题'},'集合题的原始正文 ?{2}。');
const knowledge=note({id:'K1',type:'知识点',title:'集合'},'# 集合\n\n知识原始正文。');

// These host shims omit painting and PDF generation. Constructors, source
// guards, the registered A4 action and both export worker lifecycles stay real.
class Element {
  constructor(ownerDocument,tag='div') {
    this.ownerDocument=ownerDocument;this.tagName=tag;this.children=[];this.style={};this.dataset={};this.attributes=new Map();
    const names=new Set();this.classList={add:(...values)=>values.forEach(value=>names.add(value)),
      remove:(...values)=>values.forEach(value=>names.delete(value)),contains:value=>names.has(value),
      toggle:(value,force)=>{if(force??!names.has(value))names.add(value);else names.delete(value);}};
  }
  appendChild(child){child.parentElement=this;this.children.push(child);return child;}
  createEl(tag,opts={}){const child=this.ownerDocument.createElement(tag);Object.assign(child,{textContent:opts.text||'',className:opts.cls||''});return this.appendChild(child);}
  createDiv(opts={}){return this.createEl('div',opts);}
  setAttribute(key,value){this.attributes.set(key,String(value));}
  removeAttribute(key){this.attributes.delete(key);}
  addEventListener(){}
  setText(value){this.textContent=value;}
  replaceChildren(){this.children=[];}
  empty(){this.replaceChildren();}
  querySelectorAll(){return [];}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(child=>child!==this);this.parentElement=null;}
}

async function fixture() {
  const document={createElement:tag=>new Element(document,tag)};
  const nodes=new Map(),reads=[],writes=[],listeners=new Set(),opened=[],notices=[],revealed=[];
  const add=(filePath,content)=>{const name=filePath.split('/').pop();const file={path:filePath,name,basename:name.replace(/\.md$/,''),extension:'md',content};nodes.set(filePath,file);return file;};
  for(const folder of ['题库','知识','Mathsemble','Mathsemble/讲义'])nodes.set(folder,{path:folder,children:[]});
  const originalQuestion=add('题库/题.md',question),originalKnowledge=add('知识/集合.md',knowledge);
  add(virtualPath,'用户已有同名文件，不能读取或覆盖。');
  const vault={getAbstractFileByPath:filePath=>nodes.get(filePath)||null,
    getMarkdownFiles:()=>[...nodes.values()].filter(file=>file.extension==='md'),
    async read(file){reads.push(file.path);if(file.path===virtualPath)throw new Error('读取了虚拟文件');return file.content;},
    on(event,callback){const ref={event,callback};listeners.add(ref);return ref;},offref:ref=>listeners.delete(ref),
    async createFolder(filePath){writes.push(['folder',filePath]);nodes.set(filePath,{path:filePath,children:[]});},
    async create(filePath,content){writes.push(['markdown',filePath]);return add(filePath,content);},
    async createBinary(filePath,bytes){writes.push(['pdf',filePath]);nodes.set(filePath,{path:filePath,extension:'pdf',bytes});},
  };
  const emit=(event,file,oldPath)=>{for(const ref of [...listeners])if(ref.event===event)ref.callback(file,oldPath);};
  const stopRegistration=new Error('registered assembly view'),stopPainting=new Error('captured preview action');
  let registered;
  class Component {constructor(){this.cleanup=[];}register(callback){this.cleanup.push(callback);}unload(){for(const callback of this.cleanup.splice(0))callback();}}
  class Plugin {
    constructor(){this.children=new Set();this.manifest={id:'mathsemble',version:'test'};}
    registerView(type,factory){assert.equal(type,'mathsemble-assembly');registered=factory;throw stopRegistration;}
    addChild(child){this.children.add(child);}removeChild(child){this.children.delete(child);child.unload();}
    async loadData(){return {assemblySettings:{questionRoots:['题库'],knowledgeRoots:['知识'],recursive:true}};}
  }
  class Modal {
    constructor(app){this.app=app;this.modalEl=document.createElement('section');this.contentEl=this.modalEl.createDiv();this.closeCalls=0;}
    open(){opened.push(this);this.startSourceWatch();}
    close(){this.closeCalls++;this.onClose();}
  }
  class ItemView {constructor(leaf){this.app=leaf.app;this.contentEl=document.createElement('section');}}
  const obsidian={Plugin,Component,ItemView,Modal,Notice:class{constructor(message){notices.push(message);}},MarkdownRenderer:{},MarkdownView:class{}};
  const context=vm.createContext({module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),console,Buffer,
    AbortController,setTimeout,clearTimeout,document});
  // Parse fixture JSON frontmatter and the compiler's quoted scalar YAML in
  // the same realm as core.validatePlan (which intentionally checks prototypes).
  vm.runInContext(`globalThis.fixtureParseYaml=text=>{if(text.trim().startsWith('{'))return JSON.parse(text);const result={};for(const line of text.split('\\n')){const match=/^([^:]+):\\s*(.*)$/.exec(line);if(match)result[match[1]]=JSON.parse(match[2]);}return result;};`,context);
  obsidian.parseYaml=context.fixtureParseYaml;
  vm.runInContext(source+'\nglobalThis.qa={PreviewModal,core:mwbAssemblyCore,clone:value=>JSON.parse(JSON.stringify(value))};',context);
  const plugin=new context.module.exports();
  const app=plugin.app={vault,metadataCache:{getFirstLinkpathDest:()=>null},workspace:{
    revealLeaf:async leaf=>{revealed.push(leaf);},requestSaveLayout(){}}};
  await assert.rejects(plugin.onload(),error=>error===stopRegistration);
  assert.equal(typeof registered,'function','the actual onload registered the assembly view');
  const leaf={app},view=registered(leaf);leaf.view=view;view.closed=false;
  const records=context.qa.clone([{path:originalKnowledge.path,markdown:knowledge,metadata:{id:'K1',type:'知识点',title:'集合'},kind:'knowledge'},
    {path:originalQuestion.path,markdown:question,metadata:{id:'Q1',question_type:'fill_blank',title:'集合题'},kind:'question'}]);
  view.index=context.qa.core.buildIndex(records);
  view.plan=context.qa.core.createPlan('集合复习');
  for(const item of view.index.items)view.plan=context.qa.core.addItem(view.plan,item);
  view.plan.output.layout='trial';view.plan.output.mode='teacher';
  let previewAction;
  view.button=(parent,label,action)=>{if(label==='预览 A4'){previewAction=action;throw stopPainting;}return parent.createEl('button',{text:label});};
  assert.throws(()=>view.render(),error=>error===stopPainting);
  // The untouched button action still runs the real runAction and the real
  // service/previewFile closure created by plugin.onload. Only list painting is omitted.
  view.renderSelection=()=>{};view.statusEl=document.createElement('p');
  await previewAction();
  assert.equal(opened.length,1,notices.join('\n')||view.statusEl.textContent);
  const modal=opened[0];modal.status=document.createElement('p');modal.sourceStatus=document.createElement('p');
  modal.exportButtons=[document.createElement('button')];
  return {context,plugin,app,leaf,view,modal,nodes,reads,writes,listeners,notices,revealed,emit,originalQuestion,originalKnowledge,document};
}

test('registered A4 action opens a temporary PreviewModal from memory with original source records',async()=>{
  const f=await fixture();try {
    assert.equal(f.modal.file.path,virtualPath);assert.equal(f.modal.file.basename,'集合复习');
    assert.match(f.modal.markdown,/知识原始正文/);assert.match(f.modal.markdown,/集合题的原始正文/);
    assert.equal(f.modal.markdown,f.modal.assemblyPreview.markdown);
    assert.deepEqual(Array.from(f.modal.sourceSnapshot.entries,entry=>entry.record.file.path),['知识/集合.md','题库/题.md']);
    assert.equal(f.modal.sourceSnapshot.entries[0].live,f.originalKnowledge);
    assert.equal(f.modal.sourceSnapshot.entries[1].live,f.originalQuestion);
    assert.equal(f.modal.sourceSnapshot.entries[1].record.markdown,question);
    assert.equal(f.modal.sourceSnapshot.entries[1].record.metadata.id,'Q1');
    assert(Object.isFrozen(f.modal.sourceSnapshot.entries[1].record));assert(!Object.isFrozen(f.originalQuestion));
    assert.equal(f.modal.assemblyPreview.sourceMap.length,2);
    assert.equal(f.modal.sourceReadLabel(),'返回编排更新');
    assert.match(f.modal.sourceReadHint(),/临时预览.*未保存讲义/);
    assert(!f.reads.includes(virtualPath));assert.equal(f.writes.length,0);
    assert.match(f.nodes.get(virtualPath).content,/用户已有同名文件/);
    assert.equal(f.listeners.size,4);assert.equal(f.plugin.children.size,1);
  } finally {f.modal.onClose();}
  assert.equal(f.listeners.size,0);assert.equal(f.plugin.children.size,0);
});

test('real source verification blocks silently modified originals and source watches abort an active export',async()=>{
  const f=await fixture();try {
    f.reads.length=0;await f.modal.assertSourceCurrent();
    assert(f.reads.includes('题库/题.md')&&f.reads.includes('知识/集合.md'));assert(!f.reads.includes(virtualPath));
    const original=f.modal.markdown;
    f.originalQuestion.content+='\n后来修改';
    await assert.rejects(f.modal.assertSourceCurrent(),/来源|源文/);
    assert.equal(f.modal.sourceDirty,true);assert.equal(f.modal.exportButtons[0].disabled,true);
    assert.equal(f.modal.markdown,original);assert.equal(f.modal.sourceSnapshot.entries[1].record.markdown,question);
    assert.equal(f.modal.beginExport('dual'),null);
    f.modal.sourceDirty=false;f.modal.ready=true;
    const job=f.modal.beginExport('dual');assert(job);
    f.emit('modify',f.originalKnowledge);
    assert(job.controller.signal.aborted);assert.equal(f.modal.sourceDirty,true);
    assert.match(f.modal.sourceStatus.textContent,/题库或知识库内容已变化/);
    assert.equal(f.writes.length,0);
  } finally {f.modal.onClose();f.modal.onClose();}
  assert.equal(f.listeners.size,0);assert.equal(f.plugin.children.size,0);
});

test('returning to assembly reveals the live draft without reading or accepting updated source text',async()=>{
  const f=await fixture();
  const original=f.modal.markdown,plan=f.view.plan,index=f.view.index;
  f.originalQuestion.content+='\n后来修改';f.emit('modify',f.originalQuestion);
  f.reads.length=0;
  assert.equal(await f.modal.reloadSource(),true);
  assert.deepEqual(f.revealed,[f.leaf]);assert.equal(f.modal.closeCalls,1);assert.equal(f.modal.closed,true);
  assert.equal(f.modal.markdown,original);assert.equal(f.view.plan,plan);assert.equal(f.view.index,index);
  assert.equal(f.reads.length,0);assert.equal(f.writes.length,0);assert.equal(f.listeners.size,0);
  assert.match(f.view.statusEl.textContent,/刷新素材.*接受来源更新/);
});

test('failed return callback keeps the preview and its original snapshot open',async()=>{
  const f=await fixture();try {
    f.app.workspace.revealLeaf=async()=>{throw new Error('无法切换工作区');};
    const snapshot=f.modal.sourceSnapshot,markdown=f.modal.markdown;
    assert.equal(await f.modal.reloadSource(),false);
    assert.equal(f.modal.closed,false);assert.equal(f.modal.closeCalls,0);assert.equal(f.listeners.size,4);
    assert.equal(f.modal.sourceSnapshot,snapshot);assert.equal(f.modal.markdown,markdown);
    assert(f.notices.some(message=>message.includes('无法切换工作区')));assert.equal(f.writes.length,0);
  } finally {f.modal.onClose();}
});

test('explicit A4 apply still updates the bound draft without saving a plan or handout',async()=>{
  const f=await fixture();try {
    const markdown=f.modal.markdown,originalPlan=f.view.plan;
    f.modal.layout='two-column';f.modal.mode='student';
    f.modal.trialDetails.teacher='李老师';f.modal.trialEditedFields.add('teacher');
    await f.modal.applySettingsToPlan();
    assert.notEqual(f.view.plan,originalPlan);assert.equal(f.view.dirty,true);
    assert.equal(f.view.plan.course.teacher,'李老师');assert.equal(f.view.plan.output.layout,'two-column');
    assert.equal(f.view.plan.output.mode,'student');assert.equal(f.modal.markdown,markdown);
    await f.modal.applySettingsToPlan();
    assert.equal(f.writes.length,0);assert.equal(f.originalQuestion.content,question);
    await f.modal.assertSourceCurrent();
  } finally {f.modal.onClose();}
});

test('dual export captures the temporary adapter and shares original evidence with both real workers',async()=>{
  const f=await fixture();try {
    const modal=f.modal;modal.ready=true;
    modal.rendered=f.document.createElement('div');
    modal.showDualExportReport=()=>{};
    const workers=[];
    // Only Chromium/PDF bytes are stubbed. exportBothPdf constructs the real
    // job.input and createDualExportWorker constructs the actual PreviewModal.
    modal.generateDualEdition=async(job,edition)=>{
      assert.equal(job.input.assemblyPreview,modal.assemblyPreview);
      assert.equal(job.input.sourceSnapshot,modal.sourceSnapshot);
      const context=modal.createDualExportWorker(job.input),worker=context.worker;workers.push(worker);
      try {
        assert.equal(worker.documentMode,true);assert.equal(worker.generatedHandout,true);
        assert.equal(worker.sourceSnapshot,modal.sourceSnapshot);
        assert.equal(worker.assemblyPreview.assertCurrent,modal.assemblyPreview.assertCurrent);
        assert.equal(worker.assemblyPreview.sources[1].live,f.originalQuestion);
        assert.equal(worker.markdown,modal.markdown);assert.equal(worker.layout,'trial');
        worker.startSourceWatch();assert.equal(f.listeners.size,8);
        await worker.assertSourceCurrent(job.controller.signal);
        return {pdf:Buffer.from('%PDF-fixture-'+edition),pages:1};
      } finally {context.dispose();assert.equal(f.listeners.size,4);}
    };
    const report=await modal.exportBothPdf();
    assert.equal(report.outcome,'complete',report.error);assert.equal(workers.length,2);
    assert(workers.every(worker=>worker.closed));assert.equal(f.plugin.children.size,1);
    assert.equal(f.writes.filter(([kind])=>kind==='pdf').length,2);
    assert(!f.writes.some(([kind])=>kind==='markdown'));assert(!f.reads.includes(virtualPath));
    assert.equal(f.originalQuestion.content,question);assert.equal(f.originalKnowledge.content,knowledge);
  } finally {f.modal.onClose();}
  assert.equal(f.listeners.size,0);assert.equal(f.plugin.children.size,0);
});
