'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(process.env.MATHSEMBLE_TEST_SOURCE || path.resolve(__dirname,'../src/plugin.js'),'utf8');
const obsidian={Plugin:class{},Modal:class{},Notice:class{},MarkdownRenderer:{},MarkdownView:class{}};
const context={module:{exports:{}},require:name=>name==='obsidian'?obsidian:require(name),console,Buffer,AbortController};
vm.runInNewContext(source+'\nglobalThis.qa={PreviewModal,ensureExportFolder};',context);
const {PreviewModal,ensureExportFolder}=context.qa;

function competingVault(error=Object.assign(new Error('exists'),{code:'EEXIST'})) {
  let folder=null,arrivals=0,release;
  const barrier=new Promise(resolve=>{release=resolve;}),files=new Map();
  return {get arrivals(){return arrivals;},files,
    getAbstractFileByPath:path=>path==='ExamExports'?folder:files.get(path),
    async createFolder(path){
      assert.equal(path,'ExamExports');arrivals++;if(arrivals===2)release();await barrier;
      if(folder)throw error;
      return folder={path,children:[]};
    },
    async createBinary(path,bytes){assert.ok(folder);assert.ok(!files.has(path));files.set(path,{path,extension:'pdf',bytes});},
  };
}

test('concurrent first exports accept only the competing successful output-folder creation',async()=>{
  for(const error of [Object.assign(new Error('exists'),{code:'EEXIST'}),new Error('Folder already exists.')]) {
    const vault=competingVault(error);
    await Promise.all([ensureExportFolder({vault}),ensureExportFolder({vault})]);
    assert.equal(vault.arrivals,2);assert.ok(Array.isArray(vault.getAbstractFileByPath('ExamExports').children));
  }
});

test('output folder accepts an existing folder and rejects files, permission failures and unexplained mkdir errors',async()=>{
  let creates=0;
  await ensureExportFolder({vault:{getAbstractFileByPath:()=>({children:[]}),createFolder:async()=>{creates++;}}});
  assert.equal(creates,0);
  await assert.rejects(()=>ensureExportFolder({vault:{getAbstractFileByPath:()=>({extension:''}),createFolder:async()=>{creates++;}}}),/同名文件/);
  assert.equal(creates,0);
  for(const [error,appeared] of [
    [Object.assign(new Error('permission denied'),{code:'EACCES'}),null],
    [Object.assign(new Error('permission denied'),{code:'EPERM'}),{children:[]}],
    [new Error('unexplained I/O failure'),{children:[]}],
    [Object.assign(new Error('exists'),{code:'EEXIST'}),null],
  ]) {
    let node=null;
    await assert.rejects(()=>ensureExportFolder({vault:{getAbstractFileByPath:()=>node,createFolder:async()=>{node=appeared;throw error;}}}),caught=>caught===error);
  }
  let node=null;
  await assert.rejects(()=>ensureExportFolder({vault:{getAbstractFileByPath:()=>node,createFolder:async()=>{
    node={extension:'md'};throw Object.assign(new Error('exists'),{code:'EEXIST'});
  }}}),/同名文件/);
});

test('single and dual PDF export methods both complete when their first mkdir operations race',async()=>{
  const vault=competingVault(new Error('Folder already exists.')),failures=[];
  const create=(basename)=>({app:{vault},plugin:{manifest:{version:'0.2.4'}},file:{basename},markdown:'题干',
    sourceScope:{path:basename+'.md'},sourceSnapshot:{},sourceRevision:0,exam:null,renderWarnings:[],
    status:{setText(){}},beginExport(kind){return {kind,mode:'student',controller:new AbortController()};},
    assertCurrentExport(){},assertDualExport(){},assertSourceCurrent:async()=>{},isCurrentExport:()=>true,
    preparePrintHtml:async()=>'<p>题干</p>',resourceSummary:()=>'',finishExport(){},showDualExportReport(){},dualExportSettings:()=>({}),
    generateDualEdition:async()=>({pdf:Buffer.from('%PDF-fixture'),pages:1}),
    buildPdfBuffer:async(html,options)=>{const pdf=Buffer.from('%PDF-fixture');await options.onPdfReady?.(pdf);return pdf;},
    reportExportFailure(job,error){failures.push(error);},
  });
  const single=create('single'),dual=create('dual');
  const [,report]=await Promise.all([PreviewModal.prototype.exportPdf.call(single),PreviewModal.prototype.exportBothPdf.call(dual)]);
  assert.deepEqual(failures,[]);assert.equal(vault.arrivals,2);assert.equal(vault.files.size,3);
  assert.ok(single.lastSavedPdfPath);assert.equal(report.outcome,'complete');
  assert.equal(report.items.every(item=>item.state==='saved'),true);
});
