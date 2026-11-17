'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url');
const host=require('../src/export-host.cjs');
const {createResourceSession}=require('../src/export-resources.cjs');

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mathsemble-media-host-'));
  t.after(()=>{assert.equal(path.dirname(dir),os.tmpdir());assert.match(path.basename(dir),/^mathsemble-media-host-/);fs.rmSync(dir,{recursive:true,force:true});});
  const file={path:'image.svg',extension:'svg'};
  fs.writeFileSync(path.join(dir,file.path),'<svg fill="#123456"/>');
  const vault={adapter:{basePath:dir},getAbstractFileByPath:p=>p===file.path?file:null,
    readBinary:async f=>new Uint8Array(fs.readFileSync(path.join(dir,f.path)))};
  return {dir,file,vault,url:pathToFileURL(path.join(dir,file.path)).href};
}
test('host maps actual Vault file/app URLs to original bytes and catches equal-size content changes',async t=>{
  const f=fixture(t);let remoteReads=0;
  const session=host.createMediaSession({vault:f.vault,reader:async()=>{remoteReads++;throw Error('unexpected network');},
    mimeFor:()=> 'image/svg+xml',createResourceSession});
  const appUrl='app://native-host'+new URL(f.url).pathname+'?123';
  const image=await session.read(appUrl);
  assert.match(image,/^data:image\/svg\+xml;base64,/);assert.equal(remoteReads,0);
  assert.equal(session.manifest().resources[0].localPath,'image.svg');
  fs.writeFileSync(path.join(f.dir,f.file.path),'<svg fill="#654321"/>');
  assert.equal(await session.read(appUrl),image);
  await assert.rejects(session.assertLocalCurrent(),{code:'RESOURCE_LOCAL_CHANGED'});
  session.dispose();
});
test('host bounds an unresponsive local Vault read',async t=>{
  const f=fixture(t);f.vault.readBinary=()=>new Promise(()=>{});
  const session=host.createMediaSession({vault:f.vault,reader:()=>{throw Error('unexpected');},
    mimeFor:()=> 'image/svg+xml',createResourceSession,timeoutMs:10});
  await assert.rejects(session.read(f.url),{code:'RESOURCE_TIMEOUT'});session.dispose();
});
test('ordinary source evidence uses captured Markdown and has no Vault or metadata-cache reads',()=>{
  const original={file:{path:'题库/Q.md'},markdown:'captured',metadata:{id:'Q1'}};
  const preview={sourceSnapshot:{entries:[{record:original}]}};
  const evidence=host.previewEvidence(preview,(markdown,sourcePath)=>({dependencies:[{target:markdown,sourcePath}]}));
  assert.deepEqual(evidence.sources,[{path:'题库/Q.md',markdown:'captured',sourceId:'Q1'}]);
  evidence.sources[0].markdown='changed';assert.equal(original.markdown,'captured');
  assert.equal(evidence.declaredDependencies[0].target,'captured');
});
test('unsupported and malformed embedded targets become omissions without trying to fetch them',async()=>{
  let reads=0,resolves=0;
  const session=createResourceSession({reader:()=>{reads++;throw Error('unexpected');}});
  await host.captureDeclaredMedia(session,[
    {sourcePath:'q.md',target:'a.png 1x,\nb.png 2x',status:'unsupported'},
    {sourcePath:'q.md',target:'http://[invalid',status:'unsupported'},
    {sourcePath:'q.md',target:'missing.png',status:'declared'}
  ],{metadataCache:{getFirstLinkpathDest(){resolves++;return null;}},vault:{}},undefined);
  assert.equal(reads,0);assert.equal(resolves,1);
  assert.equal(session.manifest().omissions.length,3);
  assert(session.manifest().omissions.every(x=>x.reasonCode==='DECLARED_MEDIA_UNAVAILABLE'));
  session.dispose();
});
test('declared hidden images resolve in each original source context',async()=>{
  const contexts=[],urls=[];
  const session={read:async url=>urls.push(url),recordOmission:()=>assert.fail('unexpected omission')};
  const app={metadataCache:{getFirstLinkpathDest:(target,source)=>{contexts.push([target,source]);return {path:source+'/'+target,extension:'png'};}},
    vault:{getResourcePath:file=>'app://host/'+file.path}};
  await host.captureDeclaredMedia(session,[{sourcePath:'A/q.md',target:'x.png'},{sourcePath:'B/q.md',target:'x.png'}],app);
  assert.deepEqual(contexts,[['x.png','A/q.md'],['x.png','B/q.md']]);assert.notEqual(urls[0],urls[1]);
});
function imageNode(url) {
  const attrs=new Map([['src',url],['srcset',url+' 2x'],['alt','diagram']]);
  return {get currentSrc(){return attrs.get('src');},hasAttribute:key=>attrs.has(key),getAttribute:key=>attrs.get(key),
    setAttribute:(key,value)=>attrs.set(key,value),removeAttribute:key=>attrs.delete(key)};
}
test('DOM freezing finishes before measurement, retains SVG fragments and does not read frozen nodes again',async()=>{
  const node=imageNode('https://example.org/a.svg#view'),nodes=new WeakMap();let reads=0;
  const root={ownerDocument:{baseURI:'file:///'},querySelectorAll:()=>[node]};
  const session={read:async()=>{reads++;return 'data:image/svg+xml;base64,PHN2Zy8+';}};
  assert.equal((await host.freezeMediaDom(session,root,{nodes})).changed,true);
  assert.match(node.getAttribute('src'),/#view$/);assert.equal(node.hasAttribute('srcset'),false);
  assert.equal((await host.freezeMediaDom(session,root,{nodes})).changed,false);assert.equal(reads,1);
});
test('uncaptured images require a warning and a resource omission; cancellation is never downgraded',async()=>{
  const node=imageNode('https://example.org/a.png'),root={ownerDocument:{baseURI:'file:///'},querySelectorAll:()=>[node]};
  const omissions=[];
  const session={read:async()=>{throw Error('unavailable');},recordOmission:value=>omissions.push(value)};
  assert.equal((await host.freezeMediaDom(session,root)).warnings.length,1);assert.equal(omissions.length,1);
  const controller=new AbortController();controller.abort(Object.assign(Error('cancelled'),{name:'AbortError'}));
  await assert.rejects(host.freezeMediaDom(session,root,{signal:controller.signal}),{name:'AbortError'});
  assert.equal(omissions.length,1);
});
