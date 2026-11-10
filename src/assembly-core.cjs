'use strict';

// Pure, host-independent assembly logic. The source notes are never mutated.
const MAX_ENTRIES = 1000;
const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ROLES = Object.freeze({example:'例题', '例题':'例题', variant:'变式', '变式':'变式',
  practice:'训练', problem:'训练', '训练':'训练', '练习':'训练'});
const TIERS = ['核心','基础','培优','扩展'];
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

const usableLabel = raw => {
  const target = parseKnowledgeRef(raw).target;
  return !!target && !['~','[]'].includes(target);
};
const labels = value => list(value).filter(usableLabel);
function normalizeTiers(metadata, kind) {
  // A question has one level; a whole knowledge note can cover several levels.
  // An explicitly empty field must not resurrect an obsolete `level` value.
  const raw = Object.hasOwn(metadata,'teaching_tier') ? metadata.teaching_tier : metadata.level;
  const values = kind === 'knowledge' ? list(raw) : [text(raw)].filter(Boolean);
  return TIERS.filter(tier => values.includes(tier));
}

function coveredKnowledge(reference, source, nodes) {
  // A missing Wiki link remains a missing link. Coverage is declared by plain
  // labels only, within an explicitly known, equal subject on both sides.
  if (reference.wiki || !source.subject) return [];
  return nodes.filter(node => !node.identityConflict && node.subject && fold(node.subject) === fold(source.subject) &&
    node.knowledgeNodes.some(raw => {
      const tag = parseKnowledgeRef(raw);
      return !tag.wiki && fold(tag.target) === fold(reference.target);
    }));
}

function knowledgeCandidates(reference, sourcePath, nodes, subject) {
  const target = reference.target.replace(/\.md$/i, '');
  const exactId = nodes.filter(node => node.id && node.id === target);
  if (exactId.length) return exactId;
  if (target.includes('/')) {
    const dirname = sourcePath.split('/').slice(0, -1).join('/');
    const paths = [normalizePath(target), normalizePath(dirname + '/' + target)].filter(Boolean);
    return nodes.filter(node => paths.includes(node.path.replace(/\.md$/i, '')));
  }
  return nodes.filter(node => (reference.wiki || subject === undefined || subject && node.subject && fold(node.subject) === fold(subject)) &&
    [basename(node.path), node.title, ...node.aliases].some(name => fold(name) === fold(target)));
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
    const id = text(metadata.id), tiers = normalizeTiers(metadata,record.kind);
    const item = {key:'path:' + path, id, path, kind:record.kind,
      title:text(metadata.title) || basename(path), markdown:record.markdown, metadata,
      aliases:labels(metadata.aliases), knowledgeNodes:labels(metadata.knowledge_nodes),
      subject:text(metadata.subject), questionType:text(metadata.question_type || metadata.type),
      difficulty:metadata.difficulty !== null && metadata.difficulty !== '' &&
        Number.isInteger(Number(metadata.difficulty)) && Number(metadata.difficulty) >= 1 && Number(metadata.difficulty) <= 5
        ? Number(metadata.difficulty) : null,
      tiers, tier:tiers.join(' / '), role:normalizeRole(metadata.role || metadata.teaching_role),
      methods:labels(metadata.methods), source:text(metadata.source), fingerprint:fingerprint(record.markdown)};
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
      const ref = parseKnowledgeRef(raw), candidates = knowledgeCandidates(ref, item.path, nodes,item.subject);
      if (!candidates.length) {
        const covered = coveredKnowledge(ref,item,nodes);
        if (covered.length) return {...ref,status:'covered',relation:'shared-tag',nodeKeys:covered.map(node => node.key)};
      }
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
      !match(filters.tier,item.tiers) || !match(filters.role,[item.role]) ||
      !match(filters.method,item.methods.map(value => parseKnowledgeRef(value).target))) return false;
    if (options(filters.source).length && !options(filters.source).some(value => fold(item.source).includes(fold(value)))) return false;
    const keywords = fold(filters.query).split(/\s+/).filter(Boolean);
    const haystack = fold([item.title,item.id,item.path,item.markdown,...item.aliases,...item.knowledgeNodes,...item.methods,item.source].join('\n'));
    if (!keywords.every(word => haystack.includes(word))) return false;
    if (options(filters.knowledge).length && !options(filters.knowledge).some(value => {
      const ref = parseKnowledgeRef(String(value));
      const selected = nodes.filter(node => node.key === value || (node.id && node.id === value));
      // A label filter searches the declared labels; selecting a concrete note
      // by its key/ID instead follows only resolved or same-subject coverage.
      if (!selected.length && item.knowledgeRefs.some(known => fold(known.target) === fold(ref.target))) return true;
      const matches = selected.length ? selected : knowledgeCandidates(ref,'',nodes);
      if (matches.length === 1 && !matches[0].identityConflict) {
        return item.key === matches[0].key || item.knowledgeRefs.some(known => known.nodeKey === matches[0].key || known.nodeKeys?.includes(matches[0].key));
      }
      return item.knowledgeRefs.some(known => fold(known.target) === fold(ref.target));
    })) return false;
    return true;
  });
}

function eligibleQuestions(index, filters, plan) {
  const current = validatePlan(plan);
  const usedIds = new Set(current.entries.map(entry => entry.sourceId).filter(Boolean));
  const usedPaths = new Set(current.entries.map(entry => entry.sourcePath).filter(Boolean));
  const ids = new Set(), paths = new Set();
  return filterItems(index, {...filters,kind:'question'}).filter(item => {
    if (item.identityConflict || usedPaths.has(item.path) || item.id && usedIds.has(item.id) ||
      paths.has(item.path) || item.id && ids.has(item.id)) return false;
    paths.add(item.path);
    if (item.id) ids.add(item.id);
    return true;
  });
}

function selectQuestions(index, filters, plan, count, random = Math.random) {
  if (!Number.isInteger(count) || count < 1 || count > MAX_ENTRIES)
    throw new Error(`抽题数量须为 1 到 ${MAX_ENTRIES} 的整数`);
  if (typeof random !== 'function') throw new TypeError('抽题随机源无效');
  const pool = eligibleQuestions(index, filters, plan);
  const capacity = MAX_ENTRIES - validatePlan(plan).entries.length;
  const take = Math.min(count,pool.length,capacity);
  // Partial Fisher-Yates samples from every eligible item, not the first page
  // of results. Its injected random source makes the boundary cases testable.
  for (let i = 0; i < take; i++) {
    const value = random();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('抽题随机值无效');
    const chosen = i + Math.floor(value * (pool.length - i));
    [pool[i],pool[chosen]] = [pool[chosen],pool[i]];
  }
  return {requested:count,available:pool.length,capacity,items:pool.slice(0,take)};
}

function addSelectedQuestions(plan, index, filters, selected) {
  if (!Array.isArray(selected) || !selected.length || selected.length > MAX_ENTRIES)
    throw new Error('请先生成并保留至少一道候选题');
  const eligible = eligibleQuestions(index,filters,plan);
  let next = validatePlan(plan);
  // Validate the complete batch against the latest index before publishing a
  // new plan. A disappeared, edited or re-identified source never falls back.
  const current = selected.map(item => {
    const matches = eligible.filter(candidate => candidate.path === item?.path && candidate.id === item?.id);
    if (matches.length !== 1 || matches[0].fingerprint !== item.fingerprint)
      throw new Error('候选题来源或筛选条件已变化，请重新生成候选');
    return matches[0];
  });
  for (const item of current) next = addItem(next,item);
  return next;
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
function exactFields(raw, fields, name) {
  safeObject(raw,name);
  if (Reflect.ownKeys(raw).some(key => !fields.includes(key))) throw new TypeError(`${name} 含未知字段`);
  if (fields.some(key => !Object.prototype.hasOwnProperty.call(raw,key))) throw new TypeError(`${name} 缺少字段`);
}
function defaultCourse() {
  return {teacher:'',student:'',time:'',subject:'',grade:'',title:null,objectives:''};
}
function defaultOutputSettings() {
  return {layout:'default',mode:'document',spaceSettings:{ratio:100,minimumCm:0},
    solutionOptions:{solutionSpaces:false,showSolution:true}};
}
function validateCourse(raw) {
  exactFields(raw,['teacher','student','time','subject','grade','title','objectives'],'课程信息');
  const result = {};
  for (const key of ['teacher','student','time','subject','grade']) result[key] = boundedString(raw[key],'课程 '+key,200);
  result.title = raw.title === null ? null : boundedString(raw.title,'课程标题',500);
  result.objectives = boundedString(raw.objectives,'学习目标',1600);
  return result;
}
function validateOutputSettings(raw) {
  exactFields(raw,['layout','mode','spaceSettings','solutionOptions'],'排版设置');
  if (!['default','two-column','trial'].includes(raw.layout)) throw new TypeError('排版外观无效');
  if (!['document','student','teacher'].includes(raw.mode)) throw new TypeError('内容版本无效');
  exactFields(raw.spaceSettings,['ratio','minimumCm'],'留白设置');
  if (![50,75,90,100,110,125,150].includes(raw.spaceSettings.ratio) ||
      ![0,2,4].includes(raw.spaceSettings.minimumCm)) throw new TypeError('留白设置无效');
  exactFields(raw.solutionOptions,['solutionSpaces','showSolution'],'解析设置');
  if (typeof raw.solutionOptions.solutionSpaces !== 'boolean' || typeof raw.solutionOptions.showSolution !== 'boolean')
    throw new TypeError('解析设置无效');
  return {layout:raw.layout,mode:raw.mode,
    spaceSettings:{ratio:raw.spaceSettings.ratio,minimumCm:raw.spaceSettings.minimumCm},
    solutionOptions:{solutionSpaces:raw.solutionOptions.solutionSpaces,showSolution:raw.solutionOptions.showSolution}};
}
function validatePlan(raw) {
  safeObject(raw,'组题方案');
  if (![1,2].includes(raw.schemaVersion)) throw new Error('不支持的组题方案版本');
  exactFields(raw,raw.schemaVersion === 1 ? ['schemaVersion','title','entries'] :
    ['schemaVersion','title','entries','course','output'],'组题方案');
  const title = boundedString(raw.title,'方案标题',500,false);
  const course = raw.schemaVersion === 1 ? defaultCourse() : validateCourse(raw.course);
  const output = raw.schemaVersion === 1 ? defaultOutputSettings() : validateOutputSettings(raw.output);
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
  return {schemaVersion:2,title,entries,course,output};
}
function createPlan(title = '新讲义') {
  return validatePlan({schemaVersion:2,title,entries:[],course:defaultCourse(),output:defaultOutputSettings()});
}
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
function sectionRanges(entries) {
  const sections=[];
  entries.forEach((entry,index) => {
    if (entry.kind !== 'section') return;
    if (sections.length) sections[sections.length-1].end=index;
    sections.push({entryId:entry.entryId,start:index,end:entries.length});
  });
  return sections;
}
function getSections(plan) {
  return sectionRanges(validatePlan(plan).entries);
}
function moveSection(plan,entryId,targetIndex) {
  const next=validatePlan(plan), sections=sectionRanges(next.entries);
  const sourceIndex=sections.findIndex(section => section.entryId === entryId);
  if (sourceIndex < 0 || !Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= sections.length)
    throw new Error('分区移动位置无效');
  if (sourceIndex === targetIndex) return next;
  // Reorder complete spans only. Content preceding the first section stays
  // outside every section, and adjacent/empty headings remain distinct spans.
  const prefix=next.entries.slice(0,sections[0].start);
  const blocks=sections.map(section => next.entries.slice(section.start,section.end));
  const [block]=blocks.splice(sourceIndex,1); blocks.splice(targetIndex,0,block);
  next.entries=prefix.concat(...blocks);
  return next;
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

module.exports={buildIndex,filterItems,selectQuestions,addSelectedQuestions,createPlan,addItem,addSection,removeEntry,moveEntry,getSections,moveSection,updateEntry,
  resolvePlan,validatePlan,defaultCourse,defaultOutputSettings,validateCourse,validateOutputSettings,
  normalizeRole,parseKnowledgeRef,fingerprint};
