'use strict';

module.exports = function createSimilarityModal({Modal,Component,core,service,renderMarkdown}) {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const modes={family:'同族',knowledge:'同考点',method:'同方法'};
  const types={choice:'单选',multiple_choice:'多选',fill_blank:'填空',true_false:'判断',short_answer:'解答',calculation:'计算',proof:'证明',comprehensive:'综合'};
  const body=value=>String(value||'').replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)\s*(?:\r?\n|$)/,'');
  return class SimilarityModal extends Modal {
    constructor(app,plugin,view,{sourceKey,entryId}={}) {
      super(app);this.plugin=plugin;this.view=view;this.sourceKey=sourceKey;this.entryId=entryId;
      this.similarityEditor=true;this.closed=false;this.busy=false;this.visible=30;
      this.candidate=null;this.run=undefined;this.matches=[];
    }
    el(tag,parent,text,cls) {const node=this.contentEl.ownerDocument.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;parent?.appendChild(node);return node;}
    button(parent,label,fn) {const node=this.el('button',parent,label);node.type='button';node.onclick=()=>{if(!this.closed&&!node.disabled&&!this.busy)Promise.resolve().then(()=>{if(!this.closed&&node.isConnected&&!node.disabled&&!this.busy)return fn();}).catch(error=>this.status(error.message,true));};return node;}
    check(parent,label,checked=false) {const wrap=this.el('label',parent,undefined,'mwb-family-check');const node=this.el('input',wrap);node.type='checkbox';node.checked=checked;node.setAttribute('aria-label',label);this.el('span',wrap,label);return node;}
    status(message,error=false) {if(this.closed||!this.statusEl)return;this.statusEl.textContent=message;this.statusEl.classList.toggle('is-error',error);}
    updateBusy() {for(const node of this.contentEl.querySelectorAll('input,select,button'))node.disabled=this.busy||node.dataset.unavailable==='true';}
    snapshot() {return {plan:JSON.stringify(this.view.plan),settings:JSON.stringify(this.view.settings),pending:this.view.pendingBlueprintRun,
      index:this.view.index,scan:this.view.scanGeneration,mode:this.modeSelect.value,run:this.runSelect?.value,unlock:!!this.unlockInput?.checked,
      filters:this.useFiltersInput.checked?JSON.stringify(this.view.filters):null};}
    current(snapshot) {return !!snapshot&&!this.closed&&!this.view.closed&&!this.view.actionBusy&&!this.view.scanBusy&&
      JSON.stringify(this.view.plan)===snapshot.plan&&JSON.stringify(this.view.settings)===snapshot.settings&&
      this.view.pendingBlueprintRun===snapshot.pending&&this.view.index===snapshot.index&&this.view.scanGeneration===snapshot.scan&&
      this.modeSelect.value===snapshot.mode&&this.runSelect?.value===snapshot.run&&!!this.unlockInput?.checked===snapshot.unlock&&
      (snapshot.filters===null||JSON.stringify(this.view.filters)===snapshot.filters);}
    checkWorkspace() {if(this.candidate&&!this.current(this.candidateSnapshot))this.invalidate('编排、目录或素材已变化，请刷新候选。');}
    async action(label,fn) {
      if(this.closed||this.busy)return;
      this.busy=true;const controller=this.controller=new AbortController(),snapshot=this.snapshot();this.updateBusy();this.status(label+'…');
      const isCurrent=()=>this.controller===controller&&!controller.signal.aborted&&this.current(snapshot);
      try {if(!isCurrent())throw new Error('编排工作区正在处理其他操作，请稍后重试');return await fn({signal:controller.signal,isCurrent,config:clone(this.view.settings)},snapshot);}
      catch(error){if(!this.closed)this.status(error.message||String(error),error.name!=='AbortError');}
      finally{if(this.controller===controller)this.controller=null;this.busy=false;if(!this.closed)this.updateBusy();}
    }
    async onOpen() {
      this.lifecycleOwner=new Component();this.lifecycleOwner.register?.(()=>{if(!this.closed)this.close();});this.plugin.addChild?.(this.lifecycleOwner);
      this.modalEl.classList.add('mwb-family-modal','mwb-similarity-modal');this.contentEl.classList.add('mwb-family','mwb-similarity');
      this.el('h2',this.contentEl,this.entryId?'相似换题':'找相似题');
      this.el('p',this.contentEl,'按已登记题族、知识点或方法查找候选。匹配理由用于辅助选题，不代表数学等价或解法相同；请核对题意、条件和难度。','mwb-assembly-muted');
      const controls=this.el('div',this.contentEl,undefined,'mwb-family-controls');
      const label=this.el('label',controls);this.el('span',label,'查找方式');this.modeSelect=this.el('select',label);this.modeSelect.setAttribute('aria-label','查找方式');
      for(const [value,name]of Object.entries(modes))this.el('option',this.modeSelect,name).value=value;
      this.modeSelect.value='knowledge';this.modeSelect.onchange=()=>this.invalidate('查找方式已变化，请刷新候选。');
      this.useFiltersInput=this.check(controls,'沿用当前素材筛选',!!this.entryId);this.useFiltersInput.onchange=()=>this.invalidate();
      if(this.entryId){
        const runLabel=this.el('label',controls);this.el('span',runLabel,'采用配额记录');this.runSelect=this.el('select',runLabel);this.runSelect.setAttribute('aria-label','采用配额记录');
        this.runSelect.onchange=()=>{this.run=undefined;this.invalidate();};
        this.unlockInput=this.check(controls,'解除此题配额锁定后换题');this.unlockInput.onchange=()=>this.invalidate();
      }
      this.button(controls,'刷新候选',()=>this.prepare());
      this.statusEl=this.el('p',this.contentEl,'正在读取候选条件…','mwb-family-status');this.statusEl.setAttribute('role','status');
      this.results=this.el('div',this.contentEl,undefined,'mwb-family-results');
      if(!this.entryId){await this.prepare();return;}
      let ready=false;
      await this.action('读取配额记录',async options=>{
        if(this.view.pendingBlueprintRun){this.run=this.view.pendingBlueprintRun;this.el('option',this.runSelect,'本次尚未保存的配额记录').value='pending';this.runSelect.dataset.unavailable='true';ready=true;}
        else{
          const matches=await service.listMatchingBlueprintRuns(clone(this.view.plan),options);
          if(!options.isCurrent())throw new Error('编排已变化，请重新打开换题窗口');this.matches=matches;
          if(!matches.length){this.el('option',this.runSelect,'未找到匹配记录：按当前条件换题').value='legacy';this.runSelect.dataset.unavailable='true';ready=true;}
          else{if(matches.length>1)this.el('option',this.runSelect,'请选择本次采用的配额记录').value='';for(const item of matches)this.el('option',this.runSelect,[item.title||item.path,item.createdAt||''].filter(Boolean).join(' · ')).value=item.path;if(matches.length===1){this.runSelect.value=matches[0].path;ready=true;}}
        }
        this.status(ready?'记录已确定，正在准备候选。':'有多份记录匹配，请明确选择后刷新候选。');
      });
      if(ready&&!this.closed)await this.prepare();
    }
    invalidate(message='条件已变化，请刷新候选。') {this.controller?.abort();this.candidate=null;this.candidateSnapshot=null;this.closePreviews();this.results?.replaceChildren();this.status(message);}
    async prepare() {
      await this.action('核对相似候选',async(options,snapshot)=>{
        this.candidate=null;this.candidateSnapshot=null;this.closePreviews();this.results.replaceChildren();
        const mode=this.modeSelect.value,filters=this.useFiltersInput.checked?{...clone(this.view.filters),kind:'question'}:{kind:'question'};
        let candidate;
        if(this.entryId){
          const selected=this.runSelect.value;if(!selected)throw new Error('请先选择采用的配额记录');
          let run=this.run;if(selected!=='pending'&&selected!=='legacy')run=await service.loadBlueprintRun(selected,clone(this.view.plan));
          if(!options.isCurrent())throw new Error('编排已变化，请重新打开换题窗口');
          candidate=await service.prepareSimilarityReplacement({plan:clone(this.view.plan),entryId:this.entryId,mode,filters,...(run?{run}:{}),unlock:this.unlockInput.checked},options);
          this.run=run;
        }else candidate=await service.findSimilarQuestions({sourceKey:this.sourceKey,mode,filters,excludedKeys:[]},options);
        if(!options.isCurrent())throw new Error('工作区或查找方式已变化，候选未采用');
        this.candidate=candidate;this.candidateSnapshot=snapshot;this.visible=30;this.renderCandidates();
      });
    }
    metadata(item) {return [types[item?.questionType]||item?.questionType,item?.difficulty!=null?'难度 '+item.difficulty:'难度未填写',...(item?.tiers||[]),...(item?.methods||[]),...(item?.knowledgeNodes||[])].filter(Boolean).join(' · ');}
    sourceItem(wrapper) {return this.entryId?core.resolvePlan(this.view.plan,wrapper.index).entries.find(value=>value.entry.entryId===this.entryId)?.item:wrapper.index.items.find(item=>item.key===this.sourceKey);}
    renderCandidates() {
      this.closePreviews();this.results.replaceChildren();const wrapper=this.candidate;if(!wrapper)return;
      const source=this.sourceItem(wrapper);this.el('p',this.results,'参照题：'+(source?.title||'来源待核')+' · '+this.metadata(source));
      if(this.entryId)this.el('p',this.results,this.run?'将保留原配额行条件与题族上限；成功替换后，保存方案时写出新的配额记录。':'此方案未找到匹配的配额记录；本次按当前条件核对候选，不推断历史配额。','mwb-assembly-muted');
      const issues=[...new Set((wrapper.issues||[]).map(value=>typeof value==='string'?value:value?.message).filter(Boolean))];
      if(issues.length){const list=this.el('ul',this.results,undefined,'mwb-similarity-issues');for(const message of issues)this.el('li',list,message);}
      if(wrapper.status!=='ready'){this.status((wrapper.issues||[]).map(value=>value.message||String(value)).join('；')||'当前条件下不能查找候选。',true);return;}
      const candidates=wrapper.candidates||[];this.status(candidates.length?`找到 ${candidates.length} 道${modes[this.modeSelect.value]}候选；请核对匹配理由。`:issues.length?issues.join('；'):'没有满足全部条件的候选题。可调整查找方式或筛选条件。');
      const scope=this.previewScope={owner:new Component(),controller:new AbortController(),closed:false,active:0,queue:[]};this.plugin.addChild?.(scope.owner);
      for(const candidate of candidates.slice(0,this.visible)){
        const item=wrapper.index.items.find(value=>value.path===candidate.path&&(value.id||'')===(candidate.id||'')&&value.fingerprint===candidate.fingerprint);if(!item)continue;
        const card=this.el('article',this.results,undefined,'mwb-family-candidate mwb-similarity-candidate');card.dataset.candidateKey=candidate.key;
        this.el('h3',card,item.title);this.el('p',card,this.metadata(item));this.el('p',card,item.path,'mwb-assembly-muted');
        const reasons=(candidate.reasons||[]).filter(value=>typeof value==='string');this.el('p',card,'匹配依据：'+(reasons.join('；')||'暂无可解释的匹配依据'),'mwb-similarity-reasons');
        const missing=(candidate.missing||[]).filter(value=>typeof value==='string');if(missing.length)this.el('p',card,'信息不足：'+missing.join('；'),'mwb-assembly-muted mwb-similarity-missing');
        const delta=source?.difficulty!=null&&item.difficulty!=null?item.difficulty-source.difficulty:null;
        this.el('p',card,delta===null?'难度差异：有题目未填写难度，需人工核对。':delta===0?'难度差异：登记难度相同。':`难度差异：比参照题${delta>0?'高':'低'} ${Math.abs(delta)} 级。`,'mwb-similarity-difficulty');
        if(this.entryId)this.button(card,'选用此题',()=>this.apply(candidate.key));
        this.button(card,'打开原文',()=>service.openSource(item.path));
        const content=this.el('div',card,'正在加载题目…','mwb-typography mwb-family-question');scope.queue.push({item,content});
      }
      this.pump(scope);if(candidates.length>this.visible)this.button(this.results,'再显示 30 道',()=>{this.checkWorkspace();if(this.candidate){this.visible+=30;this.renderCandidates();}});this.updateBusy();
    }
    pump(scope) {while(!scope.closed&&scope.active<2&&scope.queue.length){const {item,content}=scope.queue.shift();scope.active++;content.replaceChildren();Promise.resolve().then(()=>{if(!scope.closed)return renderMarkdown(body(item.markdown),content,item.path,scope.owner,scope.controller.signal);}).catch(error=>{if(!scope.closed)content.textContent='预览未完成：'+error.message;}).finally(()=>{scope.active--;this.pump(scope);});}}
    closePreviews() {const scope=this.previewScope;if(!scope)return;scope.closed=true;scope.controller.abort();scope.queue.length=0;this.plugin.removeChild?.(scope.owner);this.previewScope=null;}
    async apply(key) {
      const candidate=this.candidate;if(!this.entryId||candidate?.status!=='ready')return;
      if(!this.current(this.candidateSnapshot)){this.invalidate('编排、目录或查找条件已变化，请刷新候选。');return;}
      await this.action('核对并替换',async options=>{
        const isCurrent=()=>options.isCurrent()&&this.candidate===candidate&&this.current(this.candidateSnapshot);
        const result=await service.applySimilarityReplacement(clone(this.view.plan),candidate,key,{...options,isCurrent});
        if(!isCurrent())throw new Error('编排已变化，本次替换未应用');
        this.view.index=result.index;this.view.indexState='ready';this.view.populateFilters();this.view.renderTree();this.view.setPlan(result.plan);this.view.pendingBlueprintRun=result.run||null;
        this.view.setStatus('已选用候选题。请核对题意与卷内设置。'+(result.run?'保存方案时会同时保存新的配额记录。':'请保存方案。'));this.close();
      });
    }
    onClose() {this.closed=true;this.controller?.abort();this.controller=null;this.closePreviews();const owner=this.lifecycleOwner;this.lifecycleOwner=null;if(owner)this.plugin.removeChild?.(owner);this.candidate=null;this.candidateSnapshot=null;if(this.view.similarityModal===this)this.view.similarityModal=null;this.contentEl.replaceChildren();}
  };
};
