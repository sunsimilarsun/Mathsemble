'use strict';

// Persistent teaching facts. Export runs are deliberately a different domain.
// An action is one immutable document, so a plan is never partially registered.
const queues=new WeakMap(),DEFAULT_ROOT='Mathsemble/使用账本',MAX_BYTES=32*1024*1024;
const bad=(code,message)=>Object.assign(new Error(message),{code});
const sha=value=>require('node:crypto').createHash('sha256').update(value).digest('hex');
const size=value=>new TextEncoder().encode(value).length;
function data(value,depth=0,budget={count:0}) {
  if(++budget.count>100000||depth>24)throw bad('USAGE_INVALID','使用记录过大或嵌套过深');
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object')throw bad('USAGE_INVALID','使用记录必须为纯 JSON 数据');
  const array=Array.isArray(value),proto=Object.getPrototypeOf(value),descriptors=Object.getOwnPropertyDescriptors(value);
  if(proto!==(array?Array.prototype:Object.prototype)&&!(proto===null&&!array))throw bad('USAGE_INVALID','使用记录必须为普通对象');
  const keys=Reflect.ownKeys(descriptors);
  if(keys.some(key=>typeof key!=='string'||['__proto__','constructor','prototype'].includes(key)||descriptors[key].get||descriptors[key].set))throw bad('USAGE_INVALID','使用记录含非法属性');
  if(array){if(value.length>10000||keys.length!==value.length+1)throw bad('USAGE_INVALID','使用记录列表无效');return Array.from({length:value.length},(_,i)=>data(descriptors[i]?.value,depth+1,budget));}
  return Object.fromEntries(keys.sort().map(key=>[key,data(descriptors[key].value,depth+1,budget)]));
}
const canonical=value=>JSON.stringify(data(value));
function exact(value,fields) {if(!value||Array.isArray(value)||Object.keys(value).length!==fields.length||Object.keys(value).some(key=>!fields.includes(key)))throw bad('USAGE_INVALID','使用记录字段不匹配');}
function text(value,label,limit=512,empty=false) {if(typeof value!=='string'||value.length>limit||/[\x00-\x1f\x7f]/.test(value)||!empty&&!value.trim())throw bad('USAGE_INVALID',label+'无效');return value;}
function contextOf(raw) {
  const value=data(raw);exact(value,['classId','courseId']);
  const result={classId:text(value.classId,'班级代号',200,true).trim(),courseId:text(value.courseId,'课程代号',200,true).trim()};
  if(!result.classId&&!result.courseId)throw bad('USAGE_CONTEXT_REQUIRED','请至少填写一个班级或课程代号');return result;
}
const contextKey=context=>sha(canonical(contextOf(context)));
function pathOf(value) {text(value,'库内路径',4096);if(value.includes('\\')||value.includes(':')||value.startsWith('/')||value.split('/').some(part=>!part||part==='.'||part==='..'))throw bad('USAGE_INVALID','库内路径无效');return value;}
function dateOf(value,label='使用时间') {text(value,label,80);if(!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))throw bad('USAGE_INVALID',label+'无效');return new Date(value).toISOString();}
const identity=item=>`${item.kind}:${item.itemId!=null?'id:'+item.itemId:'path:'+item.path}`;
const itemIdentity=item=>identity({kind:item.kind,itemId:item.id?String(item.id).trim():null,path:item.path});
function commandOf(event) {
  const {createdAt,eventId,commandSha256,...command}=event;return command;
}
function validateEvent(raw,{expectedContext,expectedEventId,core}={}) {
  const event=data(raw);
  if(!['taught','assigned','revoke'].includes(event?.action))throw bad('USAGE_INVALID','不支持的使用事件类型；导出不属于教学记录');
  const base=['schemaVersion','kind','eventId','actionId','context','contextId','action','occurredAt','createdAt','commandSha256'];
  exact(event,event.action==='revoke'?[...base,'supersedes','reason']:[...base,'planSnapshotSha256','planTitle','items']);
  if(event.schemaVersion!==1||event.kind!=='mathsemble-usage-event')throw bad('USAGE_INVALID','不支持的使用记录版本');
  event.context=contextOf(event.context);text(event.actionId,'动作 ID',200);
  const key=contextKey(event.context),eventId=sha(key+'\n'+event.actionId);
  if(event.contextId!==key||event.eventId!==eventId||expectedContext&&key!==contextKey(expectedContext)||expectedEventId&&eventId!==expectedEventId)throw bad('USAGE_INVALID','使用记录身份或班级课程不匹配');
  if(dateOf(event.occurredAt)!==event.occurredAt||dateOf(event.createdAt)!==event.createdAt)throw bad('USAGE_INVALID','使用时间必须为规范 ISO 时间');
  if(event.action==='revoke') {
    if(!/^[a-f0-9]{64}$/.test(event.supersedes)||event.supersedes===eventId)throw bad('USAGE_INVALID','撤销目标无效');text(event.reason,'撤销说明',1000,true);
  } else {
    if(!/^[a-f0-9]{64}$/.test(event.planSnapshotSha256))throw bad('USAGE_INVALID','方案快照摘要无效');text(event.planTitle,'方案标题',500);
    if(!Array.isArray(event.items)||!event.items.length||event.items.length>1000)throw bad('USAGE_INVALID','登记条目数量无效');
    const entries=new Set(),identities=new Set(),paths=new Set();
    for(const item of event.items) {
      exact(item,['entryId','kind','itemId','path','sourceFingerprint','revisionSha256','markdown','title','role','fragmentRef','score']);
      text(item.entryId,'编排项 ID');if(!['question','knowledge'].includes(item.kind))throw bad('USAGE_INVALID','使用条目类型无效');
      if(item.itemId!==null&&(text(item.itemId,'材料 ID')!==item.itemId.trim()))throw bad('USAGE_INVALID','材料 ID 无效');
      pathOf(item.path);if(!/\.md$/i.test(item.path))throw bad('USAGE_INVALID','使用来源必须为 Markdown');
      text(item.sourceFingerprint,'来源指纹',128);text(item.title,'条目标题',500,true);text(item.role,'条目角色',50,true);
      if(item.fragmentRef!==null) {
        if(typeof core?.validateFragmentRef!=='function')throw bad('USAGE_INVALID','部分使用记录需要现行片段校验器');
        item.fragmentRef=core.validateFragmentRef(item.fragmentRef,item.kind);
      }
      if(item.score!==null) {
        if(item.kind!=='question'||typeof core?.validateScore!=='function')throw bad('USAGE_INVALID','使用记录分值无效');item.score=core.validateScore(item.score);
      }
      if(item.fragmentRef?.scores&&item.score!==item.fragmentRef.ids.reduce((sum,id)=>sum+Math.round(item.fragmentRef.scores[id]*100),0)/100)throw bad('USAGE_INVALID','当次分值与所选小问不一致');
      if(typeof item.markdown!=='string'||size(item.markdown)>MAX_BYTES||item.revisionSha256!==sha(item.markdown))throw bad('USAGE_INVALID','历史正文快照摘要不匹配');
      const key=identity(item);if(entries.has(item.entryId)||identities.has(key)||paths.has(item.path))throw bad('USAGE_INVALID','同次动作含重复条目');
      entries.add(item.entryId);identities.add(key);paths.add(item.path);
    }
  }
  if(event.commandSha256!==sha(canonical(commandOf(event))))throw bad('USAGE_INVALID','使用记录内容摘要不匹配');return event;
}
function ledgerOf(events,context,core) {
  const normalized=contextOf(context),all=events.map(event=>validateEvent(event,{expectedContext:normalized,core}));
  const byId=new Map();for(const event of all){if(byId.has(event.eventId))throw bad('USAGE_CORRUPT','使用记录事件重复');byId.set(event.eventId,event);}
  const revoked=new Set();for(const event of all)if(event.action==='revoke') {
    const target=byId.get(event.supersedes);if(!target||target.action==='revoke')throw bad('USAGE_CORRUPT','撤销事件找不到原始登记');revoked.add(event.supersedes);
  }
  all.sort((a,b)=>b.occurredAt.localeCompare(a.occurredAt)||a.eventId.localeCompare(b.eventId));
  return {schemaVersion:1,context:normalized,contextId:contextKey(normalized),events:all,revokedEventIds:[...revoked].sort(),activeEvents:all.filter(event=>event.action!=='revoke'&&!revoked.has(event.eventId))};
}
function summarizeUsage(items,ledger,{context,now=new Date().toISOString(),core}={}) {
  const normalized=contextOf(context),checked=ledgerOf(ledger?.events||[],normalized,core),until=Date.parse(dateOf(now));
  if(ledger?.contextId!==checked.contextId)throw bad('USAGE_CONTEXT_MISMATCH','使用账本与当前班级课程不匹配');
  const stats=new Map();
  for(const event of checked.activeEvents)if(Date.parse(event.occurredAt)<=until)for(const item of event.items) {
    const key=identity(item);if(!stats.has(key))stats.set(key,{key,count:0,taughtCount:0,assignedCount:0,partialCount:0,lastUsed:null,lastTaught:null,lastAssigned:null,versions:[]});
    const row=stats.get(key),field=event.action==='taught'?'lastTaught':'lastAssigned';row.count++;row[event.action+'Count']++;
    if(item.fragmentRef)row.partialCount++;
    if(!row.lastUsed||event.occurredAt>row.lastUsed)row.lastUsed=event.occurredAt;if(!row[field]||event.occurredAt>row[field])row[field]=event.occurredAt;
    if(!row.versions.includes(item.revisionSha256))row.versions.push(item.revisionSha256);
  }
  return (Array.isArray(items)?items:items?.items||[]).map(item=>({item,...(stats.get(itemIdentity(item))||{key:itemIdentity(item),count:0,taughtCount:0,assignedCount:0,partialCount:0,lastUsed:null,lastTaught:null,lastAssigned:null,versions:[]})}));
}
function filterUsage(items,ledger,options={}) {
  const {mode='all',days=30,now=new Date().toISOString()}=options;
  if(!['all','unused','taught-not-assigned'].includes(mode)||!Number.isSafeInteger(days)||days<1||days>36500)throw bad('USAGE_INVALID','使用筛选条件无效');
  const cutoff=Date.parse(dateOf(now))-days*86400000;
  return summarizeUsage(items,ledger,{...options,now}).filter(row=>mode==='all'||mode==='unused'&&(!row.lastUsed||Date.parse(row.lastUsed)<cutoff)||mode==='taught-not-assigned'&&row.lastTaught&&(!row.lastAssigned||row.lastTaught>row.lastAssigned)).map(row=>row.item);
}

function createUsageService({vault,core,scanIndex,now=()=>new Date().toISOString(),newId=()=>require('node:crypto').randomUUID(),root=DEFAULT_ROOT,timeoutMs=15000}={}) {
  if(!vault||!core||typeof scanIndex!=='function')throw new TypeError('使用账本需要 Vault、core 和新鲜索引读取器');
  root=pathOf(root);if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new TypeError('使用账本超时无效');const candidates=new WeakMap();
  const check=options=>{if(options?.signal?.aborted)throw Object.assign(bad('USAGE_ABORTED','使用记录操作已取消'),{name:'AbortError'});if(options?.isCurrent&&!options.isCurrent())throw bad('USAGE_STALE','方案、班级课程或窗口已变化，请重新核对');};
  const io=(fn,options={})=>new Promise((resolve,reject)=>{
    try{check(options);}catch(error){reject(error);return;}let settled=false;
    const done=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);options.signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>done(Object.assign(bad('USAGE_ABORTED','使用记录操作已取消'),{name:'AbortError'}));
    const timer=setTimeout(()=>done(bad('USAGE_TIMEOUT','读取使用记录超时')),timeoutMs);options.signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(fn).then(value=>{try{check(options);done(null,value);}catch(error){done(error);}},error=>done(error));
  });
  const serial=fn=>{const previous=queues.get(vault)||Promise.resolve(),task=previous.catch(()=>{}).then(fn);queues.set(vault,task);return task;};
  const folderFor=context=>root+'/'+contextKey(context);
  function watch(predicate) {
    let changed=false;const refs=[];
    if(vault.on&&vault.offref)for(const event of ['create','modify','delete','rename'])refs.push(vault.on(event,(file,oldPath)=>{if(predicate(file,oldPath))changed=true;}));
    return {check(){if(changed)throw bad('USAGE_STALE','来源或使用账本在操作期间发生变化，请刷新后重试');},dispose(){for(const ref of refs)vault.offref(ref);}};
  }
  async function readEvent(file,context,options={},budget) {
    const path=file.path,content=await io(()=>vault.read(file),options);
    if(file.path!==path||vault.getAbstractFileByPath(path)!==file)throw bad('USAGE_STALE','读取时使用记录已被替换');
    if(budget&&typeof content==='string'){budget.bytes+=size(content);if(budget.bytes>128*1024*1024)throw bad('USAGE_LIMIT','本班课程账本超过 128 MiB，请先备份并核对账本范围');}
    try {if(typeof content!=='string'||size(content)>MAX_BYTES)throw Error('size');const id=path.split('/').pop().replace(/\.json$/,'');return validateEvent(JSON.parse(content),{expectedContext:context,expectedEventId:id,core});}
    catch(error){throw bad('USAGE_CORRUPT','使用账本存在损坏或不兼容记录，未覆盖：'+path+'（'+error.message+'）');}
  }
  async function loadUsage({context},options={}) {
    context=contextOf(context);check(options);const path=folderFor(context),folder=vault.getAbstractFileByPath(path);
    if(!folder)return ledgerOf([],context,core);if(!Array.isArray(folder.children))throw bad('USAGE_CORRUPT','使用账本目录被文件占用');
    const guard=watch((file,oldPath)=>[file?.path,oldPath].some(value=>value===path||value?.startsWith(path+'/')));
    try {
    const files=folder.children.filter(file=>file.extension==='json');if(files.length>20000)throw bad('USAGE_LIMIT','本班课程使用记录超过读取上限');
    const events=[],budget={bytes:0};for(const file of files){if(!/^[a-f0-9]{64}\.json$/.test(file.name||file.path.split('/').pop()))throw bad('USAGE_CORRUPT','使用账本文件名无效：'+file.path);events.push(await readEvent(file,context,options,budget));}
    check(options);const current=vault.getAbstractFileByPath(path);if(current!==folder||current.children.filter(file=>file.extension==='json').length!==files.length||files.some(file=>!current.children.includes(file)))throw bad('USAGE_STALE','读取期间使用账本已变化，请刷新');
    guard.check();return ledgerOf(events,context,core);
    } finally {guard.dispose();}
  }
  async function capture(rawPlan,entryIds,options={}) {
    const plan=core.validatePlan(data(rawPlan)),planSnapshotSha256=sha(canonical(plan));
    const selected=entryIds===undefined?plan.entries.filter(entry=>entry.kind!=='section').map(entry=>entry.entryId):data(entryIds);
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'||!plan.entries.some(entry=>entry.entryId===id&&entry.kind!=='section')))throw bad('USAGE_INVALID','请选择方案中至少一个有效题目或知识条目');
    let changed=false;const refs=[];
    const dirty=(file,oldPath)=>{if(/\.md$/i.test(file?.path||'')||/\.md$/i.test(oldPath||'')||Array.isArray(file?.children))changed=true;};
    try {
      if(vault.on&&vault.offref)for(const name of ['create','modify','delete','rename'])refs.push(vault.on(name,dirty));
      const index=await io(()=>scanIndex(options),options);if(index.issues?.some(issue=>issue.code==='read-error'))throw bad('USAGE_SOURCE_INVALID','存在未能读取的来源，无法确认材料身份');
      const resolved=core.resolvePlan(plan,index),rows=resolved.entries.filter(row=>selected.includes(row.entry.entryId));
      if(rows.some(row=>row.status!=='ok'||!row.item||row.item.identityConflict))throw bad('USAGE_SOURCE_CHANGED','登记来源已变化、缺失或存在冲突，请先在编排中核对');
      const items=[];for(const {entry,item}of rows) {
        const file=vault.getAbstractFileByPath(item.path);if(!file||file.extension!=='md')throw bad('USAGE_SOURCE_CHANGED','登记来源已缺失');
        const markdown=await io(()=>vault.read(file),options);if(file.path!==item.path||vault.getAbstractFileByPath(item.path)!==file||markdown!==item.markdown)throw bad('USAGE_SOURCE_CHANGED','登记来源在核对期间发生变化');
        items.push({entryId:entry.entryId,kind:entry.kind,itemId:item.id||null,path:item.path,sourceFingerprint:item.fingerprint,revisionSha256:sha(markdown),markdown,title:entry.title,role:entry.role,fragmentRef:entry.fragmentRef?data(entry.fragmentRef):null,score:entry.score??null});
      }
      check(options);if(changed||sha(canonical(core.validatePlan(rawPlan)))!==planSnapshotSha256)throw bad('USAGE_SOURCE_CHANGED','来源或方案在核对期间发生变化');
      const result={planSnapshotSha256,planTitle:plan.title,items};if(size(canonical(result))>MAX_BYTES-10000)throw bad('USAGE_LIMIT','本次使用快照超过 32 MiB，请分批登记');return {plan,selected,...result};
    } finally {for(const ref of refs)vault.offref(ref);}
  }
  async function preparePlanUsage({plan,context,action,entryIds,occurredAt=now()},options={}) {
    if(!['taught','assigned'].includes(action))throw bad('USAGE_INVALID','只能显式登记已讲授或已布置');context=contextOf(context);occurredAt=dateOf(occurredAt);
    if(Date.parse(occurredAt)>Date.parse(dateOf(now()))+300000)throw bad('USAGE_INVALID','实际使用时间不能在未来');
    await loadUsage({context},options);const snapshot=await capture(plan,entryIds,options);
    const wrapper={schemaVersion:1,context,action,occurredAt,planSnapshotSha256:snapshot.planSnapshotSha256,planTitle:snapshot.planTitle,items:data(snapshot.items)};
    candidates.set(wrapper,{...snapshot,context:data(context),action,occurredAt,config:data(options.config||null)});return wrapper;
  }
  async function ensureFolder(path) {
    let current='';for(const part of path.split('/')){current=current?current+'/'+part:part;let node=vault.getAbstractFileByPath(current);if(!node){try{await vault.createFolder(current);}catch(error){if(!Array.isArray(vault.getAbstractFileByPath(current)?.children))throw error;}node=vault.getAbstractFileByPath(current);}if(!Array.isArray(node?.children))throw bad('USAGE_CORRUPT','使用账本目录被文件占用');}
  }
  function makeEvent(command,actionId) {
    text(actionId,'动作 ID',200);const contextId=contextKey(command.context),event={schemaVersion:1,kind:'mathsemble-usage-event',actionId,contextId,...data(command),createdAt:dateOf(now()),eventId:sha(contextId+'\n'+actionId)};
    event.commandSha256=sha(canonical(commandOf(event)));return validateEvent(event,{core});
  }
  async function append(event,options={}) {
    const path=folderFor(event.context)+'/'+event.eventId+'.json',existing=vault.getAbstractFileByPath(path);
    const match=async file=>{const stored=await readEvent(file,event.context,{});if(stored.commandSha256!==event.commandSha256)throw bad('USAGE_ACTION_CONFLICT','动作 ID 已用于不同的登记，请勿重复利用');return {event:stored,path,state:'saved',idempotent:true};};
    if(existing)return match(existing);await ensureFolder(folderFor(event.context));check(options);
    const content=JSON.stringify(event,null,2)+'\n';if(size(content)>MAX_BYTES)throw bad('USAGE_LIMIT','本次使用记录超过 32 MiB');
    // Vault.create is create-only. Once submitted, do not race cancellation or
    // a timeout against its completion; a possibly persisted event must survive.
    try {await vault.create(path,content);}
    catch(error){const file=vault.getAbstractFileByPath(path);if(file){try{return await match(file);}catch(verifyError){if(verifyError.code==='USAGE_ACTION_CONFLICT'||verifyError.code==='USAGE_CORRUPT')throw verifyError;}}throw Object.assign(bad('USAGE_WRITE_UNVERIFIED','登记写入结果未确认；请刷新后用同一动作重试，不要另建动作'),{path,cause:error});}
    const file=vault.getAbstractFileByPath(path);if(!file)throw Object.assign(bad('USAGE_WRITE_UNVERIFIED','登记写入后尚未确认；请刷新核对'),{path});
    try {const result=await match(file);return {...result,idempotent:false};}
    catch(error){if(error.code==='USAGE_CORRUPT'||error.code==='USAGE_ACTION_CONFLICT')throw error;throw Object.assign(bad('USAGE_WRITE_UNVERIFIED','登记已提交但回读未确认；请刷新后使用同一动作重试'),{path,cause:error});}
  }
  function recordPlanUsage(candidate,{actionId},options={}) {
    const state=candidates.get(candidate);if(!state)throw bad('USAGE_INVALID','登记候选无效，请重新核对当前方案');
    if(canonical(options.config||null)!==canonical(state.config))throw bad('USAGE_STALE','素材目录设置已变化，请重新核对登记');
    const event=makeEvent({context:state.context,action:state.action,occurredAt:state.occurredAt,planSnapshotSha256:state.planSnapshotSha256,planTitle:state.planTitle,items:state.items},actionId);
    return serial(async()=>{
      check(options);await loadUsage({context:state.context},options);const existing=vault.getAbstractFileByPath(folderFor(state.context)+'/'+event.eventId+'.json');
      if(existing)return append(event,options); // Retry of a verified commit does not reinterpret a later source revision.
      await ensureFolder(folderFor(state.context));
      const guard=watch((file,oldPath)=>/\.md$/i.test(file?.path||'')||/\.md$/i.test(oldPath||'')||Array.isArray(file?.children));
      const guarded={...options,isCurrent:()=>{check(options);guard.check();return true;}};
      try {
      const fresh=await capture(state.plan,state.selected,options);
      if(canonical(fresh.items)!==canonical(state.items)||fresh.planSnapshotSha256!==state.planSnapshotSha256)throw bad('USAGE_SOURCE_CHANGED','来源版本已变化，请重新核对登记');
      await loadUsage({context:state.context},options);check(options);return await append(event,guarded);
      } finally {guard.dispose();}
    });
  }
  function revokeUsage(eventId,{actionId,context,reason=''},options={}) {
    context=contextOf(context);text(reason,'撤销说明',1000,true);
    if(!/^[a-f0-9]{64}$/.test(eventId))throw bad('USAGE_INVALID','撤销目标无效');
    return serial(async()=>{
      check(options);const ledger=await loadUsage({context},options),target=ledger.events.find(event=>event.eventId===eventId);
      if(!target||target.action==='revoke')throw bad('USAGE_INVALID','只能撤销当前班级课程中的原始登记');
      const same=ledger.events.find(event=>event.actionId===actionId);
      if(same){if(same.action!=='revoke'||same.supersedes!==eventId||same.reason!==reason)throw bad('USAGE_ACTION_CONFLICT','动作 ID 已用于其他登记');return {event:same,path:folderFor(context)+'/'+same.eventId+'.json',state:'saved',idempotent:true};}
      if(ledger.revokedEventIds.includes(eventId))throw bad('USAGE_ALREADY_REVOKED','这次登记已经撤销');
      return append(makeEvent({context,action:'revoke',occurredAt:dateOf(now()),supersedes:eventId,reason},actionId),options);
    });
  }
  return {newActionId:()=>text(newId(),'动作 ID',200),preparePlanUsage,recordPlanUsage,revokeUsage,loadUsage,listUsage:loadUsage,
    filterUsage:(items,ledger,options)=>filterUsage(items,ledger,{...options,core}),selectUsage:(items,ledger,options)=>filterUsage(items,ledger,{...options,core}),
    summarizeUsage:(items,ledger,options)=>summarizeUsage(items,ledger,{...options,core}),validateEvent:raw=>validateEvent(raw,{core}),contextKey,root};
}
module.exports={createUsageService,validateEvent,contextKey,summarizeUsage,filterUsage,selectUsage:filterUsage};
