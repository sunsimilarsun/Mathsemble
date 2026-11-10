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
      this.selectionSourceCheck = null;
      this.activePane = 'library';
      this.workspaceMode = 'library';
      this.workspaceScroll = {library:0,arrangement:0};
      this.workspaceAnchors = {library:null,arrangement:null};
      this.arrangementMenuOpen = new Set();
      this.arrangementExpanded = new Set();
      this.inlinePreviewGroups = new Map();
      this.inlinePreviewQueue = [];
      this.inlinePreviewActive = 0;
    }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return this.plan?.title || '知识与组题'; }
    getIcon() { return 'layers'; }
    getState() {
      return {plan:this.plan,planPath:this.planPath,dirty:this.dirty,filters:this.filters,workspaceMode:this.workspaceMode};
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
      if(['library','arrangement'].includes(state?.workspaceMode))this.workspaceMode=state.workspaceMode;
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
    panelHeader(parent, step, title, note) {
      const header=this.el('div',parent,'mwb-assembly-panel-header');
      this.el('span',header,'mwb-assembly-step',step);
      const text=this.el('div',header,'mwb-assembly-panel-heading');
      this.el('h3',text,'',title);
      if(note)this.el('p',text,'mwb-assembly-muted',note);
      return header;
    }
    emptyState(parent, title, detail) {
      const state=this.el('div',parent,'mwb-assembly-empty');
      this.el('strong',state,'',title);this.el('p',state,'',detail);
      return state;
    }
    switchPane(pane) {
      if(!['filters','library'].includes(pane))pane='library';
      this.activePane=pane;
      if(this.root)this.root.dataset.activePane=pane;
      for(const button of this.paneNav?.querySelectorAll('button')||[])
        button.setAttribute('aria-pressed',String(button.dataset.pane===pane));
    }
    updateWorkspaceMode() {
      if(!this.root)return;
      const arranging=this.workspaceMode==='arrangement';
      this.root.dataset.workspaceMode=this.workspaceMode;
      if(this.columns)this.columns.hidden=arranging;
      if(this.arrangementPane)this.arrangementPane.hidden=!arranging;
      for(const button of this.modeNav?.querySelectorAll('button')||[])
        button.setAttribute('aria-pressed',String(button.dataset.mode===this.workspaceMode));
    }
    captureWorkspaceAnchor(mode,preferred) {
      const list=mode==='arrangement'?this.arrangementList:this.center;if(!list)return null;
      const bounds=list.getBoundingClientRect();
      const selector=mode==='arrangement'?'.mwb-assembly-arrangement-entry':'.mwb-assembly-result,.mwb-assembly-selection-row';
      const row=preferred||[...list.querySelectorAll(selector)].find(node=>{
        const rect=node.getBoundingClientRect();return node.getClientRects().length&&rect.bottom>bounds.top&&rect.top<bounds.bottom;
      });
      if(!row)return null;
      return {id:row.dataset.entryId,path:row.dataset.sourcePath,kind:row.dataset.sourceKind,
        candidates:row.classList.contains('mwb-assembly-selection-row'),top:row.getBoundingClientRect().top-bounds.top};
    }
    restoreWorkspaceAnchor(mode) {
      if(this.closed||this.workspaceMode!==mode)return;
      const anchor=this.workspaceAnchors[mode],list=mode==='arrangement'?this.arrangementList:this.center;
      if(!anchor||!list)return;
      const selector=mode==='arrangement'?'.mwb-assembly-arrangement-entry':anchor.candidates?'.mwb-assembly-selection-row':'.mwb-assembly-result';
      const row=[...list.querySelectorAll(selector)].find(node=>mode==='arrangement'?node.dataset.entryId===anchor.id:
        node.dataset.sourcePath===anchor.path&&node.dataset.sourceKind===anchor.kind);
      if(row)list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-anchor.top;
    }
    releaseWorkspaceAnchorOnInput(node,mode) {
      // A remembered reading position must never fight subsequent user scrolling.
      for(const event of ['wheel','touchstart','pointerdown','keydown'])
        node.addEventListener(event,()=>{this.workspaceAnchors[mode]=null;},{passive:true});
    }
    switchWorkspaceMode(mode) {
      if(this.closed||!['library','arrangement'].includes(mode)||mode===this.workspaceMode)return;
      if(this.workspaceMode==='library'){
        const returnTop=this.previewReturn?.centerTop;
        this.clearItemPreview();
        if(returnTop!==undefined)this.center.scrollTop=returnTop;
        this.workspaceScroll.library=this.center?.scrollTop||0;
        this.workspaceAnchors.library=this.captureWorkspaceAnchor('library');
        this.releaseInlinePreviews('results');this.releaseInlinePreviews('candidates');
      }else{
        this.workspaceScroll.arrangement=this.arrangementList?.scrollTop||0;
        this.workspaceAnchors.arrangement=this.captureWorkspaceAnchor('arrangement');
        this.releaseInlinePreviews('arrangement');
      }
      this.workspaceMode=mode;this.updateWorkspaceMode();
      if(mode==='arrangement'){
        this.renderArrangement();this.arrangementList.scrollTop=this.workspaceScroll.arrangement;
      }else{
        this.renderResults();this.center.scrollTop=this.workspaceScroll.library;
      }
      this.restoreWorkspaceAnchor(mode);
      this.app.workspace.requestSaveLayout?.();
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
    setStatus(message, error = false) {
      if (this.closed || !this.statusEl) return;
      this.statusEl.textContent = message;
      this.statusEl.title = message;
      this.statusEl.classList.toggle('is-error', error);
    }
    updateSummary() {
      if (!this.summaryEl) return;
      const questions = this.plan.entries.filter(entry => entry.kind === 'question').length;
      const knowledge = this.plan.entries.filter(entry => entry.kind === 'knowledge').length;
      const sections=this.plan.entries.filter(entry=>entry.kind==='section').length;
      this.summaryEl.textContent = [`已选 ${questions} 题`,knowledge?`${knowledge} 篇知识`:'',sections?`${sections} 个分区`:''].filter(Boolean).join(' · ');
      this.summaryEl.setAttribute('aria-label',`查看预览编排：${this.plan.entries.length} 项，${questions} 道题，${knowledge} 篇知识，${sections} 个分区`);
      if(this.saveStateEl){
        this.saveStateEl.textContent=this.dirty?'未保存':this.planPath?'已保存':'新方案';
        this.saveStateEl.classList.toggle('is-dirty',this.dirty);
      }
      for(const button of this.primaryButtons||[])button.disabled=this.actionBusy||this.scanBusy;
      for(const control of this.arrangementPane?.querySelectorAll('[data-arrangement-mutate]')||[])
        control.disabled=this.actionBusy||this.scanBusy||control.dataset.boundary==='true';
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
      this.updateSummary();
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
      this.selectionSourceCheck?.dispose();this.selectionSourceCheck=null;
      this.scanGeneration++; this.previewGeneration++;
      this.releasePreview();
      this.releaseInlinePreviews();
      this.contentEl.replaceChildren();
    }
    releasePreview() {
      if (this.previewOwner && this.previewOwner !== this) {
        if (this.removeChild) this.removeChild(this.previewOwner);
        else this.previewOwner.unload?.();
      }
      this.previewOwner = null;
    }
    releaseInlineOwner(record) {
      const owner=record.owner;record.owner=null;
      if(owner&&owner!==this){
        if(this.removeChild)this.removeChild(owner);
        else owner.unload?.();
      }
    }
    releaseInlinePreviews(name) {
      for(const [key,group] of this.inlinePreviewGroups){
        if(name&&key!==name)continue;
        group.active=false;group.observer?.disconnect();group.resizeObserver?.disconnect();group.resizeRecords?.clear();
        for(const record of group.records){record.controller?.abort();this.releaseInlineOwner(record);}
        group.records.clear();this.inlinePreviewGroups.delete(key);
      }
      this.inlinePreviewQueue=this.inlinePreviewQueue.filter(record=>record.group.active);
    }
    beginInlinePreviews(name,root=this.center) {
      this.releaseInlinePreviews(name);
      const enabled=name==='arrangement'?this.workspaceMode==='arrangement':this.workspaceMode!=='arrangement';
      const group={name,active:true,enabled,records:new Set(),observer:null};
      this.inlinePreviewGroups.set(name,group);
      const Observer=this.contentEl.ownerDocument.defaultView?.IntersectionObserver;
      if(Observer&&enabled)group.observer=new Observer(entries=>{
        if(!group.active||this.closed)return;
        for(const entry of entries){
          const record=[...group.records].find(value=>value.node===entry.target);
          if(!record||record.state!=='pending')continue;
          if(entry.isIntersecting){
            if(!record.queued){record.queued=true;this.inlinePreviewQueue.push(record);}
          }else if(record.queued){
            record.queued=false;this.inlinePreviewQueue=this.inlinePreviewQueue.filter(value=>value!==record);
          }
        }
        this.pumpInlinePreviews();
      },{root,rootMargin:'120px 0px'});
      return group;
    }
    addInlinePreview(group,row,item) {
      const node=this.el('div',row,'mwb-assembly-snippet');
      node.dataset.previewState='pending';node.setAttribute('inert','');
      node.setAttribute('aria-label','内容摘要，点击标题查看完整内容');
      const body=this.el('div',node,'mwb-typography mwb-assembly-snippet-body','正在准备预览…');
      const record={group,node,body,item,state:'pending',queued:false,owner:null,controller:null};
      group.records.add(record);
      if(group.enabled){
        if(group.observer)group.observer.observe(node);
        else {record.queued=true;this.inlinePreviewQueue.push(record);queueMicrotask(()=>this.pumpInlinePreviews());}
      }
      return record;
    }
    pumpInlinePreviews() {
      while(!this.closed&&this.inlinePreviewActive<2&&this.inlinePreviewQueue.length){
        const record=this.inlinePreviewQueue.shift();record.queued=false;
        if(!record.group.active||!record.group.enabled||record.state!=='pending'||!record.node.isConnected)continue;
        // A queued card may have been hidden by a pane or full-preview switch.
        // Keep observing it so it can start when the list becomes visible again.
        if(record.group.observer&&!record.node.getClientRects().length)continue;
        record.group.observer?.unobserve(record.node);
        record.state='rendering';record.node.dataset.previewState='rendering';
        this.inlinePreviewActive++;
        void this.renderInlinePreview(record);
      }
    }
    async renderInlinePreview(record) {
      const current=()=>!this.closed&&record.group.active&&record.node.isConnected;
      try {
        const Controller=this.contentEl.ownerDocument.defaultView?.AbortController;
        record.controller=Controller?new Controller():null;
        if(Component){record.owner=new Component();if(this.addChild)this.addChild(record.owner);else record.owner.load?.();}
        else record.owner=this;
        record.body.replaceChildren();
        // Pass the complete Markdown to the normal renderer. CSS bounds only
        // this summary; cutting source text could split a formula or embed.
        const markdown=plainBody(record.item.markdown);
        if(renderMarkdown)await renderMarkdown(markdown,record.body,record.item.path,record.owner,record.controller?.signal);
        else record.body.textContent=markdown;
        if(current()){
          record.state='ready';record.node.dataset.previewState='ready';
        }
      }catch(error){
        if(current()&&!record.controller?.signal.aborted){
          record.state='error';record.node.dataset.previewState='error';
          record.body.textContent=record.group.name==='arrangement'?'暂不能显示正文，请从更多操作打开原文。':'暂不能显示摘要，点击标题查看完整内容。';
        }
      }finally{
        if(!current())this.releaseInlineOwner(record);
        else {record.updateOverflow?.();this.restoreWorkspaceAnchor(record.group.name==='arrangement'?'arrangement':'library');}
        // Old jobs still occupy their slot until settled, even after a filter
        // rebuild. Never reset this count when a preview group is discarded.
        this.inlinePreviewActive--;
        this.pumpInlinePreviews();
      }
    }
    render() {
      this.releasePreview();
      this.releaseInlinePreviews();
      // New/open/restored plans rebuild the entire surface. Reading anchors
      // belong only to switches and edits within the currently displayed plan.
      this.workspaceScroll={library:0,arrangement:0};
      this.workspaceAnchors={library:null,arrangement:null};
      this.previewGeneration++;
      this.selectedItem=null;
      this.previewReturn=null;
      this.contentEl.replaceChildren();
      this.root = this.el('div', this.contentEl, 'mwb-assembly');
      this.root.setAttribute('aria-label','知识与组题');
      const toolbar = this.el('header', this.root, 'mwb-assembly-toolbar');
      this.titleInput = this.field(toolbar, '讲义标题');
      this.titleInput.value = this.plan.title;
      this.titleInput.maxLength = 200;
      this.titleInput.addEventListener('input', () => {
        if (this.actionBusy) { this.titleInput.value=this.plan.title; return; }
        this.plan = {...this.plan,title:this.titleInput.value.trim() || '新讲义'}; this.stateChanged();
      });
      this.titleInput.addEventListener('blur', () => { if (!this.titleInput.value.trim()) this.titleInput.value=this.plan.title; });
      this.modeNav=this.el('nav',toolbar,'mwb-assembly-mode-nav');this.modeNav.setAttribute('aria-label','组题工作模式');
      for(const [mode,label] of [['library','选题'],['arrangement','预览编排']]){
        const button=this.button(this.modeNav,label,()=>this.switchWorkspaceMode(mode));button.dataset.mode=mode;
      }
      const primary=this.el('div',toolbar,'mwb-assembly-primary-actions');
      const save=this.button(primary, '保存方案', () => this.saveCurrentPlan(false));
      const pdf=this.button(primary, 'A4 预览 / PDF', () => this.runAction('准备预览', async () => {
        await service.preview(core.validatePlan(this.plan), this.index);
        this.setStatus('已打开 A4 预览，可选择学生版或教师版并导出 PDF。');
      }),'mod-cta');
      const menu=this.el('details',primary,'mwb-assembly-plan-menu');
      this.el('summary',menu,'','方案操作');
      const menuBody=this.el('div',menu,'mwb-assembly-menu-body');
      const menuActions=this.el('div',menuBody,'mwb-assembly-menu-actions');
      this.button(menuActions, '新建', () => {
        if (this.actionBusy || !this.confirmDiscard('new','新建')) return;
        this.plan = core.createPlan(); this.planPath = null; this.dirty = false;
        this.render(); this.setStatus('新建方案，可加入知识与题目。');
      });
      this.button(menuActions, '另存方案', () => this.saveCurrentPlan(true));
      this.savedSelect = this.field(menuBody, '已保存方案', 'select');
      this.populatePlans();
      this.button(menuBody, '打开方案', () => this.loadSelectedPlan());
      this.button(menuBody, '生成 Markdown', () => this.runAction('生成 Markdown', async () => {
        const path = await service.exportMarkdown(core.validatePlan(this.plan), this.index);
        if (!this.closed) { this.setStatus('Markdown 已生成：' + path); this.notice('Markdown 已生成：' + path); }
      }));
      menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
      this.primaryButtons=[save,pdf];
      const overview=this.el('div',this.root,'mwb-assembly-overview');
      this.summaryEl=this.button(overview,'',()=>this.switchWorkspaceMode('arrangement'),'mwb-assembly-selected-count');
      this.saveStateEl=this.el('span',overview,'mwb-assembly-save-state');
      this.statusEl = this.el('div', overview, 'mwb-assembly-status', '请配置目录后读取内容。');
      this.statusEl.setAttribute('role','status'); this.statusEl.setAttribute('aria-live','polite');
      this.paneNav=this.el('nav',this.root,'mwb-assembly-pane-nav');this.paneNav.setAttribute('aria-label','组卷工作区');
      for(const [pane,label] of [['filters','筛选'],['library','选题']]){
        const button=this.button(this.paneNav,label,()=>this.switchPane(pane));button.dataset.pane=pane;
      }
      const columns = this.el('div', this.root, 'mwb-assembly-columns');this.columns=columns;
      this.releaseWorkspaceAnchorOnInput(columns,'library');
      this.left = this.el('aside', columns, 'mwb-assembly-left');
      this.center = this.el('section', columns, 'mwb-assembly-center');
      this.left.setAttribute('aria-label','内容筛选');this.center.setAttribute('aria-label','选题与预览');
      this.renderArrangementShell();this.updateWorkspaceMode();
      this.switchPane(this.activePane);
      this.renderLeft(); this.renderCenter(); this.renderOutline();
    }
    renderLeft() {
      this.left.replaceChildren();
      this.panelHeader(this.left,'01','内容筛选','从题库与知识笔记中查找');
      const config = this.el('details', this.left, 'mwb-assembly-config');
      this.configDetails=config;
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
      this.button(this.left,'重新读取内容',()=>this.scan(),'mwb-assembly-rescan');
      const filters = this.el('div', this.left, 'mwb-assembly-filters');
      const filterHeader=this.el('div',filters,'mwb-assembly-section-heading');
      this.el('h4', filterHeader, '', '筛选条件');
      this.button(filterHeader,'清除筛选',()=>{
        this.filters={kind:this.filters.kind,query:''};this.limit=100;
        if (this.searchInput) this.searchInput.value='';
        this.populateFilters();this.renderResults();
      },'mwb-assembly-text-button');
      this.filterSelects = {};
      const basics=this.el('div',filters,'mwb-assembly-filter-grid');
      this.advancedFilters=this.el('details',filters,'mwb-assembly-advanced-filters');
      this.el('summary',this.advancedFilters,'','更多筛选');
      const advanced=this.el('div',this.advancedFilters,'mwb-assembly-filter-grid');
      const specs = [['subject','学段学科'],['questionType','题型'],['tier','教学分层'],['knowledge','知识标签'],['difficulty','难度'],['role','题目角色'],['method','方法'],['source','来源']];
      for (const [key,label] of specs) {
        const select = this.field(['difficulty','role','method','source'].includes(key)?advanced:basics,label,'select');
        select.addEventListener('change',()=>{this.filters[key]=select.value;this.limit=100;this.renderResults();});
        this.filterSelects[key] = select;
      }
      this.advancedFilters.open=['difficulty','role','method','source'].some(key=>this.filters[key]);
      this.populateFilters();
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
            this.clearItemPreview();this.populateFilters();this.updateTabs();this.renderResults();
            this.switchPane('library');this.resultsDisclosure.open=true;this.resultsSummary.focus();
          });related.title='按此知识点筛选题目';
        }
      }
    }
    renderCenter() {
      this.center.replaceChildren();
      this.panelHeader(this.center,'02','选题与预览','列表直接预览，点击标题查看全文');
      const tools=this.el('div',this.center,'mwb-assembly-search');
      this.tabs=this.el('div',tools,'mwb-assembly-tabs');
      for(const [kind,label] of [['question','题目'],['knowledge','知识']]) {
        const tab=this.button(this.tabs,label,()=>{this.filters.kind=kind;this.limit=100;this.updateTabs();this.renderResults();});
        tab.dataset.kind=kind;
      }
      this.searchInput=this.field(tools,'搜索名称、正文与标签');this.searchInput.type='search';this.searchInput.value=this.filters.query||'';
      this.searchInput.placeholder='输入关键词查找内容';
      this.searchInput.addEventListener('input',()=>{this.filters.query=this.searchInput.value;this.limit=100;this.renderResults();});
      this.activeFilters=this.el('div',tools,'mwb-assembly-active-filters');this.activeFilters.setAttribute('aria-label','已选筛选条件');
      this.selectionPanel=this.el('section',this.center,'mwb-assembly-selection');
      this.selectionPanel.setAttribute('aria-label','条件抽题');
      this.resultsDisclosure=this.el('details',this.center,'mwb-assembly-results-section');this.resultsDisclosure.open=true;
      this.candidatesShown=false;
      this.resultsSummary=this.el('summary',this.resultsDisclosure,'mwb-assembly-results-summary');
      this.results=this.el('div',this.resultsDisclosure,'mwb-assembly-results');
      this.preview=this.el('div',this.center,'mwb-assembly-preview');
      this.emptyState(this.preview,'查看完整内容','点击题目或知识标题，在这里核对正文。');
      this.updateTabs();this.renderResults();
    }
    renderActiveFilters() {
      if(!this.activeFilters)return;this.activeFilters.replaceChildren();
      const labels={query:'搜索',subject:'学段学科',questionType:'题型',difficulty:'难度',tier:'教学分层',role:'题目角色',knowledge:'知识标签',method:'方法',source:'来源'};
      for(const [key,label] of Object.entries(labels)){
        const value=String(this.filters[key]||'');if(!value)continue;
        const select=this.filterSelects?.[key];
        const display=select?.selectedOptions?.[0]?.textContent||labelOf(value);
        const chip=this.button(this.activeFilters,`${label}：${display} ×`,()=>{
          delete this.filters[key];this.limit=100;
          if(key==='query'&&this.searchInput)this.searchInput.value='';
          this.populateFilters();this.renderResults();
        },'mwb-assembly-filter-chip');
        chip.dataset.filterKey=key;chip.setAttribute('aria-label',`清除${label}筛选`);
      }
      this.activeFilters.hidden=!this.activeFilters.childElementCount;
    }
    updateTabs() {
      for(const button of this.tabs?.querySelectorAll('button')||[]) {
        const active=button.dataset.kind===this.filters.kind;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
      }
    }
    renderResults() {
      if(!this.results) return;
      if(this.selectedItem){
        const current=this.index.items.find(item=>item.path===this.selectedItem.path&&item.kind===this.selectedItem.kind&&item.fingerprint===this.selectedItem.fingerprint);
        if(current)this.selectedItem=current;
        else this.clearItemPreview('来源已变化，请重新选择内容查看最新正文。');
      }
      if(this.selection && !this.selectionIsCurrent()) this.clearSelection('筛选或内容已变化，请重新生成候选。');
      this.renderActiveFilters();
      this.renderSelection();
      const previews=this.beginInlinePreviews('results');
      this.results.replaceChildren();
      const items=core.filterItems(this.index,this.filters);
      this.resultsSummary.textContent=`找到 ${items.length} ${this.filters.kind==='knowledge'?'篇知识':'道题'}，显示 ${Math.min(items.length,this.limit)} 条`;
      if(!items.length){
        const empty=this.emptyState(this.results,'没有匹配内容',this.index.items.length?'试试减少筛选条件，或更换关键词。':'先在“内容目录”中配置题库或知识目录，再读取内容。');
        if(Object.entries(this.filters).some(([key,value])=>key!=='kind'&&value))this.button(empty,'清除筛选',()=>{
          this.filters={kind:this.filters.kind,query:''};this.limit=100;this.searchInput.value='';this.populateFilters();this.renderResults();
        });
        else if(!this.index.items.length)this.button(empty,'配置内容目录',()=>{this.configDetails.open=true;this.switchPane('filters');this.questionRootsInput.focus();});
      }
      for(const item of items.slice(0,this.limit)) {
        const row=this.el('article',this.results,'mwb-assembly-result');
        row.dataset.sourcePath=item.path;row.dataset.sourceKind=item.kind;
        const open=()=>this.showItem(item,'results');
        const detail=this.button(row,item.title,open,'mwb-assembly-result-title');detail.title=item.title+'\n'+item.path+'\n点击查看完整内容';
        const info=[item.subject,item.kind==='question'?(typeNames[item.questionType]||item.questionType):'整篇知识',item.difficulty?`难度 ${item.difficulty}`:'',item.tier,item.role].filter(Boolean);
        const badges=this.el('div',row,'mwb-assembly-badges');
        for(const text of info)this.el('span',badges,'mwb-assembly-badge',text);
        const related=this.relatedKnowledge(item);
        if(related.length){const links=this.el('div',row,'mwb-assembly-muted mwb-assembly-card-related','关联知识：'+related.map(node=>node.title).join('、'));links.title=links.textContent;}
        this.addInlinePreview(previews,row,item);
        const footer=this.el('div',row,'mwb-assembly-card-footer');
        this.el('div',footer,'mwb-assembly-result-path',item.path).title=item.path;
        this.button(footer,'查看全文',open,'mwb-assembly-card-open');
        const added=this.plan.entries.some(entry=>entry.kind!== 'section' && ((item.id && entry.sourceId===item.id)||entry.sourcePath===item.path));
        row.classList.toggle('is-added',added);
        const add=this.button(row,added?'已加入':'加入',()=>this.add(item));add.disabled=added;add.classList.add('mwb-assembly-add');
      }
      if(items.length>this.limit) this.button(this.results,'再显示 100 条',()=>{this.limit+=100;this.renderResults();});
      this.updateSelectedRows();
      this.restoreWorkspaceAnchor('library');
    }
    updateSelectedRows() {
      for(const row of this.center?.querySelectorAll('[data-source-path]')||[]){
        const selected=!!this.selectedItem&&row.dataset.sourcePath===this.selectedItem.path&&row.dataset.sourceKind===this.selectedItem.kind;
        row.classList.toggle('is-selected',selected);
        row.querySelector('.mwb-assembly-result-title')?.setAttribute('aria-pressed',String(selected));
      }
      const add=this.preview?.querySelector('.mwb-assembly-preview-add');
      if(add&&this.selectedItem){
        const item=this.selectedItem,added=this.plan.entries.some(entry=>entry.kind!=='section'&&((item.id&&entry.sourceId===item.id)||entry.sourcePath===item.path));
        add.disabled=added||this.actionBusy;
        add.textContent=added?'已加入':item.kind==='knowledge'?'整篇加入':'加入题篮';
      }
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
      this.releaseInlinePreviews('candidates');
      this.selectionPanel.replaceChildren();
      this.selectionPanel.hidden=this.filters.kind!=='question';
      this.syncCandidateLayout();
      if(this.selectionPanel.hidden) return;
      const selectionHeader=this.el('div',this.selectionPanel,'mwb-assembly-selection-header');
      this.el('h3',selectionHeader,'','条件抽题');
      const hint=this.el('span',selectionHeader,'mwb-assembly-muted',this.selection?`${this.selection.items.length} 道待确认`:'按当前筛选随机选择');
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
          this.releaseInlinePreviews('candidates');
          this.selectionRows?.replaceChildren();
          if(this.selectionSummary)this.selectionSummary.textContent=this.selectionNotice;
          if(this.applySelectionButton){this.applySelectionButton.disabled=true;this.applySelectionButton.hidden=true;}
          hint.textContent='按当前筛选随机选择';draw.textContent='生成候选';
          this.syncCandidateLayout();
        }
      });
      const draw=this.button(tools,this.selection?'重新抽取':'生成候选',()=>this.drawSelection());
      draw.disabled=this.actionBusy||this.scanBusy;
      this.applySelectionButton=this.button(tools,'加入编排',()=>this.applySelection(),'mod-cta');
      this.applySelectionButton.disabled=this.actionBusy||this.scanBusy||!this.selection?.items.length;
      this.applySelectionButton.hidden=!this.selection;
      this.selectionSummary=this.el('div',this.selectionPanel,'mwb-assembly-selection-summary');
      this.selectionSummary.setAttribute('role','status');this.selectionSummary.setAttribute('aria-live','polite');
      const selection=this.selection;
      if(selection) {
        const short=(selection.available<selection.requested?`；符合条件且未加入编排的题目只有 ${selection.available} 道`:'')+
          (selection.capacity<Math.min(selection.requested,selection.available)?`；当前编排最多还能加入 ${selection.capacity} 道`:'');
        this.selectionSummary.textContent=`目标 ${selection.requested} 道，当前候选 ${selection.items.length} 道${short}。核对后点击“加入编排”。`;
      } else this.selectionSummary.textContent=this.selectionNotice||'自动排除已加入的题目；核对候选后再加入编排。';
      this.selectionRows=this.el('div',this.selectionPanel,'mwb-assembly-selection-results');
      const previews=this.beginInlinePreviews('candidates');
      for(const [position,item] of (selection?.items||[]).entries()) {
        const row=this.el('article',this.selectionRows,'mwb-assembly-selection-row');
        row.dataset.sourcePath=item.path;row.dataset.sourceKind=item.kind;
        const open=()=>{
          if(!this.selectionIsCurrent()) {this.clearSelection('候选题已过期，请重新生成。');return;}
          return this.showItem(item,'candidates');
        };
        const preview=this.button(row,`${position+1}. ${item.title}`,open,'mwb-assembly-result-title');
        preview.title=item.title+'\n'+item.path+'\n点击查看完整内容';
        this.el('div',row,'mwb-assembly-muted',[typeNames[item.questionType]||item.questionType,item.tier,item.difficulty?`难度 ${item.difficulty}`:''].filter(Boolean).join(' · '));
        this.addInlinePreview(previews,row,item);
        const footer=this.el('div',row,'mwb-assembly-card-footer');
        this.el('div',footer,'mwb-assembly-result-path',item.path).title=item.path;
        this.button(footer,'查看全文',open,'mwb-assembly-card-open');
        const remove=this.button(row,'移出候选',()=>{
          if(this.actionBusy||this.scanBusy) return;
          if(!this.selectionIsCurrent()) {this.clearSelection('候选题已过期，请重新生成。');return;}
          this.selection.items=this.selection.items.filter(candidate=>candidate!==item);
          this.renderSelection();
        });
        remove.disabled=this.actionBusy||this.scanBusy;
      }
      this.updateSelectedRows();
    }
    syncCandidateLayout() {
      const showingCandidates=!!this.selection&&this.filters.kind==='question';
      if(this.candidatesShown!==showingCandidates&&this.resultsDisclosure)this.resultsDisclosure.open=!showingCandidates;
      this.candidatesShown=showingCandidates;
      this.selectionPanel?.classList.toggle('has-candidates',showingCandidates);
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
        let latest,sourceCheck;
        try {
          // A visible result list is only a scan snapshot. Re-read the vault
          // before applying, so edits made since drawing cannot pass by using
          // the old fingerprint twice.
          sourceCheck=service.beginSourceCheck(this.settings);
          this.selectionSourceCheck=sourceCheck;
          latest=await service.scan(this.settings);
          if(this.closed)return;
          if(this.selection!==selection||!this.selectionIsCurrent())
            throw new Error('筛选或编排已变化，请重新生成候选');
          sourceCheck.assertCurrent();
          const count=selection.items.length;
          const next=core.addSelectedQuestions(this.plan,latest,this.filters,selection.items);
          this.index=latest;this.selection=null;
          this.selectionNotice=`已将 ${count} 道题加入编排，可在右侧调整顺序和角色。`;
          this.populateFilters();this.renderTree();this.setPlan(next);
          this.setStatus(this.selectionNotice);
        } catch(error) {
          if(this.closed)return;
          this.selection=null;this.selectionNotice=errorText(error);
          if(latest&&sourceCheck?.isCurrent()&&JSON.stringify(this.settings)===settingsKey){this.index=latest;this.populateFilters();this.renderTree();this.renderResults();this.renderOutline();}
          this.renderSelection();throw error;
        } finally {
          sourceCheck?.dispose();
          if(this.selectionSourceCheck===sourceCheck)this.selectionSourceCheck=null;
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
    async showItem(item,origin) {
      if(this.closed) return;
      const active=this.contentEl.ownerDocument.activeElement;
      if(origin||!this.center.classList.contains('is-previewing')||!this.preview.contains(active)){
        this.previewReturn={path:item.path,kind:item.kind,
          candidates:origin==='candidates'||(!origin&&!!active?.closest?.('.mwb-assembly-selection-row')),
          centerTop:this.center.scrollTop,resultsTop:this.results.scrollTop,candidatesTop:this.selectionRows?.scrollTop||0};
      }
      const generation=++this.previewGeneration;
      this.releasePreview();this.selectedItem=item;this.preview.replaceChildren();
      this.preview.scrollTop=0;
      this.switchPane('library');this.preview.classList.add('has-content');this.center.classList.add('is-previewing');
      this.center.scrollTop=0;
      const header=this.el('div',this.preview,'mwb-assembly-preview-header');
      const heading=this.el('h3',header,'',item.title);heading.tabIndex=-1;
      const controls=this.el('div',header,'mwb-assembly-preview-actions');
      this.button(controls,'收起预览',()=>this.clearItemPreview(undefined,true),'mwb-assembly-preview-back');
      this.button(controls,item.kind==='knowledge'?'整篇加入':'加入题篮',()=>this.add(item),'mwb-assembly-preview-add');
      this.button(controls,'打开原文件',()=>service.openSource(item.path));
      this.el('p',this.preview,'mwb-assembly-result-path',item.path);
      this.updateSelectedRows();
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
      heading.focus({preventScroll:true});
      try {
        if(renderMarkdown) await renderMarkdown(plainBody(item.markdown),body,item.path,owner);
        else body.textContent=plainBody(item.markdown);
        if(this.closed||generation!==this.previewGeneration) return;
      } catch(error){if(!this.closed&&generation===this.previewGeneration)this.el('p',body,'mwb-assembly-error','预览失败：'+errorText(error));}
    }
    clearItemPreview(message='点击题目或知识标题，在这里核对正文。',restoreFocus=false) {
      const returnTo=this.previewReturn;this.previewReturn=null;
      this.previewGeneration++;this.releasePreview();this.selectedItem=null;
      this.center?.classList.remove('is-previewing');
      this.preview?.replaceChildren();this.preview?.classList.remove('has-content');
      if(this.preview)this.emptyState(this.preview,'查看完整内容',message);
      this.updateSelectedRows();
      if(restoreFocus){
        const list=returnTo?.candidates?this.selectionRows:this.results;
        const row=[...list?.querySelectorAll('[data-source-path]')||[]].find(node=>node.dataset.sourcePath===returnTo?.path&&node.dataset.sourceKind===returnTo?.kind);
        if(row&&!returnTo?.candidates)this.resultsDisclosure.open=true;
        if(this.results)this.results.scrollTop=returnTo?.resultsTop||0;
        if(this.selectionRows)this.selectionRows.scrollTop=returnTo?.candidatesTop||0;
        if(this.center)this.center.scrollTop=returnTo?.centerTop||0;
        const target=row?.querySelector('.mwb-assembly-result-title');
        (target||this.searchInput)?.focus({preventScroll:true});
      }
    }
    renderArrangementShell() {
      this.arrangementPane=this.el('section',this.root,'mwb-assembly-arrangement');
      this.arrangementPane.setAttribute('aria-label','预览编排');
      const toolbar=this.el('div',this.arrangementPane,'mwb-assembly-arrangement-toolbar');
      const sectionMenu=this.el('details',toolbar,'mwb-assembly-section-menu');
      const sectionToggle=this.el('summary',sectionMenu,'','添加分区');
      const sectionForm=this.el('div',sectionMenu,'mwb-assembly-section-form');
      this.arrangementSectionInput=this.field(sectionForm,'新增分区标题');
      this.arrangementSectionInput.placeholder='例如：巩固训练';this.arrangementSectionInput.maxLength=200;
      this.arrangementSectionInput.dataset.arrangementMutate='true';
      const add=this.button(sectionForm,'加入分区',()=>{
        if(this.closed||!sectionMenu.isConnected||this.actionBusy||this.scanBusy)return;
        const title=this.arrangementSectionInput.value.trim();if(!title){this.notice('请输入分区标题');return;}
        this.setPlan(core.addSection(this.plan,title));this.arrangementSectionInput.value='';
        sectionMenu.open=false;sectionToggle.focus({preventScroll:true});
      });add.dataset.arrangementMutate='true';
      this.arrangementSectionInput.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();add.click();}});
      sectionMenu.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();sectionMenu.open=false;sectionToggle.focus();}});
      const refresh=this.button(toolbar,'更新引用',()=>this.updateReferences());refresh.dataset.arrangementMutate='true';
      this.arrangementList=this.el('div',this.arrangementPane,'mwb-assembly-arrangement-list');
      this.releaseWorkspaceAnchorOnInput(this.arrangementPane,'arrangement');
      this.arrangementList.setAttribute('aria-label','已选内容顺序');
      this.arrangementList.addEventListener('dragover',event=>{
        if(this.workspaceMode==='arrangement'&&!this.actionBusy&&!this.scanBusy)event.preventDefault();
      });
      this.arrangementList.addEventListener('drop',event=>{
        if(event.target!==this.arrangementList)return;
        event.preventDefault();
        const id=event.dataTransfer?.getData('application/x-mathsemble-entry');
        this.changeArrangement(id,(plan)=>core.moveEntry(plan,id,plan.entries.length-1));
      });
    }
    changeArrangement(entryId,change,row) {
      if(this.closed||this.workspaceMode!=='arrangement'||this.actionBusy||this.scanBusy)return;
      if(row&&!row.isConnected)return;
      const index=this.plan.entries.findIndex(entry=>entry.entryId===entryId);
      if(index<0)return;
      try {this.setPlan(change(this.plan,index));}
      catch(error){this.setStatus(errorText(error),true);this.notice(errorText(error));this.renderArrangement();}
    }
    editArrangementEntry(entryId,patch,row) {
      if(this.closed||!row.isConnected||this.workspaceMode!=='arrangement'||this.actionBusy||this.scanBusy)return false;
      try {
        // Metadata edits keep the current row alive: a blur must not remove the
        // button about to receive the same pointer click or restart typesetting.
        const next=core.updateEntry(this.plan,entryId,patch);
        const before=this.plan.entries.find(entry=>entry.entryId===entryId),after=next.entries.find(entry=>entry.entryId===entryId);
        if(before.title===after.title&&before.role===after.role)return true;
        this.plan=next;this.stateChanged();this.renderResults();
        return true;
      }catch(error){this.setStatus(errorText(error),true);this.notice(errorText(error));return false;}
    }
    observeArrangementOverflow(record,expand,row) {
      const group=record.group,win=this.contentEl.ownerDocument.defaultView;
      record.updateOverflow=()=>{
        if(this.closed||!group.active||!record.node.isConnected||!record.node.getClientRects().length)return;
        const expanded=row.classList.contains('is-expanded');
        const hiddenAnswer=[...record.body.querySelectorAll('.callout[data-callout="answer"],.callout[data-callout="solution"]')]
          .some(node=>win.getComputedStyle(node).display==='none');
        let more=record.node.scrollHeight>record.node.clientHeight+1||record.node.scrollWidth>record.node.clientWidth+1||hiddenAnswer;
        if(!expanded&&!more){
          // A code/table/math scroller can fit the excerpt while hiding content
          // inside it. The inert excerpt cannot scroll, so it still needs expand.
          const checked=new Set();
          outer:for(const target of record.body.querySelectorAll('pre,table,mjx-container')){
            for(let node=target;node&&node!==record.node;node=node.parentElement){
              if(checked.has(node))break;
              checked.add(node);
              const wide=node.clientWidth>0&&node.scrollWidth>node.clientWidth+1;
              const tall=node.clientHeight>0&&node.scrollHeight>node.clientHeight+1;
              if((!wide&&!tall)||!node.getClientRects().length)continue;
              const style=win.getComputedStyle(node);
              if((wide&&/^(auto|scroll)$/.test(style.overflowX))||(tall&&/^(auto|scroll)$/.test(style.overflowY))){more=true;break outer;}
            }
          }
        }
        const hidden=!expanded&&!more;
        if(hidden&&this.contentEl.ownerDocument.activeElement===expand)row.querySelector('[data-arrangement-action="drag"]')?.focus({preventScroll:true});
        expand.hidden=hidden;expand.textContent=expanded?'收起全文':'展开全文';expand.setAttribute('aria-expanded',String(expanded));
      };
      if(!group.resizeRecords){
        group.resizeRecords=new Map();
        const Observer=win?.ResizeObserver;
        if(Observer)group.resizeObserver=new Observer(entries=>{
          if(!group.active||this.closed)return;
          const records=new Set(entries.map(entry=>group.resizeRecords.get(entry.target)).filter(Boolean));
          for(const current of records)current.updateOverflow?.();
        });
      }
      for(const node of [record.node,record.body]){group.resizeRecords.set(node,record);group.resizeObserver?.observe(node);}
      record.updateOverflow();
    }
    renderArrangement() {
      if(!this.arrangementList)return;
      if(this.workspaceMode!=='arrangement'){this.releaseInlinePreviews('arrangement');return;}
      const list=this.arrangementList,scrollTop=list.scrollTop;
      const active=this.contentEl.ownerDocument.activeElement,activeRow=active?.closest?.('.mwb-assembly-arrangement-entry');
      const focus=activeRow&&list.contains(activeRow)?{id:activeRow.dataset.entryId,
        action:active.dataset.arrangementAction,field:active.dataset.arrangementField,top:activeRow.getBoundingClientRect().top-list.getBoundingClientRect().top}:null;
      this.workspaceAnchors.arrangement=focus?this.captureWorkspaceAnchor('arrangement',activeRow):
        this.workspaceAnchors.arrangement||this.captureWorkspaceAnchor('arrangement');
      for(const row of list.querySelectorAll('[data-entry-id]')){
        if(row.querySelector('.mwb-assembly-arrangement-more')?.open)this.arrangementMenuOpen.add(row.dataset.entryId);
        else this.arrangementMenuOpen.delete(row.dataset.entryId);
      }
      const ids=new Set(this.plan.entries.map(entry=>entry.entryId));
      this.arrangementMenuOpen=new Set([...this.arrangementMenuOpen].filter(id=>ids.has(id)));
      this.arrangementExpanded=new Set([...this.arrangementExpanded].filter(id=>ids.has(id)));
      const previews=this.beginInlinePreviews('arrangement',list);
      list.replaceChildren();
      const resolved=core.resolvePlan(this.plan,this.index);
      if(!resolved.entries.length){
        const empty=this.emptyState(list,'还没有可编排的内容','先加入题目或知识，再在这里边看边调整顺序。');
        this.button(empty,'去选题',()=>{this.switchWorkspaceMode('library');this.switchPane('library');this.searchInput?.focus();});
      }
      let questionNumber=0;
      resolved.entries.forEach(({entry,item,status},index)=>{
        const row=this.el('article',list,'mwb-assembly-arrangement-entry'+(entry.kind==='section'?' is-section':''));
        row.dataset.entryId=entry.entryId;row.dataset.sourceStatus=entry.kind==='section'?'section':status;
        row.classList.toggle('is-expanded',this.arrangementExpanded.has(entry.entryId));
        const kind=entry.kind==='section'?'分区':entry.kind==='knowledge'?'知识':`第 ${++questionNumber} 题`;
        const header=this.el('div',row,'mwb-assembly-arrangement-entry-header');
        const handle=this.button(header,'⠿',()=>this.setStatus('拖动手柄排序，也可使用上移、下移或更多中的指定位置。'),'mwb-assembly-arrangement-drag');
        handle.draggable=true;handle.dataset.arrangementAction='drag';handle.dataset.arrangementMutate='true';
        const updateLabels=()=>{
          const current=this.plan.entries.find(value=>value.entryId===entry.entryId);
          handle.setAttribute('aria-label',`拖动排序：${current?.title||item?.title||kind}`);handle.title='拖动排序';
        };
        updateLabels();
        handle.addEventListener('dragstart',event=>{
          if(!row.isConnected||this.actionBusy||this.scanBusy||this.workspaceMode!=='arrangement'){event.preventDefault();return;}
          handle.focus({preventScroll:true});
          event.dataTransfer?.setData('application/x-mathsemble-entry',entry.entryId);
          if(event.dataTransfer)event.dataTransfer.effectAllowed='move';row.classList.add('is-dragging');
        });
        handle.addEventListener('dragend',()=>row.classList.remove('is-dragging'));
        row.addEventListener('dragover',event=>{
          if(!this.actionBusy&&!this.scanBusy){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
        });
        row.addEventListener('drop',event=>{
          event.preventDefault();event.stopPropagation();
          const id=event.dataTransfer?.getData('application/x-mathsemble-entry');
          if(id===entry.entryId)return;
          this.changeArrangement(id,plan=>{
            const target=plan.entries.findIndex(value=>value.entryId===entry.entryId);
            return core.moveEntry(plan,id,target);
          },row);
        });
        this.el('span',header,'mwb-assembly-arrangement-position',kind);
        const title=this.el('input',header,'mwb-assembly-arrangement-title');title.value=entry.title||'';
        title.placeholder=item?.title||'未命名内容';title.maxLength=200;title.setAttribute('aria-label',entry.kind==='section'?'分区标题':'本次显示标题');
        title.dataset.arrangementField='title';title.dataset.arrangementMutate='true';
        title.addEventListener('change',()=>{
          this.editArrangementEntry(entry.entryId,{title:title.value},row);
          title.value=this.plan.entries.find(value=>value.entryId===entry.entryId)?.title||'';updateLabels();
        });
        title.addEventListener('keydown',event=>{
          if(event.key==='Escape'){event.preventDefault();title.value=this.plan.entries.find(value=>value.entryId===entry.entryId)?.title||'';title.blur();}
          if(event.key==='Enter'){event.preventDefault();title.blur();handle.focus({preventScroll:true});}
        });
        if(entry.kind==='question'){
          const role=this.el('select',header,'mwb-assembly-arrangement-role');role.setAttribute('aria-label','本次角色');
          this.el('option',role,'',`沿用${item?.role?'：'+item.role:'题卡'}`).value='';
          for(const value of roles)this.el('option',role,'',value).value=value;
          role.value=entry.role||'';role.dataset.arrangementField='role';role.dataset.arrangementMutate='true';
          role.addEventListener('change',()=>{
            this.editArrangementEntry(entry.entryId,{role:role.value},row);
            role.value=this.plan.entries.find(value=>value.entryId===entry.entryId)?.role||'';
          });
        }
        const action=(parent,label,key,callback)=>{
          const button=this.button(parent,label,callback);button.dataset.arrangementAction=key;return button;
        };
        const up=action(header,'↑','up',()=>this.changeArrangement(entry.entryId,(plan,current)=>core.moveEntry(plan,entry.entryId,current-1),row));
        const down=action(header,'↓','down',()=>this.changeArrangement(entry.entryId,(plan,current)=>core.moveEntry(plan,entry.entryId,current+1),row));
        up.dataset.boundary=String(index===0);down.dataset.boundary=String(index===this.plan.entries.length-1);
        for(const [control,label] of [[up,'上移'],[down,'下移']]){control.dataset.arrangementMutate='true';control.setAttribute('aria-label',label);control.title=label;}
        const more=this.el('details',row,'mwb-assembly-arrangement-more');more.open=this.arrangementMenuOpen.has(entry.entryId);
        const toggle=this.el('summary',more,'','⋯');toggle.dataset.arrangementAction='more';toggle.setAttribute('aria-label','更多操作');toggle.title='更多操作';
        more.addEventListener('toggle',()=>{
          if(!more.isConnected)return;
          if(more.open){
            this.arrangementMenuOpen.add(entry.entryId);
            for(const other of list.querySelectorAll('.mwb-assembly-arrangement-more[open]'))if(other!==more)other.open=false;
          }else this.arrangementMenuOpen.delete(entry.entryId);
        });
        more.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();more.open=false;toggle.focus({preventScroll:true});}});
        const actions=this.el('div',more,'mwb-assembly-arrangement-actions');
        const position=this.field(actions,'移到第几项');position.type='number';position.min='1';position.max=String(this.plan.entries.length);position.step='1';position.value=String(index+1);
        position.dataset.arrangementField='position';position.dataset.arrangementMutate='true';
        const move=action(actions,'移动','move',()=>this.changeArrangement(entry.entryId,plan=>{
          const target=Number(position.value);
          if(!Number.isInteger(target)||target<1||target>plan.entries.length)throw new Error(`请输入 1 至 ${plan.entries.length} 之间的编排位置`);
          return core.moveEntry(plan,entry.entryId,target-1);
        },row));move.dataset.arrangementMutate='true';
        position.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();move.click();}});
        if(entry.kind!=='section'){
          const source=action(actions,'打开原文','source',()=>{if(row.isConnected)return service.openSource(item?.path||entry.sourcePath);});
          source.setAttribute('aria-label',`打开原文：${item?.path||entry.sourcePath}`);
        }
        const remove=action(actions,entry.kind==='section'?'移除分区':'移除','remove',()=>this.changeArrangement(entry.entryId,plan=>core.removeEntry(plan,entry.entryId),row));
        remove.dataset.arrangementMutate='true';remove.classList.add('mwb-assembly-remove');
        this.el('p',more,'mwb-assembly-muted',`第 ${index+1} 项，共 ${this.plan.entries.length} 项；位置包含题目、知识和分区。`);
        if(entry.kind!=='section'){
          this.el('div',more,'mwb-assembly-result-path',item?.path||entry.sourcePath);
          const message={changed:'源文已变化。请先点击“更新引用”核对最新正文，再继续预览。',missing:'找不到源文件，请恢复来源或移除此项。',conflict:'来源身份冲突，请修正后重新读取。'}[status];
          if(message)this.el('p',row,'mwb-assembly-error',message);
          if(status==='ok'&&item){
            const record=this.addInlinePreview(previews,row,item);
            record.node.toggleAttribute('inert',!this.arrangementExpanded.has(entry.entryId));
            record.node.setAttribute('aria-label','已选内容正文');
            const expand=action(row,'展开全文','expand',()=>{
              if(!row.isConnected)return;
              const open=!this.arrangementExpanded.has(entry.entryId);
              if(open)this.arrangementExpanded.add(entry.entryId);else this.arrangementExpanded.delete(entry.entryId);
              row.classList.toggle('is-expanded',open);record.node.toggleAttribute('inert',!open);record.updateOverflow?.();
            });expand.hidden=true;expand.classList.add('mwb-assembly-expand');
            this.observeArrangementOverflow(record,expand,row);
          }
        }
      });
      list.scrollTop=scrollTop;
      this.updateSummary();
      if(focus){
        const row=[...list.children].find(node=>node.dataset.entryId===focus.id);
        const target=[...row?.querySelectorAll('button,input,select,summary')||[]].find(node=>focus.field?node.dataset.arrangementField===focus.field:node.dataset.arrangementAction===focus.action);
        const fallback=row?.querySelector('[data-arrangement-action="drag"]');
        if(row){
          list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-focus.top;
          (target&&!target.disabled&&target.getClientRects().length?target:fallback)?.focus({preventScroll:true});
        }else list.querySelector('button')?.focus({preventScroll:true});
      }
      this.restoreWorkspaceAnchor('arrangement');
    }
    renderOutline() {
      this.updateSummary();
      this.renderArrangement();
    }
    async scan() {
      if(this.actionBusy){this.notice('请等待当前操作完成');return;}
      const generation=++this.scanGeneration;this.scanBusy=true;
      this.updateSummary();
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
      finally{if(generation===this.scanGeneration){this.scanBusy=false;if(!this.closed){this.renderSelection();this.updateSummary();}}}
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
