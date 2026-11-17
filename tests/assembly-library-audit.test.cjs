'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const core=require('../src/assembly-core.cjs');
const {collectMediaDependencies}=require('../src/assembly-markdown.cjs');
const {createLibraryService}=require('../src/assembly-library.cjs');
const question=id=>'---\n'+JSON.stringify({id,question_type:'fill_blank',subject:'数学',family_id:null})+'\n---\n正文 ?{42}';
function fixture(){
  const nodes=new Map(),listeners=new Set(),deleted=[],control={read:null};
  const emit=(type,...args)=>{for(const entry of [...listeners])if(entry.type===type)entry.fn(...args);};
  const folder=path=>{if(nodes.has(path))return nodes.get(path);const parent=path.includes('/')?folder(path.slice(0,path.lastIndexOf('/'))):null,node={path,name:path.split('/').pop(),children:[],parent};nodes.set(path,node);parent?.children.push(node);return node;};
  const file=(path,bytes)=>{const parent=folder(path.slice(0,path.lastIndexOf('/'))),old=nodes.get(path),name=path.split('/').pop();if(old)parent.children=parent.children.filter(n=>n!==old);const node={path,name,extension:name.split('.').pop(),bytes:Buffer.from(bytes),parent};nodes.set(path,node);parent.children.push(node);emit('create',node);return node;};
  const vault={getAbstractFileByPath:path=>nodes.get(path)||null,getFiles:()=>[...nodes.values()].filter(n=>!n.children),getMarkdownFiles:()=>[...nodes.values()].filter(n=>n.extension==='md'),
    on:(type,fn)=>{const ref={type,fn};listeners.add(ref);return ref;},offref:ref=>listeners.delete(ref),read:async node=>node.bytes.toString(),
    readBinary:async node=>{const bytes=Uint8Array.from(node.bytes).buffer;control.read?.(node);return bytes;},
    createFolder:async path=>{if(nodes.has(path))throw Error('exists');const node=folder(path);emit('create',node);return node;},
    createBinary:async(path,bytes)=>{if(nodes.has(path))throw Error('exists');return file(path,bytes);},
    modify:async(node,text)=>{node.bytes=Buffer.from(text);emit('modify',node);},
    delete:async node=>{deleted.push(node.path);nodes.delete(node.path);node.parent.children=node.parent.children.filter(n=>n!==node);emit('delete',node);}};
  const assemblyService={scan:async()=>core.buildIndex(vault.getMarkdownFiles().filter(n=>!n.path.startsWith('Mathsemble/')).map(node=>({path:node.path,kind:'question',markdown:node.bytes.toString(),metadata:JSON.parse(node.bytes.toString().split('\n')[1])}))),openSource:async()=>{}};
  const service=createLibraryService({vault,core,assemblyService,parseYaml:JSON.parse,collectMediaDependencies});return {nodes,file,vault,service,control,deleted,emit,listeners};
}
const stage=(f,id='A')=>f.service.stageImport({profile:'markdown',targetRoot:'导入题库',files:[{path:'A.md',text:question(id)}]});

test('library audit: import conflict uses the same trim-only ID identity as core',async t=>{
  for(const [existing,incoming]of [[' A ','A'],['A',' A ']])await t.test(JSON.stringify([existing,incoming]),async()=>{
    const f=fixture();f.file('题库/existing.md',question(existing));const batch=await stage(f,incoming),result=await f.service.commitBatch(batch.batchId,{confirmed:true});
    assert.equal(result.status,'conflict');assert(result.issues.some(issue=>issue.code==='id-conflict'));assert(!f.nodes.has(batch.files[0].targetPath));
  });
});
test('library audit: undo must preserve edits observed during the final source read',async()=>{
  const f=fixture(),batch=await stage(f);await f.service.commitBatch(batch.batchId,{confirmed:true});const target=batch.files[0].targetPath;let reads=0,edited=false;
  f.control.read=node=>{if(node.path===target&&++reads===3){edited=true;node.bytes=Buffer.from('用户刚保存的新正文');f.emit('modify',node);}};
  const result=await f.service.undoBatch(batch.batchId,{confirmed:true});assert(edited,'race fixture did not inject its edit');
  assert(f.nodes.has(target),'undo deleted a user edit observed before delete');assert.equal(f.nodes.get(target).bytes.toString(),'用户刚保存的新正文');assert(!f.deleted.includes(target));assert.equal(result.status,'partial');
});
test('library audit: undo must preserve a replacement file swapped during its last read',async()=>{
  const f=fixture(),batch=await stage(f);await f.service.commitBatch(batch.batchId,{confirmed:true});const target=batch.files[0].targetPath;let reads=0,replaced=false;
  f.control.read=node=>{if(node.path===target&&++reads===3){replaced=true;f.file(target,'用户新建的同名文件');}};
  const result=await f.service.undoBatch(batch.batchId,{confirmed:true});assert(replaced,'race fixture did not replace its target');
  assert(f.nodes.has(target),'undo deleted a replacement TFile');assert.equal(f.nodes.get(target).bytes.toString(),'用户新建的同名文件');assert(!f.deleted.includes(target));assert.equal(result.status,'partial');
});
