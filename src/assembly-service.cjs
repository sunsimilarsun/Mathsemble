'use strict';

// Host adapter: source notes are read-only. Only explicit plans and generated
// handouts are written, under dedicated output folders.
module.exports = function createAssemblyService(plugin, {core, compileMarkdown, collectMediaDependencies, blueprintEngine, familyEngine, similarityEngine, parseYaml, previewFile}) {
  const app = plugin.app, vault = app.vault;
  const planFolder = 'Mathsemble/组题方案', outputFolder = 'Mathsemble/讲义';
  const blueprintFolder = 'Mathsemble/组卷蓝图', runFolder = 'Mathsemble/组卷记录';
  let settings, data, saveQueue = Promise.resolve(), planIO = Promise.resolve();
  let blueprintIO = Promise.resolve();
  const cleanPath = value => {
    const path = String(value || '').trim().replace(/\\/g, '/').replace(/\/$/, '');
    if (!path || path.startsWith('/') || path.split('/').some(p => !p || p === '.' || p === '..') || /[\x00-\x1f]/.test(path))
      throw new Error('目录必须为库内相对路径，不能留空或包含 ..');
    return path;
  };
  const normalizeSettings = raw => {
    const roots = key => [...new Set((Array.isArray(raw?.[key]) ? raw[key] : []).filter(Boolean).map(cleanPath))];
    return {questionRoots:roots('questionRoots'), knowledgeRoots:roots('knowledgeRoots'), recursive:raw?.recursive !== false};
  };
  async function loadSettings() {
    if (!settings) {
      data = (await plugin.loadData()) || {};
      const existing = path => vault.getAbstractFileByPath(path) ? [path] : [];
      settings = normalizeSettings(data.assemblySettings || {
        questionRoots:existing('数学教学/初中题库'),
        knowledgeRoots:[...existing('数学教学/高中知识'), ...existing('数学教学/初中知识')], recursive:true});
    }
    return JSON.parse(JSON.stringify(settings));
  }
  async function saveSettings(raw) {
    await loadSettings();
    const next = normalizeSettings(raw);
    for (const path of [...next.questionRoots,...next.knowledgeRoots]) {
      if (!Array.isArray(vault.getAbstractFileByPath(path)?.children)) throw new Error('目录不存在：' + path);
    }
    // Serialize settings saves so a slow write cannot restore an older config.
    const task = saveQueue.catch(() => {}).then(async () => {
      await plugin.saveData({...data,assemblySettings:next});
      settings = next; data = {...data,assemblySettings:next};
    });
    saveQueue = task; await task;
  }
  function frontmatter(markdown) {
    const match = markdown.replace(/^\uFEFF/, '').match(/^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)(?:\r?\n|$)/);
    const result = match ? parseYaml(match[1]) : {};
    if (result == null) return {};
    if (typeof result !== 'object' || Array.isArray(result)) throw new Error('元信息必须为字段对象');
    return result;
  }
  const excluded = path => /(^|\/)(?:\.[^/]+|_高中知识登记|assets|node_modules|ExamExports|模板&规范|Mathsemble)(\/|$)/i.test(path) ||
    /(?:【模板】|【示例】|复测样例|Q-DEMO-|Q-CANONICAL-|整卷验收_)/i.test(path);
  const abortError = () => Object.assign(new Error('来源核对已取消'),{name:'AbortError'});
  function readContext({signal,timeoutMs = 60000,resourceTimeoutMs = 15000} = {}) {
    if (!(Number.isFinite(timeoutMs) && timeoutMs > 0 && Number.isFinite(resourceTimeoutMs) && resourceTimeoutMs > 0))
      throw new Error('来源读取超时设置无效');
    const deadline = Date.now() + timeoutMs, pending = new Set();
    let closed = false;
    const check = () => {
      if (closed || signal?.aborted) throw abortError();
      if (Date.now() >= deadline) throw Object.assign(new Error('来源核对超时，请重试'),{code:'MWB_ASSEMBLY_TIMEOUT'});
    };
    const run = (operation,label) => {
      check();
      return new Promise((resolve,reject) => {
        let settled = false;
        const finish = (error,value) => {
          if (settled) return;
          settled = true; clearTimeout(timer); signal?.removeEventListener('abort',onAbort); pending.delete(cancel);
          if (error) reject(error); else resolve(value);
        };
        const onAbort = () => finish(abortError()), cancel = () => finish(abortError());
        const timer = setTimeout(() => finish(Object.assign(new Error(label+'超时，请重试'),{code:'MWB_ASSEMBLY_TIMEOUT'})),
          Math.max(1,Math.min(resourceTimeoutMs,deadline-Date.now())));
        pending.add(cancel); signal?.addEventListener('abort',onAbort,{once:true});
        Promise.resolve().then(() => {check();return operation();}).then(value => {
          try {check();finish(null,value);} catch(error) {finish(error);}
        },error => finish(error));
      });
    };
    return {check,run,close:() => {closed=true;for (const cancel of [...pending]) cancel();}};
  }
  function beginSourceCheck(raw,onChange,extraPaths=[]) {
    const config = normalizeSettings(raw), roots = [...config.questionRoots,...config.knowledgeRoots];
    let changed = false, disposed = false;
    const refs = [];
    const relevant = (path,folder) => {
      if (typeof path !== 'string') return false;
      if(extraPaths.some(extra=>extra===path||folder&&extra.startsWith(path+'/')))return true;
      if (folder && roots.some(root => root === path || root.startsWith(path + '/'))) return true;
      if (excluded(path) || !folder && !/\.md$/i.test(path)) return false;
      return roots.some(root => path.startsWith(root + '/') &&
        (folder || config.recursive || !path.slice(root.length + 1).includes('/')));
    };
    const invalidate = (event,file,oldPath) => {
      if (disposed) return;
      const folder = Array.isArray(file?.children);
      if (relevant(file?.path,folder) || relevant(oldPath,folder)) {
        changed = true; onChange?.(event,file,oldPath);
      }
    };
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      for (const ref of refs) vault.offref(ref);
      refs.length = 0;
    };
    try {
      // Watch the whole scan scope: a new/edited note can introduce a duplicate
      // identity, even when it was not among the originally selected notes.
      for (const event of ['create','modify','delete','rename']) refs.push(vault.on(event,(file,oldPath)=>invalidate(event,file,oldPath)));
    } catch (error) { dispose(); throw error; }
    return {isCurrent:() => !changed && !disposed,
      assertCurrent:() => {if (changed || disposed) throw new Error('来源在核对期间发生变化，请刷新素材后重新生成候选');},dispose};
  }
  async function scan(raw,options = {}) {
    const io = options.io || readContext(options);
    try {
    const config = normalizeSettings(raw || await io.run(loadSettings,'读取素材目录'));
    const inside = (path, roots) => roots.some(root => path.startsWith(root + '/') &&
      (config.recursive || !path.slice(root.length + 1).includes('/')));
    const files = vault.getMarkdownFiles().filter(file => !excluded(file.path) &&
      (inside(file.path,config.questionRoots) || inside(file.path,config.knowledgeRoots)));
    const records = [], issues = [];
    // Metadata and contents come from the same read, never from a stale cache.
    for (let offset = 0; offset < files.length; offset += 20) {
      await Promise.all(files.slice(offset,offset + 20).map(async file => {
        const path = file.path;
        try {
          const markdown = await io.run(()=>vault.read(file),'读取素材 '+path), metadata = frontmatter(markdown);
          if (file.path !== path || vault.getAbstractFileByPath(path) !== file) throw new Error('扫描时文件已改名或替换，请重新扫描');
          const type = String(metadata.question_type || metadata.type || '').toLowerCase();
          const question = /^(choice|single_choice|multiple_choice|fill_blank|true_false|short_answer|calculation|proof|comprehensive|单选题?|多选题?|填空题?|判断题?|解答题?)$/.test(type);
          const knowledge = inside(path,config.knowledgeRoots) &&
            !/^(README|章节导航|待补清单)\.md$/i.test(file.name);
          if (question && inside(path,config.questionRoots)) records.push({path,markdown,metadata,kind:'question'});
          else if (knowledge) records.push({path,markdown,metadata,kind:'knowledge'});
        } catch (error) {
          if (error?.name === 'AbortError' || error?.code === 'MWB_ASSEMBLY_TIMEOUT') throw error;
          issues.push({code:'read-error',path,message:error.message});
        }
      }));
    }
    records.sort((a,b) => a.path.localeCompare(b.path,'zh-CN'));
    const index = core.buildIndex(records);
    index.issues.push(...issues);
    io.check(); return index;
    } finally {if (!options.io) io.close();}
  }
  async function ensureFolder(path) {
    let current = '';
    for (const segment of path.split('/')) {
      current = current ? current + '/' + segment : segment;
      const node = vault.getAbstractFileByPath(current);
      if (node && !Array.isArray(node.children)) throw new Error('输出目录被同名文件占用：' + current);
      if (!node) {
        try { await vault.createFolder(current); }
        catch (error) { if (!Array.isArray(vault.getAbstractFileByPath(current)?.children)) throw error; }
      }
    }
  }
  const stem = title => String(title || '新讲义').replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,80).replace(/[. ]+$/, '') || '新讲义';
  const uniquePath = (folder,title,extension) => {
    const stamp = new Date().toISOString().replace(/[:.]/g,'-');
    let path = `${folder}/${stem(title)}_${stamp}.${extension}`, n = 1;
    while (vault.getAbstractFileByPath(path)) path = `${folder}/${stem(title)}_${stamp}_${n++}.${extension}`;
    return path;
  };
  async function listPlans() {
    const folder = vault.getAbstractFileByPath(planFolder);
    return (folder?.children || []).filter(file => file.extension === 'json')
      .map(file => ({path:file.path,title:file.basename})).sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
  }
  const planPath = path => {
    const clean = cleanPath(path);
    if (!clean.startsWith(planFolder + '/') || clean.slice(planFolder.length + 1).includes('/') || !clean.endsWith('.json'))
      throw new Error('方案只能保存在 Mathsemble/组题方案 中');
    return clean;
  };
  function queuePlanIO(action) {
    const task = planIO.catch(() => {}).then(action);
    planIO = task;
    return task;
  }
  function createPlanSession() {
    // Each view remembers what it actually read. Another view's save must not
    // advance this baseline and silently authorize overwriting its changes.
    const knownPlanContents = new Map();
    return {
      async savePlan(raw,path) {
        const plan = core.validatePlan(raw), requestedPath = path ? planPath(path) : null;
        return queuePlanIO(async () => {
          await ensureFolder(planFolder);
          const target = requestedPath || uniquePath(planFolder,plan.title,'json');
          const file = vault.getAbstractFileByPath(target), text = JSON.stringify(plan,null,2) + '\n';
          if (file) {
            if (!knownPlanContents.has(target)) throw new Error('请先打开该方案再保存，或另存为新方案');
            if (await vault.read(file) !== knownPlanContents.get(target)) throw new Error('方案文件已被外部修改，请重新打开后再保存');
            if(plan.schemaVersion===4&&JSON.parse(knownPlanContents.get(target)).schemaVersion<4)
              throw Object.assign(new Error('分值或稳定片段需要方案 v4，请另存为新方案；原方案保留，旧插件不能读取 v4'),{code:'PLAN_V4_SAVE_AS_REQUIRED'});
            await vault.modify(file,text);
          } else await vault.create(target,text);
          knownPlanContents.set(target,text);
          return target;
        });
      },
      async loadPlan(path) {
        const target = planPath(path);
        return queuePlanIO(async () => {
          const file = vault.getAbstractFileByPath(target);
          if (!file || file.extension !== 'json') throw new Error('方案文件不存在');
          const text = await vault.read(file), plan = core.validatePlan(JSON.parse(text));
          knownPlanContents.set(file.path,text);
          return plan;
        });
      }
    };
  }
  const {savePlan,loadPlan} = createPlanSession();

  // Sidecars have their own schema and I/O session. Neither loading an old
  // plan nor using the existing selection/preview routes needs this engine.
  const engine = () => {
    if (!blueprintEngine || !['validateBlueprint','prepareAllocation','allocateQuestions','applyAllocation','validateAllocation']
      .every(key=>typeof blueprintEngine[key] === 'function')) throw new Error('组卷蓝图引擎未配置');
    return blueprintEngine;
  };
  function plainData(value,depth = 0) {
    if (depth>32) throw new Error('侧车数据嵌套过深');
    if (value===null || typeof value==='string' || typeof value==='boolean' || typeof value==='number'&&Number.isFinite(value)) return value;
    if (!value || typeof value!=='object' || Object.getOwnPropertySymbols(value).length ||
        ![Object.prototype,null,Array.prototype].includes(Object.getPrototypeOf(value))) throw new Error('侧车数据必须是纯 JSON');
    const descriptors=Object.getOwnPropertyDescriptors(value);
    for(const [key,entry] of Object.entries(descriptors))
      if (['__proto__','prototype','constructor'].includes(key) || entry.get || entry.set) throw new Error('侧车数据含不允许的属性');
    if(Array.isArray(value)) {
      if(value.length>10000 || Object.keys(value).length!==value.length || Object.keys(value).some(key=>!/^(0|[1-9]\d*)$/.test(key))) throw new Error('侧车列表无效');
      return value.map(item=>plainData(item,depth+1));
    }
    return Object.fromEntries(Object.keys(value).sort().map(key=>[key,plainData(descriptors[key].value,depth+1)]));
  }
  const exact = (value,fields,label) => {
    if (!value || Array.isArray(value) || typeof value!=='object' || Object.keys(value).some(key=>!fields.includes(key)))
      throw new Error(label+'含未知字段或结构无效');
  };
  const boundedText = (value,label,max=4096,empty=false) => {
    if(typeof value!=='string' || value.length>max || (!empty&&!value.trim()) || /[\x00-\x1f\x7f]/.test(value)) throw new Error(label+'无效');
    return value;
  };
  const strongDigest = value => require('node:crypto').createHash('sha256').update(JSON.stringify(plainData(value))).digest('hex');
  const newId = () => require('node:crypto').randomUUID();
  const planDigest = raw => strongDigest(core.validatePlan(raw));
  const indexDigest = index => strongDigest({items:index.items.map(item=>({path:item.path,kind:item.kind,markdown:item.markdown}))
    .sort((a,b)=>a.path.localeCompare(b.path)),issues:index.issues});
  const sidecarPath = (path,folder) => {
    const clean=cleanPath(path);
    if(!clean.startsWith(folder+'/') || clean.slice(folder.length+1).includes('/') || !clean.endsWith('.json')) throw new Error('侧车只能保存在 '+folder+' 中');
    return clean;
  };
  const listSidecars = folder => (vault.getAbstractFileByPath(folder)?.children || []).filter(file=>file.extension==='json')
    .map(file=>({path:file.path,title:file.basename})).sort((a,b)=>a.title.localeCompare(b.title,'zh-CN'));
  async function listBlueprints() { return listSidecars(blueprintFolder); }
  async function listBlueprintRuns() { return listSidecars(runFolder); }
  async function listMatchingBlueprintRuns(rawPlan,options={}) {
    const plan=core.validatePlan(rawPlan),digest=planDigest(plan),io=readContext(options),matches=[];
    try {
      for(const item of listSidecars(runFolder)) {
        originCheck(options);io.check();
        const file=vault.getAbstractFileByPath(item.path);
        try {
          if(!file || file.extension!=='json') continue;
          const run=validateBlueprintRun(parseSidecar(await io.run(()=>vault.read(file),'读取组卷记录')));
          if(file.path!==item.path || vault.getAbstractFileByPath(item.path)!==file || run.resultPlanDigest!==digest) continue;
          matchRunPlan(run,plan);
          matches.push({path:item.path,title:run.blueprintSnapshot.title,createdAt:run.createdAt,runId:run.runId});
        } catch(error) {
          if(error?.name==='AbortError'||error?.code==='MWB_ASSEMBLY_TIMEOUT') throw error;
          // Unknown, broken or unrelated sidecars never prevent opening an old plan.
        }
      }
      originCheck(options);io.check();
      if(planDigest(rawPlan)!==digest) throw new Error('方案已变化，请重新查找配额记录');
      return matches;
    } finally {io.close();}
  }
  const queueBlueprintIO = action => {
    const task=blueprintIO.catch(()=>{}).then(action);blueprintIO=task;return task;
  };
  const parseSidecar = source => {
    if(typeof source!=='string' || source.length>8*1024*1024) throw new Error('侧车文件过大或内容无效');
    return plainData(JSON.parse(source));
  };
  function createBlueprintSession() {
    const known=new Map();
    return {
      async loadBlueprint(path) {
        const target=sidecarPath(path,blueprintFolder),api=engine();
        return queueBlueprintIO(async()=>{
          const file=vault.getAbstractFileByPath(target);
          if(!file || file.extension!=='json') throw new Error('蓝图文件不存在');
          const text=await vault.read(file),blueprint=api.validateBlueprint(parseSidecar(text));
          if(file.path!==target || vault.getAbstractFileByPath(target)!==file) throw new Error('读取时蓝图文件已被替换');
          known.set(target,{file,text});return blueprint;
        });
      },
      async saveBlueprint(raw,path) {
        const blueprint=engine().validateBlueprint(raw),requested=path?sidecarPath(path,blueprintFolder):null;
        return queueBlueprintIO(async()=>{
          await ensureFolder(blueprintFolder);
          const target=requested || `${blueprintFolder}/${stem(blueprint.title)}_${newId()}.json`;
          const previous=known.get(target),file=vault.getAbstractFileByPath(target),text=JSON.stringify(blueprint,null,2)+'\n';
          if(requested && previous && (!file || file!==previous.file)) throw new Error('蓝图文件已被外部删除或替换，请重新打开或另存');
          if(file) {
            if(!previous) throw new Error('请先打开该蓝图再保存，或另存为新蓝图');
            if(await vault.read(file)!==previous.text || file.path!==target || vault.getAbstractFileByPath(target)!==file)
              throw new Error('蓝图文件已被外部修改，请重新打开后再保存');
            await vault.modify(file,text);
          } else await vault.create(target,text);
          known.set(target,{file:vault.getAbstractFileByPath(target),text});return target;
        });
      }
    };
  }
  const {saveBlueprint,loadBlueprint}=createBlueprintSession();
  function originCheck(options) {
    if(options.isCurrent && !options.isCurrent()) throw abortError();
  }
  const sourcesFromIndex = index => index.items.map(item=>({path:item.path,markdown:item.markdown,live:vault.getAbstractFileByPath(item.path)}));
  async function generateBlueprintCandidate(input,options={}) {
    const api=engine(),plan=core.validatePlan(input.plan),blueprint=api.validateBlueprint(input.blueprint);
    const locks=plainData(input.locks || []),excludedKeys=plainData(input.excludedKeys || []);
    const io=readContext(options);let guard;
    try {
      originCheck(options);io.check();
      const config=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      guard=beginSourceCheck(config);
      const index=await scan(config,{io}),sourceSnapshotDigest=indexDigest(index),sources=sourcesFromIndex(index);
      const prepared=api.prepareAllocation({index,plan,blueprint,locks,excludedKeys});
      const allocation=prepared.status==='ready' ? api.allocateQuestions(prepared.problem,{seed:input.seed,limits:options.limits,signal:options.signal}) : null;
      await recheckSources(sources,io,guard);originCheck(options);guard.assertCurrent();
      return {schemaVersion:1,status:allocation?.status || prepared.status,index,blueprint,locks:allocation ? plainData(allocation.locks) : locks,excludedKeys,
        allocation,context:prepared.context || null,issues:prepared.issues || [],config,
        basePlanSnapshot:plan,basePlanSnapshotDigest:planDigest(plan),sourceSnapshotDigest};
    } finally {guard?.dispose();io.close();}
  }
  function candidateState(candidate) {
    if(!candidate || Object.getPrototypeOf(candidate)!==Object.prototype || Reflect.ownKeys(candidate).some(key=>
      typeof key!=='string' || ['__proto__','prototype','constructor'].includes(key) ||
      Object.getOwnPropertyDescriptor(candidate,key).get || Object.getOwnPropertyDescriptor(candidate,key).set))
      throw new Error('蓝图候选结构无效');
    if(candidate.schemaVersion!==1 || candidate.status!=='complete') throw new Error('配额候选未完整满足，不能加入编排');
    const api=engine(),plan=core.validatePlan(candidate.basePlanSnapshot),blueprint=api.validateBlueprint(candidate.blueprint);
    if(planDigest(plan)!==candidate.basePlanSnapshotDigest) throw new Error('候选基准方案已变化');
    const locks=plainData(candidate.locks),allocation=api.validateAllocation(candidate.allocation);
    if(candidate.context!==allocation.context || JSON.stringify(plainData(allocation.locks))!==JSON.stringify(locks)) throw new Error('候选锁定上下文已变化');
    return {api,plan,blueprint,locks,excludedKeys:plainData(candidate.excludedKeys),allocation};
  }
  function replaceBlueprintCandidate(candidate,{targetSlotId,mode='row',seed,candidateKey,limits,signal}={}) {
    const {api,plan,blueprint,locks,excludedKeys,allocation}=candidateState(candidate);
    const prepared=api.prepareAllocation({index:candidate.index,plan,blueprint,locks,excludedKeys});
    if(prepared.status!=='ready' || prepared.context!==candidate.context || allocation.context!==candidate.context) throw new Error('换题候选上下文已变化，请重新生成');
    const replacement=api.prepareReplacement({problem:prepared.problem,allocation,targetSlotId,mode,candidateKey});
    if(replacement.status!=='ready') return {...candidate,status:replacement.status,issues:replacement.issues || [],allocation:null};
    const next=api.allocateQuestions(replacement.problem,{seed:seed ?? allocation.seed,limits,signal});
    return {...candidate,status:next.status,allocation:next,context:next.context,locks:plainData(next.locks),issues:replacement.issues || []};
  }
  function updateBlueprintLocks(candidate,newLocks) {
    const {api,plan,blueprint,excludedKeys,allocation}=candidateState(candidate);
    if(typeof api.updateAllocationLocks!=='function') throw new Error('蓝图锁定更新接口未配置');
    const next=api.updateAllocationLocks({index:candidate.index,plan,blueprint,locks:plainData(newLocks),excludedKeys,allocation});
    return {...candidate,status:next.status,allocation:next,context:next.context,locks:plainData(next.locks)};
  }
  async function applyBlueprintCandidate(rawPlan,candidate,options={}) {
    const state=candidateState(candidate),api=state.api,plan=core.validatePlan(rawPlan),io=readContext(options);let guard;
    try {
      // The index is a UI convenience, never an application authority.
      const {blueprint,locks,excludedKeys,allocation}=state,config=normalizeSettings(candidate.config);
      if(planDigest(plan)!==candidate.basePlanSnapshotDigest) throw new Error('方案已变化，请重新生成蓝图候选');
      originCheck(options);io.check();
      const currentConfig=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      if(JSON.stringify(currentConfig)!==JSON.stringify(config)) throw new Error('素材目录设置已变化，请重新生成蓝图候选');
      guard=beginSourceCheck(config);
      const index=await scan(config,{io}),sources=sourcesFromIndex(index);
      if(indexDigest(index)!==candidate.sourceSnapshotDigest) throw new Error('来源内容或题库身份已变化，请重新生成蓝图候选');
      const entryIdsBySlot=Object.fromEntries(allocation.assignments.filter(row=>row.origin==='candidate').map(row=>[row.slotId,newId()]));
      const applied=api.applyAllocation({freshIndex:index,plan,blueprint,locks,excludedKeys,allocation,expectedContext:candidate.context,entryIdsBySlot});
      await recheckSources(sources,io,guard);originCheck(options);guard.assertCurrent();
      if(planDigest(rawPlan)!==candidate.basePlanSnapshotDigest) throw new Error('方案已变化，请重新生成蓝图候选');
      const next=core.validatePlan(applied.plan);
      const run=validateBlueprintRun({schemaVersion:1,kind:'mathsemble-blueprint-run',runId:newId(),createdAt:new Date().toISOString(),
        blueprintSnapshot:blueprint,basePlanSnapshotDigest:candidate.basePlanSnapshotDigest,resultPlanDigest:planDigest(next),
        planPathHint:null,seed:allocation.seed,algorithmVersion:allocation.algorithmVersion,locks,assignments:applied.bindings,
        sourceSnapshotDigest:candidate.sourceSnapshotDigest});
      return {plan:next,index,run};
    } finally {guard?.dispose();io.close();}
  }
  function validateBlueprintRun(raw) {
    const run=plainData(raw);
    exact(run,['schemaVersion','kind','runId','createdAt','blueprintSnapshot','basePlanSnapshotDigest','resultPlanDigest','planPathHint',
      'seed','algorithmVersion','locks','assignments','sourceSnapshotDigest'],'组卷记录');
    if(run.schemaVersion!==1 || run.kind!=='mathsemble-blueprint-run') throw new Error('不支持的组卷记录版本');
    if(typeof run.runId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(run.runId)) throw new Error('组卷记录 ID 无效');
    boundedText(run.createdAt,'组卷时间',80);if(!Number.isFinite(Date.parse(run.createdAt))) throw new Error('组卷时间无效');
    for(const field of ['basePlanSnapshotDigest','resultPlanDigest','sourceSnapshotDigest'])
      if(!/^[a-f0-9]{64}$/.test(run[field])) throw new Error('组卷快照摘要无效');
    run.blueprintSnapshot=engine().validateBlueprint(run.blueprintSnapshot);
    if(run.planPathHint!==null) run.planPathHint=planPath(run.planPathHint);
    boundedText(run.seed,'组卷种子',512,true);boundedText(run.algorithmVersion,'组卷算法版本',100);
    const rows=new Map(run.blueprintSnapshot.rows.map(row=>[row.rowId,row])),slots=new Set(),entries=new Set();
    const validateBinding=(row,binding)=>{
      exact(row,['rowId','slotId','origin','sourceId','sourcePath','sourceFingerprint','existingEntryId',...(binding?['entryId']:[])],'配额归属');
      for(const key of ['rowId','slotId','sourceId','sourcePath','sourceFingerprint']) boundedText(row[key],'配额 '+key,key==='sourcePath'?4096:512,key==='sourceId');
      if(!['plan','candidate'].includes(row.origin)) throw new Error('配额来源无效');
      if(row.origin==='plan') boundedText(row.existingEntryId,'既有编排 ID',512);
      else if(row.existingEntryId!==undefined) throw new Error('新增题不能冒充已有编排');
      if(binding) boundedText(row.entryId,'编排 ID',512);
      const config=rows.get(row.rowId),prefix=row.rowId+':',ordinal=row.slotId.startsWith(prefix)?Number(row.slotId.slice(prefix.length)):NaN;
      if(!config || !Number.isInteger(ordinal) || ordinal<1 || ordinal>config.count || row.slotId!==prefix+ordinal) throw new Error('配额槽与蓝图不匹配');
      if(cleanPath(row.sourcePath)!==row.sourcePath || !/\.md$/i.test(row.sourcePath)) throw new Error('配额来源路径无效');
    };
    if(!Array.isArray(run.assignments)||run.assignments.length>1000||!Array.isArray(run.locks)||run.locks.length>1000) throw new Error('配额归属列表无效');
    for(const row of run.assignments) {
      validateBinding(row,true);
      if(slots.has(row.slotId)||entries.has(row.entryId)) throw new Error('配额槽或编排 ID 重复');
      if(row.origin==='plan'&&row.entryId!==row.existingEntryId) throw new Error('已有编排身份不一致');
      slots.add(row.slotId);entries.add(row.entryId);
    }
    if(run.assignments.length!==run.blueprintSnapshot.rows.reduce((n,row)=>n+row.count,0)) throw new Error('组卷记录配额不完整');
    const locked=new Set();
    for(const lock of run.locks) {
      validateBinding(lock,false);const bound=run.assignments.find(row=>row.slotId===lock.slotId);
      if(locked.has(lock.slotId)||!bound||Object.keys(lock).some(key=>lock[key]!==bound[key])) throw new Error('锁定项与配额归属不匹配');
      locked.add(lock.slotId);
    }
    return run;
  }
  function matchRunPlan(run,rawPlan) {
    const plan=core.validatePlan(rawPlan);
    if(planDigest(plan)!==run.resultPlanDigest) throw new Error('组卷记录与当前方案快照不匹配');
    for(const binding of run.assignments) {
      const entry=plan.entries.find(row=>row.entryId===binding.entryId);
      if(!entry || entry.kind!=='question' || ['sourceId','sourcePath','sourceFingerprint'].some(key=>entry[key]!==binding[key])) throw new Error('组卷记录的来源归属与方案不匹配');
    }
    return plan;
  }
  async function saveBlueprintRun(raw,{planPath:path}={}) {
    const run=validateBlueprintRun(raw),targetPlan=planPath(path || run.planPathHint);
    return queueBlueprintIO(async()=>{
      const file=vault.getAbstractFileByPath(targetPlan);
      if(!file || file.extension!=='json') throw new Error('请先保存方案，再保存组卷记录');
      const saved=await vault.read(file);matchRunPlan(run,JSON.parse(saved));
      if(file.path!==targetPlan || vault.getAbstractFileByPath(targetPlan)!==file) throw new Error('保存记录时方案文件已被替换');
      run.planPathHint=targetPlan;await ensureFolder(runFolder);
      if(file.path!==targetPlan || vault.getAbstractFileByPath(targetPlan)!==file || await vault.read(file)!==saved)
        throw new Error('保存组卷记录前方案已被修改，请重新核对');
      // The same run may be retried under a new file name after an uncertain
      // write; no previous record is ever modified or silently replaced.
      const target=`${runFolder}/${stem(run.blueprintSnapshot.title)}_${run.runId}_${newId()}.json`;
      await vault.create(target,JSON.stringify(run,null,2)+'\n');return target;
    });
  }
  async function loadBlueprintRun(path,rawPlan) {
    engine();const target=sidecarPath(path,runFolder);
    const file=vault.getAbstractFileByPath(target);
    if(!file || file.extension!=='json') throw new Error('组卷记录不存在');
    const content=await vault.read(file),run=validateBlueprintRun(parseSidecar(content));
    if(file.path!==target || vault.getAbstractFileByPath(target)!==file) throw new Error('读取时组卷记录已被替换');
    matchRunPlan(run,rawPlan);return run; // Snapshot match is not source freshness.
  }
  function verifyRunOnIndex(run,plan,index,options={}) {
    const api=engine();matchRunPlan(run,plan);
    const locks=run.assignments.map(({entryId,existingEntryId,origin,...row})=>({...row,origin:'plan',existingEntryId:entryId}));
    const prepared=api.prepareAllocation({index,plan,blueprint:run.blueprintSnapshot,locks});
    if(prepared.status!=='ready') throw new Error('组卷记录的来源、锁定或配额已失效');
    const allocation=api.allocateQuestions(prepared.problem,{seed:run.seed,limits:options.limits,signal:options.signal});
    if(allocation.status!=='complete') throw new Error('组卷记录无法完整复核：'+allocation.status);
    api.applyAllocation({freshIndex:index,plan,blueprint:run.blueprintSnapshot,locks,allocation,expectedContext:prepared.context,entryIdsBySlot:{}});
  }
  async function verifyBlueprintRun(raw,rawPlan,options={}) {
    const run=validateBlueprintRun(raw),plan=matchRunPlan(run,rawPlan),io=readContext(options);let guard;
    try {
      originCheck(options);io.check();
      const config=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));guard=beginSourceCheck(config);
      const index=await scan(config,{io}),sources=sourcesFromIndex(index);
      verifyRunOnIndex(run,plan,index,options);
      await recheckSources(sources,io,guard);originCheck(options);guard.assertCurrent();matchRunPlan(run,rawPlan);
      return {run,index,bindings:plainData(run.assignments)};
    } finally {guard?.dispose();io.close();}
  }
  const replacementCandidates=new WeakMap();
  const familyApi=()=>{
    if(!familyEngine || typeof familyEngine.prepareReplacement!=='function' || typeof familyEngine.applyReplacement!=='function')
      throw new Error('同族换题引擎未配置');
    return familyEngine;
  };
  const similarityApi=()=>{
    if(!similarityEngine||typeof similarityEngine.search!=='function')throw new Error('相似题引擎未配置');
    return similarityEngine;
  };
  function replacementApi(kind) {
    const api=familyApi();
    if(kind==='family')return {prepare:api.prepareReplacement,apply:api.applyReplacement,algorithmVersion:api.algorithmVersion};
    if(typeof api.prepareConstrainedReplacement!=='function'||typeof api.applyConstrainedReplacement!=='function')
      throw new Error('公共换题约束引擎未配置');
    return {prepare:api.prepareConstrainedReplacement,apply:api.applyConstrainedReplacement,algorithmVersion:api.constrainedAlgorithmVersion};
  }
  function taxonomyProbes(config) {
    const groups=[];
    for(const root of config.questionRoots) {
      const ancestors=[],parts=root.split('/');
      for(let n=parts.length;n>=0;n--)ancestors.push(parts.slice(0,n).join('/'));
      for(const [dimension,name]of [['knowledge','知识点'],['methods','方法']])groups.push({dimension,
        paths:ancestors.map(parent=>(parent?parent+'/':'')+'_system/规范/数学标签库/'+name+'.json')});
    }
    return {groups,paths:[...new Set(groups.flatMap(group=>group.paths))].sort()};
  }
  async function readTaxonomy(config,io) {
    const probes=taxonomyProbes(config),snapshots=new Map();
    for(const path of probes.paths) {
      io.check();const file=vault.getAbstractFileByPath(path);
      if(!file){snapshots.set(path,null);continue;}
      if(Array.isArray(file.children))throw new Error('标签词表路径应为文件：'+path);
      const source=await io.run(()=>vault.read(file),'读取标签词表 '+path);
      if(typeof source!=='string'||source.length>8*1024*1024)throw new Error('标签词表过大或内容无效：'+path);
      if(file.path!==path||vault.getAbstractFileByPath(path)!==file)throw new Error('标签词表在读取时已变化，请刷新候选');
      snapshots.set(path,source);
    }
    const taxonomy={},chosen={knowledge:new Set(),methods:new Set()};
    for(const group of probes.groups){const path=group.paths.find(value=>snapshots.get(value)!==null);if(path)chosen[group.dimension].add(path);}
    for(const [dimension,paths]of Object.entries(chosen)) {
      if(!paths.size)continue;
      const tags=[],seen=new Set();
      for(const path of [...paths].sort()) {
        let value;try{value=plainData(JSON.parse(snapshots.get(path)));}catch(error){throw new Error('标签词表不能解析：'+path+'（'+error.message+'）');}
        const rows=Array.isArray(value)?value:value?.tags;
        if(!Array.isArray(rows))throw new Error('标签词表缺少 tags 列表：'+path);
        for(const tag of rows){const key=strongDigest(tag);if(!seen.has(key)){seen.add(key);tags.push(tag);}}
      }
      taxonomy[dimension]={tags};
    }
    return {taxonomy,digest:strongDigest([...snapshots])};
  }
  async function recheckTaxonomy(config,snapshot,io,guard) {
    const current=await readTaxonomy(config,io);guard.assertCurrent();
    if(current.digest!==snapshot.digest)throw new Error('标签词表已变化，请刷新相似题候选');
  }
  async function findSimilarQuestions(input,options={}) {
    const api=similarityApi(),sourceKey=boundedText(input.sourceKey,'原题标识',4096),mode=input.mode??'knowledge';
    const filters=plainData(input.filters||{}),excludedKeys=plainData(input.excludedKeys||[]);
    const io=readContext(options);let guard;
    try {
      originCheck(options);io.check();
      const config=normalizeSettings(options.config||await io.run(loadSettings,'读取素材目录'));
      guard=beginSourceCheck(config,undefined,taxonomyProbes(config).paths);
      const taxonomy=await readTaxonomy(config,io),index=await scan(config,{io}),sources=sourcesFromIndex(index);
      const result=api.search({index,sourceKey,mode,filters,excludedKeys,taxonomy:taxonomy.taxonomy});
      await recheckSources(sources,io,guard);await recheckTaxonomy(config,taxonomy,io,guard);
      const current=normalizeSettings(options.config||await io.run(loadSettings,'核对素材目录'));
      if(JSON.stringify(current)!==JSON.stringify(config))throw new Error('素材目录设置已变化，请刷新相似题候选');
      originCheck(options);io.check();guard.assertCurrent();
      return {...plainData(result),index,taxonomyDigest:taxonomy.digest};
    } finally {guard?.dispose();io.close();}
  }
  function familyConstraints(run,entryId,unlock) {
    const binding=run?.assignments.find(row=>row.entryId===entryId),lock=binding&&run.locks.find(row=>row.slotId===binding.slotId);
    return {rowFilters:binding?run.blueprintSnapshot.rows.find(row=>row.rowId===binding.rowId).filters:{},
      maxPerFamily:run?.blueprintSnapshot.constraints.maxPerFamily??null,locked:!!lock&&!unlock,
      targetSlotId:binding?.slotId||null};
  }
  async function checkFamilyOrigin(rawPlan,digest,config,options,io,guard) {
    originCheck(options);io.check();guard.assertCurrent();
    const current=normalizeSettings(options.config || await io.run(loadSettings,'核对素材目录'));
    if(JSON.stringify(current)!==JSON.stringify(config)) throw new Error('素材目录设置已变化，请刷新换题候选');
    if(planDigest(rawPlan)!==digest) throw new Error('方案已变化，请刷新换题候选');
    originCheck(options);io.check();guard.assertCurrent();
  }
  async function prepareQuestionReplacement(kind,input,options={}) {
    const api=replacementApi(kind),search=kind==='similarity'?similarityApi():null;
    const plan=core.validatePlan(input.plan),basePlanSnapshotDigest=planDigest(plan),mode=input.mode??'knowledge';
    const entryId=boundedText(input.entryId,'编排 ID',512),filters=plainData(input.filters||{});
    if(input.unlock!==undefined&&typeof input.unlock!=='boolean') throw new Error('解除锁定选择无效');
    const unlock=input.unlock===true,run=input.run===undefined?null:validateBlueprintRun(input.run);
    if(run)matchRunPlan(run,plan);
    const io=readContext(options);let guard;
    try {
      originCheck(options);io.check();
      const config=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      guard=beginSourceCheck(config,undefined,search?taxonomyProbes(config).paths:[]);
      const taxonomy=search?await readTaxonomy(config,io):null;
      const index=await scan(config,{io}),sources=sourcesFromIndex(index),sourceSnapshotDigest=indexDigest(index);
      if(run)verifyRunOnIndex(run,plan,index,options);
      const constraints=familyConstraints(run,entryId,unlock);
      const prepared=api.prepare({index,plan,entryId,filters,...constraints});
      let ranked=null;
      if(search&&prepared.status==='ready') {
        const source=core.resolvePlan(plan,index).entries.find(row=>row.entry.entryId===entryId).item;
        const eligible=new Set(prepared.candidates.map(item=>item.key));
        ranked=search.search({index,sourceKey:source.key,mode,filters,taxonomy:taxonomy.taxonomy});
        ranked={...ranked,candidates:(ranked.candidates||[]).filter(item=>eligible.has(item.key))};
      }
      if(taxonomy)await recheckTaxonomy(config,taxonomy,io,guard);
      await recheckSources(sources,io,guard);await checkFamilyOrigin(input.plan,basePlanSnapshotDigest,config,options,io,guard);
      const status=ranked?.status||prepared.status,candidates=ranked?.candidates||prepared.candidates||[];
      const issues=[...(prepared.issues||[]),...(ranked?.issues||[])];
      if(search&&status==='ready'&&!candidates.length&&!issues.length)issues.push({code:'SIMILARITY_NO_CANDIDATES',message:'没有同时满足相似依据和换题约束的候选题'});
      const algorithmVersion=ranked?.algorithmVersion||api.algorithmVersion;
      const wrapper={schemaVersion:1,status,candidates:plainData(candidates),context:prepared.context||null,
        issues:plainData(issues),index,entryId,filters:plainData(filters),unlock,run:run?plainData(run):null,
        config:plainData(config),basePlanSnapshotDigest,sourceSnapshotDigest,
        ...(search?{mode,algorithmVersion,taxonomyDigest:taxonomy.digest}:{})};
      // UI fields are display data. Captured constraints cannot be removed or
      // weakened by clearing a wrapper.run, changing filters or toggling unlock.
      replacementCandidates.set(wrapper,{kind,status,entryId,filters,unlock,run,config,context:prepared.context,
        basePlanSnapshotDigest,sourceSnapshotDigest,constraints,mode,taxonomy,algorithmVersion,
        candidateKeys:new Set(candidates.map(candidate=>candidate.key))});
      return wrapper;
    } finally {guard?.dispose();io.close();}
  }
  async function applyQuestionReplacement(kind,rawPlan,candidate,candidateKey,options={}) {
    const state=replacementCandidates.get(candidate);
    if(!state||state.kind!==kind||state.status!=='ready'||!state.candidateKeys.has(candidateKey)) throw new Error('换题候选无效，请重新查看候选题');
    const api=replacementApi(kind),plan=core.validatePlan(rawPlan),io=readContext(options);let guard;
    try {
      if(planDigest(plan)!==state.basePlanSnapshotDigest) throw new Error('方案已变化，请刷新换题候选');
      originCheck(options);io.check();
      const config=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      if(JSON.stringify(config)!==JSON.stringify(state.config)) throw new Error('素材目录设置已变化，请刷新换题候选');
      guard=beginSourceCheck(config,undefined,state.taxonomy?taxonomyProbes(config).paths:[]);
      if(state.taxonomy)await recheckTaxonomy(config,state.taxonomy,io,guard);
      const index=await scan(config,{io}),sources=sourcesFromIndex(index),sourceSnapshotDigest=indexDigest(index);
      if(sourceSnapshotDigest!==state.sourceSnapshotDigest) throw new Error('来源内容或题库身份已变化，请刷新换题候选');
      if(state.run)verifyRunOnIndex(state.run,plan,index,options);
      const result=api.apply({freshIndex:index,plan,entryId:state.entryId,candidateKey,expectedContext:state.context,
        filters:state.filters,...state.constraints});
      const next=core.validatePlan(result.plan);let run;
      if(state.run) {
        const previous=state.run,entry=next.entries.find(row=>row.entryId===state.entryId);
        const reference={sourceId:entry.sourceId,sourcePath:entry.sourcePath,sourceFingerprint:entry.sourceFingerprint};
        run=validateBlueprintRun({...previous,runId:newId(),createdAt:new Date().toISOString(),planPathHint:null,
          basePlanSnapshotDigest:state.basePlanSnapshotDigest,resultPlanDigest:planDigest(next),sourceSnapshotDigest,
          algorithmVersion:state.algorithmVersion||'family-replacement-v1',
          assignments:previous.assignments.map(row=>row.entryId===state.entryId?{...row,...reference}:row),
          locks:previous.locks.filter(lock=>!(state.unlock&&lock.slotId===state.constraints.targetSlotId))});
        verifyRunOnIndex(run,next,index,options);
      }
      if(state.taxonomy)await recheckTaxonomy(config,state.taxonomy,io,guard);
      await recheckSources(sources,io,guard);await checkFamilyOrigin(rawPlan,state.basePlanSnapshotDigest,config,options,io,guard);
      return {plan:next,index,...(run?{run}:{})};
    } finally {guard?.dispose();io.close();}
  }
  const prepareFamilyReplacement=(input,options={})=>prepareQuestionReplacement('family',input,options);
  const applyFamilyReplacement=(plan,candidate,key,options={})=>applyQuestionReplacement('family',plan,candidate,key,options);
  const prepareSimilarityReplacement=(input,options={})=>prepareQuestionReplacement('similarity',input,options);
  const applySimilarityReplacement=(plan,candidate,key,options={})=>applyQuestionReplacement('similarity',plan,candidate,key,options);
  async function readResolvedSources(plan,config,io) {
    const fresh = await scan(config,{io});
    const result = core.resolvePlan(plan,fresh);
    const invalid = result.entries.filter(row=>row.status !== 'ok');
    if (invalid.length) throw new Error('来源已变化、缺失或存在身份冲突，请刷新素材并在“预览编排”核对，再接受来源更新：' +
      invalid.map(row=>result.issues.find(issue=>issue.entryId===row.entry.entryId)?.message || row.entry.title || row.entry.sourcePath).slice(0,5).join('、'));
    const sources = Object.freeze(result.entries.filter(row=>row.item).map(({item}) => {
      const live = vault.getAbstractFileByPath(item.path);
      if (!live || live.extension !== 'md') throw new Error('来源已删除或替换：'+item.path);
      // Freeze the evidence, never the host's live TFile instance.
      return Object.freeze({path:item.path,live,markdown:item.markdown});
    }));
    return {result,sources,index:fresh};
  }
  async function recheckSources(sources,io,guard) {
    for (const source of sources) {
      io.check();
      if (!guard.isCurrent()) throw new Error('生成期间源文发生变化，请返回编排刷新素材');
      const stillSameFile = () => source.live.path === source.path && vault.getAbstractFileByPath(source.path) === source.live;
      if (!stillSameFile() || await io.run(()=>vault.read(source.live),'复核来源 '+source.path) !== source.markdown || !stillSameFile())
        throw new Error('生成期间源文发生变化，请重试：' + source.path);
    }
    io.check();
    if (!guard.isCurrent()) throw new Error('生成期间源文发生变化，请返回编排刷新素材');
  }
  async function compile(raw,_index,options = {}) {
    const plan = core.validatePlan(raw), io = readContext(options);
    let guard;
    try {
      if (!plan.entries.some(entry=>entry.kind !== 'section')) throw new Error('请先加入知识或题目');
      const config = normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      guard = beginSourceCheck(config);
      const {result,sources} = await readResolvedSources(plan,config,io);
      let sourceMap = Object.freeze([]);
      const outputPath = options.outputPath || `${outputFolder}/讲义.md`;
      const markdown = await io.run(()=>compileMarkdown(plan,result.entries,{outputPath,
        onSourceMap:rows => {sourceMap = Object.freeze(rows.map(row=>Object.freeze({...row})));},
        resolveLink:async (target,sourcePath) => {
          io.check();
          const file = app.metadataCache.getFirstLinkpathDest(target,sourcePath);
          return file && !Array.isArray(file.children) ? {path:file.path,extension:file.extension} : null;
        }}),'生成讲义预览');
      // Recheck after async link resolution, before preview publication or writes.
      await recheckSources(sources,io,guard);
      return {markdown,sources,sourceMap};
    } finally {guard?.dispose();io.close();}
  }
  async function exportMarkdown(plan,index) {
    const path = uniquePath(outputFolder,plan.title,'md');
    const {markdown} = await compile(plan,index,{outputPath:path});
    await ensureFolder(outputFolder); await vault.create(path,markdown); return path;
  }
  async function preview(raw,index,options = {}) {
    const plan = core.validatePlan(raw);
    const assertOrigin = () => {
      if (options.isCurrent && !options.isCurrent()) throw new Error('编排已变化或关闭，旧预览已取消；请从当前方案重新预览');
    };
    assertOrigin();
    const timeouts = {timeoutMs:options.timeoutMs,resourceTimeoutMs:options.resourceTimeoutMs};
    const configRead = readContext({...timeouts,signal:options.signal});
    let config;
    try {config = normalizeSettings(await configRead.run(loadSettings,'读取素材目录'));}
    finally {configRead.close();}
    // A source-path context for relative links only; this file is never read,
    // written, or used as a diagnostic destination, even if the path exists.
    const file = Object.freeze({path:`${outputFolder}/__preview__.md`,basename:plan.title,extension:'md'});
    const prepared = await compile(plan,index,{...timeouts,config,outputPath:file.path,signal:options.signal});
    const assemblyPreview = Object.freeze({...prepared,
      getEvidence() {
        if (typeof collectMediaDependencies !== 'function') throw new Error('媒体依赖收集器未配置，无法生成归档证据');
        // Evidence is derived only from the captured text. Never re-read a live
        // note here, and never expose its mutable TFile to archive consumers.
        const sources = prepared.sources.map(({path,markdown})=>({path,markdown}));
        return JSON.parse(JSON.stringify({planSnapshot:plan,compiledMarkdown:prepared.markdown,
          compiledPathContext:file.path,sourceMap:prepared.sourceMap,sources,
          declaredDependencies:sources.flatMap(source=>collectMediaDependencies(source.markdown,source.path).dependencies)}));
      },
      async assertCurrent(signal) {
        const io = readContext({...timeouts,signal});
        let guard;
        try {
          io.check();guard=beginSourceCheck(config);
          const {sources} = await readResolvedSources(plan,config,io);
          if (sources.length !== prepared.sources.length || sources.some((source,i) => {
            const original=prepared.sources[i];
            return source.path !== original.path || source.live !== original.live || source.markdown !== original.markdown;
          })) throw new Error('编排来源已变化，请返回编排更新并重新预览');
          await recheckSources(prepared.sources,io,guard);
          return true;
        } finally {guard?.dispose();io.close();}
      },
      watch(callback) {
        // Changes anywhere in the captured library scope may introduce a
        // duplicate identity. Conservatively invalidate until a new preview.
        const guard = beginSourceCheck(config,callback);
        return guard.dispose;
      }});
    assertOrigin();
    await previewFile(file,{
      planSettings:{course:core.validateCourse(plan.course),output:core.validateOutputSettings(plan.output)},
      onApplyPlanSettings:options.onApplyPlanSettings,assemblyPreview,
      onReturnToAssembly:options.onReturnToAssembly});
  }
  async function openSource(path) {
    const file = vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'md') throw new Error('源文件不存在');
    await app.workspace.getLeaf('tab').openFile(file);
  }
  async function updateEntryContent(rawPlan,entryId,patch,options={}) {
    // UI edits use the same source-wide guard as preview; never acknowledge a
    // changed source or publish a partial score/selection update implicitly.
    const plan=core.validatePlan(rawPlan),baseline=planDigest(plan),next=core.updateEntry(plan,entryId,patch),io=readContext(options);let guard;
    if(Reflect.ownKeys(patch).some(key=>!['score','fragmentRef'].includes(key))) {io.close();throw new Error('此操作仅修改分值和片段引用');}
    try {
      originCheck(options);io.check();
      const config=normalizeSettings(options.config || await io.run(loadSettings,'读取素材目录'));
      guard=beginSourceCheck(config);
      let previous=null,savedRecord=null,matchingPaths=null;
      if(options.run!=null) {
        previous=validateBlueprintRun(options.run);matchRunPlan(previous,plan);
      } else if(listSidecars(runFolder).length) {
        engine();
        const matches=await io.run(()=>listMatchingBlueprintRuns(plan,options),'查找已有配额记录');
        matchingPaths=matches.map(row=>row.path).sort();
        if(matches.length>1)throw Object.assign(new Error('当前方案有多份匹配的配额记录，请明确选择记录后再修改分值或片段'),{code:'BLUEPRINT_RUN_SELECTION_REQUIRED'});
        if(matches.length===1) {
          const path=matches[0].path,file=vault.getAbstractFileByPath(path);
          if(!file||file.extension!=='json')throw new Error('已有配额记录已被移除');
          const content=await io.run(()=>vault.read(file),'读取已有配额记录');
          previous=validateBlueprintRun(parseSidecar(content));matchRunPlan(previous,plan);
          if(file.path!==path||vault.getAbstractFileByPath(path)!==file)throw new Error('已有配额记录已被替换');
          savedRecord={path,file,content};
        }
      } else matchingPaths=[];
      if(previous?.assignments.some(row=>row.entryId===entryId)&&next.entries.find(entry=>entry.entryId===entryId)?.fragmentRef)
        throw Object.assign(new Error('此题已归属整题配额，不能改为部分小问；请先明确重新编排配额'),{code:'BLUEPRINT_FRAGMENT_BINDING_CONFLICT'});
      const {sources,index}=await readResolvedSources(next,config,io);
      let run;
      if(previous) {
        verifyRunOnIndex(previous,plan,index,options);
        run=validateBlueprintRun({...previous,runId:newId(),createdAt:new Date().toISOString(),planPathHint:null,
          basePlanSnapshotDigest:baseline,resultPlanDigest:planDigest(next),sourceSnapshotDigest:indexDigest(index),algorithmVersion:'entry-content-edit-v1'});
        verifyRunOnIndex(run,next,index,options);
      }
      await recheckSources(previous?sourcesFromIndex(index):sources,io,guard);originCheck(options);
      if(matchingPaths) {
        const current=(await io.run(()=>listMatchingBlueprintRuns(plan,options),'复核已有配额记录')).map(row=>row.path).sort();
        if(JSON.stringify(current)!==JSON.stringify(matchingPaths))throw new Error('修改期间配额记录发生变化，请重新核对后重试');
      }
      if(savedRecord) {
        const {path,file,content}=savedRecord;
        if(file.path!==path||vault.getAbstractFileByPath(path)!==file||await io.run(()=>vault.read(file),'复核原配额记录')!==content)
          throw new Error('修改期间原配额记录已被更改，未应用任何编排修改');
      }
      await checkFamilyOrigin(rawPlan,baseline,config,options,io,guard);
      if(planDigest(rawPlan)!==baseline)throw new Error('编排已变化，分值或片段修改未应用');
      return {plan:next,index,...(run?{run}:{})};
    } finally {guard?.dispose();io.close();}
  }
  return {loadSettings,saveSettings,beginSourceCheck,scan,listPlans,createPlanSession,savePlan,loadPlan,compile,exportMarkdown,preview,openSource,
    listBlueprints,listBlueprintRuns,createBlueprintSession,saveBlueprint,loadBlueprint,generateBlueprintCandidate,applyBlueprintCandidate,
    replaceBlueprintCandidate,updateBlueprintLocks,validateBlueprintRun,saveBlueprintRun,loadBlueprintRun,verifyBlueprintRun,
    listMatchingBlueprintRuns,prepareFamilyReplacement,applyFamilyReplacement,findSimilarQuestions,
    prepareSimilarityReplacement,applySimilarityReplacement,updateEntryContent};
};
