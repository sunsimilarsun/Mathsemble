'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const core=require('../src/assembly-core.cjs'),createAssembly=require('../src/assembly-service.cjs');
const {collectMediaDependencies}=require('../src/assembly-markdown.cjs');
const {createLibraryService,analyzeLibrary,validateTransferPackage}=require('../src/assembly-library.cjs');
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const clone=v=>JSON.parse(JSON.stringify(v));
const question=(id,body='求 $1+1=?{2}$。',extra={})=>'---\n'+JSON.stringify({id,subject:'数学',question_type:'fill_blank',family_id:null,...extra})+'\n---\n'+body;
function fixture(initial={}) {
  const nodes=new Map(),writes=[],deletes=[],listeners=new Set();
  const trigger=(type,...args)=>{for(const entry of [...listeners])if(entry.type===type)entry.fn(...args);};
  const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,name:path.split('/').pop(),children:[],parent};nodes.set(path,node);parent?.children.push(node);return node;};
  const file=(path,data)=>{const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,name=path.split('/').pop(),node={path,name,basename:name.replace(/\.[^.]+$/,''),extension:name.includes('.')?name.split('.').pop():'',bytes:Buffer.from(data),parent};nodes.set(path,node);parent?.children.push(node);trigger('create',node);return node;};
  for(const [path,data]of Object.entries(initial))file(path,data);folder('题库');
  let settings={assemblySettings:{questionRoots:['题库'],knowledgeRoots:[],recursive:true}};
  const vault={getAbstractFileByPath:p=>nodes.get(p)||null,getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),getFiles:()=>[...nodes.values()].filter(n=>!n.children),
    on:(type,fn)=>{const entry={type,fn};listeners.add(entry);return entry;},offref:entry=>listeners.delete(entry),
    read:async node=>node.bytes.toString('utf8'),readBinary:async node=>Uint8Array.from(node.bytes).buffer,
    createFolder:async path=>{if(nodes.has(path))throw Error('exists');writes.push(['folder',path]);const node=folder(path);trigger('create',node);return node;},
    create:async(path,data)=>{if(nodes.has(path))throw Error('exists');writes.push(['file',path]);return file(path,data);},
    createBinary:async(path,data)=>{if(nodes.has(path))throw Error('exists');writes.push(['file',path]);return file(path,Buffer.from(data));},
    modify:async(node,text)=>{node.bytes=Buffer.from(text);trigger('modify',node);},
    delete:async node=>{deletes.push(node.path);nodes.delete(node.path);if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);trigger('delete',node);}};
  const plugin={app:{vault},loadData:async()=>settings,saveData:async data=>{settings=data;}};
  const assemblyService=createAssembly(plugin,{core,parseYaml:JSON.parse}),deps={vault,core,assemblyService,parseYaml:JSON.parse,collectMediaDependencies};
  const service=createLibraryService(deps);return {nodes,file,folder,vault,service,assemblyService,deps,writes,deletes,listeners,trigger,text:path=>nodes.get(path)?.bytes.toString('utf8')};
}
const stage=(f,files=[{path:'A.md',text:question('A')}],other={})=>f.service.stageImport({profile:'markdown',files,targetRoot:'导入题库',...other});

test('diagnostics retain index issues, metadata gaps and duplicate-body candidates without editing notes',async()=>{
  const f=fixture({'题库/A.md':question('A','完全相同正文'),'题库/B.md':question('B','完全相同正文'),'题库/C.md':question('C','![missing](assets/missing.png)',{subject:''})});
  const result=await f.service.diagnose();assert(result.issues.some(i=>i.code==='missing-metadata'&&i.path==='题库/C.md'));
  assert.equal(result.issues.filter(i=>i.code==='possible-same-body').length,2);assert(result.issues.some(i=>i.code==='missing-resource'));assert.equal(f.writes.length,0);assert.equal(f.deletes.length,0);
  assert.equal(analyzeLibrary({items:[],issues:[{code:'known',path:'x',message:'original'}]}).issues[0].code,'known');
});

test('diagnostics discover missing or illegal question_type cards omitted by normal scan and respect exclusions',async()=>{
  const f=fixture({'题库/missing.md':'---\n'+JSON.stringify({subject:'数学'})+'\n---\n待核题干',
    '题库/invalid.md':question('BAD','题干',{question_type:'unsupported-type'}),'题库/README.md':'说明',
    '题库/assets/ignored.md':'资产说明','题库/【模板】ignored.md':'模板','题库/sub/deep.md':'深入待核'});
  assert.equal((await f.assemblyService.scan()).items.length,0);
  const report=await f.service.diagnose({config:{questionRoots:['题库'],knowledgeRoots:[],recursive:false}});
  assert.equal(report.counts.unindexed,2);assert(report.issues.some(row=>row.path==='题库/missing.md'&&row.code==='missing-metadata'&&row.field==='id'));
  assert(report.issues.some(row=>row.path==='题库/missing.md'&&row.code==='missing-metadata'&&row.field==='question_type'));
  assert(report.issues.some(row=>row.path==='题库/invalid.md'&&row.code==='unindexed-source-review'));
  assert(!report.issues.some(row=>/README|ignored|deep/.test(row.path)));assert.equal(f.writes.length,0);
});

test('staging retains exact originals and candidates but cannot commit without confirmation',async()=>{
  const f=fixture(),raw='\uFEFF'+question('A').replaceAll('\n','\r\n'),batch=await stage(f,[{path:'chapter/A.md',text:raw}]);
  assert.equal(batch.status,'staged');assert.equal(f.text(batch.originals[0].stagePath),raw);assert.equal(f.text(batch.files[0].stagePath),raw);assert(!f.nodes.has('导入题库/chapter/A.md'));
  await assert.rejects(f.service.commitBatch(batch.batchId),/确认/);assert(!f.nodes.has(batch.files[0].targetPath));
  const again=await stage(f,[{path:'chapter/A.md',text:raw}]);assert.equal(again.batchId,batch.batchId);assert.equal((await f.service.listBatches()).length,1);
});

test('confirmed create-only commit and restart retries are idempotent and preserve all existing bytes',async()=>{
  const f=fixture({'existing.txt':'old'}),batch=await stage(f),before=f.text('existing.txt');
  const first=await f.service.commitBatch(batch.batchId,{confirmed:true});assert.equal(first.status,'complete');assert.equal(first.created.length,1);assert.equal(f.text('existing.txt'),before);
  const restarted=createLibraryService(f.deps),again=await restarted.commitBatch(batch.batchId,{confirmed:true});assert.equal(again.status,'complete');assert.deepEqual(again.created,[]);assert.equal(f.text(batch.files[0].targetPath),question('A'));assert.equal(f.listeners.size,0);
});

test('same name and same ID conflicts are reported, never overwritten or silently renumbered',async()=>{
  const f=fixture({'题库/old.md':question('A')}),batch=await stage(f);
  let result=await f.service.commitBatch(batch.batchId,{confirmed:true});assert.equal(result.status,'conflict');assert(result.issues.some(i=>i.code==='id-conflict'));assert(!f.nodes.has(batch.files[0].targetPath));
  const g=fixture({'导入题库/A.md':'unrelated'}),same=await stage(g);result=await g.service.commitBatch(same.batchId,{confirmed:true});assert.equal(result.status,'conflict');assert.equal(g.text('导入题库/A.md'),'unrelated');
  const mapped=await stage(f,undefined,{idMap:{A:'A-confirmed'}});result=await f.service.commitBatch(mapped.batchId,{confirmed:true});assert.equal(result.status,'complete');assert.match(f.text(mapped.files[0].targetPath),/A-confirmed/);assert.equal(f.text(mapped.originals[0].stagePath),question('A'));
});

test('unknown JSON profile/schema retains original evidence and blocks submission',async()=>{
  const f=fixture(),text=JSON.stringify({schemaVersion:99,items:[]}),batch=await f.service.stageImport({profile:'mathsemble-question-json-v1',targetRoot:'导入题库',files:[{path:'future.json',text}]});
  assert.equal(batch.status,'blocked');assert.equal(f.text(batch.originals[0].stagePath),text);await assert.rejects(f.service.commitBatch(batch.batchId,{confirmed:true}),/阻断/);
  const other=await f.service.stageImport({profile:'qti-unrecognized',targetRoot:'导入题库',files:[{path:'raw.json',text:'{"x":1}'}]});assert.equal(other.status,'blocked');assert.equal(other.files.length,0);
});

test('explicit JSON profile preserves metadata and reports unknown unmapped fields',async()=>{
  const f=fixture(),input={schemaVersion:1,custom:{untouched:true},items:[{path:'A.md',metadata:{id:'A',question_type:'fill_blank',subject:'数学',family_id:null,privateMetadata:'retained'},markdown:'题干 ?{1}',externalScore:7}]};
  const batch=await f.service.stageImport({profile:'mathsemble-question-json-v1',targetRoot:'导入题库',files:[{path:'input.json',text:JSON.stringify(input)}]});
  assert.equal(batch.status,'staged');assert.equal(batch.lossReport.filter(row=>row.code==='unknown-field-preserved').length,2);assert.match(f.text(batch.files[0].stagePath),/privateMetadata/);assert.equal(JSON.parse(f.text(batch.originals[0].stagePath)).items[0].externalScore,7);
});

test('interrupted acknowledged creation can resume while a write-then-error remains unverified and never auto-deleted',async()=>{
  const f=fixture(),batch=await stage(f,[{path:'A.md',text:question('A')},{path:'B.md',text:question('B')}]),create=f.vault.createBinary;let fail=true;
  f.vault.createBinary=async(path,bytes)=>{if(fail&&path==='导入题库/B.md')throw Error('simulated before write');return create(path,bytes);};
  const first=await f.service.commitBatch(batch.batchId,{confirmed:true});assert.equal(first.status,'partial');assert.deepEqual(first.created,['导入题库/A.md']);assert(!f.nodes.has('导入题库/B.md'));
  fail=false;assert.equal((await createLibraryService(f.deps).commitBatch(batch.batchId,{confirmed:true})).status,'complete');
  const g=fixture(),uncertain=await stage(g),write=g.vault.createBinary;g.vault.createBinary=async(path,bytes)=>{const value=await write(path,bytes);if(path==='导入题库/A.md')throw Error('after persistence');return value;};
  assert.equal((await g.service.commitBatch(uncertain.batchId,{confirmed:true})).status,'partial');assert(g.nodes.has('导入题库/A.md'));
  assert.equal((await g.service.commitBatch(uncertain.batchId,{confirmed:true})).status,'conflict');await g.service.undoBatch(uncertain.batchId,{confirmed:true});assert(g.nodes.has('导入题库/A.md'));assert(!g.deletes.length);
});

test('undo deletes only acknowledged unchanged files, keeps edits and retains original receipts',async()=>{
  const f=fixture(),batch=await stage(f,[{path:'A.md',text:question('A')},{path:'B.md',text:question('B')}]);await f.service.commitBatch(batch.batchId,{confirmed:true});
  await f.vault.modify(f.nodes.get('导入题库/B.md'),question('B','后续编辑'));const result=await f.service.undoBatch(batch.batchId,{confirmed:true});
  assert.equal(result.status,'partial');assert.deepEqual(result.removed,['导入题库/A.md']);assert(f.text('导入题库/B.md').includes('后续编辑'));assert(f.nodes.has(batch.originals[0].stagePath));
  const again=await createLibraryService(f.deps).undoBatch(batch.batchId,{confirmed:true});assert.equal(again.status,'partial');assert.deepEqual(again.removed,[]);assert.equal(f.deletes.length,1);
});

test('same-time event ordering cannot restore ownership after a successful undo',async()=>{
  const f=fixture(),service=createLibraryService({...f.deps,now:()=>new Date('2026-01-01T00:00:00Z')}),batch=await service.stageImport({profile:'markdown',files:[{path:'A.md',text:question('A')}],targetRoot:'导入题库'});
  await service.commitBatch(batch.batchId,{confirmed:true});await service.undoBatch(batch.batchId,{confirmed:true});f.file('导入题库/A.md',question('A'));
  await createLibraryService(f.deps).undoBatch(batch.batchId,{confirmed:true});assert(f.nodes.has('导入题库/A.md'));assert.equal(f.deletes.length,1);
});

test('tampered stage bytes, batch manifest and traversal paths are rejected',async()=>{
  const f=fixture();for(const path of ['../escape.md','/abs.md','C:/drive.md','a/../escape.md','a\\escape.md','a/CON.md'])await assert.rejects(stage(f,[{path,text:question('A')}]),/路径/);
  const batch=await stage(f);f.nodes.get(batch.files[0].stagePath).bytes=Buffer.from('tampered');await assert.rejects(f.service.commitBatch(batch.batchId,{confirmed:true}),/暂存/);assert(!f.nodes.has(batch.files[0].targetPath));
  const manifest=f.nodes.get('Mathsemble/待入库/'+batch.batchId+'/manifest.json');const edited=JSON.parse(manifest.bytes);edited.files[0].targetPath='escape.md';manifest.bytes=Buffer.from(JSON.stringify(edited));await assert.rejects(f.service.loadBatch(batch.batchId),/摘要/);
});

test('source edits during commit invalidate the batch before any new target is published',async()=>{
  const f=fixture({'题库/old.md':question('OLD')}),batch=await stage(f),read=f.vault.readBinary;let changed=false;
  f.vault.readBinary=async file=>{const result=await read(file);if(!changed&&file.path==='题库/old.md'){changed=true;await f.vault.modify(file,question('A'));}return result;};
  await assert.rejects(f.service.commitBatch(batch.batchId,{confirmed:true}),/题库发生变化/);assert(!f.nodes.has('导入题库/A.md'));assert.equal(f.listeners.size,0);
});

test('Mathsemble source cards, binary images and a plan round-trip to an empty Vault with explicit mappings',async()=>{
  const image=Buffer.from([137,80,78,71,0,255,1]),source=question('A','![图](../assets/a.png)\n\n`![literal](../assets/a.png)`\n\n![[assets/a.png]]');
  const f=fixture({'题库/A.md':source,'assets/a.png':image});const index=await f.assemblyService.scan();let plan=core.addSection(core.createPlan('迁移课'),'分区');plan=core.addItem(plan,index.items[0]);plan=core.updateEntry(plan,plan.entries[1].entryId,{title:'卷内标题',role:'例题'});
  const exported=await f.service.exportTransfer({plan});assert.equal(exported.status,'complete');const valid=validateTransferPackage(exported.package);assert.equal(valid.files.length,3);
  const g=fixture(),batch=await g.service.stageTransfer(valid,{targetRoot:'接收题库'});assert.equal(batch.status,'staged');assert(!g.nodes.has('接收题库/题库/A.md'));assert.equal((await g.service.commitBatch(batch.batchId,{confirmed:true})).status,'complete');
  assert.deepEqual(g.nodes.get('接收题库/assets/a.png').bytes,image);assert.match(g.text('接收题库/题库/A.md'),/!\[\[接收题库\/assets\/a.png\]\]/);assert.match(g.text('接收题库/题库/A.md'),/`!\[literal\]\(\.\.\/assets\/a.png\)`/);
  const migrated=JSON.parse(g.text(batch.files.find(row=>row.kind==='plan').targetPath)),fresh=await g.assemblyService.scan({questionRoots:['接收题库/题库'],knowledgeRoots:[],recursive:true});assert.equal(core.resolvePlan(migrated,fresh).issues.length,0);
  assert.equal(migrated.entries[1].entryId,plan.entries[1].entryId);assert.equal(migrated.entries[1].title,'卷内标题');assert.equal(migrated.entries[1].role,'例题');assert.equal(g.text(batch.originals[0].stagePath),JSON.stringify(valid));
  assert.equal(batch.files.find(row=>row.kind==='source').originalSha256,hash(source));assert.notEqual(batch.files.find(row=>row.kind==='source').sha256,hash(source));
});

test('remote dependencies and SVG external links are partial and never silently complete',async()=>{
  const f=fixture({'题库/A.md':question('A','![remote](https://example.invalid/private.png)\n![svg](../assets/a.svg)'),'assets/a.svg':'<svg><image href="https://example.invalid/a.png"/></svg>'});
  const result=await f.service.exportTransfer({sourcePaths:['题库/A.md']});assert.equal(result.status,'partial');assert(result.issues.some(i=>i.code==='unpacked-dependency'));assert(result.issues.some(i=>i.code==='svg-external-dependency'));assert.equal(result.package.files.length,2);
});

test('existing sidecars and archives preserve exact bytes and disclose opaque historical reference semantics',async()=>{
  const sidecar=Buffer.from('{"schemaVersion":1,"path":"original/note.md","unknown":42}\r\n'),archive=Buffer.from([0,255,1]);
  const f=fixture({'题库/A.md':question('A'),'Mathsemble/组卷记录/old.json':sidecar,'Mathsemble/材料归档/old/media.bin':archive});
  const result=await f.service.exportTransfer({sourcePaths:['题库/A.md'],sidecarPaths:['Mathsemble/组卷记录/old.json'],archivePaths:['Mathsemble/材料归档/old']});
  const g=fixture(),batch=await g.service.stageTransfer(result.package);assert.equal((await g.service.commitBatch(batch.batchId,{confirmed:true})).status,'complete');
  for(const row of batch.files.filter(row=>['sidecar','archive'].includes(row.kind)))assert.deepEqual(g.nodes.get(row.targetPath).bytes,Buffer.from(row.base64,'base64'));
  assert.equal(batch.lossReport.filter(row=>row.code==='opaque-history-preserved').length,2);assert(!g.nodes.has('Mathsemble/组卷记录/old.json'));
});

test('transfer integrity, unknown versions, dangerous paths and malformed Base64 block import but retain the package original',async()=>{
  const f=fixture({'题库/A.md':question('A')}),{package:original}=await f.service.exportTransfer({sourcePaths:['题库/A.md']});
  for(const mutate of [p=>{p.files[0].base64='@@';},p=>{p.schemaVersion=99;},p=>{p.files[0].path='../escape.md';},p=>{p.files[0].sha256='0'.repeat(64);}]){
    const value=clone(original);mutate(value);const g=fixture(),batch=await g.service.stageTransfer(value);assert.equal(batch.status,'blocked');assert.equal(batch.originals.length,1);await assert.rejects(g.service.commitBatch(batch.batchId,{confirmed:true}),/阻断/);assert.equal(g.nodes.get(batch.originals[0].stagePath).bytes.toString(),JSON.stringify(value));
  }
});

test('cancellation before staging or commit does not publish source files',async()=>{
  const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(f.service.stageImport({profile:'markdown',files:[{path:'A.md',text:question('A')}],targetRoot:'导入题库'},{signal:controller.signal}),{name:'AbortError'});
  const batch=await stage(f);await assert.rejects(f.service.commitBatch(batch.batchId,{confirmed:true,signal:controller.signal}),{name:'AbortError'});assert(!f.nodes.has('导入题库/A.md'));assert.equal(f.listeners.size,0);
});
