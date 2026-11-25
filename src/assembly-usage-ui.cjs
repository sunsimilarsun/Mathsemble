'use strict';

// A teacher explicitly records an actual activity. Merely opening this modal,
// previewing, saving a plan or exporting never creates a teaching event.
module.exports=function createUsageModal({Modal,Component,Notice,core,service,onChanged}={}) {
  const clone=value=>JSON.parse(JSON.stringify(value));
  const localTime=()=>{const date=new Date();date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16);};
  const scope=item=>item.fragmentRef?'部分使用：'+(item.fragmentRef.kind==='question-part'?'小问 ':'知识小节 ')+item.fragmentRef.ids.join('、')+(item.score!==null?' · '+item.score+' 分':''):'整份材料'+(item.score!==null?' · '+item.score+' 分':'');
  return class UsageModal extends Modal {
    constructor(app,plugin,view,options={}) {
      super(app);this.plugin=plugin;this.view=view;this.options=options;this.closed=false;this.busy=false;this.candidate=null;
      this.actionId=service.newActionId();this.revokeIds=new Map();this.visible=100;
    }
    el(tag,parent,text,cls){const node=this.contentEl.ownerDocument.createElement(tag);if(text!==undefined)node.textContent=String(text);if(cls)node.className=cls;parent?.appendChild(node);return node;}
    field(parent,label,tag='input'){const wrap=this.el('label',parent,undefined,'mwb-usage-field');this.el('span',wrap,label);const node=this.el(tag,wrap);node.setAttribute('aria-label',label);return node;}
    button(parent,label,fn){const node=this.el('button',parent,label);node.type='button';node.onclick=()=>{if(this.closed||this.busy||node.disabled)return;Promise.resolve().then(()=>{if(!this.closed&&!this.busy&&node.isConnected&&!node.disabled)return fn();}).catch(error=>this.status(error.message,true));};return node;}
    context(){return {classId:this.classInput.value.trim(),courseId:this.courseInput.value.trim()};}
    status(message,error=false){if(!this.closed){this.statusEl.textContent=message;this.statusEl.classList.toggle('is-error',error);}}
    snapshot(){return {plan:JSON.stringify(this.view.plan),settings:JSON.stringify(this.view.settings),context:JSON.stringify(this.context()),action:this.actionInput.value,time:this.timeInput.value};}
    current(snapshot){return !this.closed&&!this.view.closed&&!this.view.actionBusy&&!this.view.scanBusy&&JSON.stringify(this.view.plan)===snapshot.plan&&JSON.stringify(this.view.settings)===snapshot.settings&&JSON.stringify(this.context())===snapshot.context&&this.actionInput.value===snapshot.action&&this.timeInput.value===snapshot.time;}
    updateBusy(){for(const node of this.contentEl.querySelectorAll('button,input,select'))node.disabled=this.busy||node.dataset.unavailable==='true';if(this.recordButton)this.recordButton.disabled=this.busy||!this.candidate;}
    invalidate(){this.candidate=null;this.actionId=service.newActionId();this.preview?.replaceChildren();this.updateBusy();this.status('条件已变化，请重新核对后登记。');}
    async action(label,fn){
      if(this.closed||this.busy)return;this.busy=true;const controller=this.controller=new AbortController(),snapshot=this.snapshot();this.status(label+'…');this.updateBusy();
      const options={signal:controller.signal,isCurrent:()=>this.controller===controller&&!controller.signal.aborted&&this.current(snapshot),config:clone(this.view.settings||{})};
      try{if(!options.isCurrent())throw Error('编排工作区正在处理其他操作，请稍后重试');return await fn(options,snapshot);}
      catch(error){this.status(error.message||String(error),error.name!=='AbortError');}
      finally{if(this.controller===controller)this.controller=null;this.busy=false;if(!this.closed)this.updateBusy();}
    }
    async onOpen(){
      if(Component){this.owner=new Component();this.owner.register?.(()=>{if(!this.closed)this.close();});this.plugin.addChild?.(this.owner);}
      this.modalEl.classList.add('mwb-usage-modal');this.contentEl.classList.add('mwb-usage');this.el('h2',this.contentEl,'实际使用账本');
      this.el('p',this.contentEl,'只有明确登记才计为已讲授或已布置；导出不代表使用，也不代表学生掌握。记录含当时原文，仅保存在本地账本。','mwb-assembly-muted');
      const controls=this.el('div',this.contentEl,undefined,'mwb-usage-controls'),context=this.options.context||this.view.usageContext||{classId:'',courseId:''};
      this.classInput=this.field(controls,'班级代号');this.classInput.value=context.classId||'';this.classInput.maxLength=200;
      this.courseInput=this.field(controls,'课程代号');this.courseInput.value=context.courseId||'';this.courseInput.maxLength=200;
      this.actionInput=this.field(controls,'实际使用类型','select');for(const [value,label]of [['taught','已讲授'],['assigned','已布置']])this.el('option',this.actionInput,label).value=value;
      this.timeInput=this.field(controls,'实际使用时间');this.timeInput.type='datetime-local';this.timeInput.value=localTime();
      for(const node of [this.classInput,this.courseInput,this.actionInput,this.timeInput])node.addEventListener('change',()=>{this.invalidate();if(node===this.classInput||node===this.courseInput){this.ledger=null;this.history?.replaceChildren();this.revokeIds.clear();}});
      const actions=this.el('div',this.contentEl,undefined,'mwb-usage-actions');this.button(actions,'核对本次登记',()=>this.prepare());
      this.recordButton=this.button(actions,'确认登记本次使用',()=>this.record());this.button(actions,'刷新使用记录',()=>this.refresh());
      this.statusEl=this.el('p',this.contentEl,'填写班级或课程，再核对当前方案。','mwb-usage-status');this.statusEl.setAttribute('role','status');
      this.preview=this.el('div',this.contentEl,undefined,'mwb-usage-preview');this.history=this.el('div',this.contentEl,undefined,'mwb-usage-history');this.updateBusy();
      if(context.classId||context.courseId)await this.refresh();
    }
    async prepare(){return this.action('核对来源版本',async(options,snapshot)=>{
      this.candidate=null;this.preview.replaceChildren();const date=new Date(this.timeInput.value);if(!Number.isFinite(date.getTime()))throw Error('请填写有效的实际使用时间');
      const candidate=await service.preparePlanUsage({plan:clone(this.view.plan),context:this.context(),action:this.actionInput.value,occurredAt:date.toISOString()},options);
      if(!options.isCurrent())throw Error('编排或登记条件已变化，未采用旧结果');this.candidate=candidate;this.candidateSnapshot=snapshot;
      this.el('h3',this.preview,`${candidate.planTitle} · ${candidate.items.length} 项 · ${candidate.action==='taught'?'已讲授':'已布置'}`);
      this.el('p',this.preview,'将保存来源当时的 Markdown 正文和版本摘要；不修改题卡或方案。');
      const list=this.el('ol',this.preview);for(const item of candidate.items.slice(0,100))this.el('li',list,(item.title||item.path)+' · '+(item.itemId||'仅路径身份')+' · '+scope(item));
      if(candidate.items.length>100)this.el('p',this.preview,'其余 '+(candidate.items.length-100)+' 项也将登记。');this.status('来源已核对。确认实际使用后，再点击“确认登记本次使用”。');
    });}
    async changed(result,context){const callback=this.options.onChanged||onChanged;if(callback)try{await callback({context,event:result.event,result});}catch(error){if(Notice)new Notice('使用记录已保存，但筛选刷新未完成：'+(error.message||String(error)));}}
    async record(){const candidate=this.candidate;if(!candidate)return;return this.action('保存实际使用',async options=>{
      if(!this.current(this.candidateSnapshot))throw Error('编排或条件已变化，请重新核对');
      const result=await service.recordPlanUsage(candidate,{actionId:this.actionId},options);
      this.candidate=null;this.actionId=service.newActionId();
      // A submitted Vault write may finish after close. Keep the saved fact and
      // notify the workspace, but do not reopen the modal or alter a new plan.
      await this.changed(result,result.event.context);if(this.closed)return;
      this.preview.replaceChildren();this.status(result.idempotent?'该动作已经登记，未重复计数。':'已保存本次使用；源卡与方案保持。');if(Notice)new Notice('实际使用已登记');
      this.ledger=await service.loadUsage({context:this.context()},options);if(options.isCurrent())this.renderHistory();
    });}
    async refresh(){return this.action('读取本班课程记录',async options=>{const ledger=await service.loadUsage({context:this.context()},options);if(!options.isCurrent())throw Error('班级课程已变化，未采用旧记录');this.ledger=ledger;this.visible=100;this.renderHistory();this.status(`共 ${ledger.activeEvents.length} 次有效登记，${ledger.revokedEventIds.length} 次已撤销。`);});}
    renderHistory(){
      this.history.replaceChildren();if(!this.ledger)return;this.el('h3',this.history,'本班课程历史');
      const revoked=new Set(this.ledger.revokedEventIds),events=this.ledger.events.filter(event=>event.action!=='revoke');
      for(const event of events.slice(0,this.visible)){
        const row=this.el('article',this.history,undefined,'mwb-usage-event');row.dataset.eventId=event.eventId;
        this.el('h4',row,`${event.action==='taught'?'已讲授':'已布置'} · ${new Date(event.occurredAt).toLocaleString()} · ${event.items.length} 项${revoked.has(event.eventId)?' · 已撤销':''}`);
        this.el('p',row,event.planTitle+' · 方案摘要 '+event.planSnapshotSha256.slice(0,12)+(event.items.some(item=>item.fragmentRef)?' · 含部分使用（整题筛选保守计为已用）':''));
        const details=this.el('details',row);this.el('summary',details,'查看当时版本');let populated=false;
        details.addEventListener('toggle',()=>{if(!details.open||populated)return;populated=true;for(const item of event.items){this.el('p',details,(item.title||item.path)+' · '+scope(item)+' · '+item.path+' · SHA-256 '+item.revisionSha256);this.el('pre',details,item.markdown);}});
        if(!revoked.has(event.eventId)){const reason=this.field(row,'撤销说明');reason.maxLength=1000;this.button(row,'撤销这次登记',()=>this.revoke(event,reason.value));}
        else for(const correction of this.ledger.events.filter(value=>value.action==='revoke'&&value.supersedes===event.eventId))this.el('p',row,'更正记录：'+new Date(correction.createdAt).toLocaleString()+(correction.reason?' · '+correction.reason:''));
      }
      if(events.length>this.visible)this.button(this.history,'再显示 100 次',()=>{this.visible+=100;this.renderHistory();this.updateBusy();});this.updateBusy();
    }
    async revoke(event,reason){return this.action('追加撤销更正',async options=>{
      let actionId=this.revokeIds.get(event.eventId);if(!actionId){actionId=service.newActionId();this.revokeIds.set(event.eventId,actionId);}
      const result=await service.revokeUsage(event.eventId,{actionId,context:this.context(),reason},options);await this.changed(result,result.event.context);if(this.closed)return;
      this.ledger=await service.loadUsage({context:this.context()},options);if(options.isCurrent()){this.renderHistory();this.status('已追加撤销记录，原始登记仍保留。');}
    });}
    onClose(){this.closed=true;this.controller?.abort();this.controller=null;this.candidate=null;const owner=this.owner;this.owner=null;if(owner)this.plugin.removeChild?.(owner);if(this.view.usageModal===this)this.view.usageModal=null;this.contentEl.replaceChildren();}
  };
};
