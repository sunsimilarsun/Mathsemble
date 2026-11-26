'use strict';

const fragments = typeof MWB_ASSEMBLY_FRAGMENTS !== 'undefined' ? MWB_ASSEMBLY_FRAGMENTS : require('./assembly-fragments.cjs');

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

function normalizeFamilyMetadata(metadata = {}) {
  // Identity uses the same trim-only, case-sensitive spelling as question IDs.
  // Missing values never create a shared synthetic family or a parent link.
  const field = value => {
    if (value == null || typeof value === 'string' && !value.trim()) return {value:null,state:'empty'};
    if (typeof value !== 'string' || value.length > 512 || /[\x00-\x1f\x7f]/.test(value)) return {value:null,state:'invalid'};
    return {value:value.trim(),state:'valid'};
  };
  const family=field(metadata?.family_id),parent=field(metadata?.parent_id);
  return {familyId:family.value,familyState:family.state==='empty'?'unclassified':family.state==='valid'?'classified':'invalid',
    familyValid:family.state!=='invalid',parentId:parent.value,parentState:parent.state==='empty'?'none':parent.state==='valid'?'declared':'invalid',
    parentValid:parent.state!=='invalid'};
}

function diagnoseParents(items,ids,issues) {
  const next=new Map();
  for (const item of items) {
    item.parentRef={status:'none'};
    if (item.kind!=='question') continue;
    const issue=(code,message,extra={})=>issues.push({code,message,path:item.path,...extra});
    if (!item.familyValid) issue('family-invalid','题族字段无效；应为非空文字或 null');
    if (!item.parentValid) {item.parentRef={status:'invalid'};issue('parent-invalid','显式母题 ID 无效；应为非空文字或 null');continue;}
    if (!item.parentId) continue;
    const matches=ids.get(item.parentId) || [];
    item.parentRef={id:item.parentId,status:'missing'};
    if (item.id && item.id===item.parentId) {item.parentRef.status='self';issue('parent-self','母题 ID 指向题目自身',{parentId:item.parentId});continue;}
    if (!matches.length) {issue('parent-missing','当前素材范围未找到显式母题 ID',{parentId:item.parentId});continue;}
    if (matches.length>1 || matches[0].identityConflict) {
      item.parentRef.status='ambiguous';issue('parent-ambiguous','显式母题 ID 对应多个文件',{parentId:item.parentId,paths:matches.map(parent=>parent.path)});continue;
    }
    const parent=matches[0];
    if (parent.kind!=='question') {item.parentRef.status='non-question';issue('parent-non-question','显式母题 ID 指向知识笔记',{parentId:item.parentId,parentPath:parent.path});continue;}
    item.parentRef={id:item.parentId,status:'resolved',parentKey:parent.key};next.set(item,parent);
    if (item.familyId && parent.familyId && item.familyId!==parent.familyId)
      issue('parent-cross-family','显式母题与本题声明了不同题族，请核对原文',{parentId:item.parentId,parentPath:parent.path});
  }
  // Each explicit relation has at most one target; iterative walks avoid a
  // recursion limit on a long imported parent chain. A cycle is reported once.
  const finished=new Set();
  for (const start of next.keys()) {
    if (finished.has(start)) continue;
    const chain=[],positions=new Map();let current=start;
    while (current && !finished.has(current) && !positions.has(current)) {
      positions.set(current,chain.length);chain.push(current);current=next.get(current);
    }
    if (current && positions.has(current)) {
      const cycle=chain.slice(positions.get(current));
      for (const item of cycle) item.parentRef.status='cycle';
      issues.push({code:'parent-cycle',message:'显式母题关系形成循环，请核对原文',paths:cycle.map(item=>item.path).sort()});
    }
    for (const item of chain) finished.add(item);
  }
}

function familyGroups(index) {
  const groups=new Map();let unclassifiedCount=0,invalidCount=0;
  for (const item of index?.items || []) {
    if (item.kind!=='question') continue;
    const family=normalizeFamilyMetadata(item.metadata);
    if (!family.familyValid) {invalidCount++;continue;}
    if (!family.familyId) {unclassifiedCount++;continue;}
    if (!groups.has(family.familyId)) groups.set(family.familyId,{familyId:family.familyId,count:0,memberKeys:[],tiers:{},roles:{},questionTypes:{}});
    const group=groups.get(family.familyId);group.count++;group.memberKeys.push(item.key);
    const count=(values,key)=>{if(key)Object.defineProperty(values,key,{value:(Object.hasOwn(values,key)?values[key]:0)+1,enumerable:true,writable:true,configurable:true});};
    for (const tier of item.tiers || []) count(group.tiers,tier);
    count(group.roles,item.role);count(group.questionTypes,item.questionType);
  }
  return {groups:[...groups.values()].sort((a,b)=>a.familyId<b.familyId?-1:a.familyId>b.familyId?1:0)
    .map(group=>({...group,memberKeys:group.memberKeys.sort()})),unclassifiedCount,invalidCount};
}

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

function knowledgeLookup(items) {
  const byId = new Map(), byIdentity = new Map(), byPath = new Map(), byName = new Map();
  const coverage = new Map(), order = new Map();
  function add(map, key, node) {
    const matches = map.get(key);
    if (!matches) map.set(key, [node]);
    else if (matches.at(-1) !== node) matches.push(node);
  }
  for (const node of items) {
    if (node.kind !== 'knowledge') continue;
    order.set(node, order.size);
    if (node.id) {
      add(byId, node.id, node);
      add(byIdentity, node.id, node);
    }
    add(byIdentity, node.key, node);
    add(byPath, node.path.replace(/\.md$/i, ''), node);
    for (const name of [basename(node.path), node.title, ...node.aliases]) add(byName, fold(name), node);
    // Only a non-conflicted note can declare coverage, within its own subject.
    if (!node.subject || node.identityConflict) continue;
    const subject = fold(node.subject);
    if (!coverage.has(subject)) coverage.set(subject, new Map());
    for (const raw of node.knowledgeNodes) {
      const tag = parseKnowledgeRef(raw);
      if (!tag.wiki) add(coverage.get(subject), fold(tag.target), node);
    }
  }
  return {byId, byIdentity, byPath, byName, coverage, order};
}

function knowledgeCandidates(reference, sourcePath, lookup, subject) {
  const target = reference.target.replace(/\.md$/i, '');
  const exactId = lookup.byId.get(target);
  if (exactId) return exactId;
  if (target.includes('/')) {
    const dirname = sourcePath.split('/').slice(0, -1).join('/');
    const absolutePath = normalizePath(target), relativePath = normalizePath(dirname + '/' + target);
    const absolute = absolutePath && lookup.byPath.get(absolutePath) || [];
    const relative = relativePath && lookup.byPath.get(relativePath) || [];
    if (absolutePath === relativePath || !relative.length) return absolute;
    if (!absolute.length) return relative;
    return [...absolute, ...relative].sort((a,b) => lookup.order.get(a) - lookup.order.get(b));
  }
  const matches = lookup.byName.get(fold(target)) || [];
  if (reference.wiki || subject === undefined) return matches;
  return subject ? matches.filter(node => node.subject && fold(node.subject) === subject) : [];
}

// Recognize numbered chapters even when the scan starts inside one. For a
// custom, unnumbered bank, the two folders below its root are chapter/section.
function questionScope(path, metadata, questionRoots) {
  const folders = path.split('/').slice(0, -1);
  const explicitChapter = folders.findLastIndex(name =>
    /^(?:第[零〇一二三四五六七八九十百两\d]+章|C\d+(?=$|[^\dA-Za-z-]))/i.test(name));
  const chapterIndex = explicitChapter >= 0 ? explicitChapter : folders.findIndex(name => /^\d{1,3}\s+\S/.test(name));
  let chapterFolder, sectionFolder;
  if (chapterIndex >= 0) {
    [chapterFolder, sectionFolder] = folders.slice(chapterIndex);
  } else {
    const root = questionRoots.find(root => path.startsWith(root + '/'));
    const relative = root ? folders.slice(root.split('/').length) : [];
    if (['初中例题','初中变式'].includes(relative[0])) relative.shift();
    [chapterFolder, sectionFolder] = relative;
  }
  const folderLabel = value => value && value !== '题卡' ? value : '';
  const chapter = text(metadata.chapter) || text(metadata.chapter_name) || text(metadata.章节) ||
    text(metadata.chapter_id) || folderLabel(chapterFolder);
  const section = text(metadata.section) || text(metadata.section_name) || text(metadata.小节) ||
    text(metadata.section_id) || (folderLabel(chapterFolder) && folderLabel(sectionFolder));
  return {chapter, section};
}

function buildIndex(records, {questionRoots = []} = {}) {
  if (!Array.isArray(records)) throw new TypeError('索引输入必须为列表');
  const items = [], issues = [], paths = new Set(), ids = new Map();
  const roots = questionRoots.map(normalizePath).sort((a,b) => a.length - b.length);
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
    const item = {key:'path:' + path, id, path, kind:record.kind,...normalizeFamilyMetadata(metadata),
      ...(record.kind === 'question' ? questionScope(path, metadata, roots) : {}),
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
  diagnoseParents(items,ids,issues);
  const lookup = knowledgeLookup(items);
  for (const item of items) {
    const subject = fold(item.subject);
    item.knowledgeRefs = item.knowledgeNodes.map(raw => {
      const ref = parseKnowledgeRef(raw), candidates = knowledgeCandidates(ref, item.path, lookup, subject);
      if (!candidates.length && !ref.wiki && subject) {
        const covered = lookup.coverage.get(subject)?.get(fold(ref.target));
        if (covered) return {...ref,status:'covered',relation:'shared-tag',nodeKeys:covered.map(node => node.key)};
      }
      const status = candidates.length > 1 || candidates[0]?.identityConflict ? 'ambiguous' :
        candidates.length === 1 ? 'resolved' : ref.wiki ? 'missing' : 'tag';
      return {...ref, status, ...(status === 'resolved' ? {nodeKey:candidates[0].key} : {}),
        ...(status === 'ambiguous' ? {candidates:candidates.map(node => node.key)} : {})};
    });
  }
  return {items, issues};
}

function knowledgeFilter(items, values) {
  if (!values.length) return null;
  const lookup = knowledgeLookup(items), nodeKeys = new Set(), literalTargets = new Set();
  for (const value of values) {
    const ref = parseKnowledgeRef(String(value));
    const selected = lookup.byIdentity.get(value);
    const matches = selected || knowledgeCandidates(ref, '', lookup);
    const unique = matches.length === 1 && !matches[0].identityConflict;
    if (unique) nodeKeys.add(matches[0].key);
    // A literal label can match across subjects. Selecting a concrete note
    // follows only resolved links and its same-subject coverage.
    if (!selected || !unique) literalTargets.add(fold(ref.target));
  }
  return item => nodeKeys.has(item.key) || item.knowledgeRefs.some(ref =>
    nodeKeys.has(ref.nodeKey) || ref.nodeKeys?.some(key => nodeKeys.has(key)) ||
    (literalTargets.size && literalTargets.has(fold(ref.target))));
}

function filterItems(index, filters = {}) {
  const items = Array.isArray(index?.items) ? index.items : [];
  const options = value => (Array.isArray(value) ? value : [value]).filter(value => value !== null && value !== undefined && String(value).trim() !== '' && value !== 'all');
  const foldedOptions = value => new Set(options(value).map(fold));
  const kinds = foldedOptions(filters.kind), subjects = foldedOptions(filters.subject);
  const types = foldedOptions(filters.questionType), difficulty = foldedOptions(filters.difficulty);
  const tiers = foldedOptions(filters.tier), roles = foldedOptions(filters.role);
  const sources = options(filters.source).map(fold);
  const keywords = fold(filters.query).split(/\s+/).filter(Boolean);
  const matchesKnowledge = knowledgeFilter(items, options(filters.knowledge));
  const familyIds=(Array.isArray(filters.familyId)?filters.familyId:[filters.familyId]).filter(value=>value!=null&&!(typeof value==='string'&&!value.trim()));
  const familyStates=options(filters.familyState);
  const methodTargets=new Set(options(filters.method).map(value=>fold(parseKnowledgeRef(value).target)));
  const chapters = list(filters.chapter), sections = list(filters.section);
  return items.filter(item => {
    if (filters.kind !== 'knowledge' &&
      ((chapters.length && !chapters.includes(item.chapter)) || (sections.length && !sections.includes(item.section)))) return false;
    if (familyIds.length && (item.kind!=='question' || item.familyState!=='classified' ||
      !familyIds.some(value=>typeof value==='string'&&value.trim()===item.familyId))) return false;
    if (familyStates.length && (item.kind!=='question' || !familyStates.includes(item.familyState))) return false;
    if ((kinds.size && !kinds.has(fold(item.kind))) || (subjects.size && !subjects.has(fold(item.subject))) ||
      (types.size && !types.has(fold(item.questionType))) || (difficulty.size && !difficulty.has(fold(item.difficulty))) ||
      (tiers.size && !item.tiers.some(tier => tiers.has(fold(tier)))) || (roles.size && !roles.has(fold(item.role))) ||
      (methodTargets.size && !item.methods.some(value => methodTargets.has(fold(parseKnowledgeRef(value).target))))) return false;
    if (sources.length && !sources.some(value => fold(item.source).includes(value))) return false;
    if (matchesKnowledge && !matchesKnowledge(item)) return false;
    if (keywords.length) {
      const haystack = fold([item.title,item.id,item.path,item.markdown,...item.aliases,...item.knowledgeNodes,...item.methods,item.source].join('\n'));
      if (!keywords.every(word => haystack.includes(word))) return false;
    }
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
    solutionOptions:{studentBlankCallouts:[],teacherVisibleCallouts:[]}};
}
function validateCalloutTypes(raw) {
  if (!Array.isArray(raw) || Object.getPrototypeOf(raw) !== Array.prototype || raw.length > 128 ||
      Reflect.ownKeys(raw).some(key => key !== 'length' && (typeof key !== 'string' || !/^\d+$/.test(key))) ||
      Object.values(Object.getOwnPropertyDescriptors(raw)).some(descriptor => descriptor.get || descriptor.set))
    throw new TypeError('Callout 类型列表无效');
  const result = [], seen = new Set();
  for (const type of raw) {
    if (typeof type !== 'string' || !/^[a-z0-9_-]{1,64}$/.test(type)) throw new TypeError('Callout 类型无效');
    if (type === 'answer') throw new TypeError('answer 的留白和显示已固定，无需加入类型列表');
    if (seen.has(type)) throw new TypeError('Callout 类型重复');
    seen.add(type); result.push(type);
  }
  return result;
}
function validateCalloutOptions(raw) {
  safeObject(raw,'Callout 设置');
  if (Object.prototype.hasOwnProperty.call(raw,'solutionSpaces') || Object.prototype.hasOwnProperty.call(raw,'showSolution')) {
    exactFields(raw,['solutionSpaces','showSolution'],'旧解析设置');
    if (typeof raw.solutionSpaces !== 'boolean' || typeof raw.showSolution !== 'boolean')
      throw new TypeError('旧解析设置无效');
    return {studentBlankCallouts:raw.solutionSpaces ? ['solution'] : [],
      teacherVisibleCallouts:raw.showSolution ? ['solution'] : []};
  }
  exactFields(raw,['studentBlankCallouts','teacherVisibleCallouts'],'Callout 设置');
  return {studentBlankCallouts:validateCalloutTypes(raw.studentBlankCallouts),
    teacherVisibleCallouts:validateCalloutTypes(raw.teacherVisibleCallouts)};
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
  return {layout:raw.layout,mode:raw.mode,
    spaceSettings:{ratio:raw.spaceSettings.ratio,minimumCm:raw.spaceSettings.minimumCm},
    solutionOptions:validateCalloutOptions(raw.solutionOptions)};
}
function validatePlan(raw) {
  safeObject(raw,'组题方案');
  if (![1,2,3,4].includes(raw.schemaVersion)) throw new Error('不支持的组题方案版本');
  exactFields(raw,raw.schemaVersion === 1 ? ['schemaVersion','title','entries'] :
    ['schemaVersion','title','entries','course','output'],'组题方案');
  const title = boundedString(raw.title,'方案标题',500,false);
  const course = raw.schemaVersion === 1 ? defaultCourse() : validateCourse(raw.course);
  const output = raw.schemaVersion === 1 ? defaultOutputSettings() : validateOutputSettings(raw.output);
  if (!Array.isArray(raw.entries) || raw.entries.length > MAX_ENTRIES) throw new Error(`组题方案最多 ${MAX_ENTRIES} 项`);
  if (Object.getPrototypeOf(raw.entries) !== Array.prototype || Object.keys(raw.entries).length!==raw.entries.length ||
    Reflect.ownKeys(raw.entries).some(key=>typeof key!=='string' || key!=='length'&&!/^(0|[1-9]\d*)$/.test(key)) ||
    Object.entries(Object.getOwnPropertyDescriptors(raw.entries)).some(([key, descriptor]) =>
      FORBIDDEN.has(key) || descriptor.get || descriptor.set || key !== 'length' && !/^\d+$/.test(key))) {
    throw new TypeError('编排列表含不允许的属性');
  }
  const entryIds = new Set(), sourceIds = new Set(), sourcePaths = new Set();
  const fields = new Set(['entryId','kind','sourceId','sourcePath','sourceFingerprint','title','role',
    ...(raw.schemaVersion===4?['score','fragmentRef']:[])]);
  const entries = raw.entries.map(entry => {
    safeObject(entry,'编排项');
    if (Reflect.ownKeys(entry).some(key => !fields.has(key))) throw new TypeError('编排项含未知字段');
    const entryId = boundedString(entry.entryId,'编排项 ID',512,false);
    if (entryIds.has(entryId)) throw new Error('编排项 ID 重复');
    entryIds.add(entryId);
    if (!['question','knowledge','section'].includes(entry.kind)) throw new TypeError('编排项类型无效');
    const result = {entryId,kind:entry.kind,
      sourceId:boundedString(entry.sourceId,'源 ID',512),
      sourcePath:boundedString(entry.sourcePath,'源路径',4096),
      sourceFingerprint:boundedString(entry.sourceFingerprint,'源指纹',128),
      title:boundedString(entry.title,'显示标题',500),role:boundedString(entry.role,'教学角色',50)};
    if(Object.hasOwn(entry,'score')) {
      if(entry.kind!=='question')throw new Error('仅题目编排项可设置分值');
      result.score=fragments.validateScore(entry.score);
    }
    if(Object.hasOwn(entry,'fragmentRef')) {
      result.fragmentRef=fragments.validateFragmentRef(entry.fragmentRef,entry.kind);
      const sum=fragments.totalScore(result.fragmentRef);
      if(sum!==null) {
        if(Object.hasOwn(result,'score')&&result.score!==sum)throw new Error('整题分值须等于全部已选小问分值之和');
        result.score=sum;
      }
    }
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
  return {schemaVersion:entries.some(entry=>Object.hasOwn(entry,'score')||entry.fragmentRef)?4:3,title,entries,course,output};
}
function createPlan(title = '新讲义') {
  return validatePlan({schemaVersion:3,title,entries:[],course:defaultCourse(),output:defaultOutputSettings()});
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
  const allowed=new Set(['title','role','sourceId','sourcePath','sourceFingerprint','score','fragmentRef']);
  if (Reflect.ownKeys(patch).some(key => !allowed.has(key))) throw new Error('不允许修改此编排字段');
  const entry=next.entries.find(entry => entry.entryId === entryId);
  if (!entry) throw new Error('编排项不存在');
  if(entry.fragmentRef && (Object.hasOwn(patch,'sourceId')&&patch.sourceId!==entry.sourceId ||
      Object.hasOwn(patch,'sourcePath')&&patch.sourcePath!==entry.sourcePath && !entry.sourceId) && patch.fragmentRef!==null)
    throw new Error('片段引用不能转移到另一来源，请先切回整题');
  if(Object.hasOwn(patch,'fragmentRef')) {
    const ref=patch.fragmentRef===null?null:fragments.validateFragmentRef(patch.fragmentRef,entry.kind);
    const changed=JSON.stringify(entry.fragmentRef?.ids||null)!==JSON.stringify(ref?.ids||null);
    if(changed&&!Object.hasOwn(patch,'score'))delete entry.score;
    if(ref?.scores&&!Object.hasOwn(patch,'score'))entry.score=fragments.totalScore(ref);
  }
  for(const [key,value] of Object.entries(patch)) {
    if((key==='score'||key==='fragmentRef')&&value===null)delete entry[key];else entry[key]=value;
  }
  next.schemaVersion=4;return validatePlan(next);
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
    let fragmentIssue;
    if(item&&status!=='conflict'&&entry.fragmentRef) {
      try {fragments.resolveFragment(item,entry.fragmentRef);}
      catch(error) {status=error.code==='FRAGMENT_MISSING'?'fragment-missing':'fragment-invalid';fragmentIssue=error.message;}
    }
    if (status !== 'ok') issues.push({code:status,entryId:entry.entryId,path:entry.sourcePath,
      message:fragmentIssue || (status === 'missing' ? `来源已缺失：${entry.title}` : status === 'conflict' ? `来源身份冲突：${entry.title}` : `来源已更新：${entry.title}`)});
    return {entry,item,status};
  });
  return {entries,issues};
}

module.exports={buildIndex,filterItems,selectQuestions,addSelectedQuestions,createPlan,addItem,addSection,removeEntry,moveEntry,getSections,moveSection,updateEntry,
  resolvePlan,validatePlan,defaultCourse,defaultOutputSettings,validateCourse,validateOutputSettings,
  normalizeRole,normalizeFamilyMetadata,familyGroups,parseKnowledgeRef,fingerprint,
  splitFrontmatter:fragments.splitFrontmatter,
  validateScore:fragments.validateScore,validateFragmentRef:fragments.validateFragmentRef,
  listFragments:fragments.listFragments,resolveFragment:fragments.resolveFragment};
