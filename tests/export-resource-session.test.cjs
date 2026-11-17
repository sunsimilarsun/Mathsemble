'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {createResourceSession, safeResourceUrl} = require('../src/export-resources.cjs');
const data = (text, mime = 'image/png') => 'data:' + mime + ';base64,' + Buffer.from(text).toString('base64');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
const deferred = () => {let resolve, reject;const promise = new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const tick = async () => {await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const code = expected => error => {assert.equal(error.code,expected);return true;};

test('empty browser session does not load Node APIs or need a clock/AbortController', () => {
  const context = {module:{exports:{}},require:()=>{throw Error('No Node runtime');},URL};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/export-resources.cjs'),'utf8'),context);
  const session = context.module.exports.createResourceSession();
  assert.equal(session.manifest().resources.length,0);
  assert.equal(session.manifest().bytesUsed,0);
  assert.equal(session.snapshot().blobs.length,0);
  session.dispose();session.dispose();
  assert.throws(()=>session.manifest(),code('RESOURCE_SESSION_DISPOSED'));
});

test('same URL is frozen for a session, concurrent callers merge and kinds accumulate', async () => {
  const gate=deferred();let calls=0;
  const session=createResourceSession({reader:async()=>{calls++;return gate.promise;}});
  const first=session.read('https://example.test/a'),second=session.read('https://example.test/a','file:///',{kind:'font'});
  await tick();assert.equal(calls,1);gate.resolve(data('first'));
  assert.equal(await first,data('first'));assert.equal(await second,data('first'));
  assert.equal(await session.read('https://example.test/a'),data('first'));
  assert.equal(calls,1);assert.deepEqual(session.manifest().resources[0].kinds,['font','image']);
  assert.equal(session.manifest().resources[0].representation,'captured-response');
});

test('URL resolution separates relative paths in different bases and sessions have no global cache', async () => {
  const seen=[];let edition='one';
  const reader=async url=>{seen.push(url);return data(edition+url);};
  const session=createResourceSession({reader});
  const one=await session.read('picture.png','https://example.test/chapter-one/');
  const two=await session.read('picture.png','https://example.test/chapter-two/');
  assert.notEqual(one,two);assert.equal(session.manifest().resources.length,2);
  edition='two';assert.equal(await session.read('picture.png','https://example.test/chapter-one/'),one);
  const next=createResourceSession({reader});assert.notEqual(await next.read('picture.png','https://example.test/chapter-one/'),one);
  assert.equal(seen.length,3);
});

test('read failures are not cached; a successful retry clears only read-stage omissions', async () => {
  let calls=0;
  const session=createResourceSession({reader:async()=>{if(++calls===1)throw Error('temporary failure');return data('ok');}});
  await assert.rejects(session.read('https://example.test/a'),/temporary failure/);
  assert.equal(session.manifest().resources.length,0);
  session.recordOmission({url:'https://example.test/a',stage:'read',reasonCode:'READ_FAILED'});
  session.recordOmission({url:'https://example.test/a',stage:'render',reasonCode:'DECODE_FAILED'});
  await session.read('https://example.test/a');assert.equal(calls,2);
  assert.deepEqual(session.manifest().omissions.map(value=>value.stage),['render']);
});

test('one caller cancels without aborting another caller or the shared reader', async () => {
  const gate=deferred(),caller=new AbortController();let sharedSignal,calls=0;
  const session=createResourceSession({reader:async(_url,_base,{signal})=>{calls++;sharedSignal=signal;return gate.promise;}});
  const first=session.read('https://example.test/a','file:///',{signal:caller.signal});
  const firstRejected=assert.rejects(first,error=>error.name==='AbortError'&&error.code==='RESOURCE_ABORTED');
  const second=session.read('https://example.test/a');await tick();caller.abort();await firstRejected;
  assert.equal(sharedSignal.aborted,false);assert.equal(calls,1);gate.resolve(data('shared'));
  assert.equal(await second,data('shared'));assert.equal(session.manifest().resources.length,1);
});

test('already aborted calls including cache hits and record reject without changing retained resources', async () => {
  let calls=0;const session=createResourceSession({reader:async()=>{calls++;return data('ok');}});
  await session.read('https://example.test/a');const before=session.manifest();
  const controller=new AbortController();controller.abort();
  await assert.rejects(session.read('https://example.test/a','file:///',{signal:controller.signal,kind:'font'}),code('RESOURCE_ABORTED'));
  await assert.rejects(session.read('https://example.test/b','file:///',{signal:controller.signal}),code('RESOURCE_ABORTED'));
  await assert.rejects(session.record(data('different'),'https://example.test/a',{signal:controller.signal}),code('RESOURCE_ABORTED'));
  assert.equal(calls,1);assert.deepEqual(session.manifest(),before);
});

test('dispose aborts the underlying reader, settles waiters, and rejects late completion and subsequent APIs', async () => {
  const gate=deferred();let signal;
  const session=createResourceSession({reader:async(_url,_base,options)=>{signal=options.signal;return gate.promise;}});
  const pending=session.read('https://example.test/a');const rejected=assert.rejects(pending,code('RESOURCE_SESSION_DISPOSED'));
  await tick();session.dispose();assert.equal(signal.aborted,true);await rejected;
  gate.resolve(data('too late'));await tick();session.dispose();
  for(const operation of [()=>session.manifest(),()=>session.snapshot(),()=>session.readBlob('missing'),()=>session.recordOmission({url:'https://example.test/a'})])
    assert.throws(operation,code('RESOURCE_SESSION_DISPOSED'));
  await assert.rejects(session.read('https://example.test/a'),code('RESOURCE_SESSION_DISPOSED'));
  await assert.rejects(session.record(data('x'),'https://example.test/a'),code('RESOURCE_SESSION_DISPOSED'));
  await assert.rejects(session.assertLocalCurrent(),code('RESOURCE_SESSION_DISPOSED'));
});

test('budget counts unique decoded blobs, preserves old entries, and applies atomically to concurrent commits', async () => {
  const a=deferred(),b=deferred();let calls=0;
  const session=createResourceSession({maxBytes:5,reader:async url=>{calls++;return url.endsWith('/a')?a.promise:b.promise;}});
  const first=session.read('https://example.test/a'),second=session.read('https://example.test/b');
  const secondRejected=assert.rejects(second,code('RESOURCE_BUDGET_EXCEEDED'));
  a.resolve(data('AAAA'));await first;b.resolve(data('BBBB'));await secondRejected;
  assert.equal(session.manifest().bytesUsed,4);assert.equal(session.manifest().resources.length,1);
  assert.equal(await session.read('https://example.test/a'),data('AAAA'));assert.equal(calls,2);
  await session.record(data('AAAA','font/woff2'),'https://example.test/same-bytes',{kind:'font'});
  assert.equal(session.manifest().bytesUsed,4);assert.equal(session.snapshot().blobs.length,1);
  assert.equal(session.manifest().resources.length,2);
  await assert.rejects(session.record(data('XX'),'https://example.test/new'),code('RESOURCE_BUDGET_EXCEEDED'));
  assert.equal(session.manifest().resources.length,2);
});

test('an over-budget failure leaves no resource cached and can later capture a smaller response', async () => {
  let value='too big',calls=0;
  const session=createResourceSession({maxBytes:2,reader:async()=>{calls++;return data(value);}});
  await assert.rejects(session.read('https://example.test/a'),code('RESOURCE_BUDGET_EXCEEDED'));
  value='ok';await session.read('https://example.test/a');assert.equal(calls,2);assert.equal(session.manifest().bytesUsed,2);
});

test('Vault-local capture uses immutable original bytes, never remote reader, and local aliases share the first capture', async () => {
  let current=Buffer.from('AAAA'),reads=0,remote=0;
  const session=createResourceSession({resolveLocal:()=> 'assets/picture.png',readLocal:async()=>{reads++;return current;},
    mimeForLocal:()=> 'image/png',reader:async()=>{remote++;return data('remote');}});
  const captured=await session.read('app://vault/a');current.fill(66);
  assert.equal(captured,data('AAAA'));assert.equal(await session.read('app://vault/a'),captured);
  assert.equal(await session.read('app://vault/alias'),captured);
  assert.equal(reads,1);assert.equal(remote,0);
  const resources=session.manifest().resources;
  assert.equal(resources.length,2);assert.equal(resources[0].localPath,'assets/picture.png');
  assert.equal(resources[0].representation,'original');assert.equal(resources[0].displayUrl,undefined);
  assert.equal(resources[0].sha256,hash('AAAA'));
});

test('concurrent aliases of one local path coalesce the actual byte read', async () => {
  const gate=deferred();let reads=0;
  const session=createResourceSession({resolveLocal:()=> 'assets/a.svg',readLocal:async()=>{reads++;return gate.promise;},mimeForLocal:()=> 'image/svg+xml'});
  const a=session.read('app://vault/a'),b=session.read('app://vault/b');await tick();assert.equal(reads,1);
  gate.resolve(Buffer.from('<svg/>'));assert.equal(await a,await b);assert.equal(session.snapshot().blobs.length,1);
});

test('local verification hashes each unique source path once and detects same-length edits and missing files', async () => {
  let current=Buffer.from('AAAA'),reads=0,missing=false;
  const session=createResourceSession({resolveLocal:()=> 'assets/a.png',readLocal:async()=>{reads++;if(missing)throw Error('ENOENT');return current;},mimeForLocal:()=> 'image/png'});
  await session.read('app://vault/a');await session.read('app://vault/b');assert.equal(reads,1);
  assert.equal(await session.assertLocalCurrent(),true);assert.equal(reads,2);
  current=Buffer.from('BBBB');await assert.rejects(session.assertLocalCurrent(),code('RESOURCE_LOCAL_CHANGED'));assert.equal(reads,3);
  missing=true;await assert.rejects(session.assertLocalCurrent(),/ENOENT/);
  assert.equal(await session.read('app://vault/a'),data('AAAA'));
});

test('local verification honors cancellation and never treats a cancelled read as unchanged', async () => {
  const gate=deferred();let checking=false,calls=0;
  const session=createResourceSession({resolveLocal:()=> 'a.png',readLocal:async()=>{calls++;return checking?gate.promise:Buffer.from('a');},mimeForLocal:()=> 'image/png'});
  await session.read('app://vault/a');checking=true;
  const controller=new AbortController(),pending=session.assertLocalCurrent(controller.signal);
  const rejected=assert.rejects(pending,code('RESOURCE_ABORTED'));await tick();controller.abort();await rejected;
  gate.resolve(Buffer.from('a'));await tick();assert.equal(calls,2);
  const aborted=new AbortController();aborted.abort();await assert.rejects(session.assertLocalCurrent(aborted.signal),code('RESOURCE_ABORTED'));assert.equal(calls,2);
});

test('local verification cannot report a newly captured source as checked when it appeared mid-flight', async () => {
  const gate=deferred();let verifying=false;
  const session=createResourceSession({resolveLocal:url=>new URL(url).pathname.slice(1),
    readLocal:async localPath=>localPath==='a.png'&&verifying?gate.promise:Buffer.from(localPath),mimeForLocal:()=> 'image/png'});
  await session.read('app://vault/a.png');verifying=true;
  const pending=session.assertLocalCurrent(),rejected=assert.rejects(pending,code('RESOURCE_SET_CHANGED'));
  await tick();await session.read('app://vault/b.png');gate.resolve(Buffer.from('a.png'));await rejected;
  verifying=false;assert.equal(await session.assertLocalCurrent(),true);
});

test('record/capture freezes pre-existing data without fetching, detects conflicts and validates local attribution', async () => {
  let network=0,local=0;
  const session=createResourceSession({reader:async()=>{network++;return data('fetch');},resolveLocal:url=>url.startsWith('app:')?'asset.png':null,
    readLocal:async()=>{local++;return Buffer.from('local');},mimeForLocal:()=> 'image/png'});
  assert.equal(session.capture,session.record);
  await session.capture(data('inline'),'https://example.test/a');assert.equal(network,0);
  await session.record(data('inline'),'https://example.test/a',{kind:'font'});
  await assert.rejects(session.record(data('changed'),'https://example.test/a'),code('RESOURCE_CAPTURE_CONFLICT'));
  await assert.rejects(session.record(data('inline','image/jpeg'),'https://example.test/a'),code('RESOURCE_CAPTURE_CONFLICT'));
  assert.equal(await session.read('https://example.test/a'),data('inline'));
  await assert.rejects(session.record(data('wrong'),'app://vault/asset'),code('RESOURCE_CAPTURE_CONFLICT'));
  assert.equal(local,1);assert.equal(await session.read('app://vault/asset'),data('local'));
});

test('record waits for an in-flight capture, rejects incompatible bytes, and can recover a failed remote read', async () => {
  const gate=deferred(),session=createResourceSession({reader:async()=>gate.promise});
  const reading=session.read('https://example.test/a'),recording=session.record(data('new'),'https://example.test/a');
  const rejected=assert.rejects(recording,code('RESOURCE_CAPTURE_CONFLICT'));gate.resolve(data('old'));await reading;await rejected;
  assert.equal(await session.read('https://example.test/a'),data('old'));
  const broken=deferred(),recovery=createResourceSession({reader:async()=>broken.promise});
  const readFailure=recovery.read('https://example.test/a');const failureObserved=assert.rejects(readFailure,/offline/);
  const recordRecovery=recovery.record(data('rendered'),'https://example.test/a');broken.reject(Error('offline'));await failureObserved;
  assert.equal(await recordRecovery,data('rendered'));
});

test('blob, manifest and snapshot values are defensive copies which survive session disposal', async () => {
  const session=createResourceSession();await session.read(data('abc'));
  const manifest=session.manifest(),id=manifest.resources[0].blobId,blob=session.readBlob(id),snapshot=session.snapshot();
  blob[0]=0;snapshot.blobs[0].bytes[1]=0;manifest.resources[0].kinds.push('poison');manifest.resources[0].mime='text/html';
  assert.equal(Buffer.from(session.readBlob(id)).toString(),'abc');assert.deepEqual(session.manifest().resources[0].kinds,['image']);
  assert.equal(session.manifest().resources[0].mime,'image/png');assert.throws(()=>session.readBlob('unknown'),code('RESOURCE_BLOB_MISSING'));
  const saved=session.snapshot();session.dispose();assert.equal(Buffer.from(saved.blobs[0].bytes).toString(),'abc');assert.equal(saved.manifest.resources.length,1);
});

test('resource evidence strips credentials/query/fragment and inline data while retaining exact URL hashes', async () => {
  const url='https://alice:password123@example.test/a.png?token=secret456&other=private789#section';
  const session=createResourceSession({reader:async()=>data('bytes')});await session.read(url);
  session.recordOmission({url,reasonCode:'READ_FAILED',reason:'Could not load '+url+' password=password123 token=secret456'});
  await session.read(data('an inline resource'));
  session.recordOmission({url:data('an inline resource'),reason:'Cannot decode '+data('an inline resource')});
  const manifest=session.manifest(),json=JSON.stringify(manifest);
  for(const secret of ['alice','password123','secret456','private789','?token=','#section','base64,'])assert.equal(json.includes(secret),false,secret);
  const resource=manifest.resources.find(item=>item.urlSha256===hash(new URL(url).href));
  assert.equal(resource.displayUrl,'https://example.test/a.png');
  const inline=manifest.resources.find(item=>item.representation==='original');assert.equal(inline.displayUrl,undefined);
  assert.equal(safeResourceUrl(url),'https://example.test/a.png');
  assert.equal(safeResourceUrl(data('abc')),undefined);
  assert.equal(safeResourceUrl('javascript:alert(1)'),'[unsupported resource URL]');
});

test('different private URL queries remain separate identities even when their display URL matches', async () => {
  const session=createResourceSession({reader:async url=>data(new URL(url).search)});
  await session.read('https://example.test/a?token=one');await session.read('https://example.test/a?token=two');
  const rows=session.manifest().resources;assert.equal(rows.length,2);assert.equal(rows[0].displayUrl,rows[1].displayUrl);
  assert.notEqual(rows[0].urlSha256,rows[1].urlSha256);assert.notEqual(rows[0].blobId,rows[1].blobId);
});

test('external files are captured but explicitly unverified, and SVG references diagnose without fetching', async () => {
  let reads=0;
  const svg='<svg xmlns="http://www.w3.org/2000/svg"><image href="https://elsewhere.test/image.png"/><style>@import "font.css";</style></svg>';
  const session=createResourceSession({reader:async()=>{reads++;return data(svg,'image/svg+xml');}});
  await session.read('file:///outside-vault/a.svg');assert.equal(reads,1);
  const manifest=session.manifest();assert.equal(manifest.resources[0].localPath,undefined);
  assert.deepEqual(manifest.warnings.map(row=>row.code).sort(),['EXTERNAL_FILE_NOT_VERIFIED','SVG_EXTERNAL_REFERENCE']);
  assert.equal(await session.assertLocalCurrent(),true);assert.equal(reads,1);
  const safe=createResourceSession();await safe.read(data('<svg><use href="#symbol"/><image href="data:image/png;base64,YQ=="/><style>x{fill:url(#paint)}</style></svg>','image/svg+xml'));
  assert.deepEqual(safe.manifest().warnings,[]);
  const css=createResourceSession();await css.read(data('<svg><style>x{fill:url(../paint.svg)}</style></svg>','image/svg+xml'));
  assert.equal(css.manifest().warnings[0].code,'SVG_EXTERNAL_REFERENCE');
});

test('data URI decoding handles binary percentages, UTF-8, unpadded base64, plus, parameters and fragments', async () => {
  const session=createResourceSession();
  const expected=Buffer.from([0xff,0x00,0x2b]);
  assert.equal(await session.read('data:application/octet-stream,%FF%00+'),'data:application/octet-stream;base64,'+expected.toString('base64'));
  const svg='<svg>中文</svg>';
  assert.equal(await session.read('data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)),data(svg,'image/svg+xml;charset=utf-8'));
  const metadata=session.manifest().resources.find(row=>row.mime==='image/svg+xml');assert.equal(metadata.mediaType,'image/svg+xml;charset=utf-8');
  assert.equal(await session.read('data:image/png;base64,YQ'),data('a'));
  assert.equal(await session.read('data:image/png;base64,YQ==#fragment'),data('a'));
  assert.equal(await session.read('data:,hello'),data('hello','text/plain'));
});

test('invalid data, unsafe protocols, paths and options fail without adding resources', async () => {
  const session=createResourceSession();
  for(const value of ['data:image/png;base64,@@@','data:image/png;base64,A','data:image/png;base64,YR==','data:image/png;base64,YQ=','data:image/png,%GG','data:image/png,%0','data:image/png;broken,a','data:image/png;base64;base64,YQ=='])
    await assert.rejects(session.read(value),code('RESOURCE_DATA_INVALID'),value);
  await assert.rejects(session.read('data:image/png;base64,'),code('RESOURCE_EMPTY'));
  await assert.rejects(session.read('javascript:alert(1)'),code('RESOURCE_PROTOCOL_UNSUPPORTED'));
  await assert.rejects(session.read('x','relative-base'),code('RESOURCE_URL_INVALID'));
  await assert.rejects(session.read(data('x'),'file:///',{kind:'script'}),/资源用途/);
  assert.equal(session.manifest().resources.length,0);
  for(const bad of ['../x','/x','C:/x','a\\b','a//b','a/./b',' a ']){
    const invalid=createResourceSession({resolveLocal:()=>bad,readLocal:async()=>Buffer.from('x')});
    await assert.rejects(invalid.read('app://vault/x'),code('RESOURCE_LOCAL_PATH_INVALID'));
  }
  for(const maxBytes of [-1,NaN,Infinity,1.5,'2'])assert.throws(()=>createResourceSession({maxBytes}),/预算/);
  assert.throws(()=>createResourceSession({reader:2}),/适配器/);
});

test('empty resources, invalid local byte types, and missing injected readers are reported honestly', async () => {
  const missing=createResourceSession();await assert.rejects(missing.read('https://example.test/a'),code('RESOURCE_READER_MISSING'));
  const local=createResourceSession({resolveLocal:()=> 'a.png'});await assert.rejects(local.read('app://vault/a'),code('RESOURCE_READER_MISSING'));
  const invalid=createResourceSession({resolveLocal:()=> 'a.png',readLocal:async()=>[1,2]});await assert.rejects(invalid.read('app://vault/a'),code('RESOURCE_BYTES_INVALID'));
  const zero=createResourceSession({resolveLocal:()=> 'a.png',readLocal:async()=>Buffer.alloc(0)});await assert.rejects(zero.read('app://vault/a'),code('RESOURCE_EMPTY'));
  const budget=createResourceSession({maxBytes:0});await assert.rejects(budget.read(data('a')),code('RESOURCE_BUDGET_EXCEEDED'));
});

test('session lifetime has no wall-clock budget and manifest ordering is stable', async () => {
  let calls=0;const session=createResourceSession({reader:async()=>{calls++;return data('a');}});
  await session.read('https://example.test/z');const first=session.manifest();
  const realNow=Date.now;try{Date.now=()=>realNow()+1000*60*60*24*365;await session.read('https://example.test/z');}finally{Date.now=realNow;}
  assert.equal(calls,1);assert.deepEqual(session.manifest(),first);
  await session.read('https://example.test/a');const ids=session.manifest().resources.map(row=>row.urlSha256);
  assert.deepEqual(ids,[...ids].sort());
});
