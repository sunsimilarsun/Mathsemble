'use strict';

// Pure allocation engine. The host injects core and owns scanning, source SHA
// verification, persistence, task generations, UUIDs and all user-visible I/O.
const ALGORITHM = 'blueprint-maxflow-v1';
const MAX_ENTRIES = 1000, MAX_ROWS = 64;
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
const FILTERS = ['query','subject','questionType','difficulty','tier','role','method','source','knowledge'];
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const error = (code,message,issues) => Object.assign(new Error(message),{code,...(issues ? {issues} : {})});
const issue = (code,message,extra={}) => ({code,message,...extra});

function jsonData(value,label='数据',depth=0,budget={nodes:0}) {
  if (++budget.nodes>300000 || depth>24) throw error('BLUEPRINT_INVALID',label+'过大或嵌套过深');
  if (value===null || typeof value==='boolean' || typeof value==='string') return value;
  if (typeof value==='number' && Number.isFinite(value)) return value;
  if (!value || typeof value!=='object') throw error('BLUEPRINT_INVALID',label+'不是 JSON 数据');
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value);
  if (proto!==(array ? Array.prototype : Object.prototype) && !(proto===null&&!array))
    throw error('BLUEPRINT_INVALID',label+'不是普通对象或列表');
  const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
  if (keys.some(key=>typeof key!=='string'||FORBIDDEN.has(key)||descriptors[key].get||descriptors[key].set))
    throw error('BLUEPRINT_INVALID',label+'含不允许的属性');
  if (array) {
    if (value.length>100000 || keys.some(key=>key!=='length'&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=value.length)) ||
        keys.length!==value.length+1) throw error('BLUEPRINT_INVALID',label+'含稀疏或非法列表属性');
    return Array.from({length:value.length},(_,index)=>jsonData(descriptors[index].value,label,depth+1,budget));
  }
  const result={};for(const key of keys)result[key]=jsonData(descriptors[key].value,label,depth+1,budget);return result;
}
function fields(raw,required,optional=[],label='数据') {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw error('BLUEPRINT_INVALID',label+'必须为对象');
  if (Object.keys(raw).some(key=>!required.includes(key)&&!optional.includes(key)) || required.some(key=>!Object.hasOwn(raw,key)))
    throw error('BLUEPRINT_INVALID',label+'含未知字段或缺少字段');
}
function string(value,label,max=512,empty=false) {
  if (typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value)||!empty&&!value.trim())
    throw error('BLUEPRINT_INVALID',label+'无效');
  return value;
}
function integer(value,label,min,max) {
  if(!Number.isSafeInteger(value)||value<min||value>max)throw error('BLUEPRINT_INVALID',label+'须为 '+min+' 到 '+max+' 的整数');return value;
}
function identifier(value,label) {string(value,label,96);if(!/^[A-Za-z0-9_-]+$/.test(value))throw error('BLUEPRINT_INVALID',label+'仅支持字母、数字、下划线和连字符');return value;}
function freeze(value) {if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
function normalizeFilters(raw) {
  fields(raw,[],FILTERS,'筛选条件');const result={query:''};
  for(const name of FILTERS) {
    if(name==='query'){if(Object.hasOwn(raw,name))result.query=string(raw.query,'搜索文字',2000,true).trim();continue;}
    const input=raw[name]===undefined?[]:Array.isArray(raw[name])?raw[name]:[raw[name]];
    if(input.length>128)throw error('BLUEPRINT_INVALID','同维度筛选最多 128 项');
    const values=[];
    for(const value of input) {
      if(value===null||value===''||value==='all')continue;
      if(name==='difficulty'){const n=typeof value==='string'&&/^[1-5]$/.test(value)?Number(value):value;values.push(integer(n,'难度',1,5));}
      else values.push(string(value,'筛选值',4096).trim());
    }
    result[name]=[...new Set(values)].sort(name==='difficulty'?(a,b)=>a-b:compare);
  }
  return result;
}
function validateBlueprint(raw) {
  raw=jsonData(raw,'蓝图');fields(raw,['schemaVersion','blueprintId','revision','title','rows','constraints'],[],'蓝图');
  if(raw.schemaVersion!==1)throw error('BLUEPRINT_INVALID','不支持的蓝图版本');
  identifier(raw.blueprintId,'蓝图 ID');integer(raw.revision,'蓝图修订',1,Number.MAX_SAFE_INTEGER);string(raw.title,'蓝图标题',500);
  if(!Array.isArray(raw.rows)||raw.rows.length>MAX_ROWS)throw error('BLUEPRINT_INVALID','蓝图最多 '+MAX_ROWS+' 行');
  const seen=new Set();let total=0;
  const rows=raw.rows.map(row=>{fields(row,['rowId','label','filters','count'],[],'配额行');identifier(row.rowId,'配额行 ID');
    if(seen.has(row.rowId))throw error('BLUEPRINT_INVALID','配额行 ID 重复');seen.add(row.rowId);
    string(row.label,'配额行标签',200,true);integer(row.count,'配额数量',1,MAX_ENTRIES);total+=row.count;
    return {rowId:row.rowId,label:row.label,filters:normalizeFilters(row.filters),count:row.count};});
  if(total>MAX_ENTRIES)throw error('BLUEPRINT_INVALID','蓝图配额总数最多 '+MAX_ENTRIES);
  fields(raw.constraints,['uniqueQuestion','maxPerFamily'],[],'蓝图约束');
  if(raw.constraints.uniqueQuestion!==true)throw error('BLUEPRINT_INVALID','蓝图必须保持题目唯一');
  if(raw.constraints.maxPerFamily!==null)integer(raw.constraints.maxPerFamily,'每族上限',1,MAX_ENTRIES);
  return {schemaVersion:1,blueprintId:raw.blueprintId,revision:raw.revision,title:raw.title,rows,
    constraints:{uniqueQuestion:true,maxPerFamily:raw.constraints.maxPerFamily}};
}
function assignment(raw) {
  fields(raw,['rowId','slotId','origin','sourceId','sourcePath','sourceFingerprint'],['existingEntryId'],'配额归属');
  identifier(raw.rowId,'配额行 ID');string(raw.slotId,'槽 ID',128);
  if(!['plan','candidate'].includes(raw.origin))throw error('BLUEPRINT_INVALID','归属来源无效');
  string(raw.sourceId,'源 ID',512,true);string(raw.sourcePath,'源路径',4096);string(raw.sourceFingerprint,'源指纹',128);
  if(raw.sourcePath.startsWith('/')||raw.sourcePath.includes('\\')||raw.sourcePath.includes(':')||
      raw.sourcePath.split('/').some(part=>!part||part==='.'||part==='..')||!/\.md$/i.test(raw.sourcePath))
    throw error('BLUEPRINT_INVALID','来源须为库内 Markdown 路径');
  if(raw.origin==='plan')string(raw.existingEntryId,'已存在的编排项 ID',512);
  else if(Object.hasOwn(raw,'existingEntryId'))throw error('BLUEPRINT_INVALID','新候选不能含已存在编排项 ID');
  return {rowId:raw.rowId,slotId:raw.slotId,origin:raw.origin,sourceId:raw.sourceId,sourcePath:raw.sourcePath,
    sourceFingerprint:raw.sourceFingerprint,...(raw.origin==='plan'?{existingEntryId:raw.existingEntryId}:{})};
}
function assignments(raw,label) {
  if(!Array.isArray(raw)||raw.length>MAX_ENTRIES)throw error('BLUEPRINT_INVALID',label+'须为最多 1000 项的列表');
  return raw.map(assignment);
}
function validateAllocation(raw) {
  raw=jsonData(raw,'候选');fields(raw,['schemaVersion','algorithmVersion','status','seed','context','locks','assignments','rowStats','familyStats','diagnostics'],[],'候选');
  if(raw.schemaVersion!==1||raw.algorithmVersion!==ALGORITHM)throw error('BLUEPRINT_INVALID','不支持的候选版本');
  if(!['complete','infeasible','budget','cancelled'].includes(raw.status))throw error('BLUEPRINT_INVALID','候选状态无效');
  string(raw.seed,'随机种子',512);string(raw.context,'候选上下文',32*1024*1024);
  const locks=assignments(raw.locks,'锁定列表'),selected=assignments(raw.assignments,'候选列表');
  if(raw.status!=='complete'&&selected.length)throw error('BLUEPRINT_INVALID','未完成候选不得含可应用的分配');
  if(!Array.isArray(raw.rowStats)||raw.rowStats.length>MAX_ROWS||!Array.isArray(raw.familyStats)||!Array.isArray(raw.diagnostics))
    throw error('BLUEPRINT_INVALID','候选统计无效');
  for(const row of raw.rowStats){fields(row,['rowId','requested','locked','available','assigned','missing'],[],'行统计');identifier(row.rowId,'统计行 ID');for(const key of ['requested','locked','available','assigned','missing'])integer(row[key],'行统计',0,Number.MAX_SAFE_INTEGER);}
  return {...raw,locks,assignments:selected};
}
function family(item,core) {
  const {familyId,familyValid}=core.normalizeFamilyMetadata(item.metadata);
  return {familyId,familyValid};
}
const identity = item => item.id?'id:'+item.id:'path:'+item.path;
const sameSource = (a,b) => a.sourceId===b.sourceId&&a.sourcePath===b.sourcePath&&a.sourceFingerprint===b.sourceFingerprint;
const sourceOf = item => ({sourceId:item.id||'',sourcePath:item.path,sourceFingerprint:item.fingerprint});
const asAssignment = (slot,item) => ({rowId:slot.rowId,slotId:slot.slotId,origin:'candidate',...sourceOf(item)});
function random(seed) {
  let state=2166136261;for(let i=0;i<seed.length;i++)state=Math.imul(state^seed.charCodeAt(i),16777619);
  return ()=>{state=(state+0x6D2B79F5)|0;let n=Math.imul(state^(state>>>15),1|state);n^=n+Math.imul(n^(n>>>7),61|n);return ((n^(n>>>14))>>>0)/4294967296;};
}
function shuffle(values,rng) {const result=values.slice();for(let i=result.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[result[i],result[j]]=[result[j],result[i]];}return result;}

function createBlueprintEngine({core}={}) {
  if(!core||['filterItems','validatePlan','resolvePlan','normalizeRole','normalizeFamilyMetadata'].some(name=>typeof core[name]!=='function'))throw new TypeError('蓝图引擎需要现行 assembly core');
  const problems=new WeakMap();
  const expose=state=>{const problem=freeze({context:state.context,blueprint:state.blueprint,slots:state.slots,
    candidates:state.candidates.map(item=>({...sourceOf(item),key:item.key,title:item.title,role:item.role,familyId:item.familyId,rowIds:item.rowIds})),
    locks:state.locks,...(state.replacement?{replacement:state.replacement}:{})});problems.set(problem,state);return {status:'ready',problem,context:state.context,issues:state.issues};};
  function prepareAllocation({index,plan,blueprint,locks=[],excludedKeys=[]}) {
    const current=core.validatePlan(jsonData(plan,'组题方案')),bp=validateBlueprint(blueprint);
    const fixed=assignments(jsonData(locks,'锁定列表'),'锁定列表').sort((a,b)=>compare(a.slotId,b.slotId));
    const excluded=jsonData(excludedKeys,'排除列表');if(!Array.isArray(excluded))throw error('BLUEPRINT_INVALID','排除列表须为列表');
    const excludedList=[...new Set(excluded.map(value=>string(value,'排除标识',4608)))].sort(compare),exclude=new Set(excludedList);
    if(!Array.isArray(index?.items))throw error('BLUEPRINT_INVALID','来源索引无效');
    const issues=[],conflicts=[],rows=bp.rows,slots=rows.flatMap(row=>Array.from({length:row.count},(_,i)=>({rowId:row.rowId,slotId:row.rowId+':'+(i+1)})));
    const slotMap=new Map(slots.map(slot=>[slot.slotId,slot])),usedIds=new Set(current.entries.map(entry=>entry.sourceId).filter(Boolean)),usedPaths=new Set(current.entries.map(entry=>entry.sourcePath).filter(Boolean));
    const idCounts=new Map(),pathCounts=new Map();
    for(const item of index.items){pathCounts.set(item.path,(pathCounts.get(item.path)||0)+1);if(item.id)idCounts.set(item.id,(idCounts.get(item.id)||0)+1);}
    const safe=item=>item.kind==='question'&&!item.identityConflict&&pathCounts.get(item.path)===1&&(!item.id||idCounts.get(item.id)===1);
    const matches=new Map(index.items.map(item=>[item,new Set()]));
    for(const row of rows)for(const item of core.filterItems(index,{...row.filters,kind:'question'}))matches.get(item)?.add(row.rowId);
    const cap=bp.constraints.maxPerFamily,candidates=[];
    for(const item of index.items) {
      if(!safe(item)||usedPaths.has(item.path)||item.id&&usedIds.has(item.id)||exclude.has(identity(item))||!matches.get(item)?.size)continue;
      const fam=family(item,core);
      if(cap!==null&&!fam.familyValid){issues.push(issue('INVALID_FAMILY','题族字段无效，该题不能参与受限分配',{path:item.path}));continue;}
      candidates.push({key:identity(item),id:item.id||'',path:item.path,fingerprint:item.fingerprint,title:item.title,role:item.role,
        ...fam,rowIds:[...matches.get(item)].sort(compare)});
    }
    candidates.sort((a,b)=>compare(a.key,b.key)||compare(a.path,b.path));
    const candidateMap=new Map(candidates.map(item=>[item.key,item])),resolved=core.resolvePlan(current,index),resolvedMap=new Map(resolved.entries.map(value=>[value.entry.entryId,value]));
    const baseFamilies=new Map(),planItems=new Map();
    for(const value of resolved.entries)if(value.entry.kind==='question') {
      if(cap!==null&&value.status!=='ok')conflicts.push(issue('PLAN_SOURCE_UNRESOLVED','开启题族上限前须处理已有题的来源',{entryId:value.entry.entryId,status:value.status}));
      if(value.status==='ok'&&value.item) {
        const item={...sourceOf(value.item),key:identity(value.item),...family(value.item,core)};planItems.set(value.entry.entryId,item);
        if(cap!==null&&!item.familyValid)conflicts.push(issue('PLAN_FAMILY_INVALID','已有题的题族字段无效',{entryId:value.entry.entryId}));
        if(item.familyValid&&item.familyId)baseFamilies.set(item.familyId,(baseFamilies.get(item.familyId)||0)+1);
      }
    }
    if(cap!==null)for(const [familyId,count]of baseFamilies)if(count>cap)conflicts.push(issue('PLAN_FAMILY_LIMIT','已有方案已超过题族上限',{familyId,count,limit:cap}));
    const occupiedSlots=new Set(),lockedIds=new Set(),lockedPaths=new Set(),entryIds=new Set();
    for(const lock of fixed) {
      const slot=slotMap.get(lock.slotId);let valid=true;
      const fail=(code,message)=>{conflicts.push(issue(code,message,{rowId:lock.rowId,slotId:lock.slotId}));valid=false;};
      if(!slot||slot.rowId!==lock.rowId)fail('LOCK_SLOT_INVALID','锁定槽不在当前配额行内');
      if(occupiedSlots.has(lock.slotId)||lockedPaths.has(lock.sourcePath)||lock.sourceId&&lockedIds.has(lock.sourceId))fail('LOCK_DUPLICATE','同一槽或题不能锁定两次');
      occupiedSlots.add(lock.slotId);lockedPaths.add(lock.sourcePath);if(lock.sourceId)lockedIds.add(lock.sourceId);
      if(lock.origin==='plan') {
        const value=resolvedMap.get(lock.existingEntryId);
        if(value?.entry.fragmentRef)fail('LOCK_PARTIAL_QUESTION','已选小问不能充抵整题配额；请先在编排中恢复整题');
        if(entryIds.has(lock.existingEntryId))fail('LOCK_DUPLICATE','已有编排项只能归属一行');entryIds.add(lock.existingEntryId);
        if(!value||value.entry.kind!=='question'||value.status!=='ok'||!sameSource(lock,sourceOf(value.item||{})))fail('LOCK_SOURCE_CHANGED','锁定的已有题缺失、冲突或来源已变化');
        else if(!safe(value.item)||!matches.get(value.item)?.has(lock.rowId)||exclude.has(identity(value.item)))fail('LOCK_FILTER_MISMATCH','锁定的已有题不满足本行条件');
      } else {
        const item=candidateMap.get(lock.sourceId?'id:'+lock.sourceId:'path:'+lock.sourcePath);
        if(!item||!sameSource(lock,sourceOf(item)))fail('LOCK_SOURCE_CHANGED','锁定候选缺失、冲突、已被使用或来源已变化');
        else if(!item.rowIds.includes(lock.rowId))fail('LOCK_FILTER_MISMATCH','锁定候选不满足本行条件');
      }
      if(!valid)continue;
    }
    if(!rows.length)conflicts.push(issue('EMPTY_BLUEPRINT','请先添加配额行'));
    const added=slots.length-fixed.filter(lock=>lock.origin==='plan').length;
    if(current.entries.length+added>MAX_ENTRIES)conflicts.push(issue('PLAN_CAPACITY_EXCEEDED','完整配额超过方案剩余容量',{current:current.entries.length,added,limit:MAX_ENTRIES}));
    const fixedFamilies=new Map(baseFamilies);
    if(cap!==null)for(const lock of fixed.filter(lock=>lock.origin==='candidate')){const item=candidateMap.get(lock.sourceId?'id:'+lock.sourceId:'path:'+lock.sourcePath);if(item?.familyId)fixedFamilies.set(item.familyId,(fixedFamilies.get(item.familyId)||0)+1);}
    if(cap!==null)for(const [familyId,count]of fixedFamilies)if(count>cap)conflicts.push(issue('LOCK_FAMILY_LIMIT','锁定题与已有方案合计超过题族上限',{familyId,count,limit:cap}));
    if(conflicts.length)return {status:'conflict',issues:[...conflicts,...issues]};
    const context=JSON.stringify({algorithmVersion:ALGORITHM,plan:current,blueprint:bp,locks:fixed,excludedKeys:excludedList,
      candidates,planFamilies:cap===null?[]:[...baseFamilies].sort((a,b)=>compare(a[0],b[0]))});
    return expose({context,blueprint:bp,plan:current,locks:fixed,excludedKeys:excludedList,slots,candidates,candidateMap,planItems,baseFamilies,issues,fixed});
  }
  const getState=problem=>{const state=problems.get(problem);if(!state)throw error('BLUEPRINT_INVALID','请使用本引擎当次准备的分配问题');return state;};
  function verifyAssignments(state,raw) {
    const values=assignments(jsonData(raw,'候选分配'),'候选分配');
    if(values.length!==state.slots.length)throw error('BLUEPRINT_STALE','候选未满足完整配额');
    const slots=new Map(state.slots.map(slot=>[slot.slotId,slot])),found=new Map(),ids=new Set(),paths=new Set(),families=new Map(state.baseFamilies);
    const locks=new Map(state.locks.map(lock=>[lock.slotId,lock]));
    for(const value of values) {
      const slot=slots.get(value.slotId),lock=locks.get(value.slotId);
      if(!slot||slot.rowId!==value.rowId||found.has(value.slotId)||paths.has(value.sourcePath)||value.sourceId&&ids.has(value.sourceId))
        throw error('BLUEPRINT_STALE','候选槽、行归属或题目唯一性无效');
      found.set(value.slotId,value);paths.add(value.sourcePath);if(value.sourceId)ids.add(value.sourceId);
      if(lock&&JSON.stringify(lock)!==JSON.stringify(value))throw error('BLUEPRINT_STALE','候选改变了锁定题或行归属');
      if(value.origin==='plan') {
        if(!lock||lock.origin!=='plan')throw error('BLUEPRINT_STALE','已有题必须有明确锁定行归属');
      } else {
        const item=state.candidateMap.get(value.sourceId?'id:'+value.sourceId:'path:'+value.sourcePath);
        if(!item||!sameSource(value,sourceOf(item))||!item.rowIds.includes(value.rowId))throw error('BLUEPRINT_STALE','候选来源或行条件已变化');
        if(item.familyId)families.set(item.familyId,(families.get(item.familyId)||0)+1);
      }
    }
    if(state.blueprint.constraints.maxPerFamily!==null)for(const count of families.values())if(count>state.blueprint.constraints.maxPerFamily)throw error('BLUEPRINT_STALE','候选超过全局题族上限');
    return state.slots.map(slot=>found.get(slot.slotId));
  }
  function allocateQuestions(problem,{seed='0',limits={},signal}={}) {
    const state=getState(problem);string(seed,'随机种子',512);limits=jsonData(limits,'计算预算');fields(limits,[],['maxEdges','maxOperations'],'计算预算');
    const maxEdges=integer(limits.maxEdges??250000,'边预算',0,2000000),maxOperations=integer(limits.maxOperations??5000000,'运算预算',0,200000000);
    let operations=0,edges=0;const tick=()=>{if(signal?.aborted)throw error('CANCELLED','分配已取消');if(++operations>maxOperations)throw error('BUDGET','分配计算超出预算');};
    const result=(status,values=[],diagnostics=[],rowCounts=new Map())=>{
      const selected=status==='complete'?verifyAssignments(state,values):[];
      const stats=state.blueprint.rows.map(row=>{const assigned=status==='complete'?selected.filter(item=>item.rowId===row.rowId).length:(rowCounts.get(row.rowId)||0);return {rowId:row.rowId,requested:row.count,
        locked:state.locks.filter(item=>item.rowId===row.rowId).length,available:state.candidates.filter(item=>item.rowIds.includes(row.rowId)).length+state.locks.filter(item=>item.origin==='plan'&&item.rowId===row.rowId).length,assigned,missing:row.count-assigned};});
      const counts=new Map(state.baseFamilies);for(const value of selected.filter(item=>item.origin==='candidate')){const item=state.candidateMap.get(value.sourceId?'id:'+value.sourceId:'path:'+value.sourcePath);if(item?.familyId)counts.set(item.familyId,(counts.get(item.familyId)||0)+1);}
      return {schemaVersion:1,algorithmVersion:ALGORITHM,status,seed,context:state.context,locks:jsonData(state.locks),assignments:selected,rowStats:stats,
        familyStats:[...counts].sort((a,b)=>compare(a[0],b[0])).map(([familyId,count])=>({familyId,count,limit:state.blueprint.constraints.maxPerFamily})),diagnostics:[...state.issues,...diagnostics]};
    };
    try {
      tick();const rng=random(seed),fixed=state.fixed,occupied=new Set(fixed.map(value=>value.slotId)),used=new Set(fixed.filter(value=>value.origin==='candidate').map(value=>value.sourceId?'id:'+value.sourceId:'path:'+value.sourcePath));
      const free=state.slots.filter(slot=>!occupied.has(slot.slotId)),demand=new Map();for(const slot of free)demand.set(slot.rowId,(demand.get(slot.rowId)||0)+1);
      const fixedCounts=new Map();for(const value of fixed)fixedCounts.set(value.rowId,(fixedCounts.get(value.rowId)||0)+1);
      if(!free.length)return result('complete',fixed);
      const cap=state.blueprint.constraints.maxPerFamily,families=new Map(state.baseFamilies);
      for(const value of fixed.filter(value=>value.origin==='candidate')){const item=state.candidateMap.get(value.sourceId?'id:'+value.sourceId:'path:'+value.sourcePath);if(item?.familyId)families.set(item.familyId,(families.get(item.familyId)||0)+1);}
      const available=shuffle(state.candidates.filter(item=>!used.has(item.key)&&(!state.allowedKeys||state.allowedKeys.has(item.key))),rng);
      const graph=[[],[]],source=0,sink=1,newNode=()=>{graph.push([]);return graph.length-1;};
      const add=(from,to,capacity)=>{tick();if(++edges>maxEdges)throw error('BUDGET','分配网络超出边预算');const forward={to,reverse:graph[to].length,capacity},reverse={to:from,reverse:graph[from].length,capacity:0};graph[from].push(forward);graph[to].push(reverse);return forward;};
      const rowNodes=new Map(),familyNodes=new Map(),chosen=[];
      for(const rowId of [...demand.keys()].sort(compare)){const node=newNode();rowNodes.set(rowId,node);add(node,sink,demand.get(rowId));}
      for(const item of available) {
        tick();const matching=shuffle(item.rowIds.filter(row=>demand.has(row)),rng);if(!matching.length)continue;
        const node=newNode();let parent=source;
        if(cap!==null&&item.familyId) {
          if(!familyNodes.has(item.familyId)){const familyNode=newNode();familyNodes.set(item.familyId,familyNode);add(source,familyNode,Math.max(0,cap-(families.get(item.familyId)||0)));}
          parent=familyNodes.get(item.familyId);
        }
        add(parent,node,1);
        for(const rowId of matching)chosen.push({item,rowId,edge:add(node,rowNodes.get(rowId),1)});
      }
      let flow=0;
      for(;;) {
        tick();const level=Array(graph.length).fill(-1),queue=[source];level[source]=0;
        for(let cursor=0;cursor<queue.length;cursor++)for(const edge of graph[queue[cursor]]){tick();if(edge.capacity>0&&level[edge.to]<0){level[edge.to]=level[queue[cursor]]+1;queue.push(edge.to);}}
        if(level[sink]<0)break;
        const positions=Array(graph.length).fill(0);
        const push=(node,amount)=>{tick();if(node===sink)return amount;while(positions[node]<graph[node].length){const edge=graph[node][positions[node]];tick();if(edge.capacity>0&&level[edge.to]===level[node]+1){const sent=push(edge.to,Math.min(amount,edge.capacity));if(sent){edge.capacity-=sent;graph[edge.to][edge.reverse].capacity+=sent;return sent;}}positions[node]++;}return 0;};
        let sent;while((sent=push(source,free.length-flow))>0){flow+=sent;if(flow===free.length)break;}if(flow===free.length)break;
      }
      const selected=fixed.slice(),freeByRow=new Map();for(const slot of free){if(!freeByRow.has(slot.rowId))freeByRow.set(slot.rowId,[]);freeByRow.get(slot.rowId).push(slot);}
      const assignedCounts=new Map(fixedCounts);
      for(const value of chosen)if(value.edge.capacity===0){selected.push(asAssignment(freeByRow.get(value.rowId).shift(),value.item));assignedCounts.set(value.rowId,(assignedCounts.get(value.rowId)||0)+1);}
      if(flow!==free.length)return result('infeasible',[],[issue('GLOBAL_QUOTA_SHORTFALL','完整候选池的最大流不足；约束未放宽',{required:free.length,allocated:flow,deficit:free.length-flow,
        rows:state.blueprint.rows.filter(row=>(assignedCounts.get(row.rowId)||0)<row.count).map(row=>row.rowId),familyLimit:cap,operations,edges})],assignedCounts);
      return result('complete',selected);
    } catch(failure) {
      if(failure.code==='BUDGET'||failure.code==='CANCELLED')return result(failure.code==='BUDGET'?'budget':'cancelled',[],[issue(failure.code,failure.message,{operations,edges})]);
      throw failure;
    }
  }
  function prepareReplacement({problem,allocation,targetSlotId,mode='row',candidateKey}) {
    const state=getState(problem),current=validateAllocation(allocation);
    if(current.status!=='complete'||current.context!==state.context)throw error('BLUEPRINT_STALE','换题候选已失效');
    const selected=verifyAssignments(state,current.assignments),target=selected.find(value=>value.slotId===targetSlotId);
    const conflict=(code,message)=>({status:'conflict',issues:[issue(code,message,{slotId:targetSlotId})]});
    if(!target)return conflict('REPLACEMENT_SLOT_INVALID','待换槽不存在');
    if(state.locks.some(value=>value.slotId===targetSlotId))return conflict('REPLACEMENT_LOCKED','请先解锁该槽再换题');
    if(!['row','same-family'].includes(mode))throw error('BLUEPRINT_INVALID','换题模式无效');
    const old=state.candidateMap.get(target.sourceId?'id:'+target.sourceId:'path:'+target.sourcePath);
    if(mode==='same-family'&&(!old?.familyValid||!old.familyId))return conflict('REPLACEMENT_FAMILY_UNKNOWN','未分类或题族字段无效，不能进行同族换题');
    if(candidateKey!==undefined)string(candidateKey,'指定候选',4608);
    const allowedKeys=new Set(state.candidates.filter(item=>item.key!==old.key&&item.rowIds.includes(target.rowId)&&
      (mode!=='same-family'||item.familyValid&&item.familyId===old.familyId)&&(candidateKey===undefined||item.key===candidateKey)).map(item=>item.key));
    if(candidateKey!==undefined&&!allowedKeys.has(candidateKey))return conflict('REPLACEMENT_FILTER_MISMATCH','指定替代题不符合原行或题族条件');
    return expose({...state,fixed:selected.filter(value=>value.slotId!==targetSlotId),allowedKeys,replacement:{targetSlotId,mode,previous:target}});
  }
  function updateAllocationLocks({index,plan,blueprint,locks,excludedKeys=[],allocation}) {
    const candidate=validateAllocation(allocation);
    if(candidate.status!=='complete')throw error('BLUEPRINT_STALE','只有完整候选可以更新锁定');
    const previous=prepareAllocation({index,plan,blueprint,locks:candidate.locks,excludedKeys});
    if(previous.status!=='ready'||previous.context!==candidate.context)
      throw error('BLUEPRINT_STALE','原候选上下文已变化，不能通过锁定更新恢复有效',previous.issues);
    verifyAssignments(getState(previous.problem),candidate.assignments);
    const next=prepareAllocation({index,plan,blueprint,locks,excludedKeys});
    if(next.status!=='ready')throw error('BLUEPRINT_REGENERATE_REQUIRED','锁定设置与完整候选冲突，请重新生成',next.issues);
    const state=getState(next.problem);
    try{verifyAssignments(state,candidate.assignments);}
    catch(failure){throw error('BLUEPRINT_REGENERATE_REQUIRED','锁定归属已改变，请重新生成候选',[issue(failure.code,failure.message)]);}
    return validateAllocation({...candidate,context:next.context,locks:state.locks,
      rowStats:candidate.rowStats.map(row=>({...row,locked:state.locks.filter(lock=>lock.rowId===row.rowId).length}))});
  }
  function applyAllocation({freshIndex,plan,blueprint,locks=[],excludedKeys=[],allocation,expectedContext,entryIdsBySlot}) {
    const candidate=validateAllocation(allocation);
    if(candidate.status!=='complete')throw error('BLUEPRINT_STALE','只有完整候选可以加入编排');
    const prepared=prepareAllocation({index:freshIndex,plan,blueprint,locks,excludedKeys});
    if(prepared.status!=='ready')throw error('BLUEPRINT_STALE','蓝图约束或锁定来源已变化',prepared.issues);
    if(typeof expectedContext!=='string'||prepared.context!==expectedContext||candidate.context!==expectedContext||JSON.stringify(candidate.locks)!==JSON.stringify(problems.get(prepared.problem).locks))
      throw error('BLUEPRINT_STALE','候选上下文已变化，请重新生成');
    const state=getState(prepared.problem),selected=verifyAssignments(state,candidate.assignments),ids=jsonData(entryIdsBySlot,'编排项 ID 映射');fields(ids,[],selected.filter(value=>value.origin==='candidate').map(value=>value.slotId),'编排项 ID 映射');
    const next=core.validatePlan(state.plan),bindings=[];
    for(const value of selected) {
      let entryId=value.existingEntryId;
      if(value.origin==='candidate') {
        entryId=string(ids[value.slotId],'新编排项 ID',512);const item=state.candidateMap.get(value.sourceId?'id:'+value.sourceId:'path:'+value.sourcePath),role=core.normalizeRole(item.role);
        next.entries.push({entryId,kind:'question',sourceId:item.id,sourcePath:item.path,sourceFingerprint:item.fingerprint,title:item.title,role:['例题','变式','训练'].includes(role)?role:''});
      }
      bindings.push({...value,entryId});
    }
    return {plan:core.validatePlan(next),bindings};
  }
  return {validateBlueprint,validateAllocation,prepareAllocation,allocateQuestions,prepareReplacement,updateAllocationLocks,applyAllocation,algorithmVersion:ALGORITHM};
}

module.exports={createBlueprintEngine};
