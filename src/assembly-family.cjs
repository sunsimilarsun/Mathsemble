'use strict';

// Pure same-family replacement. Fresh source reads, strong digests, recovered
// blueprint records and persistence belong to the service, never this module.
const ALGORITHM='family-replacement-v1';
const CONSTRAINED_ALGORITHM='constrained-replacement-v1';
const FILTERS=new Set(['kind','query','subject','chapter','section','questionType','difficulty','tier','role','method','source','knowledge','familyId','familyState']);
const forbidden=new Set(['__proto__','prototype','constructor']);
const compare=(a,b)=>a<b?-1:a>b?1:0;
const error=(code,message,issues)=>Object.assign(new Error(message),{code,...(issues?{issues}:{})});
const issue=(code,message,extra={})=>({code,message,...extra});
function jsonData(value,label='数据',depth=0,budget={nodes:0}) {
  if(++budget.nodes>200000||depth>24)throw error('FAMILY_INVALID',label+'过大或嵌套过深');
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')throw error('FAMILY_INVALID',label+'必须为纯 JSON 数据');
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  if(proto!==(array?Array.prototype:Object.prototype)&&!(proto===null&&!array))throw error('FAMILY_INVALID',label+'必须为普通对象或列表');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||forbidden.has(key)||descriptors[key].get||descriptors[key].set))throw error('FAMILY_INVALID',label+'含不允许的属性');
  if(array) {
    if(value.length>10000||keys.length!==value.length+1||keys.some(key=>key!=='length'&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length)))
      throw error('FAMILY_INVALID',label+'含非法列表');
    return Array.from({length:value.length},(_,i)=>jsonData(descriptors[i].value,label,depth+1,budget));
  }
  const result={};for(const key of keys.sort(compare))result[key]=jsonData(descriptors[key].value,label,depth+1,budget);return result;
}
function filtersOf(value) {
  const filters=jsonData(value,'换题筛选');
  if(!filters||typeof filters!=='object'||Array.isArray(filters)||Object.keys(filters).some(key=>!FILTERS.has(key)))
    throw error('FAMILY_INVALID','换题筛选含未知字段');
  for(const [key,raw]of Object.entries(filters)) {
    if(key==='query') {if(typeof raw!=='string'||raw.length>2000)throw error('FAMILY_INVALID','搜索文字无效');continue;}
    const values=Array.isArray(raw)?raw:[raw];
    if(values.length>128||values.some(value=>value!==null&&typeof value!=='string'&&!(key==='difficulty'&&Number.isInteger(value)&&value>=1&&value<=5)))
      throw error('FAMILY_INVALID','换题筛选值无效');
    if(values.some(value=>typeof value==='string'&&(value.length>4096||/[\x00-\x1f\x7f]/.test(value))))throw error('FAMILY_INVALID','换题筛选值无效');
  }
  return filters;
}
const identity=item=>item.id?'id:'+item.id:'path:'+item.path;
const sourceOf=item=>({sourceId:item.id||'',sourcePath:item.path,sourceFingerprint:item.fingerprint});

function createFamilyEngine({core}={}) {
  if(!core||['validatePlan','resolvePlan','filterItems','normalizeFamilyMetadata','updateEntry'].some(name=>typeof core[name]!=='function'))
    throw new TypeError('题族换题引擎需要现行 assembly core');
  // Both candidate strategies share identity, quota, locking and source checks.
  // Only the explicit same-family strategy requires a classified source family.
  function prepare({index,plan,entryId,filters={},rowFilters={},maxPerFamily=null,locked=false},sameFamily) {
    const current=core.validatePlan(jsonData(plan,'组题方案')),currentFilters=filtersOf(filters),requiredFilters=filtersOf(rowFilters);
    if(typeof entryId!=='string'||!entryId.trim()||entryId.length>512)throw error('FAMILY_INVALID','待换编排项 ID 无效');
    if(typeof locked!=='boolean'||maxPerFamily!==null&&(!Number.isSafeInteger(maxPerFamily)||maxPerFamily<1||maxPerFamily>1000))
      throw error('FAMILY_INVALID','锁定或题族上限无效');
    if(!Array.isArray(index?.items))throw error('FAMILY_INVALID','来源索引无效');
    const conflict=(code,message,extra={})=>({status:'conflict',candidates:[],issues:[issue(code,message,{entryId,...extra})]});
    const entry=current.entries.find(value=>value.entryId===entryId);
    if(!entry||entry.kind!=='question')return conflict('FAMILY_TARGET_INVALID','只能替换当前方案中的题目');
    if(entry.fragmentRef)return conflict('FAMILY_FRAGMENT_SELECTED','此项选用了稳定小问；请先切回整题再换题，避免把片段身份套用到另一道题');
    if(locked)return conflict('FAMILY_LOCKED','请先显式解除该题的锁定再换题');
    const resolved=core.resolvePlan(current,index),target=resolved.entries.find(value=>value.entry.entryId===entryId);
    const ids=new Map(),paths=new Map();
    for(const item of index.items) {paths.set(item.path,(paths.get(item.path)||0)+1);if(item.id)ids.set(item.id,(ids.get(item.id)||0)+1);}
    const safe=item=>item?.kind==='question'&&!item.identityConflict&&paths.get(item.path)===1&&(!item.id||ids.get(item.id)===1);
    if(target.status!=='ok'||!safe(target.item))return conflict('FAMILY_SOURCE_CHANGED','待换题来源缺失、冲突或已变化，请先核对来源',{sourceStatus:target.status});
    const family=core.normalizeFamilyMetadata(target.item.metadata);
    if(sameFamily&&(!family.familyValid||!family.familyId))return conflict('FAMILY_UNKNOWN','待换题未分类或题族字段无效，不能推断同族关系');
    if(!family.familyValid)return conflict('FAMILY_FIELD_INVALID','待换题的题族字段无效，请先核对原文');
    const usedIds=new Set(),usedPaths=new Set(),counts=new Map(),familySources=[];
    for(const value of resolved.entries) {
      if(value.entry.entryId===entryId)continue;
      if(value.entry.sourceId)usedIds.add(value.entry.sourceId);if(value.entry.sourcePath)usedPaths.add(value.entry.sourcePath);
      if(value.entry.kind!=='question')continue;
      if(maxPerFamily!==null&&(value.status!=='ok'||!safe(value.item)))
        return conflict('FAMILY_PLAN_SOURCE_UNRESOLVED','核对全局题族上限前须处理方案中其他题目的来源',{otherEntryId:value.entry.entryId});
      if(value.status==='ok') {
        const other=core.normalizeFamilyMetadata(value.item.metadata);
        if(maxPerFamily!==null&&!other.familyValid)return conflict('FAMILY_FIELD_INVALID','方案中其他题目的题族字段无效',{otherEntryId:value.entry.entryId});
        if(other.familyValid&&other.familyId)counts.set(other.familyId,(counts.get(other.familyId)||0)+1);
        if(maxPerFamily!==null)familySources.push({entryId:value.entry.entryId,...sourceOf(value.item),familyId:other.familyId});
      }
    }
    if(maxPerFamily!==null) {
      const withTarget=new Map(counts);
      if(sameFamily)withTarget.set(family.familyId,(withTarget.get(family.familyId)||0)+1);
      for(const [familyId,count]of withTarget)if(count>maxPerFamily)
        return conflict('FAMILY_LIMIT','整个方案已超过题族上限，换题不能放宽约束',{familyId,count,limit:maxPerFamily});
    }
    // Evaluate both sets against the FULL index: filtering away knowledge notes
    // first would change resolved/shared-tag semantics. Same fields remain AND.
    const visible=new Set(core.filterItems(index,currentFilters)),required=new Set(core.filterItems(index,requiredFilters));
    const candidates=[];
    for(const item of index.items) {
      if(!safe(item)||identity(item)===identity(target.item)||usedPaths.has(item.path)||item.id&&usedIds.has(item.id)||
          !visible.has(item)||!required.has(item))continue;
      const other=core.normalizeFamilyMetadata(item.metadata);
      if(!other.familyValid||sameFamily&&other.familyId!==family.familyId)continue;
      // The target was removed from counts above. A cross-family candidate now
      // consumes one slot in its own family; unknown families stay independent.
      if(maxPerFamily!==null&&other.familyId&&(counts.get(other.familyId)||0)+1>maxPerFamily)continue;
      candidates.push({key:identity(item),id:item.id||'',path:item.path,fingerprint:item.fingerprint,title:item.title,role:item.role,
        familyId:other.familyId,subject:item.subject,questionType:item.questionType,difficulty:item.difficulty,tiers:[...(item.tiers||[])]});
    }
    candidates.sort((a,b)=>compare(a.key,b.key)||compare(a.path,b.path));
    const context=JSON.stringify({algorithmVersion:sameFamily?ALGORITHM:CONSTRAINED_ALGORITHM,plan:current,entryId,target:{...sourceOf(target.item),familyId:family.familyId},
      filters:currentFilters,rowFilters:requiredFilters,maxPerFamily,locked,candidates,
      familySources:familySources.sort((a,b)=>compare(a.entryId,b.entryId))});
    return {status:'ready',candidates,context,issues:candidates.length?[]:[issue(sameFamily?'FAMILY_NO_CANDIDATES':'REPLACEMENT_NO_CANDIDATES',
      sameFamily?'没有同时满足当前筛选、原配额行和同族条件的替代题':'没有同时满足当前筛选、原配额行与题族上限的替代题',{entryId,familyId:family.familyId})]};
  }
  function apply({freshIndex,plan,entryId,candidateKey,expectedContext,filters={},rowFilters={},maxPerFamily=null,locked=false},sameFamily) {
    if(typeof candidateKey!=='string'||!candidateKey||typeof expectedContext!=='string')throw error('FAMILY_INVALID','换题候选或上下文无效');
    const prepared=prepare({index:freshIndex,plan,entryId,filters,rowFilters,maxPerFamily,locked},sameFamily);
    if(prepared.status!=='ready'||prepared.context!==expectedContext)
      throw error('FAMILY_STALE','换题来源、方案或约束已变化，请重新选择',prepared.issues);
    const candidate=prepared.candidates.find(item=>item.key===candidateKey);
    if(!candidate)throw error('FAMILY_STALE','替代题不在当前受约束的候选中');
    const current=core.validatePlan(plan),entry=current.entries.find(value=>value.entryId===entryId);
    const previous={sourceId:entry.sourceId,sourcePath:entry.sourcePath,sourceFingerprint:entry.sourceFingerprint},next=sourceOf(candidate);
    return {plan:core.updateEntry(current,entryId,next),replacement:{entryId,previous,next}};
  }
  return {prepareReplacement:input=>prepare(input,true),applyReplacement:input=>apply(input,true),
    prepareConstrainedReplacement:input=>prepare(input,false),applyConstrainedReplacement:input=>apply(input,false),
    algorithmVersion:ALGORITHM,constrainedAlgorithmVersion:CONSTRAINED_ALGORITHM};
}

module.exports={createFamilyEngine};
