'use strict';

// Pure, host-independent assembly logic. The source notes are never mutated.
const MAX_ENTRIES = 1000;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ROLES = Object.freeze({example:'例题', '例题':'例题', variant:'变式', '变式':'变式',
  practice:'训练', problem:'训练', '训练':'训练', '练习':'训练'});
const text = value => typeof value === 'string' ? value.trim() : '';
const fold = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().trim();
const list = value => [...new Set((Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
  .map(text).filter(Boolean))];
const normalizeRole = value => Object.hasOwn(ROLES,fold(value)) ? ROLES[fold(value)] : text(value);
const basename = path => path.split('/').pop().replace(/\.md$/i, '');

function normalizePath(path) {
  const parts = [];
  for (const part of String(path).replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') { if (!parts.length) return ''; parts.pop(); }
    else parts.push(part);
  }
  return parts.join('/');
}

function fingerprint(value) {
  // A content-change hint, not a cryptographic identity or integrity check.
  let a = 2166136261, b = 2246822507;
  for (let i = 0; i < String(value).length; i++) {
    const code = String(value).charCodeAt(i);
    a = Math.imul(a ^ code, 16777619);
    b = Math.imul(b ^ code, 3266489909);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

function parseKnowledgeRef(raw) {
  const value = text(raw), wiki = value.match(/^\[\[([\s\S]+)\]\]$/);
  const body = wiki ? wiki[1] : value;
  const pipe = body.indexOf('|');
  const target = (pipe < 0 ? body : body.slice(0, pipe)).split('#')[0].trim();
  return {raw:value, target, label:(pipe < 0 ? target : body.slice(pipe + 1).trim()) || target,
    wiki:!!wiki};
}

function knowledgeCandidates(reference, sourcePath, nodes) {
  const target = reference.target.replace(/\.md$/i, '');
  const exactId = nodes.filter(node => node.id && node.id === target);
  if (exactId.length) return exactId;
  if (target.includes('/')) {
    const dirname = sourcePath.split('/').slice(0, -1).join('/');
    const paths = [normalizePath(target), normalizePath(dirname + '/' + target)].filter(Boolean);
    return nodes.filter(node => paths.includes(node.path.replace(/\.md$/i, '')));
  }
  return nodes.filter(node => [basename(node.path), node.title, ...node.aliases].some(name => fold(name) === fold(target)));
}

function buildIndex(records) {
  if (!Array.isArray(records)) throw new TypeError('索引输入必须为列表');
  const items = [], issues = [], paths = new Set(), ids = new Map();
  for (const record of records) {
    if (!record || !['question','knowledge'].includes(record.kind) || typeof record.markdown !== 'string' ||
      !text(record.path) || !/\.md$/i.test(record.path)) {
      issues.push({code:'invalid-record',message:'忽略无效的知识或题卡记录',path:text(record?.path)});
      continue;
    }
    const path = normalizePath(record.path);
    if (!path || paths.has(path)) {
      issues.push({code:'duplicate-path',message:'同一路径重复收录',path}); continue;
    }
    paths.add(path);
    const metadata = record.metadata && typeof record.metadata === 'object' && !Array.isArray(record.metadata)
      ? {...record.metadata} : {};
    const id = text(metadata.id);
    const item = {key:'path:' + path, id, path, kind:record.kind,
      title:text(metadata.title) || basename(path), markdown:record.markdown, metadata,
      aliases:list(metadata.aliases), knowledgeNodes:list(metadata.knowledge_nodes),
      subject:text(metadata.subject), questionType:text(metadata.question_type || metadata.type),
      difficulty:metadata.difficulty !== null && metadata.difficulty !== '' &&
        Number.isInteger(Number(metadata.difficulty)) && Number(metadata.difficulty) >= 1 && Number(metadata.difficulty) <= 5
        ? Number(metadata.difficulty) : null,
      tier:text(metadata.teaching_tier || metadata.level), role:normalizeRole(metadata.role || metadata.teaching_role),
      methods:list(metadata.methods), source:text(metadata.source), fingerprint:fingerprint(record.markdown)};
    items.push(item);
    if (id) { if (!ids.has(id)) ids.set(id, []); ids.get(id).push(item); }
  }
  for (const [id, matches] of ids) {
    if (matches.length === 1) matches[0].key = 'id:' + id;
    else {
      for (const item of matches) item.identityConflict = true;
      issues.push({code:'duplicate-id',message:`ID ${id} 对应多个文件，请先处理冲突`,id,paths:matches.map(item => item.path)});
    }
  }
  const nodes = items.filter(item => item.kind === 'knowledge');
  for (const item of items) {
    item.knowledgeRefs = item.knowledgeNodes.map(raw => {
      const ref = parseKnowledgeRef(raw), candidates = knowledgeCandidates(ref, item.path, nodes);
      const status = candidates.length > 1 || candidates[0]?.identityConflict ? 'ambiguous' :
        candidates.length === 1 ? 'resolved' : ref.wiki ? 'missing' : 'tag';
      return {...ref, status, ...(status === 'resolved' ? {nodeKey:candidates[0].key} : {}),
        ...(status === 'ambiguous' ? {candidates:candidates.map(node => node.key)} : {})};
    });
  }
  return {items, issues};
}

function filterItems(index, filters = {}) {
  const items = Array.isArray(index?.items) ? index.items : [];
  const nodes = items.filter(item => item.kind === 'knowledge');
  const options = value => (Array.isArray(value) ? value : [value]).filter(value => value !== null && value !== undefined && String(value).trim() !== '' && value !== 'all');
  const match = (filter, values) => !options(filter).length || options(filter).some(want => values.some(value => fold(value) === fold(want)));
  return items.filter(item => {
    if (!match(filters.kind,[item.kind]) || !match(filters.subject,[item.subject]) ||
      !match(filters.questionType,[item.questionType]) || !match(filters.difficulty,[item.difficulty]) ||
      !match(filters.tier,[item.tier]) || !match(filters.role,[item.role]) ||
      !match(filters.method,item.methods.map(value => parseKnowledgeRef(value).target))) return false;
    if (options(filters.source).length && !options(filters.source).some(value => fold(item.source).includes(fold(value)))) return false;
    const keywords = fold(filters.query).split(/\s+/).filter(Boolean);
    const haystack = fold([item.title,item.id,item.path,item.markdown,...item.aliases,...item.knowledgeNodes,...item.methods,item.source].join('\n'));
    if (!keywords.every(word => haystack.includes(word))) return false;
    if (options(filters.knowledge).length && !options(filters.knowledge).some(value => {
      const ref = parseKnowledgeRef(String(value));
      const selected = nodes.filter(node => node.key === value || (node.id && node.id === value));
      const matches = selected.length ? selected : knowledgeCandidates(ref,'',nodes);
      if (matches.length === 1 && !matches[0].identityConflict) {
        return item.key === matches[0].key || item.knowledgeRefs.some(known => known.nodeKey === matches[0].key);
      }
      return item.knowledgeRefs.some(known => fold(known.target) === fold(ref.target));
    })) return false;
    return true;
  });
}

let sequence = 0;
function newEntryId() {
  return typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID() :
    'entry-' + Date.now().toString(36) + '-' + (++sequence).toString(36) + '-' + Math.random().toString(36).slice(2,10);
}

function safeObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${name} 必须为对象`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError(`${name} 不是普通对象`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (FORBIDDEN.has(key) || descriptor.get || descriptor.set) throw new TypeError(`${name} 含不允许的属性`);
  }
}
function boundedString(value, name, limit, allowEmpty = true) {
  if (typeof value !== 'string' || value.length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || (!allowEmpty && !value.trim())) {
    throw new TypeError(`${name} 无效`);
  }
  return value;
}
function validatePlan(raw) {
  safeObject(raw,'组题方案');
  const keys = new Set(['schemaVersion','title','entries']);
  if (Object.keys(raw).some(key => !keys.has(key))) throw new TypeError('组题方案含未知字段');
  if (raw.schemaVersion !== 1) throw new Error('不支持的组题方案版本');
  const title = boundedString(raw.title,'方案标题',500,false);
  if (!Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES) throw new Error(`组题方案最多 ${MAX_ENTRIES} 项`);
  if (Object.getPrototypeOf(raw.entries) !== Array.prototype ||
    Object.entries(Object.getOwnPropertyDescriptors(raw.entries)).some(([key, descriptor]) =>
      FORBIDDEN.has(key) || descriptor.get || descriptor.set || key !== 'length' && !/^\d+$/.test(key))) {
    throw new TypeError('编排列表含不允许的属性');
  }
  const entryIds = new Set(), sourceIds = new Set(), sourcePaths = new Set();
  const fields = new Set(['entryId','kind','sourceId','sourcePath','sourceFingerprint','title','role']);
  const entries = raw.entries.map(entry => {
    safeObject(entry,'编排项');
    if (Object.keys(entry).some(key => !fields.has(key))) throw new TypeError('编排项含未知字段');
    const entryId = boundedString(entry.entryId,'编排项 ID',512,false);
    if (entryIds.has(entryId)) throw new Error('编排项 ID 重复');
    entryIds.add(entryId);
    if (!['question','knowledge','section'].includes(entry.kind)) throw new TypeError('编排项类型无效');
    const result = {entryId,kind:entry.kind,
      sourceId:boundedString(entry.sourceId,'源 ID',512),
      sourcePath:boundedString(entry.sourcePath,'源路径',4096),
      sourceFingerprint:boundedString(entry.sourceFingerprint,'源指纹',128),
      title:boundedString(entry.title,'显示标题',500),role:boundedString(entry.role,'教学角色',50)};
    if (entry.kind === 'section') {
      if (result.sourceId || result.sourcePath || result.sourceFingerprint || result.role || !result.title.trim()) throw new Error('分区字段无效');
    } else {
      if (!result.sourcePath || normalizePath(result.sourcePath) !== result.sourcePath || !/\.md$/i.test(result.sourcePath)) throw new Error('源路径必须为库内 Markdown 路径');
      if (result.sourceId && sourceIds.has(result.sourceId) || sourcePaths.has(result.sourcePath)) throw new Error('同一来源重复加入方案');
      if (result.sourceId) sourceIds.add(result.sourceId);
      sourcePaths.add(result.sourcePath);
      if (entry.kind === 'knowledge' && result.role || result.role && !['例题','变式','训练'].includes(result.role)) throw new Error('教学角色无效');
    }
    return result;
  });
  return {schemaVersion:1,title,entries};
}
function createPlan(title = '新讲义') { return validatePlan({schemaVersion:1,title,entries:[]}); }
function addItem(plan, item) {
  const next = validatePlan(plan);
  if (!item || !['question','knowledge'].includes(item.kind) || item.identityConflict) throw new Error('来源无效或 ID 存在冲突，不能加入');
  const role = normalizeRole(item.role);
  next.entries.push({entryId:newEntryId(),kind:item.kind,sourceId:item.id || '',sourcePath:item.path,
    sourceFingerprint:item.fingerprint,title:item.title,
    role:item.kind === 'question' && ['例题','变式','训练'].includes(role) ? role : ''});
  return validatePlan(next);
}
function addSection(plan,title) {
  const next=validatePlan(plan);
  next.entries.push({entryId:newEntryId(),kind:'section',sourceId:'',sourcePath:'',sourceFingerprint:'',title,role:''});
  return validatePlan(next);
}
function removeEntry(plan,entryId) {
  const next=validatePlan(plan);
  if (!next.entries.some(entry => entry.entryId === entryId)) throw new Error('编排项不存在');
  next.entries=next.entries.filter(entry => entry.entryId !== entryId); return next;
}
function moveEntry(plan,entryId,targetIndex) {
  const next=validatePlan(plan), sourceIndex=next.entries.findIndex(entry => entry.entryId === entryId);
  if (sourceIndex < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= next.entries.length) throw new Error('编排移动位置无效');
  const [entry]=next.entries.splice(sourceIndex,1); next.entries.splice(targetIndex,0,entry); return next;
}
function updateEntry(plan,entryId,patch) {
  const next=validatePlan(plan); safeObject(patch,'编排修改');
  const allowed=new Set(['title','role','sourceId','sourcePath','sourceFingerprint']);
  if (Object.keys(patch).some(key => !allowed.has(key))) throw new Error('不允许修改此编排字段');
  const entry=next.entries.find(entry => entry.entryId === entryId);
  if (!entry) throw new Error('编排项不存在');
  Object.assign(entry,patch); return validatePlan(next);
}
function resolvePlan(plan,index) {
  const current=validatePlan(plan), items=Array.isArray(index?.items) ? index.items : [], issues=[];
  const entries=current.entries.map(entry => {
    if (entry.kind === 'section') return {entry,item:null,status:'ok'};
    const matches=items.filter(item => entry.sourceId ? item.id === entry.sourceId : item.path === entry.sourcePath);
    let status, item=matches.length === 1 ? matches[0] : null;
    if (matches.length > 1 || item?.identityConflict || item && (item.kind !== entry.kind || !entry.sourceId && item.id)) status='conflict';
    else if (!item) status='missing';
    else status=item.fingerprint === entry.sourceFingerprint ? 'ok' : 'changed';
    if (status !== 'ok') issues.push({code:status,entryId:entry.entryId,path:entry.sourcePath,
      message:status === 'missing' ? `来源已缺失：${entry.title}` : status === 'conflict' ? `来源身份冲突：${entry.title}` : `来源已更新：${entry.title}`});
    return {entry,item,status};
  });
  return {entries,issues};
}

module.exports={buildIndex,filterItems,createPlan,addItem,addSection,removeEntry,moveEntry,updateEntry,
  resolvePlan,validatePlan,normalizeRole,parseKnowledgeRef,fingerprint};
