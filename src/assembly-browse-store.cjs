'use strict';

// Keep private browse data in the desktop web profile, scoped to this vault.
// Group rows so updating one note writes a small part of the index in one transaction.
const BUCKETS = 64, HEADER = -1;
function bucketOf(path) {
  let hash = 0;
  for (let i = 0; i < path.length; i++) hash = Math.imul(hash,31) + path.charCodeAt(i);
  return hash & (BUCKETS - 1);
}
function sameRow(a,b) {
  return a && a.mtime === b.mtime && a.ctime === b.ctime && a.size === b.size && a.record === b.record;
}

module.exports = function createBrowseStore(vaultPath, factory) {
  if (!vaultPath || !globalThis.crypto?.subtle) return null;
  try {factory ??= globalThis.indexedDB;} catch {return null;}
  if (!factory) return null;
  let databaseName, revision, previous = new Map(), queue = Promise.resolve();
  async function open() {
    if (!databaseName) {
      const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(vaultPath));
      databaseName = 'mathsemble-browse-' + Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    }
    return new Promise((resolve,reject) => {
      const request = factory.open(databaseName,1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore('snapshot');
      request.onblocked = () => { blocked = true; reject(new Error('本机索引正被其他窗口使用')); };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (blocked) db.close();
        else {db.onversionchange = () => db.close(); resolve(db);}
      };
    });
  }
  async function transaction(mode,operation) {
    const db = await open();
    try {
      return await new Promise((resolve,reject) => {
        const tx = db.transaction('snapshot',mode);
        let result, failure;
        tx.oncomplete = () => resolve(result);
        tx.onabort = () => reject(failure || tx.error || new Error('本机索引操作中断'));
        // IndexedDB must receive all dependent writes while the transaction is active.
        const request = operation(tx.objectStore('snapshot'));
        request.read.onsuccess = () => {
          try {result = request.finish(request.read.result);}
          catch (error) {failure = error; tx.abort();}
        };
      });
    } finally {db.close();}
  }
  function ordered(operation) {
    const result = queue.then(operation);
    queue = result.catch(()=>{});
    return result;
  }
  function load() {
    return ordered(async () => {
      const snapshot = await transaction('readonly',store => ({
        read:store.getAll(),
        finish(values) {
          const [meta,...buckets] = values;
          if (!meta?.revision || !buckets.every(Array.isArray)) return null;
          const entries = buckets.flat();
          if (entries.length !== meta.count || !entries.every(row=>typeof row?.path === 'string')) return null;
          return {meta,entries};
        }
      }));
      revision = snapshot?.meta.revision;
      previous = new Map(snapshot?.entries.map(row=>[row.path,row]));
      return snapshot ? {...snapshot.meta.header,entries:snapshot.entries} : null;
    });
  }
  function save(snapshot) {
    return ordered(async () => {
      const {entries,...header} = snapshot;
      const buckets = Array.from({length:BUCKETS},()=>[]), changed = new Set(), next = new Map();
      for (const row of entries) {
        const bucket = bucketOf(row.path);
        buckets[bucket].push(row); next.set(row.path,row);
        if (!sameRow(previous.get(row.path),row)) changed.add(bucket);
      }
      for (const path of previous.keys()) if (!next.has(path)) changed.add(bucketOf(path));
      const nextRevision = crypto.randomUUID();
      await transaction('readwrite',store => ({
        read:store.get(HEADER),
        finish(meta) {
          // Another window may have published a different generation since our last read.
          if (!revision || revision !== meta?.revision) {
            store.clear();
            for (let i = 0; i < BUCKETS; i++) if (buckets[i].length) store.put(buckets[i],i);
          } else {
            for (const i of changed) {
              if (buckets[i].length) store.put(buckets[i],i);
              else store.delete(i);
            }
          }
          store.put({header,count:entries.length,revision:nextRevision},HEADER);
        }
      }));
      previous = next; revision = nextRevision;
    });
  }
  function clear() {
    return ordered(async () => {
      await transaction('readwrite',store=>({read:store.clear(),finish:()=>{}}));
      previous.clear(); revision = undefined;
    });
  }
  return {load,save,clear};
};
