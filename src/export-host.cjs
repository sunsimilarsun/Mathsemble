'use strict';

// Host adapters keep Vault I/O and DOM ownership out of the immutable resource
// store. Original Markdown is never read here: callers supply captured sources.
function createMediaSession({vault, reader, mimeFor, createResourceSession, timeoutMs = 15000}) {
  const root = vault.adapter?.basePath || vault.adapter?.getBasePath?.();
  let canonicalRoot;
  const resolveLocal = address => {
    if (!root || !/^(?:app|file|capacitor):/i.test(address)) return null;
    try {
      const fs = require('fs'), path = require('path'), url = new URL(address);
      const decoded = url.protocol === 'file:' ? require('url').fileURLToPath(url)
        : decodeURIComponent(url.pathname).replace(/^\/(?=[A-Za-z]:\/)/, '');
      canonicalRoot ||= fs.realpathSync(root);
      const resolved = fs.realpathSync(decoded);
      const relative = path.relative(canonicalRoot,resolved);
      if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..'+path.sep)) return null;
      return relative.replace(/\\/g,'/');
    } catch (_) { return null; }
  };
  const readLocal = async (path,{signal}={}) => {
    if (signal?.aborted) throw signal.reason || new Error('资源读取已取消');
    const file = vault.getAbstractFileByPath(path);
    if (!file || file.extension === undefined) throw new Error('本地资源不存在：'+path);
    const bytes = await new Promise((resolve,reject) => {
      const aborted = () => done(signal.reason || new Error('资源读取已取消'));
      const done = (error,value) => { clearTimeout(timer); signal?.removeEventListener('abort',aborted); error ? reject(error) : resolve(value); };
      const timer = setTimeout(()=>{const error=new Error('本地资源读取超时');error.name='TimeoutError';error.code='RESOURCE_TIMEOUT';done(error);},timeoutMs);
      signal?.addEventListener('abort',aborted,{once:true});
      if (signal?.aborted) { aborted(); return; }
      Promise.resolve().then(()=>vault.readBinary(file)).then(value=>done(null,value),done);
    });
    if (signal?.aborted) throw signal.reason || new Error('资源读取已取消');
    return new Uint8Array(bytes);
  };
  return createResourceSession({reader,resolveLocal,readLocal,mimeForLocal:mimeFor});
}

function omissionAddress(value, base) {
  try { return new URL(value,base).href; }
  catch (_) {
    // The manifest hashes data URLs without displaying their contents.
    return 'data:text/plain,' + new URLSearchParams({target:value}).toString();
  }
}

async function freezeMediaDom(session, root, {signal, nodes = new WeakMap()} = {}) {
  const warnings = [];
  let changed = false;
  for (const node of root.querySelectorAll('img,svg image[href],svg image[xlink\\:href]')) {
    if (signal?.aborted) throw signal.reason || new Error('资源读取已取消');
    const attr = node.localName === 'img' ? 'src' : node.hasAttribute('href') ? 'href' : 'xlink:href';
    const raw = node.getAttribute(attr);
    const sources = attr === 'src' && node.parentElement?.localName === 'picture'
      ? Array.from(node.parentElement.children).filter(child => child.localName === 'source' && child.hasAttribute('srcset'))
      : [];
    const responsive = node.hasAttribute('srcset') || sources.length > 0;
    if (!responsive && (!raw || raw[0] === '#' || nodes.get(node)?.value === raw)) continue;
    // currentSrc becomes available during render settling. Freezing the
    // fallback earlier would permanently override the browser's selection.
    if (responsive && !node.currentSrc) continue;
    const url = attr === 'src' && node.currentSrc ? node.currentSrc : raw;
    try {
      let value = await session.read(url, root.ownerDocument.baseURI, {signal,kind:'image'});
      // A fragment selects an SVG view; it is not part of the captured bytes.
      if (/^data:image\/svg\+xml[;,]/i.test(value))
        value += new URL(url,root.ownerDocument.baseURI).hash;
      node.setAttribute(attr,value);
      if (attr === 'src') {
        node.removeAttribute('srcset');
        for (const source of sources) source.removeAttribute('srcset');
      }
      nodes.set(node,{value}); changed = true;
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || /BUDGET|DISPOSED/.test(error?.code || '')) throw error;
      // Existing partial-export consent remains necessary. A loaded but
      // uncaptured image must not silently claim a reproducible export.
      warnings.push('图片资源未能固定，输出可能不完整：'+String(node.getAttribute('alt') || '图片').slice(0,80));
      session.recordOmission({url:omissionAddress(url,root.ownerDocument.baseURI),kind:'image',stage:'read',reasonCode:'RESOURCE_UNAVAILABLE'});
    }
  }
  return {changed,warnings:[...new Set(warnings)]};
}

function previewEvidence(preview, collectMediaDependencies) {
  if (preview.assemblyPreview?.getEvidence) return preview.assemblyPreview.getEvidence();
  const records = preview.sourceSnapshot?.entries?.map(entry=>entry.record)
    || (preview.exam ? preview.exam.items : [{file:preview.file,markdown:preview.markdown}]);
  const sources = records.map(record=>({path:record.file.path,markdown:record.markdown,
    ...(typeof record.metadata?.id === 'string' && record.metadata.id ? {sourceId:record.metadata.id} : {})}));
  const noteEmbeds = new Set((preview.sourceSnapshot?.embeddedLinks || [])
    .map(link => JSON.stringify([link.sourcePath,link.syntax || 'wiki-embed',link.target])));
  const declaredDependencies = sources.flatMap(source => {
    const result = collectMediaDependencies(source.markdown,source.path);
    return result.dependencies.filter(item => !noteEmbeds.has(JSON.stringify([source.path,item.syntax,item.target])));
  });
  return {sources,declaredDependencies};
}

async function captureDeclaredMedia(session, declarations, app, signal) {
  for (const item of declarations || []) {
    if (signal?.aborted) throw signal.reason || new Error('资源归档已取消');
    const target = item.target || item.rawTarget;
    const sourcePath = item.sourcePath || '';
    let url = target;
    try {
      if (item.status === 'unsupported') throw new Error('嵌入资源类型不受支持');
      if (typeof target !== 'string' || !target) throw new Error('媒体目标为空');
      if (!/^(?:https?:|data:|app:|file:|blob:|capacitor:)/i.test(target)) {
        const link = target.split('#')[0];
        const file = app.metadataCache.getFirstLinkpathDest(link,sourcePath);
        if (!file || !/^(?:png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i.test(file.extension || ''))
          throw new Error('嵌入目标缺失或不是支持的图片');
        url = app.vault.getResourcePath(file);
      }
      await session.read(url, 'file:///', {signal,kind:'image'});
    } catch (error) {
      if (signal?.aborted || error?.name === 'AbortError' || /BUDGET|DISPOSED/.test(error?.code || '')) throw error;
      session.recordOmission({url:omissionAddress(url || sourcePath,'file:///'),kind:'image',stage:'render',
        reasonCode:'DECLARED_MEDIA_UNAVAILABLE',reason:'原文中的嵌入资源未能归档'});
    }
  }
}

function runtimeEvidence(app,plugin) {
  const result = {pluginVersion:plugin.manifest?.version || 'unknown'};
  try {
    result.obsidianApiVersion = require('obsidian').apiVersion;
    if (typeof process !== 'undefined') { result.platform = process.platform; result.versions = {...process.versions}; }
    const base = app.vault.adapter.basePath || app.vault.adapter.getBasePath();
    const bytes = require('fs').readFileSync(require('path').join(base,plugin.manifest.dir,'main.js'));
    result.bundleSha256 = require('crypto').createHash('sha256').update(bytes).digest('hex');
  } catch (_) { /* API-only hosts may not expose installation files. */ }
  return JSON.parse(JSON.stringify(result));
}

module.exports = {createMediaSession,freezeMediaDom,previewEvidence,captureDeclaredMedia,runtimeEvidence};
