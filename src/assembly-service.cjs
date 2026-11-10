'use strict';

// Host adapter: source notes are read-only. Only explicit plans and generated
// handouts are written, under dedicated output folders.
module.exports = function createAssemblyService(plugin, {core, compileMarkdown, parseYaml, previewFile}) {
  const app = plugin.app, vault = app.vault;
  const planFolder = 'Mathsemble/组题方案', outputFolder = 'Mathsemble/讲义';
  let settings, data, saveQueue = Promise.resolve(), planIO = Promise.resolve();
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
  function beginSourceCheck(raw,onChange) {
    const config = normalizeSettings(raw), roots = [...config.questionRoots,...config.knowledgeRoots];
    let changed = false, disposed = false;
    const refs = [];
    const relevant = (path,folder) => {
      if (typeof path !== 'string') return false;
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
  async function readResolvedSources(plan,config,io) {
    const fresh = await scan(config,{io});
    const result = core.resolvePlan(plan,fresh);
    const invalid = result.entries.filter(row=>row.status !== 'ok');
    if (invalid.length) throw new Error('来源已变化、缺失或存在身份冲突，请刷新素材并在“预览编排”核对，再接受来源更新：' +
      invalid.map(row=>row.entry.title || row.entry.sourcePath).slice(0,5).join('、'));
    const sources = Object.freeze(result.entries.filter(row=>row.item).map(({item}) => {
      const live = vault.getAbstractFileByPath(item.path);
      if (!live || live.extension !== 'md') throw new Error('来源已删除或替换：'+item.path);
      // Freeze the evidence, never the host's live TFile instance.
      return Object.freeze({path:item.path,live,markdown:item.markdown});
    }));
    return {result,sources};
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
  return {loadSettings,saveSettings,beginSourceCheck,scan,listPlans,createPlanSession,savePlan,loadPlan,compile,exportMarkdown,preview,openSource};
};
