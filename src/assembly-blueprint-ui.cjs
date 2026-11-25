'use strict';

module.exports = function createBlueprintModal({Modal,Component,Notice,core,engine,service,renderMarkdown}) {
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = () => globalThis.crypto?.randomUUID?.() || 'b_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2);
  const types = {choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'};
  const text = error => error?.message || String(error);
  const body = value => value.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'');
  const row = n => ({rowId:uid(),label:'配额 '+n,count:1,filters:{}});
  return class BlueprintModal extends Modal {
    constructor(app,plugin,view) {
      super(app);this.plugin=plugin;this.view=view;this.blueprintEditor=true;
      this.blueprint={schemaVersion:1,blueprintId:uid(),revision:1,title:'配额蓝图',rows:[row(1)],constraints:{uniqueQuestion:true,maxPerFamily:null}};
      this.session=service.createBlueprintSession();this.locks=[];this.candidate=null;this.closed=false;this.busy=false;
      this.visible=50;this.seed=uid();this.saved=[];this.runs=[];this.blueprintPath=null;this.baseRevision=1;
    }
    el(tag,parent,label,cls) {const node=this.contentEl.ownerDocument.createElement(tag);if(label!==undefined)node.textContent=label;if(cls)node.className=cls;parent?.appendChild(node);return node;}
    button(parent,label,action,cls) {const node=this.el('button',parent,label,cls);node.type='button';node.onclick=()=>{if(!node.disabled)Promise.resolve().then(()=>{if(!this.closed&&node.isConnected&&!node.disabled)return action();}).catch(error=>this.status(text(error),true));};return node;}
    field(parent,label,tag='input') {const wrap=this.el('label',parent,undefined,'mwb-blueprint-field');this.el('span',wrap,label);const node=this.el(tag,wrap);node.setAttribute('aria-label',label);return node;}
    status(message,error=false) {if(this.closed)return;this.statusEl.textContent=message;this.statusEl.classList.toggle('is-error',error);}
    async action(label,fn) {
      if(this.busy||this.closed)return;
      this.busy=true;const controller=this.controller=new AbortController();this.status(label+'…');this.updateBusy();
      try {return await fn({signal:controller.signal,isCurrent:()=>!this.closed&&this.controller===controller&&!controller.signal.aborted,config:clone(this.view.settings)});}
      catch(error){this.status(text(error),error?.name!=='AbortError');}
      finally {if(this.controller===controller)this.controller=null;this.busy=false;if(!this.closed)this.updateBusy();}
    }
    updateBusy() {
      for(const node of this.contentEl.querySelectorAll('input,select,button')) {
        if(node===this.cancelButton){node.disabled=!this.busy;continue;}
        node.disabled=this.busy||node.dataset.unavailable==='true';
      }
    }
    changed() {
      this.candidate=null;this.closePreviews();this.results?.replaceChildren();
      if(this.blueprintPath)this.blueprint.revision=this.baseRevision+1;
      this.status('条件已更新，请生成候选。');this.updateApply();
    }
    async onOpen() {
      this.lifecycleOwner=new Component();
      this.lifecycleOwner.register?.(()=>{if(!this.closed)this.close();});
      this.plugin.addChild?.(this.lifecycleOwner);
      this.modalEl.classList.add('mwb-blueprint-modal');this.contentEl.classList.add('mwb-blueprint');
      this.el('h2',this.contentEl,'按配额组卷');
      this.el('p',this.contentEl,'每行指定条件和题数；同一题只计入一行。未选条件表示不限，同一条件多选表示“或”。锁定后只重抽其余题，完整满足配额后再加入编排。','mwb-assembly-muted');
      const saved=this.el('div',this.contentEl,undefined,'mwb-blueprint-toolbar');
      this.savedSelect=this.field(saved,'已保存蓝图','select');
      this.button(saved,'打开蓝图',()=>this.load());
      this.button(saved,'新建蓝图',()=>{this.blueprint={schemaVersion:1,blueprintId:uid(),revision:1,title:'配额蓝图',rows:[row(1)],constraints:{uniqueQuestion:true,maxPerFamily:null}};this.blueprintPath=null;this.locks=[];this.changed();this.renderEditor();});
      this.button(saved,'保存蓝图',()=>this.save(false));this.button(saved,'另存蓝图',()=>this.save(true));
      this.titleInput=this.field(this.contentEl,'蓝图名称');this.titleInput.onchange=()=>{this.blueprint.title=this.titleInput.value;this.changed();};
      this.familyLimitInput=this.field(this.contentEl,'每个题族最多题数（空白为不限）');this.familyLimitInput.type='number';this.familyLimitInput.min='1';this.familyLimitInput.max='1000';this.familyLimitInput.step='1';
      this.familyLimitInput.onchange=()=>{this.blueprint.constraints.maxPerFamily=this.familyLimitInput.value.trim()===''?null:Number(this.familyLimitInput.value);this.changed();};
      this.rowsEl=this.el('div',this.contentEl,undefined,'mwb-blueprint-rows');
      this.button(this.contentEl,'添加配额行',()=>{if(this.blueprint.rows.length>=64){this.status('最多 64 行配额。',true);return;}this.blueprint.rows.push(row(this.blueprint.rows.length+1));this.changed();this.renderEditor();});
      const tools=this.el('div',this.contentEl,undefined,'mwb-blueprint-toolbar');
      this.button(tools,'生成候选',()=>this.generate(false),'mod-cta');
      this.button(tools,'重抽未锁定题',()=>this.generate(true));
      this.applyButton=this.button(tools,'应用完整配额',()=>this.apply(),'mod-cta');
      this.cancelButton=this.button(tools,'取消计算',()=>this.controller?.abort(Object.assign(new Error('操作已取消'),{name:'AbortError'})));
      this.statusEl=this.el('div',this.contentEl,'设置配额后生成候选。','mwb-blueprint-status');this.statusEl.setAttribute('role','status');
      this.results=this.el('div',this.contentEl,undefined,'mwb-blueprint-results');
      this.records=this.el('details',this.contentEl);this.el('summary',this.records,'查看当前方案的配额记录');
      const recordTools=this.el('div',this.records,undefined,'mwb-blueprint-toolbar');this.runSelect=this.field(recordTools,'配额记录','select');
      this.button(recordTools,'核对记录',()=>this.inspectRun());this.runResult=this.el('div',this.records);
      this.renderEditor();this.updateApply();this.updateBusy();
      await this.action('读取蓝图列表',async()=>{await this.refreshLists();this.status('可打开已有蓝图，或设置新的配额。');});
    }
    async refreshLists() {
      const [saved,runs]=await Promise.all([service.listBlueprints(),service.listBlueprintRuns()]);
      if(this.closed)return;this.saved=saved;this.runs=runs;
      this.savedSelect.replaceChildren();this.el('option',this.savedSelect,'选择蓝图').value='';
      for(const item of saved)this.el('option',this.savedSelect,item.title||item.path).value=item.path;
      this.savedSelect.value=this.blueprintPath||'';
      this.runSelect.replaceChildren();this.el('option',this.runSelect,'选择记录并核对当前方案').value='';
      for(const item of runs)this.el('option',this.runSelect,[item.title||item.blueprintTitle||item.path,item.createdAt||''].filter(Boolean).join(' · ')).value=item.path;
    }
    async load() {
      const path=this.savedSelect.value;if(!path){this.status('先选择蓝图。',true);return;}
      await this.action('打开蓝图',async()=>{
        const value=await this.session.loadBlueprint(path);if(this.closed)return;
        this.blueprint=engine.validateBlueprint(value);this.baseRevision=this.blueprint.revision;this.blueprintPath=path;
        this.locks=[];this.candidate=null;this.renderEditor();this.renderCandidate();this.status('蓝图已打开；编排中已有题目仍保留。');
      });
    }
    async save(asNew) {
      await this.action('保存蓝图',async()=>{
        let value=engine.validateBlueprint(this.blueprint);
        if(asNew)value={...value,blueprintId:uid(),revision:1};
        const path=await this.session.saveBlueprint(value,asNew?undefined:this.blueprintPath||undefined);
        if(this.closed)return;this.blueprint=value;this.blueprintPath=path;this.baseRevision=value.revision;
        if(asNew){this.candidate=null;this.renderCandidate();}
        await this.refreshLists();this.renderEditor();this.status('蓝图已保存：'+path);
      });
    }
    options(name) {
      const items=(this.view.index?.items||[]).filter(item=>item.kind==='question');
      const values=items.flatMap(item=>name==='tier'?item.tiers:name==='method'?item.methods.map(value=>core.parseKnowledgeRef(value).target):name==='knowledge'?item.knowledgeNodes:[item[name]]).filter(value=>value!==undefined&&value!==null&&value!=='');
      if(name==='questionType')values.push(...Object.keys(types));
      if(name==='difficulty')values.push(1,2,3,4,5);
      return [...new Set(values.map(String))].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true}));
    }
    filter(parent,row,name,label) {
      const input=this.field(parent,label,'select');input.multiple=true;input.size=3;input.dataset.filter=name;
      const selected=Array.isArray(row.filters[name])?row.filters[name]:row.filters[name]?[row.filters[name]]:[];
      const selectedValues=new Set(selected.map(value=>name==='method'?core.parseKnowledgeRef(value).target:String(value)));
      const values=[...new Set([...this.options(name),...selectedValues])];
      for(const value of values){const option=this.el('option',input,name==='questionType'?types[value]||value:value);option.value=value;option.selected=selectedValues.has(value);}
      input.onchange=()=>{row.filters[name]=[...input.selectedOptions].map(option=>name==='difficulty'?Number(option.value):option.value);this.changed();};
      return input;
    }
    renderEditor() {
      this.titleInput.value=this.blueprint.title;this.familyLimitInput.value=this.blueprint.constraints.maxPerFamily??'';this.rowsEl.replaceChildren();
      for(const [position,row] of this.blueprint.rows.entries()) {
        const panel=this.el('section',this.rowsEl,undefined,'mwb-blueprint-row');panel.dataset.rowId=row.rowId;
        const main=this.el('div',panel,undefined,'mwb-blueprint-row-main');
        const label=this.field(main,'配额行名称');label.value=row.label;label.onchange=()=>{row.label=label.value;this.changed();};
        const count=this.field(main,'题数');count.type='number';count.min='1';count.max='1000';count.value=row.count;
        count.onchange=()=>{row.count=Number(count.value);this.changed();};
        this.button(main,'上移',()=>{if(!position)return;const rows=this.blueprint.rows;[rows[position-1],rows[position]]=[rows[position],rows[position-1]];this.changed();this.renderEditor();});
        this.button(main,'移除此行',()=>{if(this.locks.some(lock=>lock.rowId===row.rowId)){this.status('请先解除这一行的锁定。',true);return;}this.blueprint.rows.splice(position,1);this.changed();this.renderEditor();});
        const filters=this.el('div',panel,undefined,'mwb-blueprint-filter-grid');
        this.filter(filters,row,'questionType','题型');this.filter(filters,row,'difficulty','难度');this.filter(filters,row,'tier','教学层次');
        const query=this.field(filters,'题目关键词');query.value=row.filters.query||'';query.onchange=()=>{row.filters.query=query.value;this.changed();};
        const more=this.el('details',panel);this.el('summary',more,'更多条件（同一条件多选为“或”）');const extra=this.el('div',more,undefined,'mwb-blueprint-filter-grid');
        for(const [key,name] of [['subject','学科'],['knowledge','知识点'],['method','方法'],['role','教学角色'],['source','来源']])this.filter(extra,row,key,name);
        const fixed=this.el('div',panel,undefined,'mwb-blueprint-toolbar');
        const fromPlan=this.field(fixed,'将编排中的题目计入此行','select');this.el('option',fromPlan,'选择已有题目').value='';
        for(const entry of this.view.plan.entries.filter(entry=>entry.kind==='question'))this.el('option',fromPlan,entry.title||entry.sourcePath).value=entry.entryId;
        this.button(fixed,'固定到此行',()=>{
          const entry=this.view.plan.entries.find(entry=>entry.entryId===fromPlan.value);if(!entry){this.status('先选择编排中的题目。',true);return;}
          const slots=Array.from({length:Math.min(1000,Math.max(0,row.count))},(_,i)=>row.rowId+':'+(i+1));
          const slotId=slots.find(id=>!this.locks.some(lock=>lock.slotId===id));
          if(!slotId){this.status('该行已无空余锁定位置。',true);return;}
          const lock={rowId:row.rowId,slotId,origin:'plan',sourceId:entry.sourceId||'',sourcePath:entry.sourcePath,sourceFingerprint:entry.sourceFingerprint,existingEntryId:entry.entryId};
          this.locks.push(lock);this.candidate=null;this.renderCandidate();this.renderEditor();this.status('已固定已有题目；生成时会核对行条件与来源。');
        });
        const locks=this.el('div',panel,undefined,'mwb-blueprint-locks');
        for(const lock of this.locks.filter(lock=>lock.rowId===row.rowId)){
          const badge=this.el('span',locks,lock.sourcePath+' ','mwb-blueprint-lock');
          this.button(badge,lock.origin==='plan'?'取消计入':'解除锁定',()=>this.toggleLock(lock,false));
        }
      }
      this.updateBusy();
    }
    async generate(redraw) {
      await this.action('按配额生成',async options=>{
        if(redraw)this.seed=uid();
        const value=await service.generateBlueprintCandidate({plan:clone(this.view.plan),blueprint:clone(this.blueprint),locks:clone(this.locks),excludedKeys:[],seed:this.seed},options);
        if(this.closed)return;this.candidate=value;this.visible=50;this.renderCandidate();
      });
    }
    updateApply() {if(this.applyButton){this.applyButton.dataset.unavailable=String(this.candidate?.allocation?.status!=='complete');this.applyButton.disabled=this.busy||this.applyButton.dataset.unavailable==='true';}}
    async toggleLock(assignment,locked) {
      if(this.closed||this.busy)return;
      const next=this.locks.filter(lock=>lock.slotId!==assignment.slotId);if(locked)next.push(clone(assignment));
      this.locks=next;
      if(this.candidate?.allocation?.status==='complete') {
        try {this.candidate=service.updateBlueprintLocks(this.candidate,clone(next));}
        catch(error){this.candidate=null;this.status(text(error)+'；请重新生成候选。',true);}
      }
      this.renderEditor();this.renderCandidate();
    }
    async replace(slotId,mode='row') {
      await this.action('更换题目',async()=>{
        const value=service.replaceBlueprintCandidate(this.candidate,{targetSlotId:slotId,mode,seed:uid()});
        if(this.closed)return;
        if(value.allocation?.status!=='complete'){this.status((value.allocation?.diagnostics||value.issues||[]).map(item=>item.message).join('；')||'没有满足条件的替代题，原候选保留。',true);return;}
        this.candidate=value;this.renderCandidate();
      });
    }
    renderCandidate() {
      this.closePreviews();this.results?.replaceChildren();this.updateApply();if(!this.results||!this.candidate)return;
      const candidate=this.candidate,allocation=candidate.allocation;
      const issues=allocation?.diagnostics||candidate.issues||[];
      this.status(allocation?.status==='complete'?'配额已全部满足。核对题目后应用；应用前会重新检查来源。':issues.map(item=>item.message).join('；')||'本次配额未能完整满足。',allocation?.status!=='complete');
      if(allocation?.rowStats?.length){const table=this.el('table',this.results);const head=this.el('tr',this.el('thead',table));for(const label of ['配额','需要','候选池','锁定','分配'])this.el('th',head,label);const tbody=this.el('tbody',table);
        for(const stat of allocation.rowStats){const tr=this.el('tr',tbody);for(const value of [this.blueprint.rows.find(row=>row.rowId===stat.rowId)?.label||stat.rowId,stat.requested,stat.available,stat.locked,stat.assigned])this.el('td',tr,String(value));}}
      if(allocation?.status!=='complete')return;
      const scope=this.previewScope={controller:new AbortController(),queue:[],active:0,closed:false,owner:new Component()};this.plugin.addChild?.(scope.owner);
      const rows=this.el('div',this.results,undefined,'mwb-blueprint-candidates');
      for(const assignment of allocation.assignments.slice(0,this.visible)) {
        const item=candidate.index.items.find(item=>item.path===assignment.sourcePath&&(!assignment.sourceId||item.id===assignment.sourceId));
        const card=this.el('article',rows,undefined,'mwb-blueprint-candidate');card.dataset.slotId=assignment.slotId;
        this.el('strong',card,(this.blueprint.rows.find(row=>row.rowId===assignment.rowId)?.label||'配额')+' · '+(item?.title||assignment.sourcePath));
        const tools=this.el('div',card,undefined,'mwb-blueprint-toolbar');const label=this.el('label',tools);const lock=this.el('input',label);lock.type='checkbox';lock.checked=this.locks.some(value=>value.slotId===assignment.slotId);lock.setAttribute('aria-label','锁定 '+(item?.title||assignment.sourcePath));this.el('span',label,' 锁定');
        lock.onchange=()=>void this.toggleLock(assignment,lock.checked);
        const replace=this.button(tools,'换一道',()=>this.replace(assignment.slotId));replace.dataset.unavailable=String(lock.checked);replace.disabled=lock.checked;
        const family=this.button(tools,'同族换一道',()=>this.replace(assignment.slotId,'same-family'));family.dataset.unavailable=String(lock.checked||item?.familyState!=='classified');family.disabled=family.dataset.unavailable==='true';
        const content=this.el('div',card,'正在加载题目…','mwb-typography mwb-blueprint-question');
        if(item)scope.queue.push({item,content});else content.textContent='来源暂不可用，请重新生成。';
      }
      this.pump(scope);
      if(allocation.assignments.length>this.visible)this.button(this.results,'再显示 50 道',()=>{this.visible+=50;this.renderCandidate();});
      this.updateBusy();
    }
    pump(scope) {
      while(!scope.closed&&scope.active<2&&scope.queue.length){const {item,content}=scope.queue.shift();scope.active++;content.replaceChildren();
        Promise.resolve(renderMarkdown(body(item.markdown),content,item.path,scope.owner,scope.controller.signal)).catch(error=>{if(!scope.closed)content.textContent='预览未完成：'+text(error);})
          .finally(()=>{scope.active--;this.pump(scope);});}
    }
    closePreviews() {const scope=this.previewScope;if(!scope)return;scope.closed=true;scope.controller.abort();scope.queue.length=0;this.plugin.removeChild?.(scope.owner);this.previewScope=null;}
    async apply() {
      if(this.candidate?.allocation?.status!=='complete')return;
      await this.action('核对并应用配额',async options=>{
        if(this.view.closed||this.view.actionBusy||this.view.scanBusy)throw new Error('编排工作区正在处理其他操作，请稍后重试');
        const beforePlan=JSON.stringify(this.view.plan),beforeSettings=JSON.stringify(this.view.settings),candidate=this.candidate;
        const isCurrent=()=>options.isCurrent()&&!this.view.closed&&!this.view.actionBusy&&!this.view.scanBusy&&
          this.candidate===candidate&&JSON.stringify(this.view.plan)===beforePlan&&JSON.stringify(this.view.settings)===beforeSettings;
        const result=await service.applyBlueprintCandidate(clone(this.view.plan),candidate,{...options,isCurrent});
        if(!isCurrent())throw new Error('编排或目录设置已变化，旧候选未应用；请重新生成');
        this.view.index=result.index;this.view.indexState='ready';this.view.populateFilters();this.view.renderTree();this.view.setPlan(result.plan);this.view.pendingBlueprintRun=result.run;
        this.view.setStatus('已应用完整配额；保存方案时将同时保存配额归属与锁定记录。');this.close();
      });
    }
    async inspectRun() {
      const path=this.runSelect.value;if(!path){this.status('先选择配额记录。',true);return;}
      await this.action('核对方案配额',async options=>{
        const run=await service.loadBlueprintRun(path,clone(this.view.plan));
        const checked=await service.verifyBlueprintRun(run,clone(this.view.plan),options);if(this.closed)return;
        this.runResult.replaceChildren();this.el('p',this.runResult,'配额归属与来源已核对：'+checked.run.blueprintSnapshot.title);
        for(const assignment of checked.run.assignments)this.el('p',this.runResult,(checked.run.blueprintSnapshot.rows.find(row=>row.rowId===assignment.rowId)?.label||assignment.rowId)+' · '+assignment.sourcePath+(checked.run.locks.some(lock=>lock.slotId===assignment.slotId)?'（锁定）':''));
        this.status('记录匹配当前方案。原题卡与旧方案格式保持不变。');
      });
    }
    onClose() {
      this.closed=true;this.controller?.abort(Object.assign(new Error('蓝图窗口已关闭'),{name:'AbortError'}));this.controller=null;
      this.closePreviews();const owner=this.lifecycleOwner;this.lifecycleOwner=null;if(owner)this.plugin.removeChild?.(owner);
      this.candidate=null;if(this.view.blueprintModal===this)this.view.blueprintModal=null;this.contentEl.replaceChildren();
    }
  };
};
