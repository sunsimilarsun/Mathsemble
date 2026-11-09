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
  function beginSourceCheck(raw) {
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
    const invalidate = (file,oldPath) => {
      const folder = Array.isArray(file?.children);
      if (relevant(file?.path,folder) || relevant(oldPath,folder)) changed = true;
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
      for (const event of ['create','modify','delete','rename']) refs.push(vault.on(event,invalidate));
    } catch (error) { dispose(); throw error; }
    return {isCurrent:() => !changed && !disposed,
      assertCurrent:() => {if (changed || disposed) throw new Error('来源在核对期间发生变化，请重新读取内容后生成候选');},dispose};
  }
  async function scan(raw) {
    const config = normalizeSettings(raw || await loadSettings());
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
          const markdown = await vault.read(file), metadata = frontmatter(markdown);
          if (file.path !== path) throw new Error('扫描时文件已改名，请重新扫描');
          const type = String(metadata.question_type || metadata.type || '').toLowerCase();
          const question = /^(choice|single_choice|multiple_choice|fill_blank|true_false|short_answer|calculation|proof|comprehensive|单选题?|多选题?|填空题?|判断题?|解答题?)$/.test(type);
          const knowledge = inside(path,config.knowledgeRoots) &&
            !/^(README|章节导航|待补清单)\.md$/i.test(file.name);
          if (question && inside(path,config.questionRoots)) records.push({path,markdown,metadata,kind:'question'});
          else if (knowledge) records.push({path,markdown,metadata,kind:'knowledge'});
        } catch (error) { issues.push({code:'read-error',path,message:error.message}); }
      }));
    }
    records.sort((a,b) => a.path.localeCompare(b.path,'zh-CN'));
    const index = core.buildIndex(records);
    index.issues.push(...issues);
    return index;
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
  async function compile(raw,_index,options = {}) {
    const plan = core.validatePlan(raw);
    if (!plan.entries.some(entry=>entry.kind !== 'section')) throw new Error('请先加入知识或题目');
    const fresh = await scan(await loadSettings());
    const result = core.resolvePlan(plan,fresh);
    const invalid = result.entries.filter(row=>row.status !== 'ok');
    if (invalid.length) throw new Error('来源已变化、缺失或存在身份冲突，请重新扫描并检查“更新引用”：' +
      invalid.map(row=>row.entry.title || row.entry.sourcePath).slice(0,5).join('、'));
    const outputPath = options.outputPath || `${outputFolder}/讲义.md`;
    const markdown = await compileMarkdown(plan,result.entries,{outputPath,
      resolveLink:async (target,sourcePath) => {
        const file = app.metadataCache.getFirstLinkpathDest(target,sourcePath);
        return file && !Array.isArray(file.children) ? {path:file.path,extension:file.extension} : null;
      }});
    // Recheck after async link resolution, before any output file is written.
    for (const {item} of result.entries) if (item) {
      const file = vault.getAbstractFileByPath(item.path);
      if (!file || await vault.read(file) !== item.markdown) throw new Error('生成期间源文发生变化，请重试：' + item.path);
    }
    return {markdown};
  }
  async function exportMarkdown(plan,index) {
    const path = uniquePath(outputFolder,plan.title,'md');
    const {markdown} = await compile(plan,index,{outputPath:path});
    await ensureFolder(outputFolder); await vault.create(path,markdown); return path;
  }
  async function preview(plan,index) {
    const path = await exportMarkdown(plan,index);
    await previewFile(vault.getAbstractFileByPath(path));
  }
  async function openSource(path) {
    const file = vault.getAbstractFileByPath(path);
    if (!file || file.extension !== 'md') throw new Error('源文件不存在');
    await app.workspace.getLeaf('tab').openFile(file);
  }
  return {loadSettings,saveSettings,beginSourceCheck,scan,listPlans,createPlanSession,savePlan,loadPlan,compile,exportMarkdown,preview,openSource};
};
