'use strict';

module.exports = function createFamilyModal({Modal,Component,core,service,renderMarkdown}) {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const types={choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'};
  const body=value=>String(value||'').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'');
  return class FamilyModal extends Modal {
    constructor(app,plugin,view,entryId) {
      super(app);this.plugin=plugin;this.view=view;this.entryId=entryId;this.familyEditor=true;
      this.closed=false;this.busy=false;this.visible=30;this.candidate=null;this.run=undefined;this.matches=[];
    }
    el(tag,parent,text,cls) {const node=this.contentEl.ownerDocument.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;parent?.appendChild(node);return node;}
    button(parent,label,fn) {const node=this.el('button',parent,label);node.type='button';node.onclick=()=>{if(!this.closed&&!node.disabled&&!this.busy)Promise.resolve().then(()=>{if(!this.closed&&node.isConnected&&!node.disabled&&!this.busy)return fn();}).catch(error=>this.status(error.message,true));};return node;}
    check(parent,label,checked=false) {const wrap=this.el('label',parent,undefined,'mwb-family-check');const node=this.el('input',wrap);node.type='checkbox';node.checked=checked;node.setAttribute('aria-label',label);this.el('span',wrap,label);return node;}
    status(message,error=false) {if(this.closed)return;this.statusEl.textContent=message;this.statusEl.classList.toggle('is-error',error);}
    updateBusy() {for(const node of this.contentEl.querySelectorAll('input,select,button'))node.disabled=this.busy||node.dataset.unavailable==='true';}
    snapshot() {return {plan:JSON.stringify(this.view.plan),settings:JSON.stringify(this.view.settings),pending:this.view.pendingBlueprintRun,filters:this.useFiltersInput?.checked?JSON.stringify(this.view.filters):null};}
    current(snapshot) {return !this.closed&&!this.view.closed&&!this.view.actionBusy&&!this.view.scanBusy&&JSON.stringify(this.view.plan)===snapshot.plan&&JSON.stringify(this.view.settings)===snapshot.settings&&this.view.pendingBlueprintRun===snapshot.pending&&(snapshot.filters===null||JSON.stringify(this.view.filters)===snapshot.filters);}
    async action(label,fn) {
      if(this.closed||this.busy)return;
      this.busy=true;const controller=this.controller=new AbortController(),snapshot=this.snapshot();this.updateBusy();this.status(label+'…');
      const isCurrent=()=>this.controller===controller&&!controller.signal.aborted&&this.current(snapshot);
      try {if(!isCurrent())throw new Error('编排工作区正在处理其他操作，请稍后重试');return await fn({signal:controller.signal,isCurrent,config:clone(this.view.settings)},snapshot);}
      catch(error){this.status(error.message||String(error),error.name!=='AbortError');}
      finally{if(this.controller===controller)this.controller=null;this.busy=false;if(!this.closed)this.updateBusy();}
    }
    async onOpen() {
      this.lifecycleOwner=new Component();this.lifecycleOwner.register?.(()=>{if(!this.closed)this.close();});this.plugin.addChild?.(this.lifecycleOwner);
      this.modalEl.classList.add('mwb-family-modal');this.contentEl.classList.add('mwb-family');
      this.el('h2',this.contentEl,'同族换题');this.el('p',this.contentEl,'只列出同一有效题族中的其他题。请核对题意与难度；题族相同不表示数学上等价。替换保留位置、卷内标题和角色。','mwb-assembly-muted');
      const controls=this.el('div',this.contentEl,undefined,'mwb-family-controls');
      const label=this.el('label',controls);this.el('span',label,'采用配额记录');this.runSelect=this.el('select',label);this.runSelect.setAttribute('aria-label','采用配额记录');
      this.useFiltersInput=this.check(controls,'沿用当前素材筛选',true);
      this.unlockInput=this.check(controls,'解除此题配额锁定后换题');
      this.runSelect.onchange=()=>{this.run=undefined;this.invalidate();};this.useFiltersInput.onchange=()=>this.invalidate();this.unlockInput.onchange=()=>this.invalidate();
      this.button(controls,'刷新候选',()=>this.prepare());
      this.statusEl=this.el('p',this.contentEl,'正在查找方案记录…','mwb-family-status');this.statusEl.setAttribute('role','status');
      this.results=this.el('div',this.contentEl,undefined,'mwb-family-results');
      let ready=false;
      await this.action('读取配额记录',async options=>{
        if(this.view.pendingBlueprintRun){this.run=this.view.pendingBlueprintRun;this.el('option',this.runSelect,'本次尚未保存的配额记录').value='pending';this.runSelect.dataset.unavailable='true';ready=true;}
        else{
          const matches=await service.listMatchingBlueprintRuns(clone(this.view.plan),options);if(!options.isCurrent())throw new Error('编排已变化，请重新打开换题窗口');this.matches=matches;
          if(!matches.length){this.el('option',this.runSelect,'未找到匹配记录：按当前题族与筛选换题').value='legacy';this.runSelect.dataset.unavailable='true';ready=true;}
          else{if(matches.length>1)this.el('option',this.runSelect,'请选择本次采用的配额记录').value='';for(const item of matches)this.el('option',this.runSelect,[item.title||item.path,item.createdAt||''].filter(Boolean).join(' · ')).value=item.path;if(matches.length===1){this.runSelect.value=matches[0].path;ready=true;}}
        }
        this.status(ready?'记录已确定，正在准备候选。':'有多份记录匹配，请明确选择后刷新候选。');
      });
      if(ready&&!this.closed)await this.prepare();
    }
    invalidate() {this.candidate=null;this.closePreviews();this.results.replaceChildren();this.status('条件已变化，请刷新候选。');}
    async prepare() {
      await this.action('核对同族候选',async(options,snapshot)=>{
        this.candidate=null;this.closePreviews();this.results.replaceChildren();
        const selected=this.runSelect.value;if(!selected)throw new Error('请先选择采用的配额记录');
        let run=this.run;
        if(selected!=='pending'&&selected!=='legacy')run=await service.loadBlueprintRun(selected,clone(this.view.plan));
        if(!options.isCurrent())throw new Error('编排已变化，请重新打开换题窗口');
        const filters=this.useFiltersInput.checked?{...clone(this.view.filters),kind:'question'}:{kind:'question'};
        const candidate=await service.prepareFamilyReplacement({plan:clone(this.view.plan),entryId:this.entryId,filters,...(run?{run}:{}),unlock:this.unlockInput.checked},options);
        if(!options.isCurrent())throw new Error('编排已变化，候选未采用');
        this.run=run;this.candidate=candidate;this.candidateSnapshot=snapshot;this.visible=30;this.renderCandidates();
      });
    }
    metadata(item) {return [types[item?.questionType]||item?.questionType,item?.difficulty!=null?'难度 '+item.difficulty:'',...(item?.tiers||[]),...(item?.methods||[]),...(item?.knowledgeNodes||[])].filter(Boolean).join(' · ')||'未填写';}
    renderCandidates() {
      this.closePreviews();this.results.replaceChildren();const wrapper=this.candidate;if(!wrapper)return;
      const old=core.resolvePlan(this.view.plan,wrapper.index).entries.find(value=>value.entry.entryId===this.entryId)?.item;
      this.el('p',this.results,'当前：'+(old?.title||'来源待核')+' · '+this.metadata(old));
      this.el('p',this.results,this.run?'将保留原配额行条件与题族上限；成功替换后，保存方案时写出新的配额记录。':'此方案未找到匹配的配额记录；本次只核对同族、当前筛选及重复题，不推断历史配额。','mwb-assembly-muted');
      if(wrapper.status!=='ready'){this.status((wrapper.issues||[]).map(value=>value.message).join('；')||'当前条件下不能换题。',true);return;}
      const candidates=wrapper.candidates||[];this.status(candidates.length?`找到 ${candidates.length} 道同族候选；核对后选用。`:'没有满足全部条件的其他同族题。原编排保持。');
      const scope=this.previewScope={owner:new Component(),controller:new AbortController(),closed:false,active:0,queue:[]};this.plugin.addChild?.(scope.owner);
      for(const candidate of candidates.slice(0,this.visible)){
        const item=wrapper.index.items.find(value=>value.path===candidate.path&&(value.id||'')===(candidate.id||'')&&value.fingerprint===candidate.fingerprint);if(!item)continue;
        const card=this.el('article',this.results,undefined,'mwb-family-candidate');card.dataset.candidateKey=candidate.key;
        this.el('h3',card,item.title);this.el('p',card,'替换为：'+this.metadata(item));this.el('p',card,item.path,'mwb-assembly-muted');
        this.button(card,'选用此题',()=>this.apply(candidate.key));
        const content=this.el('div',card,'正在加载题目…','mwb-typography mwb-family-question');scope.queue.push({item,content});
      }
      this.pump(scope);if(candidates.length>this.visible)this.button(this.results,'再显示 30 道',()=>{this.visible+=30;this.renderCandidates();});this.updateBusy();
    }
    pump(scope) {while(!scope.closed&&scope.active<2&&scope.queue.length){const {item,content}=scope.queue.shift();scope.active++;content.replaceChildren();Promise.resolve(renderMarkdown(body(item.markdown),content,item.path,scope.owner,scope.controller.signal)).catch(error=>{if(!scope.closed)content.textContent='预览未完成：'+error.message;}).finally(()=>{scope.active--;this.pump(scope);});}}
    closePreviews() {const scope=this.previewScope;if(!scope)return;scope.closed=true;scope.controller.abort();scope.queue.length=0;this.plugin.removeChild?.(scope.owner);this.previewScope=null;}
    async apply(key) {
      const candidate=this.candidate;if(candidate?.status!=='ready')return;
      await this.action('核对并替换',async options=>{
        if(!this.current(this.candidateSnapshot))throw new Error('编排或目录设置已变化，请刷新候选');
        const isCurrent=()=>options.isCurrent()&&this.candidate===candidate&&this.current(this.candidateSnapshot);
        const result=await service.applyFamilyReplacement(clone(this.view.plan),candidate,key,{...options,isCurrent});
        if(!isCurrent())throw new Error('编排已变化，本次替换未应用');
        this.view.index=result.index;this.view.indexState='ready';this.view.populateFilters();this.view.renderTree();this.view.setPlan(result.plan);this.view.pendingBlueprintRun=result.run||null;
        this.view.setStatus('已替换同族题，位置、卷内标题和角色保持。'+(result.run?'保存方案时会同时保存新的配额记录。':'请保存方案。'));this.close();
      });
    }
    onClose() {this.closed=true;this.controller?.abort();this.controller=null;this.closePreviews();const owner=this.lifecycleOwner;this.lifecycleOwner=null;if(owner)this.plugin.removeChild?.(owner);this.candidate=null;if(this.view.familyModal===this)this.view.familyModal=null;this.contentEl.replaceChildren();}
  };
};
