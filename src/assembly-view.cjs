'use strict';

// Native Obsidian view. UI state belongs to the workspace; content writes are
// delegated to explicit service actions. No source Markdown is mutated here.
module.exports = function createAssemblyView({ItemView, Notice, Component, core, service, renderMarkdown,openBlueprint,openFamily,openSimilarity,
  usageService,openUsage,openLibrary,openPresentation}) {
  const VIEW_TYPE = 'mathsemble-assembly';
  const roles = ['例题', '变式', '训练'];
  const calloutTypes = ['solution','scaffold','thinking','method','conclusion','attention','definition','theorem','success'];
  const typeNames = {choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'};
  const labelOf = value => String(value ?? '').replace(/^\[\[|\]\]$/g, '').split('|').at(-1);
  const sortLabels = new Intl.Collator('zh-CN',{numeric:true}).compare;
  const errorText = error => String(error?.message || error);
  const plainBody = markdown => String(markdown || '').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/, '');
  const planSaveHint = '保存讲义标题、内容顺序、来源引用、本次标题／角色，以及课程信息和默认排版；正文仍来自原笔记。';

  return class AssemblyView extends ItemView {
    constructor(leaf, plugin) {
      super(leaf);
      this.assemblyLeaf = leaf;
      this.plugin = plugin;
      this.planSession = service.createPlanSession ? service.createPlanSession() : service;
      this.plan = core.createPlan();
      this.planPath = null;
      this.dirty = false;
      this.index = {items:[],issues:[]};
      this.indexState = 'unread';
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
      this.arrangementDrag = null;
      this.orderingSidebarOpen = null;
      this.orderingSelectedId = null;
      this.inlinePreviewGroups = new Map();
      this.inlinePreviewQueue = [];
      this.inlinePreviewActive = 0;
      this.usageFilter={classId:'',courseId:'',mode:'all',days:30};
      this.usageGeneration=0;this.usageLedger=null;this.usageState='idle';this.usageStats=new Map();
    }
    getViewType() { return VIEW_TYPE; }
    getDisplayText() { return this.plan?.title || '选材与编排'; }
    getIcon() { return 'layers'; }
    getState() {
      return {plan:this.plan,planPath:this.planPath,dirty:this.dirty,filters:this.filters,usageFilter:this.usageFilter,workspaceMode:this.workspaceMode};
    }
    async setState(state, result) {
      if (state?.plan) {
        try {
          this.plan = core.validatePlan(state.plan);
          this.planPath = typeof state.planPath === 'string' ? state.planPath : null;
          this.dirty = !!state.dirty;
          if (state.filters && typeof state.filters === 'object') {
            delete this.filters.chapter; delete this.filters.section;
            for (const key of ['kind','query','knowledge','subject','chapter','section','questionType','difficulty','tier','role','method','source','familyId','familyState']) {
              if (typeof state.filters[key] === 'string') this.filters[key] = state.filters[key];
            }
          }
        } catch (error) { this.notice('无法恢复旧编排：' + errorText(error)); }
      }
      if(['library','arrangement'].includes(state?.workspaceMode))this.workspaceMode=state.workspaceMode;
      if(state?.usageFilter&&typeof state.usageFilter==='object'){
        const raw=state.usageFilter;
        this.usageFilter={classId:typeof raw.classId==='string'?raw.classId.slice(0,200):'',courseId:typeof raw.courseId==='string'?raw.courseId.slice(0,200):'',
          mode:['all','unused','taught-not-assigned'].includes(raw.mode)?raw.mode:'all',days:Number.isSafeInteger(raw.days)&&raw.days>0&&raw.days<=36500?raw.days:30};
      }
      await super.setState?.(state, result);
      if (!this.closed && this.root) {this.render();await this.refreshUsage();}
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
      this.clearArrangementDrag();
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
      this.similarityModal?.invalidate('编排已变化，请刷新候选。');
      if(this.presentationModal&&!this.presentationModal.closed)this.presentationModal.fail(new Error('编排已变化，请重新打开逐题投影'));
      this.clearArrangementDrag();
      this.clearSelection('编排已变化，请重新生成候选。');
      this.dirty = true;
      this.pendingDiscard = null;
      this.app.workspace.requestSaveLayout?.();
      this.updateSummary();
    }
    setPlan(plan) {
      this.plan = plan;
      this.stateChanged();
      this.refreshPlanSettings();
      this.renderOutline();
      this.renderResults();
    }
    applyPlanSettings(settings) {
      if(this.closed)throw new Error('编排工作区已关闭，请重新打开方案后再应用设置');
      if(this.actionBusy||this.scanBusy)throw new Error('编排正在处理其他操作，请完成后再应用设置');
      const course=core.validateCourse(settings.course),output=core.validateOutputSettings(settings.output);
      if(JSON.stringify(course)===JSON.stringify(this.plan.course)&&JSON.stringify(output)===JSON.stringify(this.plan.output))return false;
      this.plan=core.validatePlan({...this.plan,course,output});
      this.stateChanged();this.refreshPlanSettings();
      return true;
    }
    bindPreviewSettings() {
      // Bind to the exact draft that opened the preview, not whichever plan is
      // displayed later. Only this explicit callback may advance its baseline.
      const binding={plan:this.plan,path:this.planPath};
      return settings=>{
        if(this.plan!==binding.plan||this.planPath!==binding.path)
          throw new Error('编排方案已变化，请从当前方案重新打开 A4 预览后应用设置');
        const changed=this.applyPlanSettings(settings);
        binding.plan=this.plan;binding.path=this.planPath;
        this.setStatus(changed?'已应用 A4 课程与排版，请保存方案。':this.dirty?'设置已在当前编排中，请保存方案。':this.planPath?'设置与已保存方案一致。':'设置与当前编排一致，请保存方案。');
        return changed;
      };
    }
    bindPreviewContext() {
      const plan=this.plan,path=this.planPath,leaf=this.assemblyLeaf;
      const live=()=>!this.closed&&leaf?.view===this;
      const isCurrent=()=>live()&&this.plan===plan&&this.planPath===path;
      return {
        isCurrent,
        onApplyPlanSettings:this.bindPreviewSettings(),
        onReturnToAssembly:async()=>{
          if(!live())throw new Error('原编排工作区已关闭，请重新打开方案后更新来源');
          if(typeof this.app.workspace.revealLeaf!=='function')throw new Error('无法返回编排工作区，请从“选材与编排”重新打开方案');
          await this.app.workspace.revealLeaf(leaf);
          if(!live())throw new Error('原编排工作区已关闭，请重新打开方案后更新来源');
          // Returning only reveals the live workspace. Never restore an old
          // draft or accept source changes on behalf of the user.
          if(!this.actionBusy&&!this.scanBusy)this.setStatus(isCurrent()
            ? '已返回编排；请刷新素材并核对来源，接受来源更新后重新打开 A4 预览。'
            : '已返回当前编排；方案已变化，请核对所需方案和来源后重新打开 A4 预览。');
        }
      };
    }
    refreshPlanSettings() {
      if(!this.planSettingsInputs)return;
      const busy=this.actionBusy||this.scanBusy;
      for(const [key,input] of this.planSettingsInputs.course){
        const value=key==='title'&&this.plan.course.title===null?this.plan.title:this.plan.course[key];
        if(input.value!==value)input.value=value;
        input.disabled=busy||key==='title'&&this.plan.course.title===null;
      }
      const follow=this.planSettingsInputs.follow;
      follow.checked=this.plan.course.title===null;follow.disabled=busy;
      for(const [key,input] of this.planSettingsInputs.output){
        const value=Object.prototype.hasOwnProperty.call(this.plan.output,key)?this.plan.output[key]:
          Object.prototype.hasOwnProperty.call(this.plan.output.spaceSettings,key)?this.plan.output.spaceSettings[key]:this.plan.output.solutionOptions[key];
        const text=Array.isArray(value)?value.filter(type=>!calloutTypes.includes(type)).join(', '):String(value);
        if(input.type==='checkbox')input.checked=value;
        else if(input.value!==text)input.value=text;
        input.disabled=busy;
      }
      for(const [key,types] of this.planSettingsInputs.callouts){
        for(const [type,input] of types){
          input.checked=this.plan.output.solutionOptions[key].includes(type);input.disabled=busy;
        }
      }
    }
    renderPlanSettings(parent) {
      const panel=this.el('details',parent,'mwb-assembly-plan-settings');
      this.el('summary',panel,'','课程与排版');
      const body=this.el('div',panel,'mwb-assembly-plan-settings-body');
      this.el('p',body,'mwb-assembly-muted','随“保存方案”保存；下次从此方案生成 A4 时恢复。');
      const inputs={course:new Map(),output:new Map(),callouts:new Map(),follow:null};this.planSettingsInputs=inputs;
      const edit=change=>{
        if(this.planSettingsInputs!==inputs||!panel.isConnected)return;
        try{if(this.applyPlanSettings(change()))this.setStatus('课程与排版已修改，请保存方案。');}
        catch(error){this.refreshPlanSettings();this.setStatus(errorText(error),true);}
      };
      const followLabel=this.el('label',body,'mwb-assembly-check');
      const follow=this.el('input',followLabel);follow.type='checkbox';follow.dataset.courseFollow='title';
      followLabel.appendChild(this.contentEl.ownerDocument.createTextNode('课题跟随讲义标题'));
      this.planSettingsInputs.follow=follow;
      follow.addEventListener('change',()=>edit(()=>({course:{...this.plan.course,title:follow.checked?null:this.plan.title},output:this.plan.output})));
      for(const [key,label] of [['title','课题名称'],['teacher','教师'],['student','学生'],['time','上课时间'],['subject','学科'],['grade','年级'],['objectives','学习目标']]){
        const input=this.field(body,label,key==='objectives'?'textarea':'input');
        input.dataset.courseField=key;input.maxLength=key==='objectives'?1600:key==='title'?500:200;
        if(key==='objectives')input.rows=3;
        if(key==='teacher')input.placeholder='留空使用孙老师';
        this.planSettingsInputs.course.set(key,input);
        input.addEventListener('input',()=>edit(()=>({course:{...this.plan.course,[key]:input.value},output:this.plan.output})));
      }
      const select=(key,label,choices,group)=>{
        const input=this.field(body,label,'select');input.dataset.outputField=key;
        for(const [value,text] of choices)this.el('option',input,'',text).value=String(value);
        this.planSettingsInputs.output.set(key,input);
        input.addEventListener('change',()=>edit(()=>({course:this.plan.course,output:group?
          {...this.plan.output,[group]:{...this.plan.output[group],[key]:Number(input.value)}}:
          {...this.plan.output,[key]:input.value}})));
      };
      select('layout','默认外观',[['default','默认排版'],['two-column','双列排版'],['trial','试听排版']]);
      select('mode','默认版本',[['document','原文预览'],['student','学生版'],['teacher','教师版']]);
      select('ratio','等高留白比例',[50,75,90,100,110,125,150].map(value=>[value,value+'%']),'spaceSettings');
      select('minimumCm','最小留白高度',[0,2,4].map(value=>[value,value+' cm']),'spaceSettings');
      this.el('p',body,'mwb-assembly-muted','带 - 的 Callout：学生版全部隐藏，answer 固定留白；教师版 answer 固定显示。其他类型默认不留白、不显示。带 + 或无标记的 Callout 始终显示。');
      const choices=[['studentBlankCallouts','学生留白'],['teacherVisibleCallouts','教师显示']];
      const table=this.el('table',body,'mwb-assembly-callout-options');
      const head=this.el('tr',this.el('thead',table));
      for(const label of ['Callout 类型','学生留白','教师显示'])this.el('th',head,'',label);
      const rows=this.el('tbody',table);
      for(const [key] of choices)inputs.callouts.set(key,new Map());
      for(const type of calloutTypes){
        const row=this.el('tr',rows);this.el('td',row,'',type);
        for(const [key,label] of choices){
          const input=this.el('input',this.el('td',row));input.type='checkbox';
          input.dataset.calloutOption=key;input.dataset.calloutType=type;
          input.setAttribute('aria-label',type+' '+label);
          inputs.callouts.get(key).set(type,input);
          input.addEventListener('change',()=>edit(()=>{
            const types=this.plan.output.solutionOptions[key].filter(value=>value!==type);
            if(input.checked)types.push(type);
            return {course:this.plan.course,output:{...this.plan.output,
              solutionOptions:{...this.plan.output.solutionOptions,[key]:types}}};
          }));
        }
      }
      for(const [key,label] of [['studentBlankCallouts','学生版其他类型留白'],['teacherVisibleCallouts','教师版其他类型显示']]){
        const input=this.field(body,label,'input');input.type='text';input.dataset.outputField=key;
        input.placeholder='例如 hint, remark；用逗号分隔';
        input.setAttribute('aria-description','填写表格之外的 Callout 类型，多个类型以逗号分隔；无需填写 answer。');
        this.planSettingsInputs.output.set(key,input);
        input.addEventListener('change',()=>edit(()=>({course:this.plan.course,
          output:{...this.plan.output,solutionOptions:{...this.plan.output.solutionOptions,
            [key]:[...this.plan.output.solutionOptions[key].filter(type=>calloutTypes.includes(type)),
              ...input.value.trim().toLowerCase().split(/[\s,，、]+/).filter(Boolean)]}}})));
      }
      this.refreshPlanSettings();
    }
    resizePlanMenu() {
      if(this.closed||!this.planMenu?.open)return;
      const available=this.root.getBoundingClientRect().bottom-this.planMenuBody.getBoundingClientRect().top-8;
      this.planMenuBody.style.maxHeight=Math.max(0,Math.min(560,available))+'px';
    }
    setStatus(message, error = false) {
      if (this.closed || !this.statusEl) return;
      this.statusEl.textContent = message;
      this.statusEl.title = message;
      this.statusEl.classList.toggle('is-error', error);
    }
    updateSummary() {
      if(this.actionBusy||this.scanBusy)this.clearArrangementDrag();
      if (!this.summaryEl) return;
      const questions = this.plan.entries.filter(entry => entry.kind === 'question').length;
      const knowledge = this.plan.entries.filter(entry => entry.kind === 'knowledge').length;
      const sections=this.plan.entries.filter(entry=>entry.kind==='section').length;
      this.summaryEl.textContent = [`已选 ${questions} 题`,knowledge?`${knowledge} 篇知识`:'',sections?`${sections} 个分区`:''].filter(Boolean).join(' · ');
      const scored=this.plan.entries.filter(entry=>entry.kind==='question'&&typeof entry.score==='number');
      if(scored.length){const sum=scored.reduce((total,entry)=>total+Math.round(entry.score*100),0)/100;this.summaryEl.textContent+=` · ${scored.length===questions?'总分':'已设分值小计'} ${sum} 分`;}
      this.summaryEl.setAttribute('aria-label',`查看预览编排：${this.plan.entries.length} 项，${questions} 道题，${knowledge} 篇知识，${sections} 个分区`);
      if(this.saveStateEl){
        this.saveStateEl.textContent=this.dirty?'方案未保存':this.planPath?'方案已保存':'新方案';
        this.saveStateEl.classList.toggle('is-dirty',this.dirty);
      }
      if(this.sourceStateEl){
        this.sourceStateEl.hidden=questions+knowledge===0;
        let label=this.scanBusy?'正在刷新素材':'来源待核对';
        let detail=this.scanBusy?'正在重新读取素材；完成后核对当前编排的来源。':this.indexState==='error'?'素材刷新未完成，请重试；当前保留上次读取的内容。':'请先刷新素材，再核对编排来源。';
        let attention=!this.scanBusy&&this.indexState==='error';
        if(!this.scanBusy&&this.indexState==='ready'){
          // Resolve only when the immutable entries or scan snapshot change.
          if(this.sourceSummary?.entries!==this.plan.entries||this.sourceSummary?.index!==this.index)
            this.sourceSummary={entries:this.plan.entries,index:this.index,issues:core.resolvePlan(this.plan,this.index).issues};
          const issues=this.sourceSummary.issues;
          label=issues.length?`${issues.length} 项来源待处理`:'上次刷新已核对';
          detail=issues.length?'请在预览编排中核对来源变化、缺失或冲突；保存方案不会自动接受来源更新。':'按最近一次素材刷新核对；生成讲义前还会重新读取源文。';
          attention=issues.length>0;
        }
        this.sourceStateEl.textContent=label;this.sourceStateEl.title=detail;
        this.sourceStateEl.classList.toggle('is-dirty',attention);
      }
      for(const button of this.primaryButtons||[])button.disabled=this.actionBusy||this.scanBusy;
      for(const add of this.results?.querySelectorAll('.mwb-assembly-add')||[])
        add.disabled=this.actionBusy||this.scanBusy||add.closest('.mwb-assembly-result').classList.contains('is-added');
      const previewAdd=this.preview?.querySelector('.mwb-assembly-preview-add');
      if(previewAdd)previewAdd.disabled=this.actionBusy||this.scanBusy||this.previewAlreadyAdded();
      if(this.retryFilesButton)this.retryFilesButton.disabled=this.actionBusy||this.scanBusy;
      for(const control of this.arrangementPane?.querySelectorAll('[data-arrangement-mutate]')||[])
        control.disabled=this.actionBusy||this.scanBusy||control.dataset.boundary==='true';
      this.refreshPlanSettings();
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
      if (this.scanBusy) { this.notice('正在刷新素材，请稍候'); return; }
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
      const workspace=this.app?.workspace;
      if(workspace?.layoutReady===false && workspace.onLayoutReady){
        // A restored tab must let layout initialization finish before inventorying the vault.
        this.setStatus('正在等待 Obsidian 载入库文件…');
        workspace.onLayoutReady(()=>{if(!this.closed)void this.loadInitialIndex();});
        return;
      }
      await this.loadInitialIndex();
    }
    async loadInitialIndex() {
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
      this.resetSearchInput();
      this.blueprintModal?.close();
      this.familyModal?.close();
      this.similarityModal?.close();
      this.usageModal?.close();this.libraryModal?.close();this.presentationModal?.close();
      this.usageGeneration++;
      this.clearArrangementDrag();
      this.planMenuObserver?.disconnect();this.planMenuObserver=null;
      this.selectionSourceCheck?.dispose();this.selectionSourceCheck=null;
      this.scanController?.abort();this.scanBaseline=null;this.scanProgress=null;
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
      this.planMenuObserver?.disconnect();this.planMenuObserver=null;
      this.planSettingsInputs=null;
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
      this.root.setAttribute('aria-label','选材与编排');
      const toolbar = this.el('header', this.root, 'mwb-assembly-toolbar');
      this.titleInput = this.field(toolbar, '讲义标题');
      this.titleInput.value = this.plan.title;
      this.titleInput.maxLength = 200;
      this.titleInput.addEventListener('input', () => {
        if (this.actionBusy) { this.titleInput.value=this.plan.title; return; }
        this.plan = {...this.plan,title:this.titleInput.value.trim() || '新讲义'}; this.stateChanged();
      });
      this.titleInput.addEventListener('blur', () => { if (!this.titleInput.value.trim()) this.titleInput.value=this.plan.title; });
      this.modeNav=this.el('nav',toolbar,'mwb-assembly-mode-nav');this.modeNav.setAttribute('aria-label','选材与编排模式');
      for(const [mode,label] of [['library','选材'],['arrangement','预览编排']]){
        const button=this.button(this.modeNav,label,()=>this.switchWorkspaceMode(mode));button.dataset.mode=mode;
      }
      const primary=this.el('div',toolbar,'mwb-assembly-primary-actions');
      const save=this.button(primary, '保存方案', () => this.saveCurrentPlan(false));
      save.title=planSaveHint;
      const pdf=this.button(primary, '预览 A4', () => this.runAction('准备临时 A4 预览', async () => {
        await service.preview(core.validatePlan(this.plan), this.index,this.bindPreviewContext());
        this.setStatus('临时 A4 预览已打开。需要 Markdown 时，请在方案操作中保存讲义。');
      }),'mod-cta');
      pdf.title='按当前编排预览并导出 PDF 或 HTML。';
      const menu=this.el('details',primary,'mwb-assembly-plan-menu');
      this.planMenu=menu;
      this.el('summary',menu,'','方案操作');
      const menuBody=this.el('div',menu,'mwb-assembly-menu-body');
      this.planMenuBody=menuBody;
      this.el('p',menuBody,'mwb-assembly-muted',planSaveHint);
      this.renderPlanSettings(menuBody);
      const menuActions=this.el('div',menuBody,'mwb-assembly-menu-actions');
      if(openUsage)this.button(menuActions,'实际使用账本',()=>openUsage(this));
      if(openLibrary)this.button(menuActions,'题库诊断与入库',()=>openLibrary(this));
      if(openPresentation)this.button(menuActions,'逐题投影',()=>openPresentation(this));
      this.button(menuActions, '新建', () => {
        if (this.actionBusy || !this.confirmDiscard('new','新建')) return;
        this.plan = core.createPlan(); this.planPath = null; this.dirty = false; this.pendingBlueprintRun=null;
        this.render(); this.setStatus('新建方案，可加入知识与题目。');
      });
      this.button(menuActions, '另存方案', () => this.saveCurrentPlan(true));
      this.savedSelect = this.field(menuBody, '已保存方案', 'select');
      this.populatePlans();
      this.button(menuBody, '打开方案', () => this.loadSelectedPlan());
      for (const [format,label,hint] of [
        ['reference','保存讲义（引用题卡）','整题链接到源题卡；知识和所选小问保存本次正文。'],
        ['expanded','保存展开副本','按当前编排新建 Markdown，保存所有条目的本次正文。']
      ]) {
        const saveHandout=this.button(menuBody,label,()=>this.runAction(label,async()=>{
          const path = await service.exportMarkdown(core.validatePlan(this.plan),this.index,{questionFormat:format});
          if (!this.closed) { this.setStatus('已保存：' + path); this.notice('已保存：' + path); }
        }));
        saveHandout.title=hint;
      }
      menu.addEventListener('keydown',event=>{if(event.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}});
      menu.addEventListener('toggle',()=>this.resizePlanMenu());
      const MenuObserver=this.contentEl.ownerDocument.defaultView?.ResizeObserver;
      if(MenuObserver){this.planMenuObserver=new MenuObserver(()=>this.resizePlanMenu());this.planMenuObserver.observe(this.root);}
      this.primaryButtons=[save,pdf];
      const overview=this.el('div',this.root,'mwb-assembly-overview');
      this.summaryEl=this.button(overview,'',()=>this.switchWorkspaceMode('arrangement'),'mwb-assembly-selected-count');
      this.saveStateEl=this.el('span',overview,'mwb-assembly-save-state');
      this.saveStateEl.title=planSaveHint;
      this.sourceStateEl=this.el('span',overview,'mwb-assembly-save-state mwb-assembly-source-state');
      this.statusEl = this.el('div', overview, 'mwb-assembly-status', '请配置目录后刷新素材。');
      this.statusEl.setAttribute('role','status'); this.statusEl.setAttribute('aria-live','polite');
      this.paneNav=this.el('nav',this.root,'mwb-assembly-pane-nav');this.paneNav.setAttribute('aria-label','选材面板');
      for(const [pane,label] of [['filters','筛选'],['library','选材']]){
        const button=this.button(this.paneNav,label,()=>this.switchPane(pane));button.dataset.pane=pane;
      }
      const columns = this.el('div', this.root, 'mwb-assembly-columns');this.columns=columns;
      this.releaseWorkspaceAnchorOnInput(columns,'library');
      this.left = this.el('aside', columns, 'mwb-assembly-left');
      this.center = this.el('section', columns, 'mwb-assembly-center');
      this.left.setAttribute('aria-label','内容筛选');this.center.setAttribute('aria-label','选材与预览');
      this.renderArrangementShell();this.updateWorkspaceMode();
      this.switchPane(this.activePane);
      this.renderLeft(); this.renderCenter(); this.renderOutline();
      if(this.scanBusy)this.renderScanStatus();
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
      this.button(config,'应用目录并刷新',async () => {
        if (this.actionBusy) return;
        const roots = input => input.value.split(/\r?\n/).map(value=>value.trim()).filter(Boolean);
        const settings = {questionRoots:roots(this.questionRootsInput),knowledgeRoots:roots(this.knowledgeRootsInput),recursive:recursive.checked};
        await service.saveSettings(settings); this.settings=settings; await this.scan();
      });
      const rescan=this.button(this.left,'刷新素材',()=>this.scan(),'mwb-assembly-rescan');
      rescan.title='重新读取题库与知识笔记；不会自动接受编排中的来源变化。';
      this.scanFailures=this.el('div',this.left,'mwb-assembly-index-issues');
      const filters = this.el('div', this.left, 'mwb-assembly-filters');
      const filterHeader=this.el('div',filters,'mwb-assembly-section-heading');
      this.el('h4', filterHeader, '', '筛选条件');
      this.button(filterHeader,'清除筛选',()=>{
        this.filters={kind:this.filters.kind,query:''};this.limit=100;
        this.resetUsageFilter();
        this.resetSearchInput();
        this.populateFilters();this.renderResults();
      },'mwb-assembly-text-button');
      this.filterSelects = {};
      const basics=this.el('div',filters,'mwb-assembly-filter-grid');
      this.advancedFilters=this.el('details',filters,'mwb-assembly-advanced-filters');
      this.el('summary',this.advancedFilters,'','更多筛选');
      const advanced=this.el('div',this.advancedFilters,'mwb-assembly-filter-grid');
      const specs = [['subject','学段学科'],['chapter','章节'],['section','小节'],['knowledge','知识点'],['questionType','题型'],['tier','教学分层'],['familyId','题族'],['familyState','题族状态'],['difficulty','难度'],['role','题目角色'],['method','方法'],['source','来源']];
      for (const [key,label] of specs) {
        const select = this.field(['difficulty','role','method','source'].includes(key)?advanced:basics,label,'select');
        select.addEventListener('change',()=>{
          if (key==='chapter' && select.value!==this.filters.chapter) delete this.filters.section;
          this.filters[key]=select.value;this.limit=100;
          if (['subject','chapter','section'].includes(key)) this.populateFilters(true);
          this.renderResults();
          this.app.workspace.requestSaveLayout?.();
        });
        this.filterSelects[key] = select;
      }
      this.advancedFilters.open=['difficulty','role','method','source'].some(key=>this.filters[key]);
      this.populateFilters();
      if(usageService)this.renderUsageFilters(this.left);
      this.tree = this.el('div',this.left,'mwb-assembly-tree');
      this.renderTree();
    }
    filterCatalog() {
      if (this.catalog?.index===this.index) return this.catalog;
      const scopes=new Map(),nodes=new Map(),nodeOrder=new Map(),familyCounts=new Map();
      const options=Object.fromEntries(['subject','knowledge','method','tier','familyId','familyState',
        'questionType','source','difficulty','role'].map(key=>[key,new Set()]));
      const scope=(map,key)=>{
        if (!map.has(key)) map.set(key,{children:new Map(),knowledge:new Set(),nodeKeys:new Set()});
        return map.get(key);
      };
      for (const item of this.index.items) {
        if (item.kind==='knowledge') { nodeOrder.set(item.key,nodes.size);nodes.set(item.key,item); }
        for (const [key,values] of Object.entries(options)) {
          if ((key==='familyId'||key==='familyState') && item.kind!=='question') continue;
          const raw=key==='knowledge'?item.knowledgeNodes:key==='tier'?item.tiers:
            key==='method'?item.methods.map(value=>core.parseKnowledgeRef(value).target):item[key];
          for (const value of Array.isArray(raw)?raw:[raw])
            if (value!==null && value!==undefined && value!=='') values.add(String(value));
        }
        if (item.kind!=='question') continue;
        if (item.familyState==='classified') familyCounts.set(item.familyId,(familyCounts.get(item.familyId)||0)+1);
        if (!item.chapter) continue;
        const nodeKeys=(item.knowledgeRefs||[]).flatMap(ref=>ref.nodeKeys || (ref.nodeKey?[ref.nodeKey]:[]));
        for (const subject of item.subject?['',item.subject]:['']) {
          const chapter=scope(scope(scopes,subject).children,item.chapter);
          const destinations=item.section?[chapter,scope(chapter.children,item.section)]:[chapter];
          for (const destination of destinations) {
            for (const value of item.knowledgeNodes) destination.knowledge.add(value);
            for (const key of nodeKeys) destination.nodeKeys.add(key);
          }
        }
      }
      this.catalog={index:this.index,scopes,nodes,nodeOrder,familyCounts,options,empty:new Map(),selectOptions:new WeakMap()};
      return this.catalog;
    }
    populateFilters(scopeOnly=false) {
      if (!this.filterSelects) return;
      const catalog=this.filterCatalog(), {nodes,familyCounts,empty}=catalog;
      const filters=this.filters,questionTab=filters.kind==='question',ready=this.indexState==='ready';
      const chapters=catalog.scopes.get(filters.subject||'')?.children || empty;
      if (ready && filters.chapter && !chapters.has(filters.chapter)) {
        delete filters.chapter; delete filters.section;
      }
      const chapter=chapters.get(filters.chapter),sections=chapter?.children || empty;
      if (ready && filters.section && !sections.has(filters.section)) delete filters.section;
      const scope=questionTab && chapter && (chapter.children.get(filters.section)||chapter);
      const knowledge=scope?scope.knowledge:catalog.options.knowledge;
      if (ready && scope && filters.knowledge && !knowledge.has(filters.knowledge) && !scope.nodeKeys.has(filters.knowledge)) {
        // Older saved layouts can identify a note by its alias or bare ID.
        if (nodes.has(filters.knowledge) || !core.filterItems(this.index,{kind:'question',subject:filters.subject,
          chapter:filters.chapter,section:filters.section,knowledge:filters.knowledge}).length) delete filters.knowledge;
      }
      this.filterSelects.chapter.parentElement.hidden=!questionTab;
      this.filterSelects.section.parentElement.hidden=!questionTab;
      this.filterSelects.section.disabled=!filters.chapter || !sections.size;
      const scopeValues={chapter:chapters,section:sections,knowledge};
      for (const [key,select] of Object.entries(this.filterSelects)) {
        if (scopeOnly && !Object.hasOwn(scopeValues,key)) continue;
        const values=scopeValues[key] || catalog.options[key];
        let current=String(filters[key]||'');
        if(['knowledge','method'].includes(key)&&['','~','[]'].includes(core.parseKnowledgeRef(current).target)){
          current='';filters[key]='';
        }
        const extra=current && !values.has(current)?current:'';
        const prompt=key==='section'&&!filters.chapter?'先选章节':'不限';
        const previous=catalog.selectOptions.get(select);
        if (!previous || previous.values!==values || previous.extra!==extra || previous.prompt!==prompt) {
          const sorted=[...values.keys()];
          if (extra) sorted.push(extra);
          select.replaceChildren();this.el('option',select,'',prompt).value='';
          for (const value of sorted.sort(sortLabels)) {
            const node=key==='knowledge'?nodes.get(value):null;
            const label=node?node.title:key==='familyId'?value+'（'+(familyCounts.get(value)||0)+' 题）':
              key==='familyState'?({classified:'已归族',unclassified:'未归族',invalid:'字段异常'}[value]||value):
              key==='questionType'?typeNames[value]||value:labelOf(value);
            this.el('option',select,'',label).value=value;
          }
          catalog.selectOptions.set(select,{values,extra,prompt});
        }
        select.value=current;
      }
    }
    usageContext() { return {classId:this.usageFilter.classId.trim(),courseId:this.usageFilter.courseId.trim()}; }
    resetUsageFilter() {
      this.usageFilter.mode='all';const select=this.root?.querySelector('[data-usage-field="mode"]');if(select)select.value='all';
      this.usageGeneration++;this.app.workspace.requestSaveLayout?.();
    }
    async refreshUsage({render=true}={}) {
      if(!usageService)return;
      const generation=++this.usageGeneration,context=this.usageContext();
      this.usageLedger=null;this.usageStats=new Map();
      this.clearSelection('使用记录已变化，请重新生成候选。');
      if(!context.classId&&!context.courseId){this.usageState='idle';this.usageError='请填写班级或课程代号';if(render&&!this.closed)this.renderResults();return;}
      this.usageState='loading';if(render&&!this.closed)this.renderResults();
      try {
        const ledger=await usageService.loadUsage({context});
        if(this.closed||generation!==this.usageGeneration)return;
        this.usageLedger=ledger;this.usageState='ready';this.usageNow=new Date().toISOString();
        this.usageStats=new Map(usageService.summarizeUsage(this.index.items,ledger,{context,now:this.usageNow}).map(row=>[row.item.key,row]));
      }catch(error){if(!this.closed&&generation===this.usageGeneration){this.usageState='error';this.usageError=errorText(error);}}
      if(render&&!this.closed&&generation===this.usageGeneration)this.renderResults();
    }
    usageIndex(index=this.index,ledger=this.usageLedger,now=this.usageNow) {
      if(!usageService||this.usageFilter.mode==='all')return index;
      if(!ledger||this.usageState!=='ready')throw new Error(this.usageState==='loading'?'正在读取使用记录，请稍候':this.usageError||'请先填写班级或课程并刷新使用记录');
      const eligible=new Set(usageService.filterUsage(index.items,ledger,{context:this.usageContext(),mode:this.usageFilter.mode,days:this.usageFilter.days,now}));
      // Keep knowledge nodes for normal knowledge-tag resolution. Filtering the
      // question pool must not change the meaning of a shared knowledge tag.
      return {...index,items:index.items.filter(item=>item.kind==='knowledge'||eligible.has(item))};
    }
    renderUsageFilters(parent) {
      const panel=this.el('details',parent,'mwb-assembly-usage-filters');panel.open=this.usageFilter.mode!=='all';
      this.el('summary',panel,'','实际使用筛选');
      const body=this.el('div',panel);
      for(const [key,label] of [['classId','班级代号'],['courseId','课程代号']]){
        const input=this.field(body,label);input.maxLength=200;input.value=this.usageFilter[key];input.dataset.usageField=key;
        input.addEventListener('change',()=>{this.usageFilter[key]=input.value.trim();this.app.workspace.requestSaveLayout?.();void this.refreshUsage();});
      }
      const mode=this.field(body,'使用条件','select');mode.dataset.usageField='mode';
      for(const [value,label] of [['all','不限'],['unused','本班／课程近期未用'],['taught-not-assigned','已讲但尚未布置']])this.el('option',mode,'',label).value=value;
      mode.value=this.usageFilter.mode;mode.addEventListener('change',()=>{this.usageFilter.mode=mode.value;this.app.workspace.requestSaveLayout?.();void this.refreshUsage();});
      const days=this.field(body,'近期天数');days.type='number';days.min='1';days.max='36500';days.step='1';days.value=String(this.usageFilter.days);days.dataset.usageField='days';
      days.addEventListener('change',()=>{const value=Number(days.value);if(!Number.isSafeInteger(value)||value<1||value>36500){days.value=String(this.usageFilter.days);this.notice('请输入 1 至 36500 的整数天数');return;}this.usageFilter.days=value;this.app.workspace.requestSaveLayout?.();void this.refreshUsage();});
      this.button(body,'刷新使用记录',()=>this.refreshUsage());
      if(openUsage)this.button(body,'登记或查看使用',()=>openUsage(this));
      this.el('p',body,'mwb-assembly-muted','班级和课程共同确定记录范围；含小问的部分使用也计为该题已用。筛选应用于选材和条件抽题，配额蓝图使用自己的条件。');
    }
    renderFailedFiles() {
      if (!this.scanFailures) return;
      const paths=[...new Set((this.index.issues||[]).filter(issue=>issue?.code==='read-error' && issue.retryable && issue.path).map(issue=>issue.path))];
      this.scanFailures.replaceChildren();this.retryFilesButton=null;
      this.scanFailures.hidden=!paths.length || this.indexState==='cached';
      if (this.scanFailures.hidden) return;
      const details=this.el('details',this.scanFailures);
      this.el('summary',details,'',`${paths.length} 个文件读取失败，${this.index.items.length} 份素材可用`);
      details.addEventListener('toggle',()=>{
        if (!details.open || details.querySelector('ul')) return;
        const list=this.el('ul',details);
        let displayed=0,more;
        const append=()=>{
          const end=Math.min(displayed+50,paths.length);
          for (;displayed<end;displayed++) this.el('li',list,'',paths[displayed]);
          if (displayed===paths.length) more?.remove();
        };
        append();
        if (displayed<paths.length) more=this.button(details,'显示更多失败路径',append);
      });
      this.retryFilesButton=this.button(this.scanFailures,'只重试失败文件',()=>this.scan());
      this.retryFilesButton.disabled=this.actionBusy||this.scanBusy;
    }
    renderTree() {
      this.renderFailedFiles();
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
            this.resetSearchInput();
            this.filters.kind='question';this.filters.knowledge=item.key;this.limit=100;
            if (this.filters.chapter) {
              const scope={kind:'question',subject:this.filters.subject,chapter:this.filters.chapter,section:this.filters.section,knowledge:item.key};
              if (!core.filterItems(this.index,scope).length) {
                delete this.filters.section;
                if (!core.filterItems(this.index,{...scope,section:''}).length) delete this.filters.chapter;
                if (item.subject && this.filters.subject!==item.subject) delete this.filters.subject;
              }
            }
            this.clearItemPreview();this.populateFilters();this.updateTabs();this.renderResults();
            this.switchPane('library');this.resultsDisclosure.open=true;this.resultsSummary.focus();
          });related.title='按此知识点筛选题目';
        }
      }
      const issues=(this.index.issues||[]).filter(issue=>!(issue?.code==='read-error' && issue.retryable && issue.path));
      if(issues.length){
        const details=this.el('details',this.tree,'mwb-assembly-index-issues');this.el('summary',details,'',`查看 ${issues.length} 项提示`);
        for(const issue of issues.slice(0,100)){
          const row=this.el('div',details,'mwb-assembly-index-issue');this.el('p',row,'',typeof issue==='string'?issue:issue.message||JSON.stringify(issue));
          const paths=[...new Set([issue?.path,...(Array.isArray(issue?.paths)?issue.paths:[])].filter(path=>typeof path==='string'&&path))];
          for(const path of paths.slice(0,10))this.button(row,path,()=>service.openSource(path),'mwb-assembly-text-button');
          if(paths.length>10)this.el('span',row,'mwb-assembly-muted',`另有 ${paths.length-10} 个来源`);
        }
      }
    }
    cancelSearchTimer() {
      clearTimeout(this.pendingSearch?.timer);
      this.pendingSearch=null;
    }
    resetSearchInput() {
      this.cancelSearchTimer();
      this.searchComposing=false;
      if(this.searchInput)this.searchInput.value=this.filters.query||'';
    }
    commitSearch() {
      const pending=this.pendingSearch,input=this.searchInput;
      this.cancelSearchTimer();
      if(this.closed||this.searchComposing||!input)return;
      if(pending && pending.filters!==this.filters){input.value=this.filters.query||'';return;}
      if(input.value===(this.filters.query||''))return;
      this.filters.query=input.value;
      this.limit=100;
      this.renderResults();
    }
    bindSearchInput(input) {
      const active=()=>!this.closed && input===this.searchInput;
      input.addEventListener('compositionstart',()=>{
        if(!active())return;
        this.cancelSearchTimer();
        this.searchComposing=true;
      });
      input.addEventListener('compositionend',()=>{
        if(!active()||!this.searchComposing)return;
        this.searchComposing=false;
        this.commitSearch();
      });
      input.addEventListener('input',event=>{
        if(!active())return;
        this.cancelSearchTimer();
        if(input.value===(this.filters.query||''))return;
        this.clearSelection('搜索条件已变化，请重新生成候选。');
        if(this.searchComposing||event.isComposing)return;
        if(!input.value){this.commitSearch();return;}
        this.pendingSearch={filters:this.filters,timer:setTimeout(()=>this.commitSearch(),120)};
      });
      input.addEventListener('keydown',event=>{
        if(active()&&event.key==='Enter'&&!event.isComposing&&!this.searchComposing){
          event.preventDefault();
          this.commitSearch();
        }
      });
    }
    renderCenter() {
      this.resetSearchInput();
      this.center.replaceChildren();
      this.panelHeader(this.center,'02','选材与预览','列表直接预览，点击标题查看全文');
      const tools=this.el('div',this.center,'mwb-assembly-search');
      this.tabs=this.el('div',tools,'mwb-assembly-tabs');
      for(const [kind,label] of [['question','题目'],['knowledge','知识']]) {
        const tab=this.button(this.tabs,label,()=>{this.resetSearchInput();this.filters.kind=kind;this.limit=100;this.populateFilters(true);this.updateTabs();this.renderResults();});
        tab.dataset.kind=kind;
      }
      this.searchInput=this.field(tools,'搜索名称、正文与标签');this.searchInput.type='search';this.searchInput.value=this.filters.query||'';
      this.searchInput.placeholder='输入关键词查找内容';
      this.bindSearchInput(this.searchInput);
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
      const labels={query:'搜索',subject:'学段学科',chapter:'章节',section:'小节',questionType:'题型',difficulty:'难度',tier:'教学分层',role:'题目角色',knowledge:'知识点',method:'方法',source:'来源',familyId:'题族',familyState:'题族状态'};
      for(const [key,label] of Object.entries(labels)){
        if (this.filters.kind==='knowledge' && (key==='chapter'||key==='section')) continue;
        const value=String(this.filters[key]||'');if(!value)continue;
        const select=this.filterSelects?.[key];
        const display=select?.selectedOptions?.[0]?.textContent||labelOf(value);
        const chip=this.button(this.activeFilters,`${label}：${display} ×`,()=>{
          delete this.filters[key];if (key==='chapter') delete this.filters.section;this.limit=100;
          if(key==='query')this.resetSearchInput();
          this.populateFilters();this.renderResults();
        },'mwb-assembly-filter-chip');
        chip.dataset.filterKey=key;chip.setAttribute('aria-label',`清除${label}筛选`);
      }
      this.activeFilters.hidden=!this.activeFilters.childElementCount;
    }
    navigateQuestionResults(filters,message) {
      if(this.closed)return;
      this.filters={...filters};this.limit=100;
      this.resetUsageFilter?.();this.clearItemPreview();
      this.workspaceAnchors.library=null;this.workspaceScroll.library=0;
      this.resetSearchInput();
      this.populateFilters();this.updateTabs();this.switchPane('library');
      if(this.workspaceMode!=='library')this.switchWorkspaceMode('library');else this.renderResults();
      this.resultsDisclosure.open=true;
      const target=this.results.querySelector('.mwb-assembly-family-title')||this.resultsSummary;
      target.focus({preventScroll:true});
      this.center.scrollTop+=target.getBoundingClientRect().top-this.center.getBoundingClientRect().top;
      this.setStatus(message);this.app.workspace.requestSaveLayout?.();
    }
    showFamily(item) {
      if(item?.kind!=='question'||item.familyState!=='classified')return;
      this.navigateQuestionResults({kind:'question',query:'',familyId:item.familyId},'正在查看题族：'+item.familyId+'（全部已收录题）');
    }
    renderFamilyOverview(family,visibleCount) {
      const panel=this.el('section',this.results,'mwb-assembly-family-overview mwb-assembly-empty');
      const title=this.el('strong',panel,'mwb-assembly-family-title','题族：'+family.familyId);
      title.tabIndex=-1;title.setAttribute('role','heading');title.setAttribute('aria-level','3');
      this.el('p',panel,'',family.count===1?'当前仅收录这一题，暂无其他同族题。':`已收录 ${family.count} 道题，当前筛选匹配 ${visibleCount} 道。`);
      this.button(panel,'返回全部题目',()=>this.navigateQuestionResults({kind:'question',query:''},'已返回全部题目'));
    }
    updateTabs() {
      for(const button of this.tabs?.querySelectorAll('button')||[]) {
        const active=button.dataset.kind===this.filters.kind;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active));
      }
    }
    renderResults() {
      this.similarityModal?.checkWorkspace();
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
      let items=[];
      try{
        items=core.filterItems(this.usageIndex(),this.filters);
        if(usageService&&this.usageFilter.mode!=='all')items=usageService.filterUsage(items,this.usageLedger,
          {context:this.usageContext(),mode:this.usageFilter.mode,days:this.usageFilter.days,now:this.usageNow});
      }
      catch(error){this.resultsSummary.textContent='使用筛选未就绪';this.emptyState(this.results,'使用记录待核对',errorText(error));return;}
      let familySummary='';
      if(this.filters.familyId&&core.familyGroups){
        const family=core.familyGroups(this.index).groups.find(value=>value.familyId===this.filters.familyId);
        if(family){const detail=[...Object.entries(family.tiers),...Object.entries(family.roles)].map(([label,count])=>`${label} ${count}`);familySummary=` · 题族共 ${family.count} 题`+(detail.length?'（'+detail.join('、')+'）':'');this.renderFamilyOverview(family,items.length);}
      }
      if(!items.length){
        const empty=this.emptyState(this.results,'没有匹配内容',this.index.items.length?'试试减少筛选条件，或更换关键词。':'先在“内容目录”中配置题库或知识目录，再刷新素材。');
        if(Object.entries(this.filters).some(([key,value])=>key!=='kind'&&value))this.button(empty,'清除筛选',()=>{
          this.filters={kind:this.filters.kind,query:''};this.limit=100;this.resetUsageFilter();this.resetSearchInput();this.populateFilters();this.renderResults();
        });
        else if(!this.index.items.length)this.button(empty,'配置内容目录',()=>{this.configDetails.open=true;this.switchPane('filters');this.questionRootsInput.focus();});
      }
      this.appendResultPage(items,previews,0,familySummary);
      this.updateSelectedRows();
      this.restoreWorkspaceAnchor('library');
    }
    appendResultPage(items,previews,start,familySummary) {
      const end=Math.min(items.length,this.limit);
      this.resultsSummary.textContent=`找到 ${items.length} ${this.filters.kind==='knowledge'?'篇知识':'道题'}，显示 ${end} 条`+familySummary;
      let firstTitle;
      for(const item of items.slice(start,end)) {
        const row=this.el('article',this.results,'mwb-assembly-result');
        row.dataset.sourcePath=item.path;row.dataset.sourceKind=item.kind;
        const open=()=>this.showItem(item,'results');
        const detail=this.button(row,item.title,open,'mwb-assembly-result-title');detail.title=item.title+'\n'+item.path+'\n点击查看完整内容';
        firstTitle??=detail;
        const selected=this.selectedItem?.key===item.key;
        row.classList.toggle('is-selected',selected);detail.setAttribute('aria-pressed',String(selected));
        const info=[item.subject,item.kind==='question'?(typeNames[item.questionType]||item.questionType):'整篇知识',item.difficulty?`难度 ${item.difficulty}`:'',item.tier,item.role].filter(Boolean);
        const badges=this.el('div',row,'mwb-assembly-badges');
        for(const text of info)this.el('span',badges,'mwb-assembly-badge',text);
        const usage=this.usageStats.get(item.key);
        if(usage?.lastUsed)this.el('span',badges,'mwb-assembly-badge','本班／课程上次使用 '+new Date(usage.lastUsed).toLocaleDateString());
        const related=this.relatedKnowledge(item);
        if(related.length){const links=this.el('div',row,'mwb-assembly-muted mwb-assembly-card-related','关联知识：'+related.map(node=>node.title).join('、'));links.title=links.textContent;}
        this.addInlinePreview(previews,row,item);
        const footer=this.el('div',row,'mwb-assembly-card-footer');
        this.el('div',footer,'mwb-assembly-result-path',item.path).title=item.path;
        this.button(footer,'查看全文',open,'mwb-assembly-card-open');
        if(item.kind==='question'&&item.familyState==='classified')this.button(footer,'查看题族',()=>this.showFamily(item),'mwb-assembly-card-family').title='查看题族 '+item.familyId;
        if(item.kind==='question'&&openSimilarity)this.button(footer,'找相似题',()=>openSimilarity(this,{sourceKey:item.key}),'mwb-assembly-card-similarity').title='按题族、考点或方法查找候选题';
        const added=this.plan.entries.some(entry=>entry.kind!== 'section' && ((item.id && entry.sourceId===item.id)||entry.sourcePath===item.path));
        row.classList.toggle('is-added',added);
        const add=this.button(row,added?'已加入':'加入',()=>this.add(item));add.disabled=added||this.scanBusy||this.actionBusy;add.classList.add('mwb-assembly-add');
      }
      if(end<items.length){
        const more=this.button(this.results,'再显示 100 条',()=>{
          if(!more.isConnected||!previews.active)return;
          const focused=more.ownerDocument.activeElement===more;
          more.remove();this.limit=end+100;
          const next=this.appendResultPage(items,previews,end,familySummary);
          if(focused)next?.focus({preventScroll:true});
        });
      }
      return firstTitle;
    }
    updateSelectedRows() {
      for(const row of this.center?.querySelectorAll('[data-source-path]')||[]){
        const selected=!!this.selectedItem&&row.dataset.sourcePath===this.selectedItem.path&&row.dataset.sourceKind===this.selectedItem.kind;
        row.classList.toggle('is-selected',selected);
        row.querySelector('.mwb-assembly-result-title')?.setAttribute('aria-pressed',String(selected));
      }
      const add=this.preview?.querySelector('.mwb-assembly-preview-add');
      if(add&&this.selectedItem){
        const item=this.selectedItem,added=this.previewAlreadyAdded();
        add.disabled=added||this.actionBusy||this.scanBusy;
        add.textContent=added?'已加入':item.kind==='knowledge'?'整篇加入':'加入编排';
      }
    }
    previewAlreadyAdded() {
      const item=this.selectedItem;
      return !!item && this.plan.entries.some(entry=>entry.kind!=='section'&&((item.id&&entry.sourceId===item.id)||entry.sourcePath===item.path));
    }
    selectionContext() {
      return JSON.stringify({filters:this.filters,usage:this.usageFilter,usageGeneration:this.usageGeneration,plan:this.plan,count:this.selectionCount,scan:this.scanGeneration,settings:this.settings});
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
      if(openBlueprint){const blueprint=this.button(tools,'按配额组卷',()=>openBlueprint(this));blueprint.disabled=this.actionBusy||this.scanBusy;}
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
      if(this.searchComposing)return;
      if(this.pendingSearch)this.commitSearch();
      try {
        const result=core.selectQuestions(this.usageIndex(),this.filters,this.plan,Number(this.selectionCount));
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
          let usageLedger=this.usageLedger;
          if(usageService&&this.usageFilter.mode!=='all')usageLedger=await usageService.loadUsage({context:this.usageContext()});
          if(this.closed)return;
          if(this.selection!==selection||!this.selectionIsCurrent())
            throw new Error('筛选或编排已变化，请重新生成候选');
          sourceCheck.assertCurrent();
          const count=selection.items.length;
          const next=core.addSelectedQuestions(this.plan,this.usageIndex(latest,usageLedger,new Date().toISOString()),this.filters,selection.items);
          this.index=latest;this.indexState='ready';this.selection=null;
          this.selectionNotice=`已将 ${count} 道题加入编排，可在“预览编排”调整顺序和角色。`;
          this.populateFilters();this.renderTree();this.setPlan(next);
          this.setStatus(this.selectionNotice);
        } catch(error) {
          if(this.closed)return;
          this.selection=null;this.selectionNotice=errorText(error);
          if(latest&&sourceCheck?.isCurrent()&&JSON.stringify(this.settings)===settingsKey){this.index=latest;this.indexState='ready';this.populateFilters();this.renderTree();this.renderResults();this.renderOutline();}
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
      const {nodes,nodeOrder}=this.filterCatalog();
      return [...keys].filter(key=>nodes.has(key)).sort((a,b)=>nodeOrder.get(a)-nodeOrder.get(b)).map(key=>nodes.get(key));
    }
    add(item) {
      if(this.closed||this.actionBusy||this.scanBusy) return;
      if (!this.index.items.includes(item)) {
        const current=this.index.items.find(candidate=>candidate.path===item.path && candidate.key===item.key && candidate.fingerprint===item.fingerprint);
        if (!current) {this.notice('素材已变化，请重新选择');return;}
        item=current;
      }
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
      this.button(controls,item.kind==='knowledge'?'整篇加入':'加入编排',()=>this.add(item),'mwb-assembly-preview-add');
      this.button(controls,'打开原文',()=>service.openSource(item.path));
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
      const refresh=this.button(toolbar,'接受来源更新',()=>this.updateReferences());refresh.dataset.arrangementMutate='true';
      refresh.title='刷新素材并接受可确认的来源变化；保留本次标题和角色，缺失或冲突需单独处理。';
      this.orderingToggle=this.button(toolbar,'排序目录',()=>this.toggleOrderingSidebar(),'mwb-assembly-order-toggle');
      this.arrangementWorkspace=this.el('div',this.arrangementPane,'mwb-assembly-arrangement-workspace');
      this.arrangementList=this.el('div',this.arrangementWorkspace,'mwb-assembly-arrangement-list');
      for(const name of ['click','focusin'])this.arrangementList.addEventListener(name,event=>{
        const row=event.target.closest?.('.mwb-assembly-arrangement-entry');
        if(row)this.selectOrderingEntry(row.dataset.entryId);
      });
      this.renderOrderingShell();
      this.releaseWorkspaceAnchorOnInput(this.arrangementPane,'arrangement');
      this.arrangementList.setAttribute('aria-label','已选内容顺序');
      this.arrangementList.addEventListener('dragover',event=>{
        if(this.currentArrangementDrag())event.preventDefault();
      });
      this.arrangementList.addEventListener('drop',event=>{
        if(event.target!==this.arrangementList)return;
        event.preventDefault();
        this.dropArrangement(event,null);
      });
    }
    clearArrangementDrag() {
      this.arrangementDrag=null;
      for(const row of this.arrangementPane?.querySelectorAll('.is-dragging,.is-drop-before,.is-drop-after')||[])
        row.classList.remove('is-dragging','is-drop-before','is-drop-after');
    }
    currentArrangementDrag() {
      const drag=this.arrangementDrag;
      return drag&&!this.closed&&this.workspaceMode==='arrangement'&&!this.actionBusy&&!this.scanBusy&&
        drag.plan===this.plan&&drag.path===this.planPath&&drag.row.isConnected ? drag : null;
    }
    dropArrangement(event,targetId,row) {
      const drag=this.currentArrangementDrag();
      const id=event.dataTransfer?.getData('application/x-mathsemble-entry');
      this.clearArrangementDrag();
      if(!drag||id!==drag.id||row&&!row.isConnected)return;
      this.changeArrangement(id,plan=>{
        const source=plan.entries.find(entry=>entry.entryId===id);
        const target=targetId===null?plan.entries.length-1:plan.entries.findIndex(entry=>entry.entryId===targetId);
        if(target<0)throw new Error('目标编排项已变化，请重新拖动');
        if(source.kind!=='section')return core.moveEntry(plan,id,target);
        const sections=core.getSections(plan);
        // A section lands at a section boundary even when dropped on its
        // contents. Introductory items before the first section stay in place.
        const destination=targetId===null?sections.length-1:Math.max(0,sections.findIndex(section=>section.start<=target&&target<section.end));
        return core.moveSection(plan,id,destination);
      },row);
    }
    stepArrangement(entryId,direction,row) {
      this.changeArrangement(entryId,(plan,index)=>{
        if(plan.entries[index].kind!=='section')return core.moveEntry(plan,entryId,index+direction);
        const sectionIndex=core.getSections(plan).findIndex(section=>section.entryId===entryId);
        return core.moveSection(plan,entryId,sectionIndex+direction);
      },row);
    }
    changeArrangement(entryId,change,row) {
      if(this.closed||this.workspaceMode!=='arrangement'||this.actionBusy||this.scanBusy)return;
      if(row&&!row.isConnected)return;
      const index=this.plan.entries.findIndex(entry=>entry.entryId===entryId);
      if(index<0)return;
      try {
        const next=change(this.plan,index);
        if(JSON.stringify(next)===JSON.stringify(this.plan))return;
        this.setPlan(next);
      }
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
        this.plan=next;this.stateChanged();this.renderResults();this.renderOrderingSidebar(true);
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
    renderEntryContentSettings(parent,row,entry,item,status) {
      if(!service.updateEntryContent||entry.kind==='section')return;
      const panel=this.el('details',parent,'mwb-assembly-part-settings');
      this.el('summary',panel,'',entry.kind==='question'?'内容范围与本次分值':'知识小节范围');
      this.el('p',panel,'mwb-assembly-muted','只保存本次编排的选择；启用分值或片段后为 v4 方案，旧方案请另存。');
      const runChoice=this.el('div',panel);runChoice.hidden=true;
      const runSelect=this.field(runChoice,'采用配额记录','select');runSelect.dataset.arrangementMutate='true';let runsRead=false;
      panel.addEventListener('toggle',()=>{
        if(!panel.open||runsRead||this.pendingBlueprintRun||!service.listMatchingBlueprintRuns)return;runsRead=true;
        const snapshot=this.plan;
        void service.listMatchingBlueprintRuns(snapshot,{isCurrent:()=>!this.closed&&panel.isConnected&&this.plan===snapshot}).then(matches=>{
          if(this.closed||!panel.isConnected||this.plan!==snapshot)return;
          if(matches.length>1){runChoice.hidden=false;this.el('option',runSelect,'多份配额记录匹配，请选择').value='';
            for(const match of matches)this.el('option',runSelect,[match.title,match.createdAt,match.path.split('/').pop()].filter(Boolean).join(' · ')).value=match.path;}
        }).catch(error=>{if(panel.isConnected&&!this.closed)this.setStatus(errorText(error),true);});
      });
      let total;
      if(entry.kind==='question'){
        total=this.field(panel,'本次总分（可留空）');total.type='number';total.min='0';total.max='1000000';total.step='0.01';
        total.value=entry.score==null?'':String(entry.score);total.dataset.arrangementField='score';total.dataset.arrangementMutate='true';
      }
      const choices=[];let parsed;
      try{parsed=item&&core.listFragments?core.listFragments(item):null;}
      catch(error){this.el('p',panel,'mwb-assembly-error',errorText(error));}
      if(parsed?.supported&&!parsed.valid)this.el('p',panel,'mwb-assembly-error',parsed.issues.map(issue=>issue.message).join('；'));
      else if(parsed?.supported){
        this.el('p',panel,'mwb-assembly-muted',entry.kind==='question'?'勾选所需小问；自动保留共用题干。每个小问的分数全部填写或全部留空。':'勾选需要的小节；不按当前标题位置推断身份。');
        for(const part of parsed.fragments){
          const group=this.el('div',panel,'mwb-assembly-part-row');
          const label=this.el('label',group,'mwb-assembly-check'),check=this.el('input',label);check.type='checkbox';
          check.checked=!!entry.fragmentRef?.ids.includes(part.id);check.dataset.partId=part.id;check.dataset.arrangementMutate='true';
          label.appendChild(this.contentEl.ownerDocument.createTextNode(part.title+' ['+part.id+']'));
          let score;
          if(entry.kind==='question'){
            score=this.el('input',group);score.type='number';score.min='0';score.max='1000000';score.step='0.01';score.placeholder='小问分值';
            score.setAttribute('aria-label',part.title+'分值');score.dataset.partScore=part.id;score.dataset.arrangementMutate='true';
            score.value=entry.fragmentRef?.scores?.[part.id]==null?'':String(entry.fragmentRef.scores[part.id]);
          }
          choices.push({id:part.id,check,score});
        }
      }else this.el('p',panel,'mwb-assembly-muted','此来源未声明稳定片段，继续使用整题／整篇；需要截取时先在原文中按片段契约声明。');
      if(entry.fragmentRef)this.el('p',panel,'mwb-assembly-muted','当前选用：'+entry.fragmentRef.ids.join('、'));
      const apply=this.button(panel,'应用内容与分值',async()=>{
        if(!row.isConnected||this.closed||this.actionBusy||this.scanBusy)return;
        const selected=choices.filter(choice=>choice.check.checked),selectedIds=new Set(selected.map(choice=>choice.id));
        const ids=[...(entry.fragmentRef?.ids||[]).filter(id=>selectedIds.has(id)),...selected.map(choice=>choice.id).filter(id=>!entry.fragmentRef?.ids.includes(id))];
        let fragmentRef=ids.length?{kind:entry.kind==='question'?'question-part':'knowledge-section',ids}:null;
        const patch={fragmentRef};
        if(total)patch.score=total.value.trim()===''?null:Number(total.value);
        if(fragmentRef&&entry.kind==='question'){
          const scored=selected.filter(choice=>choice.score.value.trim()!=='');
          if(scored.length&&scored.length!==selected.length)throw new Error('请填写所有已选小问分值，或将小问分值全部留空');
          if(scored.length){fragmentRef.scores=Object.fromEntries(scored.map(choice=>[choice.id,Number(choice.score.value)]));delete patch.score;}
        }
        if(!runChoice.hidden&&!runSelect.value)throw new Error('多份配额记录匹配，请先选择本次采用的记录');
        await this.applyEntryContent(entry.entryId,patch,row,runSelect.value);
      });apply.dataset.arrangementMutate='true';apply.dataset.boundary=String(status!=='ok'||parsed?.supported&&!parsed.valid);
      if(entry.fragmentRef){
        const whole=this.button(panel,'恢复整题／整篇',()=>this.applyEntryContent(entry.entryId,{fragmentRef:null,...(total?{score:null}:{})},row,runSelect.value));
        whole.dataset.arrangementMutate='true';
      }
    }
    async applyEntryContent(entryId,patch,row,runPath) {
      if(this.closed||!row.isConnected||this.actionBusy||this.scanBusy)return;
      const plan=this.plan,config=JSON.stringify(this.settings);
      await this.runAction('核对内容范围与分值',async()=>{
        const options={config:this.settings,isCurrent:()=>!this.closed&&this.plan===plan&&JSON.stringify(this.settings)===config};
        const run=this.pendingBlueprintRun||(runPath?await service.loadBlueprintRun(runPath,plan):undefined);
        const result=await service.updateEntryContent(plan,entryId,patch,{...options,...(run?{run}:{})});
        if(this.closed||this.plan!==plan)return;
        this.index=result.index;this.indexState='ready';this.setPlan(result.plan);this.pendingBlueprintRun=result.run||null;
        this.setStatus('已更新本次内容范围与分值；原题卡保持不变。');
      });
    }
    renderOrderingShell() {
      this.orderingSidebar=this.el('aside',this.arrangementWorkspace,'mwb-assembly-order-sidebar');
      this.orderingSidebar.setAttribute('aria-label','排序目录');
      const header=this.el('div',this.orderingSidebar,'mwb-assembly-order-header');
      this.el('strong',header,'','排序目录');
      this.orderingCount=this.el('span',header,'mwb-assembly-muted');
      const close=this.button(header,'×',()=>this.toggleOrderingSidebar(false),'mwb-assembly-order-close');
      close.setAttribute('aria-label','收起排序目录');close.title='收起排序目录';
      this.el('p',this.orderingSidebar,'mwb-assembly-order-hint','点击定位 · 拖动排序 · Alt + ↑ / ↓ 微调');
      this.orderingList=this.el('div',this.orderingSidebar,'mwb-assembly-order-list');
      this.orderingList.setAttribute('role','list');this.orderingList.setAttribute('aria-label','编排目录');
      this.orderingList.addEventListener('dragover',event=>{
        if(!this.currentArrangementDrag())return;
        event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';
        const rect=this.orderingList.getBoundingClientRect();
        if(event.clientY<rect.top+32)this.orderingList.scrollTop-=18;
        else if(event.clientY>rect.bottom-32)this.orderingList.scrollTop+=18;
      });
      this.orderingList.addEventListener('drop',event=>{
        if(event.target!==this.orderingList)return;
        event.preventDefault();this.dropOrderingEntry(event,null,null,true);
      });
      const footer=this.el('div',this.orderingSidebar,'mwb-assembly-order-footer');
      this.orderingSelection=this.el('div',footer,'mwb-assembly-order-selection');
      const actions=this.el('div',footer,'mwb-assembly-order-destination');
      this.orderingPosition=this.field(actions,'移到第几项');this.orderingPosition.type='number';
      this.orderingPosition.min='1';this.orderingPosition.step='1';this.orderingPosition.dataset.arrangementMutate='true';
      this.orderingMove=this.button(actions,'移动',()=>{
        if(!footer.isConnected)return;
        const id=this.orderingSelectedId,row=[...this.orderingList.children].find(node=>node.dataset.entryId===id);
        this.moveOrderingEntry(id,Number(this.orderingPosition.value)-1,row);
      });this.orderingMove.dataset.arrangementMutate='true';
      this.orderingPosition.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.orderingMove.click();}});
      this.orderingLive=this.el('div',footer,'mwb-assembly-order-live');this.orderingLive.setAttribute('role','status');
      this.orderingSidebar.addEventListener('keydown',event=>{
        if(event.key==='Escape'){event.preventDefault();this.toggleOrderingSidebar(false);}
      });
      // A restored background leaf has width zero until Obsidian reveals it.
      if(this.orderingSidebarOpen===null)this.orderingSidebarOpen=!this.contentEl.clientWidth||this.contentEl.clientWidth>=760;
      this.toggleOrderingSidebar(this.orderingSidebarOpen,false);
    }
    toggleOrderingSidebar(open=!this.orderingSidebarOpen,focus=true) {
      this.orderingSidebarOpen=!!open;
      this.arrangementWorkspace.classList.toggle('is-ordering-collapsed',!open);
      this.orderingSidebar.hidden=!open;
      this.orderingToggle.setAttribute('aria-expanded',String(!!open));
      this.orderingToggle.textContent=open?'收起排序目录':'排序目录';
      if(focus){
        if(open)(this.orderingList.querySelector('[aria-current="true"]')||this.orderingList.querySelector('button')||this.orderingMove)?.focus({preventScroll:true});
        else this.orderingToggle.focus({preventScroll:true});
      }
    }
    selectOrderingEntry(id,{reveal=false}={}) {
      if(this.closed||!this.plan.entries.some(entry=>entry.entryId===id))return;
      this.orderingSelectedId=id;
      for(const row of this.orderingList?.children||[]){
        const selected=row.dataset.entryId===id;row.classList.toggle('is-selected',selected);
        row.querySelector('[data-order-action="jump"]')?.setAttribute('aria-current',String(selected));
      }
      for(const row of this.arrangementList?.children||[]){
        const selected=row.dataset.entryId===id;row.classList.toggle('is-order-selected',selected);
        if(selected&&reveal){
          const list=this.arrangementList;
          list.scrollTop+=row.getBoundingClientRect().top-list.getBoundingClientRect().top-4;
          this.workspaceAnchors.arrangement=this.captureWorkspaceAnchor('arrangement',row);
        }
      }
      this.updateOrderingDestination();
    }
    updateOrderingDestination() {
      if(!this.orderingPosition)return;
      const index=this.plan.entries.findIndex(entry=>entry.entryId===this.orderingSelectedId),entry=this.plan.entries[index];
      const sections=core.getSections(this.plan),sectionIndex=sections.findIndex(section=>section.entryId===entry?.entryId);
      const section=sectionIndex>=0,total=section?sections.length:this.plan.entries.length;
      const row=[...this.orderingList.children].find(node=>node.dataset.entryId===entry?.entryId);
      this.orderingSelection.textContent=entry?(row?.querySelector('.mwb-assembly-order-title')?.textContent||entry.title):'先加入题目或知识';
      this.orderingPosition.parentElement.querySelector('span').textContent=section?'移到第几分区':'移到第几项';
      this.orderingPosition.setAttribute('aria-label',section?'移到第几分区':'移到第几项');
      this.orderingPosition.max=String(total);this.orderingPosition.value=entry?String((section?sectionIndex:index)+1):'';
      for(const control of [this.orderingMove,this.orderingPosition]){
        control.dataset.boundary=String(!entry);control.disabled=!entry||this.actionBusy||this.scanBusy;
      }
      this.orderingPosition.title=section?'整体移动分区及其下方内容':'位置包含题目、知识和分区标题';
    }
    moveOrderingEntry(id,target,row) {
      if(!row?.isConnected||this.closed||this.workspaceMode!=='arrangement'||this.actionBusy||this.scanBusy)return;
      this.orderingSelectedId=id;
      const before=this.plan;
      this.changeArrangement(id,(plan,index)=>{
        const section=plan.entries[index].kind==='section',total=section?core.getSections(plan).length:plan.entries.length;
        if(!Number.isInteger(target)||target<0||target>=total)throw new Error(`请输入 1 至 ${total} 之间的${section?'分区序号':'编排位置'}`);
        return section?core.moveSection(plan,id,target):core.moveEntry(plan,id,target);
      },row);
      if(this.plan!==before){
        this.selectOrderingEntry(id,{reveal:true});
        this.orderingLive.textContent=`已移动到第 ${target+1} ${before.entries.find(entry=>entry.entryId===id)?.kind==='section'?'个分区':'项'}`;
      }
    }
    dropOrderingEntry(event,targetId,row,after=false) {
      const drag=this.currentArrangementDrag(),id=event.dataTransfer?.getData('application/x-mathsemble-entry');
      this.clearArrangementDrag();
      if(!drag||id!==drag.id||row&&!row.isConnected)return;
      const entries=this.plan.entries,sourceIndex=entries.findIndex(entry=>entry.entryId===id),source=entries[sourceIndex];
      let target=targetId===null?entries.length:entries.findIndex(entry=>entry.entryId===targetId);
      if(target<0||!source)return;
      if(source.kind==='section'){
        const sections=core.getSections(this.plan),from=sections.findIndex(section=>section.entryId===id);
        let to=targetId===null?sections.length:sections.findIndex(section=>section.start<=target&&target<section.end);
        if(to<0)to=0;else if(targetId!==null&&after)to++;
        target=to-(from<to?1:0);
      }else{
        if(targetId!==null&&after)target++;
        target-=sourceIndex<target?1:0;
      }
      this.moveOrderingEntry(id,target,drag.row);
    }
    renderOrderingSidebar(metadataOnly=false) {
      if(!this.orderingList||this.workspaceMode!=='arrangement')return;
      const list=this.orderingList,active=this.contentEl.ownerDocument.activeElement,activeRow=active?.closest?.('.mwb-assembly-order-row');
      const focus=list.contains(activeRow)?{id:activeRow.dataset.entryId,action:active.dataset.orderAction}:null,scrollTop=list.scrollTop;
      const resolved=core.resolvePlan(this.plan,this.index),sections=core.getSections(this.plan);
      this.orderingCount.textContent=`${this.plan.entries.filter(entry=>entry.kind==='question').length} 题 · ${this.plan.entries.length} 项`;
      if(!metadataOnly)list.replaceChildren();
      let number=0;
      resolved.entries.forEach(({entry,item,status},index)=>{
        const sectionIndex=sections.findIndex(section=>section.entryId===entry.entryId),section=sections[sectionIndex];
        const label=section?`分区 ${sectionIndex+1}`:entry.kind==='knowledge'?'知识':`第 ${++number} 题`;
        const title=entry.title||item?.title||'未命名内容';
        let row=metadataOnly?[...list.children].find(node=>node.dataset.entryId===entry.entryId):null;
        if(!row){
          row=this.el('div',list,'mwb-assembly-order-row'+(section?' is-section':''));row.dataset.entryId=entry.entryId;row.setAttribute('role','listitem');
          const button=(text,action,fn)=>{const node=this.button(row,text,fn);node.dataset.orderAction=action;return node;};
          const handle=button('⠿','drag',()=>this.selectOrderingEntry(entry.entryId));handle.draggable=true;handle.dataset.arrangementMutate='true';
          handle.addEventListener('dragstart',event=>{
            this.clearArrangementDrag();
            if(this.closed||!row.isConnected||this.workspaceMode!=='arrangement'||this.actionBusy||this.scanBusy){event.preventDefault();return;}
            handle.focus({preventScroll:true});this.selectOrderingEntry(entry.entryId);
            this.arrangementDrag={id:entry.entryId,plan:this.plan,path:this.planPath,row};
            event.dataTransfer?.setData('application/x-mathsemble-entry',entry.entryId);
            if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
            const moving=new Set(this.plan.entries.slice(section?.start??index,section?.end??index+1).map(value=>value.entryId));
            for(const member of this.arrangementPane.querySelectorAll('[data-entry-id]'))if(moving.has(member.dataset.entryId))member.classList.add('is-dragging');
          });
          handle.addEventListener('dragend',()=>this.clearArrangementDrag());
          row.addEventListener('dragover',event=>{
            const drag=this.currentArrangementDrag();if(!drag)return;
            event.preventDefault();
            for(const other of list.querySelectorAll('.is-drop-before,.is-drop-after'))other.classList.remove('is-drop-before','is-drop-after');
            const rect=row.getBoundingClientRect(),after=event.clientY>rect.top+rect.height/2;
            let indicator=row,side=after;
            if(this.plan.entries.find(value=>value.entryId===drag.id)?.kind==='section'){
              const targetSection=sections.find(value=>value.start<=index&&index<value.end)||sections[0];
              if(!targetSection||targetSection.entryId===drag.id)return;
              if(index<targetSection.start)side=false;
              const target=this.plan.entries[side?targetSection.end-1:targetSection.start];
              indicator=[...list.children].find(node=>node.dataset.entryId===target?.entryId);
            }
            indicator?.classList.add(side?'is-drop-after':'is-drop-before');
          });
          row.addEventListener('dragleave',event=>{
            if(!row.contains(event.relatedTarget))for(const other of list.querySelectorAll('.is-drop-before,.is-drop-after'))other.classList.remove('is-drop-before','is-drop-after');
          });
          row.addEventListener('drop',event=>{
            event.preventDefault();event.stopPropagation();
            const rect=row.getBoundingClientRect();this.dropOrderingEntry(event,entry.entryId,row,event.clientY>rect.top+rect.height/2);
          });
          const jump=button('','jump',()=>{if(row.isConnected)this.selectOrderingEntry(entry.entryId,{reveal:true});});
          this.el('span',jump,'mwb-assembly-order-label');this.el('span',jump,'mwb-assembly-order-title');this.el('span',jump,'mwb-assembly-order-meta');
          for(const [action,text,direction] of [['up','↑',-1],['down','↓',1]]){
            const node=button(text,action,()=>this.moveOrderingEntry(entry.entryId,(section?core.getSections(this.plan).findIndex(value=>value.entryId===entry.entryId):this.plan.entries.findIndex(value=>value.entryId===entry.entryId))+direction,row));
            node.dataset.arrangementMutate='true';node.dataset.boundary=String(direction<0?(section?sectionIndex===0:index===0):(section?sectionIndex===sections.length-1:index===this.plan.entries.length-1));
          }
          row.addEventListener('keydown',event=>{
            if(!event.altKey||!['ArrowUp','ArrowDown'].includes(event.key))return;
            event.preventDefault();row.querySelector(`[data-order-action="${event.key==='ArrowUp'?'up':'down'}"]`)?.click();
          });
        }
        row.querySelector('.mwb-assembly-order-label').textContent=label;
        row.querySelector('.mwb-assembly-order-title').textContent=title;
        const warning={changed:'来源已变化',missing:'来源缺失',conflict:'来源冲突','fragment-missing':'片段缺失','fragment-invalid':'片段有误'}[status];
        row.querySelector('.mwb-assembly-order-meta').textContent=[section?`${section.end-section.start-1} 项 · 整区移动`:entry.role||item?.role||'',warning||''].filter(Boolean).join(' · ');
        row.classList.toggle('has-warning',!!warning);
        for(const [action,text] of [['drag',section?'拖动整个分区':'拖动排序'],['jump','定位'],['up',section?'上移整个分区':'上移'],['down',section?'下移整个分区':'下移']]){
          const node=row.querySelector(`[data-order-action="${action}"]`);node.title=`${text}：${title}`;node.setAttribute('aria-label',`${text}：${title}`);
        }
      });
      if(!resolved.entries.length)this.el('p',list,'mwb-assembly-order-hint','加入内容后，可在这里快速排序。');
      if(!this.plan.entries.some(entry=>entry.entryId===this.orderingSelectedId))this.orderingSelectedId=this.plan.entries[0]?.entryId||null;
      this.selectOrderingEntry(this.orderingSelectedId);this.updateOrderingDestination();
      list.scrollTop=scrollTop;
      if(focus&&!metadataOnly){
        const row=[...list.children].find(node=>node.dataset.entryId===focus.id),target=row?.querySelector(`[data-order-action="${focus.action}"]`);
        const next=target?.dataset.boundary!=='true'?target:row?.querySelector('[data-order-action="jump"]');
        next?.focus({preventScroll:true});
        if(row){const rect=row.getBoundingClientRect(),bounds=list.getBoundingClientRect();if(rect.top<bounds.top)list.scrollTop-=bounds.top-rect.top;else if(rect.bottom>bounds.bottom)list.scrollTop+=rect.bottom-bounds.bottom;}
      }
    }
    renderArrangement() {
      this.clearArrangementDrag();
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
      const sections=core.getSections(this.plan);
      if(!resolved.entries.length){
        const empty=this.emptyState(list,'还没有可编排的内容','先加入题目或知识，再在这里边看边调整顺序。');
        this.button(empty,'去选材',()=>{this.switchWorkspaceMode('library');this.switchPane('library');this.searchInput?.focus();});
      }
      let questionNumber=0;
      resolved.entries.forEach(({entry,item,status},index)=>{
        const sectionIndex=sections.findIndex(section=>section.entryId===entry.entryId),section=sections[sectionIndex];
        const row=this.el('article',list,'mwb-assembly-arrangement-entry'+(entry.kind==='section'?' is-section':''));
        row.dataset.entryId=entry.entryId;row.dataset.sourceStatus=entry.kind==='section'?'section':status;
        row.classList.toggle('is-expanded',this.arrangementExpanded.has(entry.entryId));
        const kind=section?`分区 ${sectionIndex+1}`:entry.kind==='knowledge'?'知识':`第 ${++questionNumber} 题`;
        const header=this.el('div',row,'mwb-assembly-arrangement-entry-header');
        const handle=this.button(header,'⠿',()=>this.setStatus(section?'整体移动分区标题及下方内容，直到下一个分区；也可使用上移、下移或更多中的分区序号。':'拖动手柄排序，也可使用上移、下移或更多中的指定位置。'),'mwb-assembly-arrangement-drag');
        handle.draggable=true;handle.dataset.arrangementAction='drag';handle.dataset.arrangementMutate='true';
        const updateLabels=()=>{
          const current=this.plan.entries.find(value=>value.entryId===entry.entryId);
          const label=section?'拖动整个分区':'拖动排序';
          handle.setAttribute('aria-label',`${label}：${current?.title||item?.title||kind}`);
          handle.title=section?`${label}（含 ${section.end-section.start-1} 项内容）`:label;
        };
        updateLabels();
        handle.addEventListener('dragstart',event=>{
          this.clearArrangementDrag();
          if(this.closed||!row.isConnected||this.actionBusy||this.scanBusy||this.workspaceMode!=='arrangement'){event.preventDefault();return;}
          handle.focus({preventScroll:true});
          this.arrangementDrag={id:entry.entryId,plan:this.plan,path:this.planPath,row};
          event.dataTransfer?.setData('application/x-mathsemble-entry',entry.entryId);
          if(event.dataTransfer)event.dataTransfer.effectAllowed='move';
          const moving=new Set(this.plan.entries.slice(section?.start??index,section?.end??index+1).map(entry=>entry.entryId));
          for(const member of list.children)if(moving.has(member.dataset.entryId))member.classList.add('is-dragging');
        });
        handle.addEventListener('dragend',()=>{if(this.arrangementDrag?.row===row)this.clearArrangementDrag();});
        row.addEventListener('dragover',event=>{
          if(this.currentArrangementDrag()){event.preventDefault();if(event.dataTransfer)event.dataTransfer.dropEffect='move';}
        });
        row.addEventListener('drop',event=>{
          event.preventDefault();event.stopPropagation();
          this.dropArrangement(event,entry.entryId,row);
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
        if(entry.score!=null)this.el('span',header,'mwb-assembly-badge',entry.score+' 分');
        if(entry.fragmentRef)this.el('span',header,'mwb-assembly-badge','选用 '+entry.fragmentRef.ids.length+' 个片段');
        const action=(parent,label,key,callback)=>{
          const button=this.button(parent,label,callback);button.dataset.arrangementAction=key;return button;
        };
        const up=action(header,'↑','up',()=>this.stepArrangement(entry.entryId,-1,row));
        const down=action(header,'↓','down',()=>this.stepArrangement(entry.entryId,1,row));
        up.dataset.boundary=String(section?sectionIndex===0:index===0);
        down.dataset.boundary=String(section?sectionIndex===sections.length-1:index===this.plan.entries.length-1);
        for(const [control,label] of [[up,'上移'],[down,'下移']]){
          control.dataset.arrangementMutate='true';control.setAttribute('aria-label',section?label+'整个分区':label);control.title=section?label+'整个分区':label;
        }
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
        const position=this.field(actions,section?'移到第几分区':'移到第几项');position.type='number';position.min='1';position.max=String(section?sections.length:this.plan.entries.length);position.step='1';position.value=String((section?sectionIndex:index)+1);
        position.dataset.arrangementField='position';position.dataset.arrangementMutate='true';
        const move=action(actions,'移动','move',()=>this.changeArrangement(entry.entryId,plan=>{
          const target=Number(position.value);
          const total=section?core.getSections(plan).length:plan.entries.length;
          if(!Number.isInteger(target)||target<1||target>total)throw new Error(`请输入 1 至 ${total} 之间的${section?'分区序号':'编排位置'}`);
          return section?core.moveSection(plan,entry.entryId,target-1):core.moveEntry(plan,entry.entryId,target-1);
        },row));move.dataset.arrangementMutate='true';
        position.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();move.click();}});
        if(entry.kind!=='section'){
          const source=action(actions,'打开原文','source',()=>{if(row.isConnected)return service.openSource(item?.path||entry.sourcePath);});
          source.setAttribute('aria-label',`打开原文：${item?.path||entry.sourcePath}`);
          this.renderEntryContentSettings(actions,row,entry,item,status);
        }
        if(entry.kind==='question'&&openFamily){
          const replace=action(actions,'同族换题','family',()=>{if(row.isConnected)openFamily(this,entry.entryId);});
          replace.dataset.arrangementMutate='true';
          replace.title=item?.familyState==='classified'?'选择同族题，保留位置、卷内标题和角色':'需有效 family_id；打开后可查看不能换题的原因';
        }
        if(entry.kind==='question'&&openSimilarity){
          const replace=action(actions,'相似换题','similarity',()=>{if(row.isConnected)openSimilarity(this,{entryId:entry.entryId});});
          replace.dataset.arrangementMutate='true';replace.title='按题族、考点或方法选择候选，并核对配额与来源';
        }
        const remove=action(actions,entry.kind==='section'?'移除分区标题':'移除','remove',()=>this.changeArrangement(entry.entryId,plan=>core.removeEntry(plan,entry.entryId),row));
        remove.dataset.arrangementMutate='true';remove.classList.add('mwb-assembly-remove');
        if(section)remove.title='只移除分区标题，下方内容保留。';
        this.el('p',more,'mwb-assembly-muted',section?`第 ${sectionIndex+1} 个分区，共 ${sections.length} 个；整体移动标题及下方 ${section.end-section.start-1} 项内容，直到下一个分区。移除标题会保留内容。`:`第 ${index+1} 项，共 ${this.plan.entries.length} 项；位置包含题目、知识和分区。`);
        if(entry.kind!=='section'){
          this.el('div',more,'mwb-assembly-result-path',item?.path||entry.sourcePath);
          const message={changed:'源文已变化。可打开原文核对，再点击“接受来源更新”。',missing:'找不到源文件，请恢复来源并刷新素材，或移除此项。',conflict:'来源身份冲突，请修正后刷新素材。', 'fragment-missing':'稳定片段已缺失；请恢复锚点或切回整题／整篇。','fragment-invalid':'来源片段契约有误，请打开原文核对。'}[status];
          if(message)this.el('p',row,'mwb-assembly-error',message);
          if(status==='ok'&&item){
            let previewItem=item;
            if(entry.fragmentRef){
              try{previewItem={...item,markdown:core.resolveFragment(item,entry.fragmentRef).markdown};}
              catch(error){this.el('p',row,'mwb-assembly-error',errorText(error));return;}
            }
            const record=this.addInlinePreview(previews,row,previewItem);
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
      this.renderOrderingSidebar();
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
    renderScanStatus() {
      const prefix=this.indexState==='cached' ? `已显示上次缓存的 ${this.index.items.length} 份素材，正在核对来源` : '正在刷新素材';
      const p=this.scanProgress;
      this.setStatus(p ? `${prefix} · 已处理 ${p.processed} / ${p.total} 个文件，失败 ${p.failed} 个` : prefix+'…');
    }
    refreshIndexDisplay() {
      this.populateFilters();this.renderTree();this.renderResults();this.renderOutline();
    }
    async scan({verify=false} = {}) {
      if(this.actionBusy){this.notice('请等待当前操作完成');return;}
      this.scanController?.abort();
      const controller=this.scanController=new AbortController();
      const generation=++this.scanGeneration;
      // Keep the last checked index for this exact directory selection. A second
      // refresh can begin while the first is displaying an unverified snapshot.
      const scope=JSON.stringify(this.settings);
      const baseline=this.scanScope!==undefined && this.scanScope!==scope ? {items:[],issues:[]} : this.scanBaseline||this.index;
      this.scanScope=scope;this.scanBaseline=baseline;
      this.scanBusy=true;this.scanProgress=null;
      if (this.index!==baseline || this.indexState==='cached') {
        this.index=baseline;this.indexState='unread';this.refreshIndexDisplay();
      }
      this.updateSummary();
      this.clearSelection('正在刷新素材，请完成后重新生成候选。');this.renderSelection();
      this.renderScanStatus();
      const current=()=>!this.closed && generation===this.scanGeneration && this.scanController===controller;
      let checking=true,lastProgress=-Infinity;
      try {
        const signal=controller.signal;
        const index=!verify && service.browseIndex ? await service.browseIndex(this.settings,{
          signal,
          onProgress:p=>{
            if (!checking || !current()) return;
            this.scanProgress=p;
            const now=Date.now();
            if (now-lastProgress>=200 || p.processed===p.total) {lastProgress=now;this.renderScanStatus();}
          },
          onCachedIndex:snapshot=>{
            if (!checking || !current() || this.indexState==='cached') return;
            const changed=this.index!==snapshot;
            this.index=snapshot;this.indexState='cached';
            if (changed) this.refreshIndexDisplay();
            this.renderScanStatus();
          }
        }) : await service.scan(this.settings,{signal});
        checking=false;
        if(!current())return;
        this.index=index;this.indexState='ready';this.limit=100;
        if(usageService)await this.refreshUsage({render:false});
        if(!current())return;
        this.refreshIndexDisplay();
        const issues=index.issues||[];
        const failed=new Set(issues.filter(issue=>issue?.code==='read-error' && issue.retryable && issue.path).map(issue=>issue.path)).size;
        this.setStatus(failed ? `${index.items.length} 份素材可用，${failed} 个文件读取失败。可在内容筛选中查看路径并重试。` :
          `已刷新 ${index.items.length} 份素材${issues.length?`；${issues.length} 项待核对` : ''}。编排中的来源变化需单独接受。`,!!issues.length);
        return true;
      } catch(error){
        if(current()){
          const shownCache=this.indexState==='cached';
          this.indexState='error';
          if(shownCache){this.index=baseline;this.refreshIndexDisplay();}
          this.setStatus('素材核对未完成：'+errorText(error),true);
        }
      } finally{
        checking=false;
        if(current()){
          this.scanController=null;this.scanBaseline=null;this.scanProgress=null;
          this.scanBusy=false;this.renderSelection();this.updateSummary();
        }
      }
    }
    async updateReferences() {
      if(this.actionBusy)return;
      const scanned=await this.scan({verify:true});if(!scanned||this.closed||this.scanBusy)return;
      const resolved=core.resolvePlan(this.plan,this.index);
      let count=0;
      const entries=resolved.entries.map(({entry,item,status})=>{
        if(item&&(status==='changed'||(status==='ok'&&entry.sourcePath!==item.path))){count++;return {...entry,sourceId:item.id||'',sourcePath:item.path,sourceFingerprint:item.fingerprint};}
        return entry;
      });
      if(count)this.setPlan({...this.plan,entries});
      const unresolved=resolved.entries.filter(row=>row.status==='missing'||row.status==='conflict').length;
      this.setStatus(`已接受 ${count} 项来源更新${unresolved?`；仍有 ${unresolved} 项缺失或冲突` : ''}。本次标题和角色保留${count?'；方案有更改，请保存':''}。`,!!unresolved);
    }
    async saveCurrentPlan(asNew = false) {
      return this.runAction(asNew ? '另存方案' : '保存方案', async () => {
        const snapshot = core.validatePlan(this.plan);
        const serialized = JSON.stringify(snapshot);
        const pendingRun=this.pendingBlueprintRun;
        const path = await this.planSession.savePlan(snapshot, asNew ? undefined : this.planPath);
        let recordPath,recordError;
        if(pendingRun) {
          try {
            recordPath=await service.saveBlueprintRun(pendingRun,{planPath:path});
            if(this.pendingBlueprintRun===pendingRun)this.pendingBlueprintRun=null;
          } catch(error) {recordError=error;}
        }
        if (this.closed) return;
        this.planPath = path;
        if (JSON.stringify(this.plan) === serialized) this.dirty = false;
        this.app.workspace.requestSaveLayout?.();
        await this.refreshPlans();
        if(recordError)this.setStatus('方案已保存：'+path+'；配额记录尚未保存：'+errorText(recordError),true);
        else if(recordPath)this.setStatus('方案已保存：'+path+'；配额与锁定记录已保存：'+recordPath);
        else this.setStatus('方案已保存：' + path);
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
        this.plan=plan;this.planPath=path;this.dirty=false;this.pendingDiscard=null;this.pendingBlueprintRun=null;this.render();
        this.setStatus('方案已打开；缺失或变化的来源会在编排中标出。');this.app.workspace.requestSaveLayout?.();
      });
    }
  };
};
