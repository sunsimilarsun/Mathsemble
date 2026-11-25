'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),test=require('node:test');
const source=fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE || path.resolve(__dirname,'../src/plugin.js'),'utf8');
// Real modal export orchestration and archive service; only painting, native
// PDF generation and Vault I/O are replaced. This is not native-host evidence.
async function scenario(name,config={}) {
  const nodes=new Map(),writes=[],notices=[];let modal,pdfWrites=0;
  const insert=(path,content,binary=false)=>{const node=content===null?{path,children:[]}:
    {path,basename:path.split('/').pop().replace(/\.[^.]*$/,''),extension:path.split('.').pop(),content:binary?Buffer.from(content):content};nodes.set(path,node);return node;};
  const sourceFile=insert('source.md',config.markdown||'正文 ?{42}。');
  const vault={getAbstractFileByPath:p=>nodes.get(p)||null,read:async f=>f.content,
    async createFolder(p){if(nodes.has(p))throw Error('exists');return insert(p,null);},
    async create(p,text){if(nodes.has(p))throw Error('exists');
      if(config.failRecord&&p.startsWith('Mathsemble/导出记录/'))throw Error('record unavailable');
      writes.push(p);const n=insert(p,text);if(config.failHtml&&p.endsWith('.html'))throw Error('write persisted then rejected');return n;},
    async createBinary(p,bytes){if(nodes.has(p))throw Error('exists');writes.push(p);const n=insert(p,bytes,true);
      if(p.startsWith('ExamExports/')) {pdfWrites++;if(config.rejectSecond&&pdfWrites===2)throw Error('second write persisted then rejected');
        if(config.cancelAfterFirst&&pdfWrites===1)modal.cancelExport('audit cancellation');}
      return n;}};
  const obsidian={Plugin:class{},Modal:class{constructor(app){this.app=app;}},Notice:class{constructor(text){notices.push(text);}},
    MarkdownView:class{},MarkdownRenderer:{},parseYaml:()=>({})};
  const context=vm.createContext({module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),
    console,Buffer,Uint8Array,ArrayBuffer,TextEncoder,URL,AbortController,setTimeout,clearTimeout});
  vm.runInContext(source+'\nglobalThis.qa={PreviewModal,core:mwbAssemblyCore,clone:x=>JSON.parse(JSON.stringify(x))};',context);
  const session={manifest:()=>context.qa.clone({schemaVersion:1,resources:[],omissions:session.omissions,warnings:config.warning?[{code:'SVG_EXTERNAL_REFERENCE'}]:[]}),
    omissions:[],read:async()=>{throw Error('unexpected resource read');},recordOmission(value){this.omissions.push(context.qa.clone(value));},
    readBlob(){throw Error('unexpected blob read');},dispose(){}};
  modal=new context.qa.PreviewModal({vault,metadataCache:{getFirstLinkpathDest:()=>null}},
    {manifest:{version:'audit'}},sourceFile,sourceFile.content,null,{documentMode:!!config.document,mediaSession:session});
  let expectedPlan;
  if(config.v4) {
    const core=context.qa.core,item=core.buildIndex(context.qa.clone([{kind:'question',path:sourceFile.path,metadata:{id:'Q-v4'},markdown:sourceFile.content}])).items[0];
    let plan=core.addItem(core.createPlan('带分值的方案'),item);plan=core.updateEntry(plan,plan.entries[0].entryId,context.qa.clone({score:7.25}));
    expectedPlan=JSON.parse(JSON.stringify(plan));
    modal.assemblyPreview={getEvidence:()=>context.qa.clone({planSnapshot:plan,compiledMarkdown:sourceFile.content,compiledPathContext:'Mathsemble/__preview__.md',
      sourceMap:[{entryId:plan.entries[0].entryId,path:sourceFile.path,kind:'question',score:7.25,startLine:1,endLine:1}],
      sources:[{path:sourceFile.path,markdown:sourceFile.content}],declaredDependencies:[]})};
  }
  modal.status={setText(value){this.value=value;}};modal.ready=true;modal.archiveRequested=config.archive!==false;
  modal.ensureMediaSession=()=>session;modal.setExportBusy=()=>{};
  modal.assertSourceCurrent=async()=>true;modal.showDualExportReport=()=>{};
  modal.exportDiagnosticItems=()=>[];modal.updateDiagnostics=()=>{};modal.selectDiagnosticsTab=()=>{};
  modal.preparePrintHtml=async()=>'<html>prepared</html>';
  modal.generateDualEdition=async(_job,edition)=>({pdf:Buffer.from('PDF-'+edition),pages:1});
  modal.buildPdfBuffer=async(_html,options)=>{const bytes=Buffer.from('PDF');if(options.onPdfReady)await options.onPdfReady(bytes);return bytes;};
  let report;
  if(config.html)await modal.saveHtml();else if(config.printOnly)await modal.exportPdf({save:false,printAfter:true});
  else report=await modal.exportBothPdf();
  const result=JSON.parse(JSON.stringify(modal.lastExportRecord));
  assert(result.record,'record service did not initialize: '+JSON.stringify(result));
  const record=result.record.state==='saved'?JSON.parse(nodes.get(result.record.path).content):null;
  const manifest=result.archive.manifestPath?JSON.parse(nodes.get(result.archive.manifestPath).content):null;
  assert.equal(modal.exportJob,null,'export mutex not released');
  if(config.v4) {
    assert.equal(record.origin,'assembly');assert.equal(record.inputs.planSnapshot.schemaVersion,4);
    assert.equal(manifest.inputs.planSnapshot.schemaVersion,4);assert.equal(manifest.inputs.planSnapshot.archivePath,'plan.v4.json');
    assert.deepEqual(JSON.parse(nodes.get(result.archive.path+'/plan.v4.json').content),expectedPlan);
    assert(!nodes.has(result.archive.path+'/plan.v3.json'));
  }
  if(config.rejectSecond) {
    assert.equal(report.outcome,'partial');assert.deepEqual(record.artifacts.map(x=>x.state),['saved','unverified']);
    assert.equal(manifest.artifacts[1].state,'unverified');assert.equal(pdfWrites,2);
  } else if(config.cancelAfterFirst) {
    assert.equal(report.outcome,'partial');assert.deepEqual(record.artifacts.map(x=>x.state),['saved','cancelled']);assert.equal(pdfWrites,1);
  } else if(config.failRecord) {
    assert.equal(report.outcome,'complete');assert.equal(result.record.state,'unverified');
    assert.equal(result.archive.state,'complete');assert.deepEqual(manifest.artifacts.map(x=>x.state),['saved','saved']);
  } else if(config.printOnly) {
    assert.equal(record.outcome,'generated');assert.equal(record.artifacts[0].state,'prepared');
    assert.equal(record.artifacts[0].edition,'document');assert.equal(record.artifacts[0].path,undefined);
  } else if(config.failHtml) {
    assert.equal(record.outcome,'failed');assert.equal(record.artifacts[0].state,'unverified');
  } else if(config.warning||config.markdown) {
    assert.equal(report.outcome,'complete');assert.equal(result.archive.state,'partial');
    assert(result.warnings.some(w=>config.warning?w.code==='RESOURCE_SCOPE_LIMITED':w.code==='RESOURCE_OMISSION'));
  } else {
    assert.equal(report.outcome,'complete');assert.deepEqual(record.artifacts.map(x=>x.state),['saved','saved']);
    assert.equal(result.archive.state,config.archive===false?'not-requested':'complete');
  }
}
for(const [name,options] of [
  ['dual success with undefined print report',{}],
  ['dual second write uncertain',{rejectSecond:true}],
  ['dual cancellation after first write',{cancelAfterFirst:true}],
  ['record failure preserves saved outputs',{failRecord:true}],
  ['print only document remains prepared',{printOnly:true,document:true}],
  ['HTML persisted rejection remains uncertain',{html:true,failHtml:true}],
  ['resource warning is partial',{warning:true}],
  ['hidden unsupported declaration is omitted',{markdown:'正文\n\n![[video.mp4]]'}],
  ['lightweight without archive',{archive:false}],
  ['v4 assembly plan retains score and actual archive version',{v4:true}],
]) test('export evidence integration: '+name,()=>scenario(name,options));
