'use strict';

// Durable, create-only import receipts. Source notes are not edited by diagnosis
// or staging. Transfer containers deliberately carry original bytes separately
// from remapped candidates and never claim to implement an external QTI format.
const B=()=>require('node:buffer').Buffer;
const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const uuid=()=>require('node:crypto').randomUUID();
const ROOT='Mathsemble/待入库',PROFILE='mathsemble-question-json-v1',TRANSFER='mathsemble-transfer-v1';
const MAX_BYTES=64*1024*1024,MAX_FILES=2000;
const fail=(code,message)=>Object.assign(new Error(message),{code});
function plain(value,depth=0,seen=new Set()) {
  if(depth>32)throw fail('LIBRARY_DATA','数据嵌套过深');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||seen.has(value)||Object.getOwnPropertySymbols(value).length||![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(value)))throw fail('LIBRARY_DATA','必须使用无循环的纯 JSON 数据');
  const descriptors=Object.getOwnPropertyDescriptors(value);for(const [key,d]of Object.entries(descriptors))if(['__proto__','prototype','constructor'].includes(key)||d.get||d.set)throw fail('LIBRARY_DATA','不允许访问器或危险字段');
  seen.add(value);let result;
  if(Array.isArray(value)){if(value.length>10000||Object.keys(value).length!==value.length)throw fail('LIBRARY_DATA','列表无效');result=value.map(v=>plain(v,depth+1,seen));}
  else result=Object.fromEntries(Object.keys(value).sort().map(k=>[k,plain(descriptors[k].value,depth+1,seen)]));
  seen.delete(value);return result;
}
const json=value=>JSON.stringify(plain(value),null,2)+'\n';
const objectHash=value=>sha(JSON.stringify(plain(value)));
function pathOf(raw) {
  if(typeof raw!=='string'||!raw||raw.length>4096||raw!==raw.trim()||raw.startsWith('/')||/[\\:<>"|?*\x00-\x1f\x7f]/.test(raw)||raw.split('/').some(p=>!p||p==='.'||p==='..'||/[. ]$/.test(p)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))throw fail('LIBRARY_PATH','必须使用安全的库内相对路径');
  return raw;
}
const issue=(code,message,path='',severity='warning',extra={})=>({code,message,path,severity,...extra});
const sourceKind=metadata=>/knowledge|知识/.test(String(metadata.note_type||metadata.type||''))?'knowledge':'question';
function binary(value) {
  if(typeof value==='string')return B().from(value,'utf8');
  if(value instanceof Uint8Array)return B().from(value);
  if(value instanceof ArrayBuffer)return B().from(new Uint8Array(value));
  throw fail('LIBRARY_BYTES','文件内容必须为字符串或二进制');
}
function decode(base64) {
  if(typeof base64!=='string'||base64.length>MAX_BYTES*1.4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64))throw fail('LIBRARY_BYTES','Base64 编码无效');
  const bytes=B().from(base64,'base64');if(bytes.toString('base64')!==base64)throw fail('LIBRARY_BYTES','Base64 编码不是规范形式');return bytes;
}
const utf8=bytes=>new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
function fileRecord(path,bytes,kind='asset') {bytes=binary(bytes);return {path:pathOf(path),kind,bytes:bytes.length,sha256:sha(bytes),base64:bytes.toString('base64')};}
function checkedFiles(files) {
  if(!Array.isArray(files)||!files.length||files.length>MAX_FILES)throw fail('LIBRARY_FILES','文件数量须为 1–2000');
  const paths=new Set();let total=0;
  return files.map(raw=>{const row=plain(raw),path=pathOf(row.path),key=path.toLowerCase();if(paths.has(key))throw fail('LIBRARY_PATH','包内路径重名（含大小写）：'+path);paths.add(key);
    const bytes=decode(row.base64);total+=bytes.length;if(total>MAX_BYTES)throw fail('LIBRARY_BUDGET','材料超过 64 MiB 字节预算');
    if(row.bytes!==bytes.length||row.sha256!==sha(bytes))throw fail('LIBRARY_INTEGRITY','文件摘要或字节数不符：'+path);
    if(!['source','asset','plan','sidecar','archive'].includes(row.kind))throw fail('LIBRARY_KIND','未知文件类别：'+path);if(row.sourceKind!==undefined&&!['question','knowledge'].includes(row.sourceKind))throw fail('LIBRARY_KIND','未知源文类别：'+path);return row;});
}
function validateTransferPackage(raw) {
  const value=plain(raw);if(value?.schemaVersion!==1||value?.format!==TRANSFER)throw fail('LIBRARY_SCHEMA','不支持的材料包版本或 profile');
  if(!/^[a-f0-9]{64}$/.test(value.integrity))throw fail('LIBRARY_INTEGRITY','材料包缺少完整性摘要');
  const {integrity,...body}=value;if(objectHash(body)!==integrity)throw fail('LIBRARY_INTEGRITY','材料包完整性校验失败');
  value.files=checkedFiles(value.files);if(!Array.isArray(value.references)||!Array.isArray(value.issues))throw fail('LIBRARY_SCHEMA','材料包映射或问题列表无效');
  for(const ref of value.references){pathOf(ref.sourcePath);if(ref.resolvedPath!=null)pathOf(ref.resolvedPath);if(typeof ref.target!=='string')throw fail('LIBRARY_SCHEMA','引用映射无效');}
  return value;
}
function metadataOf(markdown,parseYaml) {
  const match=String(markdown).replace(/^\uFEFF/,'').match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
  const metadata=match?parseYaml(match[1]):{};if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw fail('LIBRARY_METADATA','元信息必须为字段对象');return plain(metadata);
}
function analyzeLibrary(index,{missingFields=['id','subject','question_type','family_id']}={}) {
  const issues=(index.issues||[]).map(row=>({...plain(row),severity:row.severity||'warning'})),groups=new Map();
  for(const item of index.items||[]){if(item.kind!=='question')continue;
    for(const field of missingFields)if(!Object.hasOwn(item.metadata||{},field)||field!=='family_id'&&(item.metadata[field]==null||String(item.metadata[field]).trim()===''))issues.push(issue('missing-metadata','缺少元信息：'+field,item.path,'warning',{field}));
    const body=item.markdown.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,'').replace(/\s+/g,' ').trim();
    if(body){const key=sha(body);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item.path);}
  }
  for(const paths of groups.values())if(paths.length>1)for(const path of paths)issues.push(issue('possible-same-body','疑似相同正文，仅供人工核对；不会自动合并或改号',path,'info',{relatedPaths:paths.filter(p=>p!==path)}));
  return {issues,counts:{items:index.items?.length||0,issues:issues.length,errors:issues.filter(row=>row.severity==='error').length}};
}
function relative(from,to) {const left=from.split('/').slice(0,-1),right=to.split('/');while(left.length&&right.length&&left[0]===right[0]){left.shift();right.shift();}return '../'.repeat(left.length)+right.join('/');}
function normalizedTarget(source,target) {
  const raw=String(target).split(/[?#]/)[0];if(!raw||/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(raw))return null;
  const parts=(raw.startsWith('/')?raw.slice(1):source.split('/').slice(0,-1).concat(raw).join('/')).split('/'),out=[];
  for(const part of parts){if(!part||part==='.')continue;if(part==='..'){if(!out.length)return null;out.pop();}else out.push(part);}return out.join('/');
}

function createLibraryService({vault,core,assemblyService,parseYaml,collectMediaDependencies,resolveDependency,now=()=>new Date(),newId=uuid}={}) {
  if(!vault||!core||!assemblyService||typeof parseYaml!=='function'||typeof collectMediaDependencies!=='function')throw fail('LIBRARY_ADAPTER','缺少题库服务依赖');
  let queue=Promise.resolve();
  const serial=fn=>{const task=queue.catch(()=>{}).then(fn);queue=task;return task;};
  const check=options=>{if(options?.signal?.aborted||options?.isCurrent&&!options.isCurrent())throw Object.assign(new Error('操作已取消或工作区已变化'),{name:'AbortError'});};
  const timestamp=()=>new Date(now()).toISOString();
  async function readBytes(file,options={}){check(options);const timeout=options.resourceTimeoutMs||15000;if(!Number.isFinite(timeout)||timeout<1)throw fail('LIBRARY_TIMEOUT','读取超时参数无效');let timer,onAbort;
    try {return await Promise.race([Promise.resolve().then(()=>vault.readBinary?vault.readBinary(file):vault.read(file)).then(binary),new Promise((_,reject)=>{timer=setTimeout(()=>reject(fail('LIBRARY_TIMEOUT','读取材料超时：'+file.path)),timeout);onAbort=()=>reject(Object.assign(new Error('操作已取消'),{name:'AbortError'}));options.signal?.addEventListener('abort',onAbort,{once:true});})]);}
    finally{clearTimeout(timer);options.signal?.removeEventListener('abort',onAbort);}}
  async function ensureFolder(path){let current='';for(const part of pathOf(path).split('/')){current=current?current+'/'+part:part;let node=vault.getAbstractFileByPath(current);if(!node){try{await vault.createFolder(current);}catch(error){node=vault.getAbstractFileByPath(current);if(!Array.isArray(node?.children))throw error;}node=vault.getAbstractFileByPath(current);}if(!Array.isArray(node?.children))throw fail('LIBRARY_CONFLICT','目录已被文件占用：'+current);}}
  async function create(path,bytes){pathOf(path);if(vault.getAbstractFileByPath(path))throw fail('LIBRARY_CONFLICT','目标已存在，未覆盖：'+path);await ensureFolder(path.slice(0,path.lastIndexOf('/')));if(vault.getAbstractFileByPath(path))throw fail('LIBRARY_CONFLICT','目标已存在，未覆盖：'+path);
    bytes=binary(bytes);if(vault.createBinary)return vault.createBinary(path,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));return vault.create(path,utf8(bytes));}
  async function resolve(target,sourcePath){if(resolveDependency){const value=await resolveDependency(target,sourcePath);if(value)return typeof value==='string'?value:value.path;}
    const path=normalizedTarget(sourcePath,target),direct=String(target).split(/[?#]/)[0];if(path&&vault.getAbstractFileByPath(path))return path;if(vault.getAbstractFileByPath(direct))return direct;
    const matches=(vault.getFiles?.()||vault.getMarkdownFiles()).filter(file=>file.path.split('/').pop()===direct);return matches.length===1?matches[0].path:null;}
  async function declarations(markdown,path,known){const rows=[];for(const dep of collectMediaDependencies(markdown,path).dependencies){
    const remote=/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(dep.target),resolvedPath=remote?null:known?known(dep.target,path):await resolve(dep.target,path);
    rows.push({...dep,resolvedPath:resolvedPath||null,external:remote});}return rows;}
  async function diagnose(options={}) {check(options);const config=options.config||await assemblyService.loadSettings(),index=await assemblyService.scan(config,options),indexed=new Set(index.items.map(item=>item.path)),extra=[],discoveryIssues=[];
    const excluded=path=>/(^|\/)(?:\.[^/]+|_高中知识登记|assets|node_modules|ExamExports|模板&规范|Mathsemble)(\/|$)/i.test(path)||/(?:【模板】|【示例】|复测样例|Q-DEMO-|Q-CANONICAL-|整卷验收_)/i.test(path)||/(?:^|\/)(?:README|章节导航|待补清单)\.md$/i.test(path);
    // The normal assembly index deliberately excludes unknown question types.
    // Diagnosis must still surface those files instead of treating absence from
    // the usable index as proof that the library has no missing metadata.
    for(const file of vault.getMarkdownFiles())if(!indexed.has(file.path)&&!excluded(file.path)&&(config.questionRoots||[]).some(root=>file.path.startsWith(root+'/')&&(config.recursive!==false||!file.path.slice(root.length+1).includes('/')))){
      check(options);try{const markdown=utf8(await readBytes(file,options)),metadata=metadataOf(markdown,parseYaml);extra.push({path:file.path,kind:'question',markdown,metadata});discoveryIssues.push(issue('unindexed-source-review','未进入可用题库索引：请核对是否题卡及 question_type，不自动更改类型',file.path,'warning'));}catch(error){if(error.name==='AbortError'||error.code==='LIBRARY_TIMEOUT')throw error;discoveryIssues.push(issue('unindexed-source-error','未入索引素材无法解析：'+error.message,file.path,'error'));}}
    const allIndex=extra.length?core.buildIndex([...index.items.map(item=>({path:item.path,kind:item.kind,markdown:item.markdown,metadata:item.metadata})),...extra]):index;
    const report=analyzeLibrary(allIndex);report.issues.push(...discoveryIssues,...(extra.length?index.issues:[]));
    for(const item of allIndex.items){check(options);for(const dep of await declarations(item.markdown,item.path))if(!dep.resolvedPath&&!dep.external||dep.status==='unsupported')report.issues.push(issue(dep.status==='unsupported'?'unsupported-resource':'missing-resource','资源待核对：'+(dep.target||dep.reasonCode),item.path,'warning',{target:dep.target}));}
    check(options);return {index,issues:report.issues,counts:{...report.counts,indexed:index.items.length,unindexed:extra.length,issues:report.issues.length,errors:report.issues.filter(row=>row.severity==='error').length}};}
  function batchPath(batchId){if(typeof batchId!=='string'||!/^batch-[a-f0-9]{24}$/.test(batchId))throw fail('LIBRARY_BATCH','批次 ID 无效');return ROOT+'/'+batchId;}
  async function loadBatch(batchId){const path=batchPath(batchId)+'/manifest.json',file=vault.getAbstractFileByPath(path);if(!file)throw fail('LIBRARY_BATCH','暂存批次不存在或尚未完成');
    const text=utf8(await readBytes(file)),batch=plain(JSON.parse(text));if(batch.schemaVersion!==1||batch.batchId!==batchId||!Array.isArray(batch.files)||!Array.isArray(batch.originals))throw fail('LIBRARY_BATCH','批次清单无效');
    const {manifestDigest,...body}=batch;if(objectHash(body)!==manifestDigest)throw fail('LIBRARY_INTEGRITY','批次清单摘要不符');
    for(const row of batch.files){pathOf(row.targetPath);if(!row.stagePath.startsWith(batchPath(batchId)+'/candidates/'))throw fail('LIBRARY_PATH','暂存文件越界');pathOf(row.stagePath);}
    return batch;}
  function batchStatus(batch,log){if(batch.status==='blocked')return 'blocked';const owned=new Set();for(const row of log){if(row.type==='created')owned.add(row.path);if(row.type==='removed')owned.delete(row.path);}if(owned.size===batch.files.length&&batch.files.length)return 'committed';if(owned.size)return 'partial';if(log.some(row=>row.type==='removed'))return 'undone';return log.some(row=>row.type==='intent')?'partial':'staged';}
  async function listBatches(){const rows=[];for(const folder of vault.getAbstractFileByPath(ROOT)?.children||[]){if(!Array.isArray(folder.children)||!/^batch-/.test(folder.name))continue;try{const batch=await loadBatch(folder.name);rows.push({batchId:batch.batchId,profile:batch.profile,createdAt:batch.createdAt,status:batchStatus(batch,await events(batch.batchId)),count:batch.files.length});}catch(_){rows.push({batchId:folder.name,status:'incomplete',count:0});}}return rows;}
  function unknown(value,known,path,loss){for(const key of Object.keys(value))if(!known.includes(key))loss.push({code:'unknown-field-preserved',path,field:key,disposition:'原件完整保留；不自动映射该字段'});}
  async function stageImport(raw,options={}) {return serial(async()=>{
    check(options);const input=plain(raw),targetRoot=pathOf(input.targetRoot||'导入题库');if(targetRoot.startsWith('Mathsemble/'))throw fail('LIBRARY_PATH','源卡目标不能位于插件侧车目录');
    const profile=input.profile,originals=(input.files||[]).map((row,i)=>fileRecord(pathOf(row.path||'input-'+i),row.base64!==undefined?decode(row.base64):binary(row.text),'asset'));
    checkedFiles(originals);const idMap=plain(input.idMap||{});for(const [from,to]of Object.entries(idMap))if(!from||typeof to!=='string'||!to.trim()||/[\x00-\x1f]/.test(to))throw fail('LIBRARY_ID','ID 映射无效');
    const digest=objectHash({profile,targetRoot,originals,idMap}),batchId='batch-'+digest.slice(0,24),base=batchPath(batchId);
    if(vault.getAbstractFileByPath(base+'/manifest.json')){const existing=await loadBatch(batchId);if(existing.inputDigest!==digest)throw fail('LIBRARY_CONFLICT','批次摘要冲突');return existing;}
    const issues=[],lossReport=[],referenceMap=[],files=[];let sourceFiles=[];
    try {
      if(profile==='markdown')sourceFiles=originals.map(row=>({...row,kind:/\.md$/i.test(row.path)?'source':'asset'}));
      else if(profile===PROFILE){
        for(const original of originals){const value=plain(JSON.parse(utf8(decode(original.base64))));if(value.schemaVersion!==1||!Array.isArray(value.items))throw fail('LIBRARY_SCHEMA','结构化 JSON 必须使用 schemaVersion:1 和 items');unknown(value,['schemaVersion','items','assets'],original.path,lossReport);
          for(const item of value.items){if(typeof item.markdown!=='string'||!item.metadata||typeof item.metadata!=='object'||Array.isArray(item.metadata))throw fail('LIBRARY_PROFILE','结构化题目需要 path、markdown 和 metadata 对象');unknown(item,['path','markdown','metadata'],original.path+':'+item.path,lossReport);
            const markdown='---\n'+JSON.stringify(plain(item.metadata))+'\n---\n'+item.markdown;sourceFiles.push(fileRecord(item.path,markdown,'source'));}
          for(const asset of value.assets||[]){const bytes=decode(asset.base64);if(asset.sha256&&asset.sha256!==sha(bytes))throw fail('LIBRARY_INTEGRITY','JSON 资源摘要不符');unknown(asset,['path','base64','sha256'],original.path+':'+asset.path,lossReport);sourceFiles.push(fileRecord(asset.path,bytes,'asset'));}}
      }else if(profile===TRANSFER){if(originals.length!==1)throw fail('LIBRARY_PROFILE','一次暂存一个材料包');const transfer=validateTransferPackage(JSON.parse(utf8(decode(originals[0].base64))));unknown(transfer,['schemaVersion','format','packageId','createdAt','files','references','issues','integrity'],originals[0].path,lossReport);sourceFiles=transfer.files;issues.push(...transfer.issues.map(row=>({...row,severity:row.severity||'warning'})));for(const row of sourceFiles)unknown(row,['path','kind','sourceKind','bytes','sha256','base64'],row.path,lossReport);
      }else throw fail('LIBRARY_PROFILE','未知导入 profile，原件已保留但禁止提交');
      sourceFiles=checkedFiles(sourceFiles);
    }catch(error){issues.push(issue(error.code||'invalid-input',error.message,'','error'));sourceFiles=[];}
    const mapping=Object.fromEntries(sourceFiles.map(row=>[row.path,row.kind==='plan'?'Mathsemble/组题方案/导入_'+batchId+'_'+sha(row.path).slice(0,8)+'_'+row.path.split('/').pop():row.kind==='sidecar'?'Mathsemble/导入旁车/'+batchId+'/'+row.path:row.kind==='archive'?'Mathsemble/导入归档/'+batchId+'/'+row.path:targetRoot+'/'+row.path]));
    const sourceByPath=new Map(sourceFiles.map(row=>[row.path,row])),originalItems=[],candidateItems=[];
    const known=(target,source)=>{const direct=String(target).split(/[?#]/)[0],rel=normalizedTarget(source,target);if(sourceByPath.has(rel))return rel;if(sourceByPath.has(direct))return direct;const matches=sourceFiles.filter(row=>row.path.split('/').pop()===direct);return matches.length===1?matches[0].path:null;};
    for(const row of sourceFiles){check(options);let bytes=decode(row.base64);if(row.kind==='source'){
      try {const original=utf8(bytes),metadata=metadataOf(original,parseYaml),nextMetadata=plain(metadata);let markdown=original;
        for(const field of ['id','parent_id'])if(typeof nextMetadata[field]==='string'&&Object.hasOwn(idMap,nextMetadata[field]))nextMetadata[field]=idMap[nextMetadata[field]];
        if(JSON.stringify(nextMetadata)!==JSON.stringify(metadata)){const match=markdown.match(/^(\uFEFF?)---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);if(!match)throw fail('LIBRARY_ID','ID 映射需要明确元信息块');markdown=match[1]+'---\n'+JSON.stringify(nextMetadata)+'\n---\n'+markdown.slice(match[0].length);lossReport.push({code:'metadata-remapped',path:row.path,disposition:'仅显式 ID 映射；原件与原摘要保留'});}
        originalItems.push({path:row.path,kind:row.sourceKind||sourceKind(metadata),markdown:original,metadata});
        for(const dep of await declarations(original,row.path,known)){
          if(dep.external||dep.status==='unsupported'||!dep.resolvedPath){issues.push(issue('unpacked-dependency','未封装依赖：'+(dep.target||dep.reasonCode),row.path,'warning'));referenceMap.push({...dep,targetPath:null});continue;}
          const destination=mapping[dep.resolvedPath],suffix=dep.target.slice(dep.target.split(/[?#]/)[0].length),replacement=(dep.syntax==='wiki-embed'?destination:relative(mapping[row.path],destination))+suffix;
          referenceMap.push({...dep,targetPath:destination,rewrittenTarget:replacement});
          // Probe each occurrence with the existing declaration parser. Literal
          // code/math/ordinary-link text never becomes a replacement site.
          const rawTarget=dep.rawTarget;if(!rawTarget)continue;let cursor=0,count=0;
          while((cursor=markdown.indexOf(rawTarget,cursor))>=0){if(++count>2000)throw fail('LIBRARY_BUDGET','单个资源引用过多');const marker='__mwb_transfer_'+batchId+'_'+cursor+'.png',probe=markdown.slice(0,cursor)+marker+markdown.slice(cursor+rawTarget.length);
            const declared=collectMediaDependencies(probe,row.path).dependencies.some(value=>value.rawTarget===marker);
            if(declared){const encoded=dep.syntax==='wiki-embed'?replacement:dep.syntax==='html-image'?replacement.replace(/&/g,'&amp;').replace(/"/g,'&quot;'):(suffix?replacement.slice(0,-suffix.length):replacement).split('/').map(part=>encodeURIComponent(part)).join('/')+suffix;markdown=markdown.slice(0,cursor)+encoded+markdown.slice(cursor+rawTarget.length);cursor+=encoded.length;}else cursor+=rawTarget.length;
          }
        }
        if(/\[\[[^\]]+\]\]/.test(markdown.replace(/!\[\[[^\]]+\]\]/g,'')))lossReport.push({code:'note-links-preserved',path:row.path,disposition:'非图片 Wiki 链接保持原文；跨根路径及 ID 型链接须核对，未宣称全部重映射'});
        bytes=binary(markdown);candidateItems.push({path:mapping[row.path],kind:row.sourceKind||sourceKind(nextMetadata),markdown,metadata:nextMetadata});
      }catch(error){issues.push(issue(error.code||'source-parse',error.message,row.path,'error'));}
    }
    files.push({...row,targetPath:mapping[row.path],stagePath:base+'/candidates/'+String(files.length).padStart(4,'0')+'.bin',base64:bytes.toString('base64'),bytes:bytes.length,sha256:sha(bytes),originalSha256:row.sha256});}
    const originalIndex=core.buildIndex(originalItems),candidateIndex=core.buildIndex(candidateItems),oldById=new Map(originalIndex.items.filter(item=>item.id).map(item=>[item.id,item]));
    for(const row of files)if(row.kind==='plan')try{
      const plan=core.validatePlan(JSON.parse(utf8(decode(row.base64))));
      for(const entry of plan.entries){if(entry.kind==='section')continue;const old=(entry.sourceId&&oldById.get(entry.sourceId))||originalIndex.items.find(item=>item.path===entry.sourcePath);
        if(!old||old.fingerprint!==entry.sourceFingerprint)throw fail('LIBRARY_PLAN_SOURCE','方案来源缺失或已变化，不能自动迁移：'+entry.sourcePath);
        const next=candidateIndex.items.find(item=>item.path===mapping[old.path]);if(!next)throw fail('LIBRARY_PLAN_SOURCE','方案来源不在包内');Object.assign(entry,{sourceId:next.id||'',sourcePath:next.path,sourceFingerprint:next.fingerprint});}
      const bytes=binary(json(core.validatePlan(plan)));Object.assign(row,{base64:bytes.toString('base64'),bytes:bytes.length,sha256:sha(bytes)});
      lossReport.push({code:'plan-reference-remapped',path:row.path,disposition:'新候选仅更新明确来源映射；原方案字节与摘要保留'});
    }catch(error){issues.push(issue(error.code||'plan-schema',error.message,row.path,'error'));}
    for(const row of files)if(['sidecar','archive'].includes(row.kind))lossReport.push({code:'opaque-history-preserved',path:row.path,disposition:'原字节完整携带；历史内部路径/摘要保持原义，不作为当前可执行记录恢复'});
    issues.push(...analyzeLibrary(candidateIndex).issues);
    const batch={schemaVersion:1,batchId,inputDigest:digest,createdAt:timestamp(),profile,targetRoot,status:issues.some(i=>i.severity==='error')?'blocked':'staged',
      originals:originals.map((row,i)=>({...row,stagePath:base+'/originals/'+String(i).padStart(4,'0')+'.bin'})),files,issues,idMap,assetMap:mapping,referenceMap,lossReport};
    // Stage files are deterministic and verified when recovering an interrupted
    // staging write. A mismatching existing file is never overwritten.
    for(const row of [...batch.originals,...files]){check(options);const existing=vault.getAbstractFileByPath(row.stagePath);if(existing){if(sha(await readBytes(existing))!==row.sha256)throw fail('LIBRARY_CONFLICT','暂存材料被修改：'+row.stagePath);}else await create(row.stagePath,decode(row.base64));}
    batch.manifestDigest=objectHash(batch);await create(base+'/manifest.json',json(batch));return batch;
  });}
  async function events(batchId){const out=[];for(const file of vault.getAbstractFileByPath(batchPath(batchId)+'/events')?.children||[]){if(file.extension!=='json')continue;const row=plain(JSON.parse(utf8(await readBytes(file))));if(row.batchId!==batchId||!Number.isSafeInteger(row.sequence)||row.sequence<1)throw fail('LIBRARY_BATCH','提交日志所属批次或顺序错误');out.push(row);}return out.sort((a,b)=>a.sequence-b.sequence);}
  async function event(batchId,type,data){const log=await events(batchId),sequence=(log.at(-1)?.sequence||0)+1,row={schemaVersion:1,batchId,eventId:newId(),sequence,time:timestamp(),type,...plain(data)};await create(batchPath(batchId)+'/events/'+String(sequence).padStart(8,'0')+'.json',json(row));return row;}
  async function preflight(batch,options={}){const issues=[],log=await events(batch.batchId),owned=new Map(log.filter(row=>row.type==='created').map(row=>[row.path,row]));
    for(const row of log.filter(row=>row.type==='removed'))owned.delete(row.path);
    const ids=new Map();for(const file of vault.getMarkdownFiles()){check(options);if(file.path.startsWith('Mathsemble/'))continue;try{const meta=metadataOf(utf8(await readBytes(file,options)),parseYaml);if(typeof meta.id==='string'&&meta.id){if(!ids.has(meta.id))ids.set(meta.id,[]);ids.get(meta.id).push(file.path);}}catch(error){if(error.name==='AbortError'||error.code==='LIBRARY_TIMEOUT')throw error;}}
    const existingPaths=new Map((vault.getFiles?.()||vault.getMarkdownFiles()).map(file=>[file.path.toLowerCase(),file.path]));
    const newIds=new Map();for(const row of batch.files){const existing=vault.getAbstractFileByPath(row.targetPath),receipt=owned.get(row.targetPath);if(receipt&&receipt.sha256!==row.sha256)issues.push(issue('receipt-mismatch','创建日志与暂存候选摘要不符',row.targetPath,'error'));if(existing){if(!receipt||sha(await readBytes(existing))!==receipt.sha256)issues.push(issue('target-exists','目标已存在或本批文件已被编辑：'+row.targetPath,row.targetPath,'error'));}
      else if(existingPaths.has(row.targetPath.toLowerCase()))issues.push(issue('target-case-conflict','目标存在仅大小写不同的文件',row.targetPath,'error'));
      else if(receipt)issues.push(issue('created-file-missing','本批已创建文件后来被删除：'+row.targetPath,row.targetPath,'error'));
      if(row.kind==='source')try{const meta=metadataOf(utf8(decode(row.base64)),parseYaml);if(typeof meta.id==='string'&&meta.id){const same=(ids.get(meta.id)||[]).filter(path=>path!==row.targetPath||!receipt);if(same.length||newIds.has(meta.id))issues.push(issue('id-conflict','题目 ID 已存在或批内重复：'+meta.id,row.targetPath,'error',{relatedPaths:[...same,...(newIds.has(meta.id)?[newIds.get(meta.id)]:[])]}));newIds.set(meta.id,row.targetPath);}}catch(error){issues.push(issue('metadata-invalid',error.message,row.targetPath,'error'));}}
    return {issues,owned};}
  async function inspectBatch(batchId,options={}){const batch=await loadBatch(batchId),state=await preflight(batch,options),commitLog=await events(batchId);return {...batch,status:batchStatus(batch,commitLog),issues:[...batch.issues,...state.issues],commitLog};}
  async function commitBatch(batchId,{confirmed=false,...options}={}) {if(confirmed!==true)throw fail('LIBRARY_CONFIRM','核对批次后须明确确认入库');return serial(async()=>{
    let writingPath=null,changed=false;const refs=[];
    const current=()=>{check(options);if(changed)throw fail('LIBRARY_CHANGED','提交期间题库发生变化，请重新核对批次');};
    if(vault.on&&vault.offref)for(const type of ['create','modify','delete','rename'])refs.push(vault.on(type,(file,oldPath)=>{if(type==='create'&&(file?.path===writingPath||writingPath&&Array.isArray(file?.children)&&writingPath.startsWith(file.path+'/')))return;if([file?.path,oldPath].some(path=>typeof path==='string'&&!path.startsWith('Mathsemble/')))changed=true;}));
    try {
    current();const batch=await loadBatch(batchId);if(batch.status==='blocked'||batch.issues.some(row=>row.severity==='error'))throw fail('LIBRARY_BLOCKED','批次存在阻断问题，原件保留但不可提交');
    const state=await preflight(batch,options);current();if(state.issues.length)return {status:'conflict',batchId,issues:state.issues,created:[]};const created=[];
    for(const row of batch.files){check(options);if(state.owned.has(row.targetPath))continue;
      const staged=vault.getAbstractFileByPath(row.stagePath);if(!staged||sha(await readBytes(staged))!==row.sha256)throw fail('LIBRARY_INTEGRITY','暂存候选发生变化，未提交');
      // Persist intent first. A rejected create may have written bytes: without
      // an acknowledged created receipt it remains unverified, never auto-owned.
      await event(batchId,'intent',{path:row.targetPath,sha256:row.sha256});current();
      try {const bytes=await readBytes(staged);if(sha(bytes)!==row.sha256)throw fail('LIBRARY_INTEGRITY','暂存候选变化');current();writingPath=row.targetPath;await create(row.targetPath,bytes);writingPath=null;await event(batchId,'created',{path:row.targetPath,sha256:row.sha256});created.push(row.targetPath);}
      catch(error){return {status:'partial',batchId,created,issues:[issue('write-unverified','创建结果需核对，未覆盖或删除：'+error.message,row.targetPath,'error')]};}
    }
    current();await event(batchId,'committed',{paths:batch.files.map(row=>row.targetPath)});return {status:'complete',batchId,created,issues:[]};
    }finally{for(const ref of refs)vault.offref(ref);}
  });}
  async function undoBatch(batchId,{confirmed=false,...options}={}){if(confirmed!==true)throw fail('LIBRARY_CONFIRM','须明确确认撤销本批创建文件');return serial(async()=>{
    const batch=await loadBatch(batchId),state=await preflight(batch,options),removed=[],issues=[];
    for(const [path,receipt]of state.owned){check(options);if(!batch.files.some(row=>row.targetPath===path&&row.sha256===receipt.sha256)){issues.push(issue('undo-ownership','日志与批次不匹配，未删除',path,'error'));continue;}
      const file=vault.getAbstractFileByPath(path);if(!file){await event(batchId,'removed',{path,sha256:receipt.sha256});continue;}
      if(sha(await readBytes(file))!==receipt.sha256||vault.getAbstractFileByPath(path)!==file||sha(await readBytes(file))!==receipt.sha256){issues.push(issue('undo-edited','本批文件已被编辑或替换，未删除',path,'error'));continue;}
      check(options);try{await vault.delete(file,true);await event(batchId,'removed',{path,sha256:receipt.sha256});removed.push(path);}catch(error){issues.push(issue('undo-unverified','删除结果需核对：'+error.message,path,'error'));}
    }
    return {status:issues.length?'partial':'complete',batchId,removed,issues};
  });}
  async function exportTransfer({sourcePaths=[],planPaths=[],sidecarPaths=[],archivePaths=[],plan}={},options={}) {
    check(options);const files=[],references=[],issues=[],seen=new Set();let totalBytes=0;
    async function capture(path,kind){pathOf(path);if(seen.has(path))return;seen.add(path);const file=vault.getAbstractFileByPath(path);if(!file||Array.isArray(file.children)){issues.push(issue('missing-file','缺少待封装文件',path,'error'));return;}
      const bytes=await readBytes(file,options);check(options);totalBytes+=bytes.length;if(totalBytes>MAX_BYTES||files.length>=MAX_FILES)throw fail('LIBRARY_BUDGET','材料超过文件数或 64 MiB 字节预算');if(vault.getAbstractFileByPath(path)!==file||sha(await readBytes(file,options))!==sha(bytes))throw fail('LIBRARY_CHANGED','封装期间文件变化：'+path);files.push(fileRecord(path,bytes,kind));
      if(kind==='asset'&&/\.svg$/i.test(path)&&/(?:href\s*=\s*["']\s*(?:https?:|\/\/)|url\(\s*["']?(?:https?:|\/\/))/i.test(bytes.toString('utf8')))issues.push(issue('svg-external-dependency','SVG 含未封装外部引用',path,'warning'));
      if(kind==='source')for(const dep of await declarations(utf8(bytes),path)){references.push({sourcePath:path,target:dep.target,resolvedPath:dep.resolvedPath,syntax:dep.syntax,status:dep.status});if(dep.resolvedPath&&dep.status!=='unsupported')await capture(dep.resolvedPath,/\.md$/i.test(dep.resolvedPath)?'source':'asset');else issues.push(issue('unpacked-dependency','未封装依赖：'+(dep.target||dep.reasonCode),path,'warning'));}}
    const plans=[];if(plan)plans.push({path:'plans/current.plan.json',plan:core.validatePlan(plan)});
    for(const path of planPaths){await capture(path,'plan');const row=files.find(row=>row.path===path);if(row)plans.push({path,plan:core.validatePlan(JSON.parse(utf8(decode(row.base64))))});}
    for(const row of plans){if(!seen.has(row.path)){files.push(fileRecord(row.path,json(row.plan),'plan'));seen.add(row.path);}for(const entry of row.plan.entries)if(entry.kind!=='section'){await capture(entry.sourcePath,'source');const source=files.find(file=>file.path===entry.sourcePath);if(source)source.sourceKind=entry.kind;}}
    for(const path of sourcePaths)await capture(path,'source');for(const path of sidecarPaths)await capture(path,'sidecar');
    for(const path of archivePaths){const node=vault.getAbstractFileByPath(path);if(Array.isArray(node?.children)){const walk=async folder=>{for(const child of folder.children){if(Array.isArray(child.children))await walk(child);else await capture(child.path,'archive');}};await walk(node);}else await capture(path,'archive');}
    const records=[];for(const row of files.filter(file=>file.kind==='source'))try{const markdown=utf8(decode(row.base64)),metadata=metadataOf(markdown,parseYaml);records.push({path:row.path,kind:row.sourceKind||sourceKind(metadata),markdown,metadata});}catch(error){issues.push(issue('source-metadata',error.message,row.path,'error'));}
    const index=core.buildIndex(records);for(const row of plans)for(const problem of core.resolvePlan(row.plan,index).issues)issues.push({...problem,severity:'error',code:'stale-plan-reference'});
    checkedFiles(files);check(options);const body={schemaVersion:1,format:TRANSFER,packageId:newId(),createdAt:timestamp(),files,references,issues};return {package:{...body,integrity:objectHash(body)},issues,status:issues.length?'partial':'complete'};
  }
  const stageTransfer=(value,{targetRoot='导入题库',idMap={},...options}={})=>stageImport({profile:TRANSFER,targetRoot,idMap,files:[{path:'transfer.json',text:JSON.stringify(value)}]},options);
  return {diagnose,stageImport,listBatches,loadBatch,inspectBatch,commitBatch,undoBatch,exportTransfer,stageTransfer,
    openSource:path=>assemblyService.openSource(path),profiles:['markdown',PROFILE,TRANSFER],limits:{maxFiles:MAX_FILES,maxBytes:MAX_BYTES}};
}
module.exports={createLibraryService,analyzeLibrary,validateTransferPackage};
