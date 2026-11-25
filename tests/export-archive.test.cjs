'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {createExportArchiveService}=require('../src/export-archive.cjs');
const core=require('../src/assembly-core.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const origin=()=>({origin:'document',sources:[{path:'课程/原文.md',markdown:'\uFEFF# 原文\r\n\r\n答案 ?{42}\r\n'}]});
const emptyResources={schemaVersion:1,resources:[],omissions:[],warnings:[]};
function fixture({fail,beforeWrite}={}) {
  const nodes=new Map(),writes=[];
  const insert=(path,content,binary=false)=>{
    const node=content===null ? {path,children:[]} : {path,content:binary ? Buffer.from(content) : content};
    nodes.set(path,node);return node;
  };
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,
    async createFolder(path){
      if(nodes.has(path))throw Error('exists');
      if(fail?.('folder',path))throw Error('folder failed');
      writes.push(['folder',path]);return insert(path,null);
    },
    async create(path,content){return write('text',path,content,false);},
    async createBinary(path,content){return write('binary',path,content,true);},
    read(){throw Error('archive must not reread source notes');},
    modify(){throw Error('archive must not overwrite');},
    delete(){throw Error('archive must not roll back saved files');}};
  async function write(kind,path,content,binary) {
    if(nodes.has(path))throw Error('exists');
    await beforeWrite?.(kind,path);
    if(nodes.has(path))throw Error('exists');
    const mode=fail?.(kind,path);
    if(mode==='before')throw Error('write rejected');
    writes.push([kind,path]);const node=insert(path,content,binary);
    if(mode==='after')throw Error('write rejected after persistence');
    return node;
  }
  let id=0;
  const options={vault,validatePlan:core.validatePlan,now:()=>new Date('2026-11-17T08:00:00Z'),newId:()=>`run-${++id}`};
  return {vault,nodes,writes,insert,options,service:createExportArchiveService(options),
    readJson:path=>JSON.parse(nodes.get(path).content)};
}
const setEmpty=run=>run.setResources({manifest:emptyResources});

test('lightweight evidence captures UTF-8 digests and statuses without copying source text or bytes',async()=>{
  const f=fixture(),input=origin(),original=input.sources[0].markdown;
  input.settings={theme:'minimal'};input.runtime={pluginVersion:'0.2.5'};
  const run=f.service.beginRun(input),bytes=Buffer.from('PDF');
  input.sources[0].markdown='changed';input.settings.theme='changed';
  const artifact=run.recordArtifact({artifactId:'teacher',kind:'pdf',edition:'teacher',state:'prepared',bytes});
  artifact.state='saved';bytes.fill(0);setEmpty(run);
  assert.equal(f.writes.length,0,'capture should not perform I/O');
  const result=await run.finalize({outcome:'cancelled'}),record=f.readJson(result.record.path);
  assert.equal(result.record.state,'saved');assert.equal(result.archive.state,'not-requested');
  assert.equal(record.artifacts[0].state,'prepared');assert.equal(record.outcome,'cancelled');
  assert.equal(record.artifacts[0].sha256,hash('PDF'));assert.equal(record.artifacts[0].bytes,3);
  assert.equal(record.inputs.sources[0].textUtf8Sha256,hash(original));
  assert.equal(record.inputs.sources[0].bytes,Buffer.byteLength(original));
  assert.equal(record.settings.theme,'minimal');assert.equal(record.runtime.pluginVersion,'0.2.5');
  assert(!JSON.stringify(record).includes('答案 ?{42}'));
  assert.equal(f.writes.filter(([kind])=>kind==='binary').length,0);
});

test('archive preserves raw Markdown, v3 plan, source map, runtime and copied artifact bytes',async()=>{
  const f=fixture(),input=origin(),raw=input.sources[0].markdown,plan=core.createPlan('原方案');
  Object.assign(input,{origin:'assembly',planSnapshot:plan,sourceMap:[{path:'课程/原文.md',from:1,to:4}],
    compiledMarkdown:'完整讲义\r\n',compiledPathContext:'Mathsemble/__preview__.md',
    options:{paper:'A4'},runtime:{plugin:'0.2.5',electron:'known'}});
  const run=f.service.beginRun(input,{archive:true}),bytes=Buffer.from([0,1,2,255]);
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saving',bytes});
  bytes.fill(9);input.sources[0].markdown='new';input.sourceMap[0].to=99;plan.title='new';
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saved',path:'输出/学生.pdf',pages:1});
  setEmpty(run);const result=await run.finalize({outcome:'complete'}),folder=result.archive.path;
  assert.equal(result.archive.state,'complete');
  const manifest=f.readJson(result.archive.manifestPath);
  assert.equal(manifest.scope,'captured-inputs-and-observed-resources');
  assert.equal(manifest.kind,'mathsemble-material-archive');
  assert.equal(f.nodes.get(folder+'/sources/0001.md').content,raw);
  assert.equal(f.nodes.get(folder+'/compiled.md').content,'完整讲义\r\n');
  assert.equal(f.readJson(folder+'/plan.v3.json').schemaVersion,3);
  assert.equal(f.readJson(folder+'/plan.v3.json').title,'原方案');
  assert.equal(manifest.inputs.planSnapshot.schemaVersion,3);assert.equal(manifest.inputs.planSnapshot.archivePath,'plan.v3.json');
  assert.equal(f.readJson(folder+'/source-map.json')[0].to,4);
  assert.deepEqual(f.nodes.get(folder+'/artifacts/0001.pdf').content,Buffer.from([0,1,2,255]));
  assert.equal(manifest.inputs.sources[0].archivePath,'sources/0001.md');
  assert.equal(manifest.artifacts[0].archivePath,'artifacts/0001.pdf');
  assert.equal(manifest.artifacts[0].state,'saved');
  assert.equal(f.readJson(folder+'/input.json').options.paper,'A4');
  assert.equal(f.writes.filter(([,path])=>path.startsWith(folder+'/')).at(-1)[1],folder+'/manifest.json');
  assert.deepEqual(plan.entries,[],'the source plan is never rewritten');
});

test('v4 archive preserves selected-part scores and source map under the actual versioned filename',async()=>{
  const f=fixture(),input=origin(),item=core.buildIndex([{kind:'question',path:'课程/原文.md',metadata:{id:'Q1'},markdown:input.sources[0].markdown}]).items[0];
  let plan=core.addItem(core.createPlan('片段方案'),item);
  plan=core.updateEntry(plan,plan.entries[0].entryId,{fragmentRef:{kind:'question-part',ids:['part-a','part-b'],scores:{'part-a':2.25,'part-b':5}}});
  const sourceMap=[{entryId:plan.entries[0].entryId,path:item.path,kind:'question',fragmentRef:plan.entries[0].fragmentRef,score:7.25,startLine:10,endLine:20}];
  Object.assign(input,{origin:'assembly',planSnapshot:plan,sourceMap,compiledMarkdown:'选定内容'});
  const snapshot=JSON.parse(JSON.stringify(plan)),run=f.service.beginRun(input,{archive:true});setEmpty(run);
  plan.entries[0].fragmentRef.scores['part-a']=999;sourceMap[0].fragmentRef.ids.reverse();
  const result=await run.finalize({outcome:'complete'}),folder=result.archive.path,manifest=f.readJson(result.archive.manifestPath);
  assert.equal(result.archive.state,'complete');assert(!f.nodes.has(folder+'/plan.v3.json'));
  assert.deepEqual(f.readJson(folder+'/plan.v4.json'),snapshot);assert.deepEqual(core.validatePlan(f.readJson(folder+'/plan.v4.json')),snapshot);
  assert.equal(manifest.inputs.planSnapshot.schemaVersion,4);assert.equal(manifest.inputs.planSnapshot.archivePath,'plan.v4.json');
  assert.equal(manifest.inputs.planSnapshot.sha256,hash(f.nodes.get(folder+'/plan.v4.json').content));
  assert.equal(f.readJson(folder+'/input.json').planSnapshot.schemaVersion,4);
  assert.equal(f.readJson(result.record.path).inputs.planSnapshot.schemaVersion,4);
  assert.deepEqual(f.readJson(folder+'/source-map.json')[0].fragmentRef,snapshot.entries[0].fragmentRef);
  const descriptor=manifest.files.find(file=>file.path==='plan.v4.json');assert.equal(descriptor.sha256,hash(f.nodes.get(folder+'/plan.v4.json').content));
});
test('lightweight v4 evidence reports actual schema without copying a plan or downgrading it',async()=>{
  const f=fixture(),item=core.buildIndex([{kind:'question',path:'题库/题.md',metadata:{},markdown:'题目'}]).items[0];
  let plan=core.addItem(core.createPlan(),item);plan=core.updateEntry(plan,plan.entries[0].entryId,{score:0});
  const run=f.service.beginRun({...origin(),origin:'assembly',planSnapshot:plan});setEmpty(run);
  const result=await run.finalize(),record=f.readJson(result.record.path);
  assert.equal(record.inputs.planSnapshot.schemaVersion,4);assert.equal(record.inputs.planSnapshot.archivePath,undefined);
  assert.equal(result.archive.state,'not-requested');assert(![...f.nodes.keys()].some(path=>/plan\.v[34]\.json$/.test(path)));
});
test('unknown normalized archive plan versions are rejected before any output is written',()=>{
  const f=fixture(),api=createExportArchiveService({...f.options,validatePlan:plan=>plan});
  for(const schemaVersion of [0,2,5,'4'])assert.throws(()=>api.beginRun({...origin(),planSnapshot:{schemaVersion}},{archive:true}),error=>error.code==='ARCHIVE_PLAN_INVALID');
  assert.equal(f.writes.length,0);
});

test('resource bytes come only from the frozen reader and repeated observations store one blob',async()=>{
  const f=fixture(),run=f.service.beginRun(origin(),{archive:true}),bytes=Buffer.from('image');
  const resource={blobId:hash(bytes),sha256:hash(bytes),bytes:bytes.length,mime:'image/png',representation:'original'};
  const manifest={...emptyResources,resources:[{...resource,localPath:'assets/a.png'},{...resource,localPath:'assets/b.png'}]};
  let reads=0;run.setResources({manifest,readBlob:id=>{reads++;assert.equal(id,hash(bytes));return bytes;}});
  manifest.resources[0].sha256='bad';
  const result=await run.finalize({outcome:'complete'}),saved=f.readJson(result.archive.manifestPath);
  assert.equal(result.archive.state,'complete');assert.equal(reads,1);
  assert.equal(f.writes.filter(([kind,path])=>kind==='binary'&&path.includes('/media/')).length,1);
  assert.equal(saved.resources.resources.length,2);
  assert(saved.resources.resources.every(resource=>resource.archivePath==='media/'+hash(bytes)+'.bin'));
  assert.deepEqual(f.nodes.get(result.archive.path+'/media/'+hash(bytes)+'.bin').content,bytes);
});

test('print-only document output remains prepared and does not imply a saved artifact',async()=>{
  const f=fixture(),run=f.service.beginRun(origin(),{archive:true});setEmpty(run);
  run.recordArtifact({artifactId:'print',kind:'pdf',edition:'document',state:'prepared',bytes:'pdf',
    printReport:{requested:true,success:true}});
  const result=await run.finalize({outcome:'printed'}),manifest=f.readJson(result.archive.manifestPath);
  assert.equal(result.archive.state,'complete');assert.equal(manifest.artifacts[0].state,'prepared');
  assert.equal(manifest.artifacts[0].path,undefined);assert.equal(manifest.artifacts[0].printReport.success,true);
});

test('warnings, omissions and unavailable artifact bytes make archive scope explicitly partial',async()=>{
  const f=fixture(),run=f.service.beginRun(origin(),{archive:true});
  run.setResources({manifest:{...emptyResources,warnings:[{code:'SVG_EXTERNAL_REFERENCE'},{code:'EXTERNAL_FILE_NOT_VERIFIED'}],
    omissions:[{omissionId:'missing',reasonCode:'RESOURCE_UNAVAILABLE'}]}});
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saved',path:'输出/学生.pdf'});
  const result=await run.finalize({outcome:'complete'}),manifest=f.readJson(result.archive.manifestPath);
  assert.equal(result.archive.state,'partial');assert.equal(manifest.state,'partial');
  assert(result.warnings.some(w=>w.code==='RESOURCE_SCOPE_LIMITED'));
  assert(result.warnings.some(w=>w.code==='RESOURCE_OMISSION'));
  assert(result.warnings.some(w=>w.code==='ARTIFACT_BYTES_UNAVAILABLE'));
  assert.equal(manifest.artifacts[0].state,'saved','archive limits must not deny a completed host save');
});

test('missing resource capture and mismatched or unavailable frozen blobs never claim complete',async()=>{
  const f=fixture(),run=f.service.beginRun(origin(),{archive:true});
  const a=Buffer.from('a'),b=Buffer.from('b');
  run.setResources({manifest:{...emptyResources,resources:[
    {blobId:'mismatch',sha256:hash(a),bytes:1},{blobId:'gone',sha256:hash(b),bytes:1}]},
    readBlob:id=>{if(id==='gone')throw Error('disposed');return b;}});
  const result=await run.finalize({outcome:'complete'});
  assert.equal(result.archive.state,'partial');
  assert.equal(result.warnings.filter(w=>w.code==='RESOURCE_BYTES_UNAVAILABLE').length,2);
  assert.equal(f.writes.filter(([,path])=>path.includes('/media/')).length,0);
  const next=f.service.beginRun(origin(),{archive:true});
  const absent=await next.finalize();assert.equal(absent.archive.state,'partial');
  assert(absent.warnings.some(w=>w.code==='RESOURCES_NOT_CAPTURED'));
});

test('a rejected archive write cannot leave a completion manifest and preserves saved output facts',async()=>{
  const f=fixture({fail:(kind,path)=>kind==='binary'&&path.includes('/artifacts/') ? 'after' : false});
  const run=f.service.beginRun(origin(),{archive:true});setEmpty(run);
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saved',path:'输出/学生.pdf',bytes:'pdf'});
  const result=await run.finalize({outcome:'complete'}),record=f.readJson(result.record.path);
  assert.equal(result.archive.state,'unverified');assert.equal(result.record.state,'saved');
  assert.equal(record.artifacts[0].state,'saved');
  assert(!f.nodes.has(result.archive.path+'/manifest.json'));
  assert(f.nodes.has(result.archive.path+'/artifacts/0001.pdf'),'an uncertain write is never deleted');
});

test('record write rejection is reported separately from a completed archive and host artifact',async()=>{
  const f=fixture({fail:(kind,path)=>kind==='text'&&path.startsWith('Mathsemble/导出记录/') ? 'after' : false});
  const run=f.service.beginRun(origin(),{archive:true});setEmpty(run);
  run.recordArtifact({artifactId:'s',kind:'html',edition:'student',state:'saved',path:'输出/a.html',bytes:'<p>x</p>'});
  const result=await run.finalize({outcome:'complete'});
  assert.equal(result.archive.state,'complete');assert.equal(result.record.state,'unverified');
  assert.equal(f.readJson(result.archive.manifestPath).artifacts[0].state,'saved');
  assert(f.nodes.has(result.record.path),'a rejected write can already have persisted');
  assert(result.warnings.some(w=>w.code==='RECORD_WRITE_FAILED'));
});

test('finalize is one promise and rejects later mutation while preserving interruption statuses',async()=>{
  const f=fixture(),run=f.service.beginRun(origin());setEmpty(run);
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saving',bytes:'s'});
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saved',path:'输出/s.pdf'});
  run.recordArtifact({artifactId:'t',kind:'pdf',edition:'teacher',state:'unverified',path:'输出/t.pdf',error:Error('write rejected')});
  const first=run.finalize({outcome:'saved-after-interruption'}),second=run.finalize({outcome:'complete'});
  assert.strictEqual(first,second);
  assert.throws(()=>setEmpty(run),{code:'ARCHIVE_FINALIZED'});
  assert.throws(()=>run.recordArtifact({}),{code:'ARCHIVE_FINALIZED'});
  const result=await first,record=f.readJson(result.record.path);
  assert.equal(record.outcome,'saved-after-interruption');
  assert.deepEqual(record.artifacts.map(a=>a.state),['saved','unverified']);
  assert.equal(record.artifacts[1].error.message,'write rejected');
  assert.equal(f.writes.filter(([,path])=>path===result.record.path).length,1);
});

test('saved states and bytes cannot be overwritten but an uncertain write can be verified',async()=>{
  const f=fixture(),run=f.service.beginRun(origin());
  const saved={artifactId:'s',kind:'pdf',edition:'student',state:'saved',path:'输出/s.pdf'};
  run.recordArtifact({...saved,bytes:'pdf'});
  assert.throws(()=>run.recordArtifact({...saved,state:'failed'}),{code:'ARCHIVE_STATE_INVALID'});
  assert.throws(()=>run.recordArtifact({...saved,path:'输出/other.pdf'}),{code:'ARCHIVE_STATE_INVALID'});
  assert.throws(()=>run.recordArtifact({...saved,bytes:'new'}),{code:'ARCHIVE_STATE_INVALID'});
  assert.throws(()=>run.recordArtifact({...saved,edition:'teacher'}),{code:'ARCHIVE_STATE_INVALID'});
  run.recordArtifact({artifactId:'t',kind:'pdf',edition:'teacher',state:'unverified',error:Error('uncertain')});
  const verified=run.recordArtifact({artifactId:'t',kind:'pdf',edition:'teacher',state:'saved',path:'输出/t.pdf'});
  assert.equal(verified.error,undefined);assert.equal(verified.history[0].error.message,'uncertain');
  assert.throws(()=>run.recordArtifact({...saved,sha256:'pretend'}),{code:'ARCHIVE_DATA_INVALID'});
});

test('existing records, run folders and files occupying parent folders are never overwritten',async()=>{
  const f=fixture();f.insert('Mathsemble',null);f.insert('Mathsemble/材料归档',null);
  f.insert('Mathsemble/材料归档/run-1',null);f.insert('Mathsemble/材料归档/run-1/old','keep');
  f.insert('Mathsemble/导出记录',null);f.insert('Mathsemble/导出记录/run-1.json','old record');
  const run=f.service.beginRun(origin(),{archive:true});setEmpty(run);
  const result=await run.finalize();
  assert.equal(result.archive.state,'failed');assert.equal(result.record.state,'failed');
  assert.equal(f.nodes.get('Mathsemble/材料归档/run-1/old').content,'keep');
  assert.equal(f.nodes.get('Mathsemble/导出记录/run-1.json').content,'old record');
  const blocked=fixture();blocked.insert('Mathsemble','a file');
  const other=await blocked.service.beginRun(origin(),{archive:true}).finalize();
  assert.equal(other.record.state,'failed');assert.equal(other.archive.state,'failed');
  assert.equal(blocked.writes.length,0);
});

test('simultaneous colliding services cannot share or replace an archive directory',async()=>{
  const f=fixture(),options={...f.options,newId:()=> 'same'};
  const first=createExportArchiveService(options).beginRun(origin(),{archive:true});
  const second=createExportArchiveService(options).beginRun(origin(),{archive:true});setEmpty(first);setEmpty(second);
  const results=await Promise.all([first.finalize(),second.finalize()]);
  assert.equal(results.filter(r=>r.archive.state==='complete').length,1);
  assert.equal(f.writes.filter(([,path])=>path==='Mathsemble/材料归档/same/manifest.json').length,1);
  assert.equal(f.writes.filter(([,path])=>path==='Mathsemble/导出记录/same.json').length,1);
});

test('invalid inputs, escaping roots and non-JSON state fail before any write',()=>{
  const f=fixture();
  for(const path of ['../outside','/absolute','C:/outside','Mathsemble//records','Mathsemble/../records'])
    assert.throws(()=>createExportArchiveService({...f.options,recordsRoot:path}),{code:'ARCHIVE_PATH_INVALID'});
  for(const runtime of [()=>{},new Date(),{callback(){}}])
    assert.throws(()=>f.service.beginRun({...origin(),runtime}),{code:'ARCHIVE_DATA_INVALID'});
  const cyclic={};cyclic.self=cyclic;
  assert.throws(()=>f.service.beginRun({...origin(),options:cyclic}),{code:'ARCHIVE_DATA_INVALID'});
  assert.throws(()=>f.service.beginRun({...origin(),planSnapshot:{...core.createPlan(),surprise:true}}));
  assert.throws(()=>createExportArchiveService({...f.options,newId:()=> '../escape'}).beginRun(origin()),{code:'ARCHIVE_ID_INVALID'});
  const repeated=createExportArchiveService({...f.options,newId:()=> 'repeat'});repeated.beginRun(origin());
  assert.throws(()=>repeated.beginRun(origin()),{code:'ARCHIVE_ID_INVALID'});
  const run=f.service.beginRun(origin());
  assert.throws(()=>run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'saved'}),{code:'ARCHIVE_DATA_INVALID'});
  assert.throws(()=>run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'prepared',bytes:123}),{code:'ARCHIVE_BYTES_INVALID'});
  assert.equal(f.writes.length,0);
});

test('separate blob identities with identical bytes share the persisted media object',async()=>{
  const f=fixture(),run=f.service.beginRun(origin(),{archive:true}),bytes=Buffer.from('shared');
  run.setResources({manifest:{...emptyResources,resources:['a','b'].map(blobId=>({blobId,sha256:hash(bytes),bytes:bytes.length}))},
    readBlob:()=>bytes});
  const result=await run.finalize();assert.equal(result.archive.state,'complete');
  assert.equal(f.writes.filter(([kind,path])=>kind==='binary'&&path.includes('/media/')).length,1);
  const manifest=f.readJson(result.archive.manifestPath);
  assert.equal(manifest.resources.resources[0].archivePath,manifest.resources.resources[1].archivePath);
});

test('operational errors do not persist URL credentials, signed queries or embedded data payloads',async()=>{
  const f=fixture(),run=f.service.beginRun(origin());setEmpty(run);
  const error=Error('read https://alice:private@example.test/a.png?token=SIGNED#key failed; token=SECRET data:image/png;base64,PRIVATE');
  run.recordArtifact({artifactId:'s',kind:'pdf',edition:'student',state:'failed',error});
  const result=await run.finalize({outcome:'failed',error}),serialized=f.nodes.get(result.record.path).content;
  for(const secret of ['alice','private','SIGNED','SECRET','PRIVATE','base64']) assert(!serialized.includes(secret),secret);
  assert(serialized.includes('https://example.test/a.png'));
  assert(serialized.includes('[inline resource]'));
});
