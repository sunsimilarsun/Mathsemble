'use strict';

// Native Obsidian view. UI state belongs to the workspace; content writes are
// delegated to explicit service actions. No source Markdown is mutated here.
module.exports = function createAssemblyView({ItemView, Notice, Component, core, service, renderMarkdown}) {
  const VIEW_TYPE = 'mathsemble-assembly';
  const roles = ['例题', '变式', '训练'];
  const typeNames = {choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'};
  const labelOf = value => String(value ?? '').replace(/^\[\[|\]\]$/g, '').split('|').at(-1);
  const errorText = error => String(error?.message || error);
  const plainBody = markdown => String(markdown || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '');

  return class AssemblyView extends ItemView {
    constructor(leaf, plugin) {
      super(leaf);
      this.plugin = plugin;
      this.planSession = service.createPlanSession ? service.createPlanSession() : service;
      this.plan = core.createPlan();
      this.planPath = null;
      this.dirty = false;
      this.index = {items:[],issues:[]};
      this.settings = {questionRoots:[],knowledgeRoots:[],recursive:true};
      this.filters = {kind:'question',query:''};
      this.limit = 100;
      this.scanGeneration = 0;
      this.previewGeneration = 0;
      this.closed = true;
      this.actionBusy = false;
      this.scanBusy = false;
      this.pendingDiscard = null;
      this.previewOwner = null;
      this.selectedItem = null;
      this.plans = [];
      this.selectionCount = '10';
      this.selection = null;
      this.selectionNotice = '';
    }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return this.plan?.title || '知识与组题'; }
    getIcon() { return 'layers'; }
    getState() {
      return {plan:this.plan,planPath:this.planPath,dirty:this.dirty,filters:this.filters};
    }
    async setState(state, result) {
      if (state?.plan) {
        try {
          this.plan = core.validatePlan(state.plan);
          this.planPath = typeof state.planPath === 'string' ? state.planPath : null;
          this.dirty = !!state.dirty;
          if (state.filters && typeof state.filters === 'object') {
            for (const key of ['kind','query','knowledge','subject','questionType','difficulty','tier','role','method','source']) {
              if (typeof state.filters[key] === 'string') this.filters[key] = state.filters[key];
            }
          }
        } catch (error) { this.notice('无法恢复旧编排：' + errorText(error)); }
      }
      await super.setState?.(state, result);
      if (!this.closed && this.root) this.render();
    }
    notice(message) { if (Notice) new Notice(message, 6000); }
    el(tag, parent, className, text) {
      const node = this.contentEl.ownerDocument.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = String(text);
      parent?.appendChild(node);
      return node;
    }
    button(parent, text, action, className = '') {
      const button = this.el('button', parent, className, text);
      button.type = 'button';
      button.addEventListener('click', () => {
        if (button.disabled) return;
        Promise.resolve().then(action).catch(error => this.setStatus(errorText(error), true));
      });
      return button;
    }
    field(parent, label, tag = 'input') {
      const wrapper = this.el('label', parent, 'mwb-assembly-field');
      this.el('span', wrapper, '', label);
      return this.el(tag, wrapper);
    }
    stateChanged() {
      this.clearSelection('编排已变化，请重新生成候选。');
      this.dirty = true;
      this.pendingDiscard = null;
      this.app.workspace.requestSaveLayout?.();
      this.updateSummary();
    }
    setPlan(plan) {
      this.plan = plan;
      this.stateChanged();
      this.renderOutline();
      this.renderResults();
    }
    editEntry(entryId, patch) {
      if (this.actionBusy) return;
      try { this.setPlan(core.updateEntry(this.plan, entryId, patch)); }
      catch (error) { this.setStatus(errorText(error), true); this.notice(errorText(error)); this.renderOutline(); }
    }
    setStatus(message, error = false) {
      if (this.closed || !this.statusEl) return;
      this.statusEl.textContent = message;
      this.statusEl.classList.toggle('is-error', error);
    }
    updateSummary() {
      if (!this.summaryEl) return;
      const questions = this.plan.entries.filter(entry => entry.kind === 'question').length;
      const knowledge = this.plan.entries.filter(entry => entry.kind === 'knowledge').length;
      this.summaryEl.textContent = `${knowledge} 篇知识 · ${questions} 道题${this.dirty ? ' · 未保存' : this.planPath ? ' · 已保存' : ''}`;
    }
    confirmDiscard(key, label) {
      if (!this.dirty) return true;
      const now = Date.now();
      if (this.pendingDiscard?.key === key && now < this.pendingDiscard.expires) {
        this.pendingDiscard = null;
        return true;
      }
      this.pendingDiscard = {key,expires:now + 12000};
      const message = `当前编排尚未保存。若要放弃，请在 12 秒内再次点击“${label}”；也可先保存方案。`;
      this.setStatus(message, true); this.notice(message);
      return false;
    }
    async runAction(label, action) {
      if (this.actionBusy) { this.notice('请等待当前操作完成'); return; }
      if (this.scanBusy) { this.notice('正在读取题库，请稍候'); return; }
      this.actionBusy = true;
      this.setStatus(label + '…');
      this.root?.classList.add('is-busy');
      this.renderSelection();
      try { await action(); }
      catch (error) { this.setStatus(errorText(error), true); this.notice(errorText(error)); }
      finally {
        this.actionBusy = false;
        this.root?.classList.remove('is-busy');
        this.updateSummary();
        if(!this.closed)this.renderSelection();
      }
    }
    async onOpen() {
      this.closed = false;
      this.render();
      try {
        const settings = await service.loadSettings();
        if (this.closed) return;
        this.settings = {...this.settings,...settings};
        this.render();
        await this.refreshPlans();
        await this.scan();
      } catch (error) { this.setStatus(errorText(error), true); }
    }
    async onClose() {
      this.closed = true;
      this.scanGeneration++; this.previewGeneration++;
      this.releasePreview();
      this.contentEl.replaceChildren();
    }
    releasePreview() {
      if (this.previewOwner && this.previewOwner !== this) {
        if (this.removeChild) this.removeChild(this.previewOwner);
        else this.previewOwner.unload?.();
      }
      this.previewOwner = null;
    }
    render() {
      this.releasePreview();
      this.previewGeneration++;
      this.contentEl.replaceChildren();
      this.root = this.el('div', this.contentEl, 'mwb-assembly');
      const header = this.el('header', this.root, 'mwb-assembly-header');
      this.el('h2', header, '', '知识与组题');
      this.summaryEl = this.el('div', header, 'mwb-assembly-summary');
      const toolbar = this.el('div', this.root, 'mwb-assembly-toolbar');
      this.titleInput = this.field(toolbar, '讲义标题');
      this.titleInput.value = this.plan.title;
      this.titleInput.maxLength = 200;
      this.titleInput.addEventListener('input', () => {
        if (this.actionBusy) { this.titleInput.value=this.plan.title; return; }
        this.plan = {...this.plan,title:this.titleInput.value.trim() || '新讲义'}; this.stateChanged();
      });
      this.titleInput.addEventListener('blur', () => { if (!this.titleInput.value.trim()) this.titleInput.value=this.plan.title; });
      this.button(toolbar, '新建', () => {
        if (this.actionBusy || !this.confirmDiscard('new','新建')) return;
        this.plan = core.createPlan(); this.planPath = null; this.dirty = false;
        this.render(); this.setStatus('新建方案，可加入知识与题目。');
      });
      this.button(toolbar, '保存方案', () => this.saveCurrentPlan(false), 'mod-cta');
      this.button(toolbar, '另存方案', () => this.saveCurrentPlan(true));
      this.savedSelect = this.field(toolbar, '已保存方案', 'select');
      this.populatePlans();
      this.button(toolbar, '打开方案', () => this.loadSelectedPlan());
      this.button(toolbar, '生成 Markdown', () => this.runAction('生成 Markdown', async () => {
        const path = await service.exportMarkdown(core.validatePlan(this.plan), this.index);
        if (!this.closed) { this.setStatus('Markdown 已生成：' + path); this.notice('Markdown 已生成：' + path); }
      }));
      this.button(toolbar, 'A4 预览 / PDF', () => this.runAction('准备预览', async () => {
        await service.preview(core.validatePlan(this.plan), this.index);
        this.setStatus('已打开 A4 预览，可选择学生版或教师版并导出 PDF。');
      }));
      this.statusEl = this.el('div', this.root, 'mwb-assembly-status', '请配置目录后读取内容。');
      this.statusEl.setAttribute('role','status'); this.statusEl.setAttribute('aria-live','polite');
      const columns = this.el('div', this.root, 'mwb-assembly-columns');
      this.left = this.el('aside', columns, 'mwb-assembly-left');
      this.center = this.el('section', columns, 'mwb-assembly-center');
      this.right = this.el('aside', columns, 'mwb-assembly-right');
      this.renderLeft(); this.renderCenter(); this.renderRight(); this.updateSummary();
    }
    renderLeft() {
      this.left.replaceChildren();
      const config = this.el('details', this.left, 'mwb-assembly-config');
      config.open = !this.settings.questionRoots?.length && !this.settings.knowledgeRoots?.length;
      this.el('summary', config, '', '内容目录');
      this.questionRootsInput = this.field(config,'题库目录（每行一个）','textarea');
      this.questionRootsInput.value = (this.settings.questionRoots || []).join('\n');
      this.questionRootsInput.placeholder = '例如：数学教学/初中题库';
      this.knowledgeRootsInput = this.field(config,'知识目录（每行一个）','textarea');
      this.knowledgeRootsInput.value = (this.settings.knowledgeRoots || []).join('\n');
      this.knowledgeRootsInput.placeholder = '例如：数学教学/高中知识';
      const recursiveLabel = this.el('label', config, 'mwb-assembly-check');
      const recursive = this.el('input', recursiveLabel); recursive.type='checkbox'; recursive.checked=this.settings.recursive !== false;
      recursiveLabel.appendChild(this.contentEl.ownerDocument.createTextNode('包含子目录'));
      this.button(config,'应用目录并读取',async () => {
        if (this.actionBusy) return;
        const roots = input => input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
        const settings = {questionRoots:roots(this.questionRootsInput),knowledgeRoots:roots(this.knowledgeRootsInput),recursive:recursive.checked};
        await service.saveSettings(settings); this.settings=settings; await this.scan();
      });
      this.button(this.left,'重新读取内容',()=>this.scan());
      const filters = this.el('div', this.left, 'mwb-assembly-filters');
      this.el('h3', filters, '', '筛选');
      this.filterSelects = {};
      const specs = [['subject','学段学科'],['questionType','题型'],['difficulty','难度'],['tier','教学分层'],['role','题目角色'],['knowledge','知识标签'],['method','方法'],['source','来源']];
      for (const [key,label] of specs) {
        const select = this.field(filters,label,'select');
        select.addEventListener('change',()=>{this.filters[key]=select.value;this.limit=100;this.renderResults();});
        this.filterSelects[key] = select;
      }
      this.populateFilters();
      this.button(filters,'清除筛选',()=>{
        this.filters={kind:this.filters.kind,query:''};this.limit=100;
        if (this.searchInput) this.searchInput.value='';
        this.populateFilters();this.renderResults();
      });
      this.tree = this.el('div',this.left,'mwb-assembly-tree');
      this.renderTree();
    }
    populateFilters() {
      if (!this.filterSelects) return;
      for (const [key,select] of Object.entries(this.filterSelects)) {
        const values = new Set();
        for (const item of this.index.items) {
          const raw = key==='knowledge' ? item.knowledgeNodes : key==='method' ? item.methods.map(value=>core.parseKnowledgeRef(value).target) : key==='tier' ? item.tiers : item[key];
          for (const value of Array.isArray(raw)?raw:[raw]) if (value !== null && value !== undefined && value !== '') values.add(String(value));
        }
        let current=String(this.filters[key]||'');
        if(['knowledge','method'].includes(key)&&['','~','[]'].includes(core.parseKnowledgeRef(current).target)){
          current='';this.filters[key]='';
        }
        if(current) values.add(current);
        select.replaceChildren();this.el('option',select,'','不限').value='';
        for (const value of [...values].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}))) {
          const node = key==='knowledge' ? this.index.items.find(item=>item.kind==='knowledge'&&item.key===value) : null;
          this.el('option',select,'',node ? node.title : key==='questionType' ? typeNames[value]||value : labelOf(value)).value=value;
        }
        select.value=current;
      }
    }
    renderTree() {
      if (!this.tree) return;
      this.tree.replaceChildren();this.el('h3',this.tree,'','知识目录');
      const groups=new Map();
      for (const item of this.index.items.filter(item=>item.kind==='knowledge')) {
        const group=item.path.includes('/')?item.path.slice(0,item.path.lastIndexOf('/')):'根目录';
        if(!groups.has(group)) groups.set(group,[]);groups.get(group).push(item);
      }
      if(!groups.size) this.el('p',this.tree,'mwb-assembly-muted','尚未读取知识笔记。');
      for(const [group,items] of [...groups].sort((a,b)=>a[0].localeCompare(b[0],'zh-CN',{numeric:true}))) {
        const details=this.el('details',this.tree);this.el('summary',details,'',group.split('/').at(-1)+`（${items.length}）`);
        for(const item of items) {
          const row=this.el('div',details,'mwb-assembly-tree-row');
          this.button(row,item.title,()=>this.showItem(item),'mwb-assembly-tree-item');
          const related=this.button(row,'关联题',()=>{
            this.filters.kind='question';this.filters.knowledge=item.key;this.limit=100;
            this.populateFilters();this.updateTabs();this.renderResults();this.showItem(item);
          });related.title='按此知识点筛选题目';
        }
      }
    }
    renderCenter() {
      this.center.replaceChildren();
      const tools=this.el('div',this.center,'mwb-assembly-search');
      this.tabs=this.el('div',tools,'mwb-assembly-tabs');
      for(const [kind,label] of [['question','题目'],['knowledge','知识']]) {
        const tab=this.button(this.tabs,label,()=>{this.filters.kind=kind;this.limit=100;this.updateTabs();this.renderResults();});
        tab.dataset.kind=kind;
      }
      this.searchInput=this.field(tools,'搜索名称、正文与标签');this.searchInput.type='search';this.searchInput.value=this.filters.query||'';
      this.searchInput.addEventListener('input',()=>{this.filters.query=this.searchInput.value;this.limit=100;this.renderResults();});
      this.selectionPanel=this.el('section',this.center,'mwb-assembly-selection');
      this.selectionPanel.setAttribute('aria-label','条件抽题');
      this.resultsSummary=this.el('div',this.center,'mwb-assembly-muted');
      this.results=this.el('div',this.center,'mwb-assembly-results');
      this.preview=this.el('div',this.center,'mwb-assembly-preview');
      this.el('p',this.preview,'mwb-assembly-muted','选择题目或知识笔记查看完整内容。');
      this.updateTabs();this.renderResults();
    }
    updateTabs() {
      for(const button of this.tabs?.querySelectorAll('button')||[]) {
        const active=button.dataset.kind===this.filters.kind;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
      }
    }
    renderResults() {
      if(!this.results) return;
      if(this.selection && !this.selectionIsCurrent()) this.clearSelection('筛选或内容已变化，请重新生成候选。');
      this.renderSelection();
      this.results.replaceChildren();
      const items=core.filterItems(this.index,this.filters);
      this.resultsSummary.textContent=`找到 ${items.length} ${this.filters.kind==='knowledge'?'篇知识':'道题'}，显示 ${Math.min(items.length,this.limit)} 条`;
      if(!items.length) this.el('p',this.results,'mwb-assembly-empty','没有匹配内容，可调整筛选或内容目录。');
      for(const item of items.slice(0,this.limit)) {
        const row=this.el('article',this.results,'mwb-assembly-result');
        const detail=this.button(row,item.title,()=>this.showItem(item),'mwb-assembly-result-title');detail.title=item.path;
        const info=[item.subject,item.kind==='question'?(typeNames[item.questionType]||item.questionType):'整篇知识',item.difficulty?`难度 ${item.difficulty}`:'',item.tier,item.role].filter(Boolean);
        this.el('div',row,'mwb-assembly-muted',info.join(' · '));
        const related=this.relatedKnowledge(item);
        if(related.length)this.el('div',row,'mwb-assembly-muted','关联知识：'+related.map(node=>node.title).join('、'));
        this.el('div',row,'mwb-assembly-result-path',item.path);
        const added=this.plan.entries.some(entry=>entry.kind!== 'section' && ((item.id && entry.sourceId===item.id)||entry.sourcePath===item.path));
        const add=this.button(row,added?'已加入':'加入',()=>this.add(item));add.disabled=added;add.classList.add('mwb-assembly-add');
      }
      if(items.length>this.limit) this.button(this.results,'再显示 100 条',()=>{this.limit+=100;this.renderResults();});
    }
    selectionContext() {
      return JSON.stringify({filters:this.filters,plan:this.plan,count:this.selectionCount,scan:this.scanGeneration,settings:this.settings});
    }
    selectionIsCurrent() {
      return !!this.selection && this.selection.index===this.index && this.selection.context===this.selectionContext();
    }
    clearSelection(message = '') {
      if(this.selection) {
        this.selection=null;
        this.selectionNotice=message;
        this.renderSelection();
      }
    }
    renderSelection() {
      if(!this.selectionPanel) return;
      this.selectionPanel.replaceChildren();
      this.selectionPanel.hidden=this.filters.kind!=='question';
      if(this.selectionPanel.hidden) return;
      this.el('h3',this.selectionPanel,'','条件抽题');
      this.el('p',this.selectionPanel,'mwb-assembly-muted','按当前筛选生成候选题，已加入编排的题目不会重复抽取。');
      const tools=this.el('div',this.selectionPanel,'mwb-assembly-selection-tools');
      this.selectionCountInput=this.field(tools,'抽题数量');
      this.selectionCountInput.type='number';this.selectionCountInput.min='1';this.selectionCountInput.max='1000';this.selectionCountInput.step='1';
      this.selectionCountInput.value=this.selectionCount;
      this.selectionCountInput.addEventListener('input',()=>{
        this.selectionCount=this.selectionCountInput.value;
        // Preserve focus while typing. The removed candidate list cannot be
        // applied even if an old button is held by a delayed click handler.
        if(this.selection) {
          this.selection=null;this.selectionNotice='抽题数量已变化，请重新生成候选。';
          this.selectionRows?.replaceChildren();
          if(this.selectionSummary)this.selectionSummary.textContent=this.selectionNotice;
          if(this.applySelectionButton)this.applySelectionButton.disabled=true;
        }
      });
      const draw=this.button(tools,this.selection?'重新抽取':'生成候选',()=>this.drawSelection(),'mod-cta');
      draw.disabled=this.actionBusy||this.scanBusy;
      this.applySelectionButton=this.button(tools,'加入编排',()=>this.applySelection());
      this.applySelectionButton.disabled=this.actionBusy||this.scanBusy||!this.selection?.items.length;
      this.selectionSummary=this.el('div',this.selectionPanel,'mwb-assembly-selection-summary');
      this.selectionSummary.setAttribute('role','status');this.selectionSummary.setAttribute('aria-live','polite');
      const selection=this.selection;
      if(selection) {
        const short=(selection.available<selection.requested?`；符合条件且未加入编排的题目只有 ${selection.available} 道`:'')+
          (selection.capacity<Math.min(selection.requested,selection.available)?`；当前编排最多还能加入 ${selection.capacity} 道`:'');
        this.selectionSummary.textContent=`目标 ${selection.requested} 道，当前候选 ${selection.items.length} 道${short}。核对后点击“加入编排”。`;
      } else this.selectionSummary.textContent=this.selectionNotice||'先生成候选，核对后再加入当前编排。';
      this.selectionRows=this.el('div',this.selectionPanel,'mwb-assembly-selection-results');
      for(const [position,item] of (selection?.items||[]).entries()) {
        const row=this.el('article',this.selectionRows,'mwb-assembly-selection-row');
        const preview=this.button(row,`${position+1}. ${item.title}`,()=>{
          if(!this.selectionIsCurrent()) {this.clearSelection('候选题已过期，请重新生成。');return;}
          return this.showItem(item);
        },'mwb-assembly-result-title');
        preview.title=item.path;
        this.el('div',row,'mwb-assembly-muted',[typeNames[item.questionType]||item.questionType,item.tier,item.difficulty?`难度 ${item.difficulty}`:''].filter(Boolean).join(' · '));
        this.el('div',row,'mwb-assembly-result-path',item.path);
        const remove=this.button(row,'移出候选',()=>{
          if(this.actionBusy||this.scanBusy) return;
          if(!this.selectionIsCurrent()) {this.clearSelection('候选题已过期，请重新生成。');return;}
          this.selection.items=this.selection.items.filter(candidate=>candidate!==item);
          this.renderSelection();
        });
        remove.disabled=this.actionBusy||this.scanBusy;
      }
    }
    drawSelection() {
      if(this.closed||this.actionBusy||this.scanBusy) return;
      if(this.filters.kind!=='question') return;
      try {
        const result=core.selectQuestions(this.index,this.filters,this.plan,Number(this.selectionCount));
        this.selection={...result,index:this.index,context:this.selectionContext()};
        this.selectionNotice='';this.renderSelection();
        this.setStatus(`已生成 ${result.items.length} 道候选题，核对后可加入编排。`);
      } catch(error) {
        this.clearSelection();this.selectionNotice=errorText(error);this.renderSelection();
        this.setStatus(errorText(error),true);
      }
    }
    async applySelection() {
      if(this.closed||this.actionBusy||this.scanBusy) return;
      if(!this.selectionIsCurrent()) {this.clearSelection('候选题已过期，请重新生成。');return;}
      const selection=this.selection;
      const settingsKey=JSON.stringify(this.settings);
      return this.runAction('核对候选题来源',async()=>{
        let latest;
        try {
          // A visible result list is only a scan snapshot. Re-read the vault
          // before applying, so edits made since drawing cannot pass by using
          // the old fingerprint twice.
          latest=await service.scan(this.settings);
          if(this.closed)return;
          if(this.selection!==selection||!this.selectionIsCurrent())
            throw new Error('筛选或编排已变化，请重新生成候选');
          const count=selection.items.length;
          const next=core.addSelectedQuestions(this.plan,latest,this.filters,selection.items);
          this.index=latest;this.selection=null;
          this.selectionNotice=`已将 ${count} 道题加入编排，可在右侧调整顺序和角色。`;
          this.populateFilters();this.renderTree();this.setPlan(next);
          this.setStatus(this.selectionNotice);
        } catch(error) {
          if(this.closed)return;
          this.selection=null;this.selectionNotice=errorText(error);
          if(latest&&JSON.stringify(this.settings)===settingsKey){this.index=latest;this.populateFilters();this.renderTree();this.renderResults();this.renderOutline();}
          this.renderSelection();throw error;
        }
      });
    }
    relatedKnowledge(item) {
      if(item.kind!=='question')return [];
      const keys=new Set((item.knowledgeRefs||[]).flatMap(ref=>ref.nodeKeys||[ref.nodeKey]).filter(Boolean));
      return this.index.items.filter(node=>node.kind==='knowledge'&&keys.has(node.key));
    }
    add(item) {
      if(this.actionBusy) return;
      try {this.setPlan(core.addItem(this.plan,item));this.setStatus(`已加入${item.kind==='knowledge'?'整篇知识':'题目'}：${item.title}`);}
      catch(error){this.setStatus(errorText(error),true);this.notice(errorText(error));}
    }
    async showItem(item) {
      if(this.closed) return;
      const generation=++this.previewGeneration;
      this.releasePreview();this.selectedItem=item;this.preview.replaceChildren();
      const header=this.el('div',this.preview,'mwb-assembly-preview-header');
      this.el('h3',header,'',item.title);
      this.button(header,item.kind==='knowledge'?'整篇加入':'加入题篮',()=>this.add(item));
      this.button(header,'打开原文件',()=>service.openSource(item.path));
      this.el('p',this.preview,'mwb-assembly-muted',item.path);
      const related=this.relatedKnowledge(item);
      if(related.length){
        const links=this.el('div',this.preview,'mwb-assembly-preview-header');
        this.el('span',links,'mwb-assembly-muted','关联知识：');
        for(const node of related)this.button(links,node.title,()=>this.showItem(node));
      }
      const body=this.el('div',this.preview,'mwb-typography mwb-assembly-preview-body');
      let owner=this;
      if(Component){owner=new Component();this.addChild?.(owner);}
      this.previewOwner=owner;
      try {
        if(renderMarkdown) await renderMarkdown(plainBody(item.markdown),body,item.path,owner);
        else body.textContent=plainBody(item.markdown);
        if(this.closed||generation!==this.previewGeneration) return;
      } catch(error){if(!this.closed&&generation===this.previewGeneration)this.el('p',body,'mwb-assembly-error','预览失败：'+errorText(error));}
    }
    renderRight() {
      this.right.replaceChildren();
      this.el('h3',this.right,'','当前编排');
      const controls=this.el('div',this.right,'mwb-assembly-outline-controls');
      this.sectionInput=this.field(controls,'新增分区标题');this.sectionInput.placeholder='例如：知识梳理';this.sectionInput.maxLength=200;
      this.button(controls,'添加分区',()=>{
        if(this.actionBusy)return;const title=this.sectionInput.value.trim();if(!title){this.notice('请输入分区标题');return;}
        this.setPlan(core.addSection(this.plan,title));this.sectionInput.value='';
      });
      this.button(controls,'更新引用',()=>this.updateReferences());
      this.outline=this.el('div',this.right,'mwb-assembly-outline');
      this.outline.addEventListener('dragover',event=>event.preventDefault());
      this.outline.addEventListener('drop',event=>{
        if(event.target!==this.outline||this.actionBusy)return;event.preventDefault();
        const id=event.dataTransfer?.getData('application/x-mathsemble-entry');
        if(this.plan.entries.some(entry=>entry.entryId===id)) this.setPlan(core.moveEntry(this.plan,id,this.plan.entries.length-1));
      });
      this.renderOutline();
    }
    renderOutline() {
      if(!this.outline)return;this.outline.replaceChildren();
      const resolved=core.resolvePlan(this.plan,this.index);
      const states=new Map(resolved.entries.map(row=>[row.entry.entryId,row]));
      if(!this.plan.entries.length)this.el('p',this.outline,'mwb-assembly-empty','从左侧加入整篇知识或题目，然后拖动排列。');
      let number=0;
      this.plan.entries.forEach((entry,index)=>{
        const row=this.el('article',this.outline,'mwb-assembly-entry'+(entry.kind==='section'?' is-section':''));
        row.draggable=true;row.dataset.entryId=entry.entryId;
        row.addEventListener('dragstart',event=>{
          if(this.actionBusy){event.preventDefault();return;}
          event.dataTransfer?.setData('application/x-mathsemble-entry',entry.entryId);
          if(event.dataTransfer)event.dataTransfer.effectAllowed='move';row.classList.add('is-dragging');
        });
        row.addEventListener('dragend',()=>row.classList.remove('is-dragging'));
        row.addEventListener('dragover',event=>{event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';});
        row.addEventListener('drop',event=>{
          event.preventDefault();event.stopPropagation();if(this.actionBusy)return;
          const id=event.dataTransfer?.getData('application/x-mathsemble-entry');
          if(id!==entry.entryId&&this.plan.entries.some(value=>value.entryId===id))this.setPlan(core.moveEntry(this.plan,id,index));
        });
        const heading=entry.kind==='section'?'分区':entry.kind==='knowledge'?'知识':`${++number}. ${entry.role||'题目'}`;
        this.el('div',row,'mwb-assembly-entry-kind',heading);
        const title=this.field(row,entry.kind==='section'?'分区标题':'本次显示标题');title.value=entry.title||'';title.maxLength=200;
        title.addEventListener('change',()=>this.editEntry(entry.entryId,{title:title.value}));
        if(entry.kind==='question') {
          const role=this.field(row,'本次角色','select');this.el('option',role,'','沿用题卡').value='';
          for(const value of roles)this.el('option',role,'',value).value=value;
          role.value=entry.role||'';role.addEventListener('change',()=>this.editEntry(entry.entryId,{role:role.value}));
        }
        const state=states.get(entry.entryId);
        if(entry.kind!=='section') {
          const text={changed:'源文已变化，点击“更新引用”后重新核对',missing:'找不到源文件',conflict:'来源 ID 冲突，请修正后重新读取'}[state?.status];
          if(text)this.el('div',row,'mwb-assembly-error',text);
          this.el('div',row,'mwb-assembly-result-path',state?.item?.path||entry.sourcePath);
        }
        const actions=this.el('div',row,'mwb-assembly-entry-actions');
        const up=this.button(actions,'上移',()=>{if(!this.actionBusy)this.setPlan(core.moveEntry(this.plan,entry.entryId,index-1));});up.disabled=index===0;
        const down=this.button(actions,'下移',()=>{if(!this.actionBusy)this.setPlan(core.moveEntry(this.plan,entry.entryId,index+1));});down.disabled=index===this.plan.entries.length-1;
        if(state?.item)this.button(actions,'查看',()=>this.showItem(state.item));
        this.button(actions,entry.kind==='section'?'移除标题':'移除',()=>{if(!this.actionBusy)this.setPlan(core.removeEntry(this.plan,entry.entryId));});
      });
      this.updateSummary();
    }
    async scan() {
      if(this.actionBusy){this.notice('请等待当前操作完成');return;}
      const generation=++this.scanGeneration;this.scanBusy=true;
      this.clearSelection('正在重新读取内容，请读取完成后生成候选。');this.renderSelection();
      this.setStatus('正在读取题库与知识笔记…');
      try {
        const index=await service.scan(this.settings);
        if(this.closed||generation!==this.scanGeneration)return;
        this.index=index;this.limit=100;
        this.populateFilters();this.renderTree();this.renderResults();this.renderOutline();
        const issues=index.issues?.length||0;
        this.setStatus(`已读取 ${index.items.length} 份内容${issues?`；${issues} 项待核对` : ''}。源文变化不会自动更新已保存的方案。`,!!issues);
        if(issues){
          const details=this.el('details',this.tree,'mwb-assembly-index-issues');this.el('summary',details,'',`查看 ${issues} 项提示`);
          for(const issue of index.issues.slice(0,100))this.el('p',details,'',typeof issue==='string'?issue:issue.message||JSON.stringify(issue));
        }
        return true;
      } catch(error){if(!this.closed&&generation===this.scanGeneration)this.setStatus(errorText(error),true);}
      finally{if(generation===this.scanGeneration){this.scanBusy=false;if(!this.closed)this.renderSelection();}}
    }
    async updateReferences() {
      if(this.actionBusy)return;
      const scanned=await this.scan();if(!scanned||this.closed||this.scanBusy)return;
      const resolved=core.resolvePlan(this.plan,this.index);
      let count=0;
      const entries=resolved.entries.map(({entry,item,status})=>{
        if(item&&(status==='changed'||(status==='ok'&&entry.sourcePath!==item.path))){count++;return {...entry,sourceId:item.id||'',sourcePath:item.path,sourceFingerprint:item.fingerprint};}
        return entry;
      });
      if(count)this.setPlan({...this.plan,entries});
      const unresolved=resolved.entries.filter(row=>row.status==='missing'||row.status==='conflict').length;
      this.setStatus(`已更新 ${count} 处引用${unresolved?`；仍有 ${unresolved} 处缺失或冲突` : ''}。请核对内容后预览。`,!!unresolved);
    }
    async saveCurrentPlan(asNew = false) {
      return this.runAction(asNew ? '另存方案' : '保存方案', async () => {
        const snapshot = core.validatePlan(this.plan);
        const serialized = JSON.stringify(snapshot);
        const path = await this.planSession.savePlan(snapshot, asNew ? undefined : this.planPath);
        if (this.closed) return;
        this.planPath = path;
        if (JSON.stringify(this.plan) === serialized) this.dirty = false;
        this.app.workspace.requestSaveLayout?.();
        await this.refreshPlans();
        this.setStatus('方案已保存：' + path);
      });
    }
    async refreshPlans() {
      try {const plans=await service.listPlans();if(this.closed)return;this.plans=plans;this.populatePlans();}
      catch(error){this.setStatus('方案列表读取失败：'+errorText(error),true);}
    }
    populatePlans() {
      if(!this.savedSelect)return;const selected=this.savedSelect.value||this.planPath||'';
      this.savedSelect.replaceChildren();this.el('option',this.savedSelect,'','选择已保存方案').value='';
      for(const plan of this.plans)this.el('option',this.savedSelect,'',plan.title||plan.path).value=plan.path;
      this.savedSelect.value=selected;
    }
    async loadSelectedPlan() {
      if(this.actionBusy)return;const path=this.savedSelect.value;
      if(!path){this.notice('请先选择方案');return;}
      if(!this.confirmDiscard('load:'+path,'打开方案'))return;
      await this.runAction('打开方案',async()=>{
        const plan=core.validatePlan(await this.planSession.loadPlan(path));if(this.closed)return;
        this.plan=plan;this.planPath=path;this.dirty=false;this.pendingDiscard=null;this.render();
        this.setStatus('方案已打开；缺失或变化的来源会在编排中标出。');this.app.workspace.requestSaveLayout?.();
      });
    }
  };
};
