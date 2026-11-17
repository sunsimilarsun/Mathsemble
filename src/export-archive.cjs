'use strict';

// An export observer, not an output writer: existing PDF/HTML saves remain in
// the host. This service only writes new, run-scoped evidence and archives.
let nodeCrypto, nodeBuffer;
const crypto = () => nodeCrypto || (nodeCrypto = require('node:crypto'));
const BufferType = () => nodeBuffer || (nodeBuffer = require('node:buffer').Buffer);
const digest = value => crypto().createHash('sha256').update(value).digest('hex');
const STATES = new Set(['prepared','saving','saved','unverified','failed','cancelled','not-run']);
const EDITIONS = new Set(['student','teacher','document']);
const ORIGINS = new Set(['question','document','folder','assembly']);
const KINDS = new Set(['pdf','html','markdown']);
const own = (value, key) => Object.prototype.hasOwnProperty.call(value,key);
function failure(code,message) { return Object.assign(new Error(message),{code}); }
function plain(value,label = '数据',seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value) ||
      !Array.isArray(value) && ![Object.prototype,null].includes(Object.getPrototypeOf(value)))
    throw failure('ARCHIVE_DATA_INVALID',label+'必须为无循环的纯 JSON 数据');
  seen.add(value);
  const result = Array.isArray(value) ? value.map(item=>plain(item,label,seen)) : {};
  if (!Array.isArray(value)) for (const key of Object.keys(value)) {
    const descriptor=Object.getOwnPropertyDescriptor(value,key);
    if (!descriptor || !own(descriptor,'value')) throw failure('ARCHIVE_DATA_INVALID',label+'不能含访问器');
    Object.defineProperty(result,key,{value:plain(descriptor.value,label,seen),enumerable:true,writable:true,configurable:true});
  }
  seen.delete(value);return result;
}
function text(value,label) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f\x7f]/.test(value))
    throw failure('ARCHIVE_DATA_INVALID',label+'必须为非空单行文字');
  return value;
}
function rootPath(value) {
  const path=text(value,'归档目录');
  if (path !== path.trim() || /[\\:]/.test(path) || path.startsWith('/') ||
      path.split('/').some(part=>!part || part==='.' || part==='..'))
    throw failure('ARCHIVE_PATH_INVALID','归档目录必须为规范库内相对路径');
  return path;
}
function bytesOf(value) {
  const B=BufferType();
  if (typeof value === 'string') return B.from(value,'utf8');
  if (value instanceof Uint8Array) return B.from(value);
  if (value instanceof ArrayBuffer) return B.from(new Uint8Array(value));
  throw failure('ARCHIVE_BYTES_INVALID','产物字节必须为文字、Uint8Array 或 ArrayBuffer');
}
function safeErrorMessage(value) {
  return String(value).replace(/data:[^\s<>"']*/gi,'[inline resource]')
    .replace(/(?:[a-z][a-z\d+.-]*:\/\/|blob:)[^\s<>"']+/gi,value=>{
      try {const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';
        return url.protocol==='blob:' ? '[blob resource]' : url.href;}
      catch (_) {return '[resource URL]';}
    })
    .replace(/\b(?:password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi,'[redacted]')
    .replace(/[\x00-\x1f\x7f]/g,' ').slice(0,1000);
}
function errorInfo(error) {
  if (error == null) return undefined;
  return {name:safeErrorMessage(error.name || 'Error').slice(0,80),
    ...(error.code && /^[A-Za-z0-9_-]{1,100}$/.test(error.code) ? {code:String(error.code)} : {}),
    message:safeErrorMessage(error.message ?? error)};
}
function json(value) { return JSON.stringify(value,null,2)+'\n'; }
function descriptor(value) {
  const bytes=bytesOf(value);return {bytes:bytes.length,sha256:digest(bytes)};
}

function createExportArchiveService({vault,validatePlan,now = ()=>new Date(),
  newId = ()=>crypto().randomUUID(),recordsRoot = 'Mathsemble/导出记录',archivesRoot = 'Mathsemble/材料归档'} = {}) {
  if (!vault || typeof vault.getAbstractFileByPath !== 'function' || typeof vault.create !== 'function' ||
      typeof vault.createFolder !== 'function' || typeof vault.createBinary !== 'function')
    throw failure('ARCHIVE_ADAPTER_INVALID','缺少 Vault 写入适配器');
  if (typeof now !== 'function' || typeof newId !== 'function' || validatePlan !== undefined && typeof validatePlan !== 'function')
    throw failure('ARCHIVE_ADAPTER_INVALID','归档时钟、标识或方案校验适配器无效');
  recordsRoot=rootPath(recordsRoot);archivesRoot=rootPath(archivesRoot);
  const ids=new Set();
  const timestamp=()=>{const date=new Date(now());if (!Number.isFinite(date.getTime()))
    throw failure('ARCHIVE_DATA_INVALID','归档时间无效');return date.toISOString();};
  async function ensureFolder(path) {
    let current='';
    for (const part of path.split('/')) {
      current=current ? current+'/'+part : part;
      let node=vault.getAbstractFileByPath(current);
      if (!node) {
        try {await vault.createFolder(current);}
        catch (error) {node=vault.getAbstractFileByPath(current);if (!Array.isArray(node?.children)) throw error;}
        node=vault.getAbstractFileByPath(current);
      }
      if (!Array.isArray(node?.children)) throw failure('ARCHIVE_PATH_CONFLICT','输出目录被文件占用：'+current);
    }
  }
  async function createFile(path,content,binary = false) {
    if (vault.getAbstractFileByPath(path)) throw failure('ARCHIVE_PATH_CONFLICT','导出证据已存在，未覆盖：'+path);
    // Vault.create/createBinary are create-only operations. Never modify a file
    // found after this check or retry a rejected write at the same path.
    return binary ? vault.createBinary(path,content.buffer.slice(content.byteOffset,content.byteOffset+content.byteLength)) : vault.create(path,content);
  }
  function beginRun(input,{archive = false} = {}) {
    if (typeof archive !== 'boolean') throw failure('ARCHIVE_DATA_INVALID','archive 必须为布尔值');
    const captured=plain(input,'导出输入');
    if (!captured || !ORIGINS.has(captured.origin) || !Array.isArray(captured.sources))
      throw failure('ARCHIVE_DATA_INVALID','来源类型或来源列表无效');
    for (const source of captured.sources) {
      if (!source || Array.isArray(source) || typeof source.markdown !== 'string')
        throw failure('ARCHIVE_DATA_INVALID','每个来源必须含 Markdown 原文');
      text(source.path,'来源路径');if (source.sourceId !== undefined) text(source.sourceId,'来源标识');
    }
    for (const key of ['compiledMarkdown','compiledPathContext']) if (captured[key] !== undefined && typeof captured[key] !== 'string')
      throw failure('ARCHIVE_DATA_INVALID',key+'必须为文字');
    for (const key of ['settings','options','runtime']) if (captured[key] !== undefined &&
      (!captured[key] || Array.isArray(captured[key]) || typeof captured[key] !== 'object'))
      throw failure('ARCHIVE_DATA_INVALID',key+'必须为纯对象');
    if (captured.planSnapshot != null) {
      if (!validatePlan) throw failure('ARCHIVE_PLAN_INVALID','归档方案需要现行校验器');
      captured.planSnapshot=plain(validatePlan(captured.planSnapshot),'方案快照');
      if (captured.planSnapshot?.schemaVersion !== 3)
        throw failure('ARCHIVE_PLAN_INVALID','材料归档仅接收校验后的 v3 方案');
    }
    const id=newId();
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(id) || ids.has(id))
      throw failure('ARCHIVE_ID_INVALID','导出记录标识无效或重复');
    ids.add(id);
    const startedAt=timestamp(),origin=captured.origin,artifacts=new Map(),artifactBytes=new Map();
    const inputSummary={sources:captured.sources.map(source=>{
      const {bytes,sha256}=descriptor(source.markdown);
      return {path:source.path,...(source.sourceId !== undefined ? {sourceId:source.sourceId} : {}),bytes,textUtf8Sha256:sha256};
    })};
    if (captured.compiledMarkdown !== undefined) {
      const {bytes,sha256}=descriptor(captured.compiledMarkdown);
      inputSummary.compiledMarkdown={bytes,textUtf8Sha256:sha256};
    }
    if (captured.compiledPathContext !== undefined) inputSummary.compiledPathContext=captured.compiledPathContext;
    for (const key of ['planSnapshot','sourceMap']) if (captured[key] != null)
      inputSummary[key]={...descriptor(json(captured[key])),...(key==='planSnapshot' ? {schemaVersion:3} : {})};
    const configuration={};
    for (const key of ['settings','options','runtime']) if (captured[key] !== undefined) configuration[key]=captured[key];
    const archiveInput=archive ? captured : null;
    let resources=null,readBlob=null,finalPromise=null,finalizing=false;
    const mutable=()=>{if (finalizing) throw failure('ARCHIVE_FINALIZED','导出记录已经封存');};
    function recordArtifact(update) {
      mutable();
      if (!update || typeof update !== 'object') throw failure('ARCHIVE_DATA_INVALID','产物记录无效');
      const {bytes,error,...metadata}=update,next=plain(metadata,'产物记录');
      const fields=new Set(['artifactId','kind','edition','state','path','pages','printReport']);
      if (Object.keys(next).some(key=>!fields.has(key))) throw failure('ARCHIVE_DATA_INVALID','产物记录含未知字段');
      if (error != null) next.error=errorInfo(error);
      text(next.artifactId,'产物标识');
      if (!KINDS.has(next.kind) || !EDITIONS.has(next.edition) || !STATES.has(next.state))
        throw failure('ARCHIVE_DATA_INVALID','产物格式、版别或状态无效');
      if (next.path !== undefined) text(next.path,'产物保存路径');
      if (next.state==='saved' && !next.path) throw failure('ARCHIVE_DATA_INVALID','saved 必须提供实际保存路径');
      if (next.pages !== undefined && (!Number.isSafeInteger(next.pages) || next.pages<0))
        throw failure('ARCHIVE_DATA_INVALID','产物页数无效');
      const previous=artifacts.get(next.artifactId);
      if (previous && (previous.kind!==next.kind || previous.edition!==next.edition ||
          previous.state==='saved' && (next.state!=='saved' || previous.path!==next.path)))
        throw failure('ARCHIVE_STATE_INVALID','不能改写产物身份或已经保存的事实');
      let copy;
      if (bytes !== undefined) {
        copy=bytesOf(bytes);const hash=digest(copy);
        if (previous?.state==='saved' && previous.sha256 && previous.sha256!==hash)
          throw failure('ARCHIVE_STATE_INVALID','不能替换已经保存的产物字节');
        next.bytes=copy.length;next.sha256=hash;
      }
      const at=timestamp(),history=[...(previous?.history || []),{at,state:next.state,...(next.error ? {error:next.error} : {})}];
      const record={...previous,...next,history};
      if (!next.error) delete record.error;
      artifacts.set(next.artifactId,record);
      if (archive && copy) artifactBytes.set(next.artifactId,copy);
      return plain(record);
    }
    function setResources(value) {
      mutable();
      if (!value || value.readBlob !== undefined && typeof value.readBlob !== 'function')
        throw failure('ARCHIVE_DATA_INVALID','媒体归档适配器无效');
      const manifest=plain(value.manifest,'媒体清单');
      if (!manifest || !Array.isArray(manifest.resources) ||
          manifest.omissions !== undefined && !Array.isArray(manifest.omissions) ||
          manifest.warnings !== undefined && !Array.isArray(manifest.warnings))
        throw failure('ARCHIVE_DATA_INVALID','媒体清单结构无效');
      resources=manifest;readBlob=value.readBlob || null;
    }
    function finalize({outcome = 'unknown',error} = {}) {
      if (finalPromise) return finalPromise;
      text(outcome,'导出结果');const finishedAt=timestamp(),runError=errorInfo(error);
      finalizing=true;
      finalPromise=(async()=>{
        const warnings=[],result={runId:id,record:{state:'not-run',path:recordsRoot+'/'+id+'.json'},
          archive:{state:archive ? 'not-run' : 'not-requested',...(archive ? {path:archivesRoot+'/'+id} : {})},warnings};
        const warn=(code,detail={})=>warnings.push({code,...detail});
        if (!resources) warn('RESOURCES_NOT_CAPTURED');
        for (const item of resources?.omissions || []) warn('RESOURCE_OMISSION',{omission:item});
        for (const item of resources?.warnings || []) warn('RESOURCE_SCOPE_LIMITED',{warning:item});
        const runRecord={schemaVersion:1,kind:'mathsemble-export-record',runId:id,startedAt,finishedAt,
          origin,outcome,...(runError ? {error:runError} : {}),inputs:inputSummary,...configuration,
          artifacts:[...artifacts.values()],resources:resources || null};
        if (archive) {
          const folder=result.archive.path,files=[];
          let writing=false;
          try {
            await ensureFolder(archivesRoot);
            if (vault.getAbstractFileByPath(folder)) throw failure('ARCHIVE_PATH_CONFLICT','材料归档已存在，未覆盖：'+folder);
            await vault.createFolder(folder); // Exclusive run directory; never resume an unknown partial archive.
            const write=async(relative,content,binary=false)=>{
              const path=folder+'/'+relative;
              if (relative.includes('/')) await ensureFolder(path.slice(0,path.lastIndexOf('/')));
              writing=true;await createFile(path,content,binary);writing=false;
              files.push({path:relative,...descriptor(content)});
            };
            for (let index=0;index<archiveInput.sources.length;index++) {
              const archivePath='sources/'+String(index+1).padStart(4,'0')+'.md';
              await write(archivePath,archiveInput.sources[index].markdown);
              inputSummary.sources[index].archivePath=archivePath;
            }
            if (archiveInput.compiledMarkdown !== undefined) await write('compiled.md',archiveInput.compiledMarkdown);
            for (const key of ['planSnapshot','sourceMap']) if (archiveInput[key] != null)
              await write(key==='planSnapshot' ? 'plan.v3.json' : 'source-map.json',json(archiveInput[key]));
            await write('input.json',json({...inputSummary,...configuration,origin}));
            const blobs=new Map(),writtenHashes=new Set();
            for (const resource of resources?.resources || []) {
              if (!resource || typeof resource.blobId !== 'string' || !/^[a-f0-9]{64}$/.test(resource.sha256 || '') ||
                  !Number.isSafeInteger(resource.bytes) || resource.bytes<0) {
                warn('RESOURCE_BYTES_UNAVAILABLE');continue;
              }
              const prior=blobs.get(resource.blobId);
              if (prior && (prior.sha256!==resource.sha256 || prior.bytes!==resource.bytes)) {
                warn('RESOURCE_BLOB_CONFLICT',{blobId:resource.blobId});continue;
              }
              if (prior) {
                if (writtenHashes.has(resource.sha256)) resource.archivePath='media/'+resource.sha256+'.bin';
                continue;
              }
              blobs.set(resource.blobId,{sha256:resource.sha256,bytes:resource.bytes});
              let bytes;
              try {
                if (!readBlob) throw failure('ARCHIVE_BLOB_UNAVAILABLE','未提供冻结媒体读取器');
                bytes=bytesOf(await readBlob(resource.blobId));
                if (bytes.length!==resource.bytes || digest(bytes)!==resource.sha256)
                  throw failure('ARCHIVE_BLOB_MISMATCH','冻结媒体摘要不一致');
              } catch (blobError) {warn('RESOURCE_BYTES_UNAVAILABLE',{blobId:resource.blobId,error:errorInfo(blobError)});continue;}
              if (!writtenHashes.has(resource.sha256)) {
                await write('media/'+resource.sha256+'.bin',bytes,true);writtenHashes.add(resource.sha256);
              }
              resource.archivePath='media/'+resource.sha256+'.bin';
            }
            let index=0;
            for (const artifact of artifacts.values()) {
              index++;const bytes=artifactBytes.get(artifact.artifactId);
              if (!bytes) {
                if (['prepared','saving','saved','unverified'].includes(artifact.state))
                  warn('ARTIFACT_BYTES_UNAVAILABLE',{artifactId:artifact.artifactId});
                continue;
              }
              const archivePath='artifacts/'+String(index).padStart(4,'0')+'.'+(artifact.kind==='markdown' ? 'md' : artifact.kind);
              await write(archivePath,bytes,true);artifact.archivePath=archivePath;
            }
            const state=warnings.length ? 'partial' : 'complete';
            const manifest={...runRecord,kind:'mathsemble-material-archive',state,
              scope:'captured-inputs-and-observed-resources',files,warnings};
            // Completion is only committed by the last, create-only manifest write.
            writing=true;await createFile(folder+'/manifest.json',json(manifest));writing=false;
            result.archive={state,path:folder,manifestPath:folder+'/manifest.json'};
          } catch (archiveError) {
            result.archive={state:writing ? 'unverified' : 'failed',path:folder,error:errorInfo(archiveError)};
            warn('ARCHIVE_WRITE_FAILED',{error:errorInfo(archiveError)});
          }
        }
        try {
          await ensureFolder(recordsRoot);
          if (vault.getAbstractFileByPath(result.record.path)) throw failure('ARCHIVE_PATH_CONFLICT','导出记录已存在，未覆盖');
          try {await createFile(result.record.path,json({...runRecord,archive:result.archive,warnings}));}
          catch (writeError) {result.record.state='unverified';throw writeError;}
          result.record.state='saved';
        } catch (recordError) {
          if (result.record.state!=='unverified') result.record.state='failed';
          result.record.error=errorInfo(recordError);
          warn('RECORD_WRITE_FAILED',{error:errorInfo(recordError)});
        }
        artifactBytes.clear();readBlob=null;
        return plain(result);
      })();
      return finalPromise;
    }
    return Object.freeze({id,recordArtifact,setResources,finalize});
  }
  return Object.freeze({beginRun});
}

module.exports = {createExportArchiveService};
