'use strict';

// One preview's immutable resource bytes. Host I/O is injected. In particular,
// importing this module or constructing an empty session requires no Node API.
let nodeBuffer, nodeCrypto;
const BufferType = () => nodeBuffer || (nodeBuffer = require('node:buffer').Buffer);
const digest = value => (nodeCrypto || (nodeCrypto = require('node:crypto')))
  .createHash('sha256').update(value).digest('hex');
const DEFAULT_LIMIT = 64 * 1024 * 1024;
const KINDS = new Set(['image', 'font', 'other']);
const PROTOCOLS = new Set(['http:', 'https:', 'app:', 'capacitor:', 'file:', 'blob:', 'data:']);

function failure(code, message, name = 'Error') {
  return Object.assign(new Error(message), {name, code});
}
const cancelled = () => failure('RESOURCE_ABORTED', '资源操作已取消', 'AbortError');
const disposedError = () => failure('RESOURCE_SESSION_DISPOSED', '媒体会话已结束', 'AbortError');
function checkSignal(signal) { if (signal?.aborted) throw cancelled(); }
function kindOf(kind = 'image') {
  if (!KINDS.has(kind)) throw new TypeError('资源用途必须为 image、font 或 other');
  return kind;
}
function resolveUrl(url, base = 'file:///') {
  if (typeof url !== 'string' || !url.trim() || /[\x00-\x1f\x7f]/.test(url))
    throw failure('RESOURCE_URL_INVALID', '资源 URL 无效');
  let parsed;
  try { parsed = new URL(url, base); }
  catch (_) { throw failure('RESOURCE_URL_INVALID', '资源 URL 或基址无效'); }
  return parsed;
}

// Never expose a data URI, URL credentials, query, or fragment in evidence.
function safeResourceUrl(url, base = 'file:///') {
  let parsed;
  try { parsed = resolveUrl(url, base); } catch (_) { return '[invalid resource URL]'; }
  if (parsed.protocol === 'data:') return undefined;
  if (parsed.protocol === 'blob:') {
    const inner = safeResourceUrl(parsed.pathname);
    return inner ? 'blob:' + inner : '[inline resource]';
  }
  if (!PROTOCOLS.has(parsed.protocol)) return '[unsupported resource URL]';
  parsed.username = ''; parsed.password = ''; parsed.search = ''; parsed.hash = '';
  return parsed.href;
}
function localPathOf(value) {
  if (value == null) return null;
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      /[\\:\x00-\x1f\x7f]/.test(value) || value.startsWith('/') ||
      value.split('/').some(part => !part || part === '.' || part === '..'))
    throw failure('RESOURCE_LOCAL_PATH_INVALID', '资源路径必须为规范 Vault 相对路径');
  return value;
}
function mediaType(header, allowBase64 = false) {
  if (typeof header !== 'string' || /[\x00-\x1f\x7f,]/.test(header))
    throw failure('RESOURCE_DATA_INVALID', '资源媒体类型无效');
  const parts = header.split(';').map(part => part.trim());
  const mime = (parts.shift() || 'text/plain').toLowerCase();
  if (!/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/.test(mime))
    throw failure('RESOURCE_DATA_INVALID', '资源 MIME 无效');
  let base64 = false;
  const parameters = [];
  for (const part of parts) {
    if (allowBase64 && part.toLowerCase() === 'base64' && !base64) { base64 = true; continue; }
    if (!/^[\w!#$&^.+-]+=(?:[^\s";]+|"[^";]*")$/.test(part))
      throw failure('RESOURCE_DATA_INVALID', '资源媒体参数无效');
    parameters.push(part);
  }
  return {mime, mediaType: [mime, ...parameters].join(';'), base64};
}
function bytesOf(raw) {
  if (!(raw instanceof Uint8Array))
    throw failure('RESOURCE_BYTES_INVALID', '资源读取必须返回 Uint8Array');
  return BufferType().from(raw); // The caller's mutable array is never retained.
}
function nonemptyWithinLimit(bytes, limit) {
  if (!bytes.length) throw failure('RESOURCE_EMPTY', '资源为空');
  if (bytes.length > limit) throw failure('RESOURCE_BUDGET_EXCEEDED', '媒体冻结字节预算不足');
}
function parseDataUri(value, limit) {
  if (typeof value !== 'string' || !/^data:/i.test(value))
    throw failure('RESOURCE_DATA_INVALID', '资源读取没有返回 data URI');
  // A literal # starts the URI fragment; it is not a payload byte. The DOM
  // adapter retains any SVG fragment selector separately from captured bytes.
  const fragment = value.indexOf('#'), data = fragment < 0 ? value : value.slice(0, fragment);
  const comma = data.indexOf(',');
  if (comma < 5) throw failure('RESOURCE_DATA_INVALID', 'data URI 缺少媒体与内容分隔');
  const type = mediaType(data.slice(5, comma), true), payload = data.slice(comma + 1);
  const B = BufferType();
  let bytes;
  if (type.base64) {
    const encoded = payload.replace(/[\t\r\n ]/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1 ||
        encoded.includes('=') && encoded.length % 4 !== 0)
      throw failure('RESOURCE_DATA_INVALID', 'data URI 的 base64 编码无效');
    if (Math.floor(encoded.replace(/=+$/, '').length * 3 / 4) > limit)
      throw failure('RESOURCE_BUDGET_EXCEEDED', '媒体冻结字节预算不足');
    bytes = B.from(encoded, 'base64');
    if (bytes.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, ''))
      throw failure('RESOURCE_DATA_INVALID', 'data URI 的 base64 编码不完整');
  } else {
    // A single bounded buffer avoids one allocation per %-encoded byte.
    const output = B.alloc(Math.min(B.byteLength(payload, 'utf8'), limit + 1));
    let cursor = 0, length = 0;
    const pushText = text => {
      const size = B.byteLength(text, 'utf8');
      if (length + size > limit) throw failure('RESOURCE_BUDGET_EXCEEDED', '媒体冻结字节预算不足');
      output.write(text, length, size, 'utf8');length += size;
    };
    for (let i = 0; i < payload.length; i++) {
      if (payload[i] !== '%') continue;
      if (!/^[a-f\d]{2}$/i.test(payload.slice(i + 1, i + 3)))
        throw failure('RESOURCE_DATA_INVALID', 'data URI 的百分号编码无效');
      if (i > cursor) pushText(payload.slice(cursor, i));
      if (length >= limit) throw failure('RESOURCE_BUDGET_EXCEEDED', '媒体冻结字节预算不足');
      output[length++] = parseInt(payload.slice(i + 1, i + 3), 16);
      i += 2; cursor = i + 1;
    }
    if (cursor < payload.length) pushText(payload.slice(cursor));
    bytes = output.subarray(0, length);
  }
  nonemptyWithinLimit(bytes, limit);
  return {bytes, mime:type.mime, mediaType:type.mediaType};
}
function svgHasExternalReferences(bytes) {
  const text = bytes.toString('utf8');
  const external = raw => {
    const value = raw.trim();
    return value !== '' && !value.startsWith('#') && !/^data:/i.test(value);
  };
  for (const match of text.matchAll(/\b(?:xlink:)?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi))
    if (external(match[1] ?? match[2] ?? match[3])) return true;
  for (const match of text.matchAll(/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi))
    if (external(match[1] ?? match[2] ?? match[3])) return true;
  for (const match of text.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi))
    if (external(match[1] ?? match[2])) return true;
  return /<!DOCTYPE[\s\S]*?\b(?:SYSTEM|PUBLIC)\s+["']/i.test(text);
}
function sanitizedReason(reason, resolvedUrl, localPath) {
  let text = String(reason ?? '');
  // Avoid serializing arbitrary data URI payloads embedded in an error message.
  text = text.replace(/data:[\s\S]*/gi, '[inline resource]');
  text = text.replace(/(?:[a-z][a-z\d+.-]*:\/\/|blob:)[^\s<>"']+/gi,
    match => localPath && match === resolvedUrl ? localPath : safeResourceUrl(match) || '[inline resource]');
  try {
    const parsed = new URL(resolvedUrl);
    const secrets = [parsed.username, parsed.password, ...parsed.searchParams.values()];
    for (const secret of secrets.filter(Boolean)) {
      for (const spelling of new Set([secret, (() => {try{return decodeURIComponent(secret);}catch(_){return secret;}})()]))
        text = text.split(spelling).join('[redacted]');
    }
  } catch (_) {}
  text = text.replace(/\b(?:password|passwd|token|api[_-]?key|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, '[redacted]');
  return text.replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 400);
}

function createResourceSession(options = {}) {
  const {reader, resolveLocal = () => null, readLocal, mimeForLocal = () => 'application/octet-stream',
    maxBytes = DEFAULT_LIMIT} = options;
  if (reader !== undefined && typeof reader !== 'function' || typeof resolveLocal !== 'function' ||
      readLocal !== undefined && typeof readLocal !== 'function' || typeof mimeForLocal !== 'function')
    throw new TypeError('资源会话读取适配器无效');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new TypeError('媒体字节预算必须为非负安全整数');
  const resources = new Map(), blobs = new Map(), inflight = new Map(), localInflight = new Map();
  const localSources = new Map(), omissions = new Map(), warnings = new Map();
  let bytesUsed = 0, disposed = false, localRevision = 0, controller;
  const check = signal => { if (disposed) throw disposedError(); checkSignal(signal); };
  const sessionSignal = () => {
    if (!controller) controller = new AbortController();
    return controller.signal;
  };
  const identity = (url, base) => {
    const parsed = resolveUrl(url, base);
    if (!PROTOCOLS.has(parsed.protocol)) throw failure('RESOURCE_PROTOCOL_UNSUPPORTED', '不支持的资源协议');
    return parsed.href;
  };
  const resolvePath = url => localPathOf(resolveLocal(url));
  const publicIdentity = (url, localPath) => ({urlSha256:digest(url),
    ...(localPath ? {localPath} : (() => {const displayUrl = safeResourceUrl(url);return displayUrl ? {displayUrl} : {};})())});
  const warn = (code, resource) => warnings.set(code + ':' + resource.urlSha256, {code, urlSha256:resource.urlSha256});
  const clearReadOmissions = url => {
    for (const [id, omission] of omissions) if (omission.url === url && omission.value.stage === 'read') omissions.delete(id);
  };
  function join(promise, signal) {
    check(signal);
    const life = sessionSignal();
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, value) => {
        if (done) return; done = true;
        signal?.removeEventListener('abort', onAbort); life.removeEventListener('abort', onDispose);
        error ? reject(error) : resolve(value);
      };
      const onAbort = () => finish(cancelled()), onDispose = () => finish(disposedError());
      signal?.addEventListener('abort', onAbort, {once:true}); life.addEventListener('abort', onDispose, {once:true});
      if (signal?.aborted) onAbort(); else if (life.aborted) onDispose();
      Promise.resolve(promise).then(value => {
        try {check(signal);finish(null,value);} catch (error) {finish(error);}
      }, error => finish(error));
    });
  }
  function commit(url, candidate, kind) {
    check();
    const hash = digest(candidate.bytes), previous = resources.get(url);
    if (previous) {
      if (previous.value.sha256 !== hash || previous.mediaType !== candidate.mediaType)
        throw failure('RESOURCE_CAPTURE_CONFLICT', '同一资源 URL 已冻结为不同内容');
      previous.kinds.add(kind);clearReadOmissions(url);return previous;
    }
    const original = candidate.localPath && localSources.get(candidate.localPath);
    if (original && (original.blobId !== hash || original.mediaType !== candidate.mediaType))
      throw failure('RESOURCE_CAPTURE_CONFLICT', '同一本地资源已冻结为不同内容');
    nonemptyWithinLimit(candidate.bytes, maxBytes);
    if (!blobs.has(hash) && bytesUsed + candidate.bytes.length > maxBytes)
      throw failure('RESOURCE_BUDGET_EXCEEDED', '媒体冻结字节预算不足');
    const value = {...publicIdentity(url,candidate.localPath), blobId:hash, sha256:hash,
      mime:candidate.mime, ...(candidate.mediaType !== candidate.mime ? {mediaType:candidate.mediaType} : {}),
      bytes:candidate.bytes.length, representation:candidate.representation};
    const dataURI = 'data:' + candidate.mediaType + ';base64,' + candidate.bytes.toString('base64');
    const entry = {value, mediaType:candidate.mediaType, dataURI, kinds:new Set([kind])};
    if (!blobs.has(hash)) {blobs.set(hash, BufferType().from(candidate.bytes));bytesUsed += candidate.bytes.length;}
    resources.set(url, entry);
    if (candidate.localPath && !original) {
      localSources.set(candidate.localPath,{blobId:hash, mime:candidate.mime, mediaType:candidate.mediaType});
      localRevision++;
    }
    if (candidate.mime === 'image/svg+xml' && svgHasExternalReferences(candidate.bytes)) warn('SVG_EXTERNAL_REFERENCE',value);
    if (!candidate.localPath && new URL(url).protocol === 'file:') warn('EXTERNAL_FILE_NOT_VERIFIED',value);
    clearReadOmissions(url);return entry;
  }
  async function localCandidate(localPath) {
    const original = localSources.get(localPath);
    if (original) return {bytes:blobs.get(original.blobId),mime:original.mime,mediaType:original.mediaType,
      localPath,representation:'original'};
    if (!readLocal) throw failure('RESOURCE_READER_MISSING', '缺少本地资源读取器');
    let pending = localInflight.get(localPath);
    if (!pending) {
      pending = Promise.resolve().then(async () => {
        check();
        const raw = await readLocal(localPath, {signal:sessionSignal()});check();
        if (!(raw instanceof Uint8Array)) throw failure('RESOURCE_BYTES_INVALID', '资源读取必须返回 Uint8Array');
        nonemptyWithinLimit(raw,maxBytes);
        const bytes = bytesOf(raw);
        const type = mediaType(mimeForLocal(localPath));
        return {bytes,mime:type.mime,mediaType:type.mediaType,localPath,representation:'original'};
      });
      localInflight.set(localPath,pending);
      const release = () => {if(localInflight.get(localPath)===pending)localInflight.delete(localPath);};
      pending.then(release,release);
    }
    return pending;
  }
  async function captureUrl(url, kind) {
    check();
    if (new URL(url).protocol === 'data:') return commit(url,{...parseDataUri(url,maxBytes),representation:'original'},kind);
    const localPath = resolvePath(url);
    if (localPath) return commit(url,await localCandidate(localPath),kind);
    if (!reader) throw failure('RESOURCE_READER_MISSING', '缺少资源读取器');
    const data = await reader(url, 'file:///', {signal:sessionSignal()});check();
    return commit(url,{...parseDataUri(data,maxBytes),representation:'captured-response'},kind);
  }
  async function read(url, base = 'file:///', {signal, kind = 'image'} = {}) {
    check(signal);kind = kindOf(kind);const key = identity(url,base);
    const existing = resources.get(key);
    if (existing) {existing.kinds.add(kind);clearReadOmissions(key);return existing.dataURI;}
    let pending = inflight.get(key);
    if (!pending) {
      pending = Promise.resolve().then(() => captureUrl(key,kind));inflight.set(key,pending);
      const release = () => {if(inflight.get(key)===pending)inflight.delete(key);};
      pending.then(release,release);
    }
    const entry = await join(pending,signal);check(signal);entry.kinds.add(kind);return entry.dataURI;
  }
  async function record(dataURI, url, {base = 'file:///', signal, kind = 'image'} = {}) {
    check(signal);kind = kindOf(kind);const key = identity(url,base),candidate = parseDataUri(dataURI,maxBytes);
    const localPath = new URL(key).protocol === 'data:' ? null : resolvePath(key);
    if (localPath) await read(key, 'file:///', {signal,kind});
    else if (inflight.has(key)) {
      try {await join(inflight.get(key),signal);} catch (error) {check(signal);}
    }
    check(signal);
    return commit(key,{...candidate,localPath,representation:localPath || new URL(key).protocol==='data:' ? 'original' : 'captured-response'},kind).dataURI;
  }
  function recordOmission({url, base = 'file:///', kind = 'image', stage = 'render',
    reasonCode = 'RESOURCE_UNAVAILABLE', reason = ''} = {}) {
    check();kind = kindOf(kind);
    if (!['read','render'].includes(stage) || typeof reasonCode !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(reasonCode))
      throw new TypeError('资源遗漏阶段或原因代码无效');
    // Unsupported schemes can still be reported safely as rejected resources.
    const key = resolveUrl(url,base).href;
    const localPath = PROTOCOLS.has(new URL(key).protocol) && new URL(key).protocol!=='data:' ? resolvePath(key) : null;
    const omissionId = digest(key+'\0'+kind+'\0'+stage+'\0'+reasonCode);
    omissions.set(omissionId,{url:key,value:{omissionId,...publicIdentity(key,localPath),kind,stage,reasonCode,
      reason:sanitizedReason(reason,key,localPath)}});
    return omissionId;
  }
  function manifest() {
    check();
    return {schemaVersion:1,bytesUsed,maxBytes,
      resources:[...resources.values()].map(entry=>({...entry.value,kinds:[...entry.kinds].sort()})).sort((a,b)=>a.urlSha256.localeCompare(b.urlSha256)),
      omissions:[...omissions.values()].map(entry=>({...entry.value})).sort((a,b)=>a.omissionId.localeCompare(b.omissionId)),
      warnings:[...warnings.values()].map(value=>({...value})).sort((a,b)=>(a.urlSha256+a.code).localeCompare(b.urlSha256+b.code))};
  }
  function readBlob(blobId) {
    check();const bytes = blobs.get(blobId);
    if (!bytes) throw failure('RESOURCE_BLOB_MISSING', '媒体字节不存在');
    return new Uint8Array(bytes);
  }
  async function assertLocalCurrent(signal) {
    check(signal);const revision = localRevision;
    for (const [localPath, original] of [...localSources]) {
      check(signal);
      const bytes = await join(Promise.resolve().then(()=>readLocal(localPath,{signal:sessionSignal()})),signal);
      check(signal);
      if (digest(bytesOf(bytes)) !== original.blobId)
        throw failure('RESOURCE_LOCAL_CHANGED', '本地媒体内容已变化：'+localPath);
    }
    check(signal);
    if (revision !== localRevision) throw failure('RESOURCE_SET_CHANGED', '复核期间媒体集合已变化，请重试');
    return true;
  }
  function snapshot() {
    check();return {manifest:manifest(),blobs:[...blobs.keys()].sort().map(blobId=>({blobId,bytes:readBlob(blobId)}))};
  }
  function dispose() {
    if (disposed) return;disposed = true;controller?.abort(disposedError());
    resources.clear();blobs.clear();inflight.clear();localInflight.clear();localSources.clear();omissions.clear();warnings.clear();bytesUsed=0;
  }
  return Object.freeze({read,record,capture:record,recordOmission,manifest,readBlob,assertLocalCurrent,snapshot,dispose});
}

module.exports = {createResourceSession, safeResourceUrl};
