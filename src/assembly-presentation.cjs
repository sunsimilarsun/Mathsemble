'use strict';

// The compiled document and its source map are one snapshot. Never split a
// question at a heading guessed from its text, or put a hidden teacher DOM
// behind the student view.
function slidesFromCompilation(plan, prepared, outputPath = 'Mathsemble/讲义/__presentation__.md') {
  if (!plan || !Array.isArray(plan.entries) || typeof prepared?.markdown !== 'string' || !Array.isArray(prepared.sourceMap))
    throw new Error('缺少逐题展示的完整来源快照');
  const entries = plan.entries.filter(entry => entry.kind !== 'section');
  if (!entries.length || prepared.sourceMap.length !== entries.length) throw new Error('逐题展示的来源数量不一致');
  const lines = prepared.markdown.split('\n'), slides = [];
  let previousEnd = 0, section = '', cursor = 0;
  for (const entry of plan.entries) {
    if (entry.kind === 'section') { section = entry.title; continue; }
    const range = prepared.sourceMap[cursor++];
    if (!range || range.entryId !== entry.entryId || range.kind !== entry.kind || typeof range.path !== 'string' || !range.path ||
        !Number.isInteger(range.startLine) || !Number.isInteger(range.endLine) || range.startLine <= previousEnd ||
        range.startLine < 1 || range.endLine < range.startLine || range.endLine > lines.length)
      throw new Error('逐题展示的来源映射失效，请重新生成');
    const markdown = lines.slice(range.startLine - 1, range.endLine).join('\n');
    if (!markdown.trim()) throw new Error('展示内容为空');
    slides.push(Object.freeze({entryId:entry.entryId,kind:entry.kind,title:entry.title || range.path,
      section,sourcePath:range.path,renderPath:outputPath,markdown}));
    previousEnd = range.endLine;
  }
  return Object.freeze(slides);
}

function createPresentationModal({Modal,Component,core,service,projectMarkdown,renderMarkdown}) {
  return class PresentationModal extends Modal {
    constructor(app,plugin,view) {
      super(app); this.plugin=plugin; this.view=view; this.closed=true; this.position=0;
      this.revealed=false; this.generation=0; this.invalid=false; this.slides=[];
    }
    el(tag,parent,className,text) {
      const node=this.contentEl.ownerDocument.createElement(tag);
      if(className)node.className=className;
      if(text!==undefined)node.textContent=String(text);
      parent?.appendChild(node); return node;
    }
    button(parent,label,action) {
      const button=this.el('button',parent,'',label); button.type='button';
      button.addEventListener('click',()=>{if(!button.disabled)void Promise.resolve().then(action).catch(error=>this.fail(error));});
      return button;
    }
    samePlan() { return !this.view.closed && JSON.stringify(this.view.plan)===this.planKey; }
    clearRender() {
      this.generation++; this.controller?.abort(); this.controller=null;
      if(this.owner) {
        if(this.plugin.removeChild)this.plugin.removeChild(this.owner); else this.owner.unload?.();
        this.owner=null;
      }
    }
    fail(error) {
      if(this.closed)return;
      this.invalid=true; this.revealed=false; this.clearRender(); this.body?.replaceChildren();
      this.status.textContent=String(error?.message||error); this.status.classList.add('is-error'); this.controls();
    }
    controls() {
      if(!this.previous)return;
      const disabled=this.closed||this.invalid||!this.slides.length;
      this.previous.disabled=disabled||this.position===0;
      this.next.disabled=disabled||this.position===this.slides.length-1;
      this.reveal.disabled=disabled;
      this.reveal.textContent=this.revealed?'隐藏答案':'揭示当前答案';
      this.reveal.setAttribute('aria-pressed',String(this.revealed));
      this.counter.textContent=this.slides.length?`${this.position+1} / ${this.slides.length}`:'准备中';
    }
    async onOpen() {
      this.closed=false; this.contentEl.replaceChildren(); this.modalEl.classList.add('mwb-presentation-modal');
      const header=this.el('header',this.contentEl,'mwb-presentation-header');
      this.el('h2',header,'','逐题投影');
      this.counter=this.el('span',header,'mwb-presentation-counter');
      this.button(header,'返回编排',()=>this.close());
      const nav=this.el('nav',this.contentEl,'mwb-presentation-nav'); nav.setAttribute('aria-label','投影控制');
      this.previous=this.button(nav,'上一项',()=>this.move(-1));
      this.reveal=this.button(nav,'揭示当前答案',()=>this.toggle());
      this.next=this.button(nav,'下一项',()=>this.move(1));
      this.el('p',this.contentEl,'mwb-assembly-muted','← / → 翻页，A 揭示或隐藏当前答案；每次换页恢复隐藏。教师内容按方案的教师版选项显示。');
      this.status=this.el('p',this.contentEl,'mwb-presentation-status','正在核对来源…'); this.status.setAttribute('role','status');
      this.body=this.el('section',this.contentEl,'mwb-typography mwb-presentation-body'); this.body.tabIndex=0;
      this.body.setAttribute('aria-label','当前展示内容');
      this.onKey=event=>{
        if(event.defaultPrevented||event.altKey||event.ctrlKey||event.metaKey||event.isComposing||
            event.target.closest?.('input,textarea,select,button,a,[contenteditable="true"]'))return;
        const action={ArrowLeft:()=>this.move(-1),PageUp:()=>this.move(-1),ArrowRight:()=>this.move(1),PageDown:()=>this.move(1),
          Home:()=>this.show(0),End:()=>this.show(this.slides.length-1),a:()=>this.toggle(),A:()=>this.toggle()}[event.key];
        if(action){event.preventDefault();void Promise.resolve().then(action).catch(error=>this.fail(error));}
      };
      this.contentEl.addEventListener('keydown',this.onKey); this.controls();
      try {
        this.plan=core.validatePlan(this.view.plan); this.planKey=JSON.stringify(this.view.plan);
        this.guard=service.beginSourceCheck(this.view.settings,()=>this.fail(new Error('素材已变化，请返回编排刷新后重新投影。')));
        const outputPath='Mathsemble/讲义/__presentation__.md';
        this.prepareController=new AbortController();
        const prepared=await service.compile(this.plan,this.view.index,{config:this.view.settings,outputPath,signal:this.prepareController.signal});
        if(this.closed)return;
        this.guard.assertCurrent();
        if(!this.samePlan())throw new Error('编排已变化，请重新打开逐题投影');
        this.slides=slidesFromCompilation(this.plan,prepared,outputPath);
        await this.show(0);
      } catch(error){this.fail(error);}
    }
    async move(delta) { return this.show(this.position+delta); }
    async toggle() { if(!this.invalid&&this.slides.length)return this.show(this.position,!this.revealed); }
    async show(position,revealed=false) {
      if(this.closed||this.invalid||position<0||position>=this.slides.length)return;
      if(!this.samePlan()){this.fail(new Error('编排已变化，请重新打开逐题投影'));return;}
      this.guard.assertCurrent(); this.clearRender();
      const generation=this.generation,slide=this.slides[position];
      this.position=position;this.revealed=!!revealed;this.controls();
      // Remove the old answer immediately, including during a slow render.
      this.body.replaceChildren(); this.status.classList.remove('is-error'); this.status.textContent='正在显示…';
      this.body.dataset.entryId=slide.entryId; this.body.dataset.mode=revealed?'teacher':'student';
      const Controller=this.contentEl.ownerDocument.defaultView?.AbortController||globalThis.AbortController;
      this.controller=Controller?new Controller():null; const signal=this.controller?.signal;
      const owner=Component?new Component():null; this.owner=owner;
      if(owner){if(this.plugin.addChild)this.plugin.addChild(owner);else owner.load?.();}
      const staging=this.el('div',this.body,'mwb-presentation-slide');
      staging.style.visibility='hidden';
      try {
        if(typeof projectMarkdown!=='function'||typeof renderMarkdown!=='function')throw new Error('课堂内容投影器未配置');
        const markdown=await projectMarkdown(slide.markdown,revealed?'teacher':'student',this.plan.output?.solutionOptions||{});
        if(typeof markdown!=='string')throw new Error('课堂内容投影结果无效');
        await renderMarkdown(markdown,staging,slide.renderPath,owner,signal);
        if(this.closed||this.invalid||signal?.aborted||generation!==this.generation)return;
        this.guard.assertCurrent();
        if(!this.samePlan())throw new Error('编排已变化，请重新打开逐题投影');
        staging.style.removeProperty('visibility'); this.body.scrollTop=0;
        this.status.textContent=[slide.section,slide.title,revealed?'答案已揭示':'答案已隐藏'].filter(Boolean).join(' · ');
        this.body.focus({preventScroll:true});
      }catch(error){if(!this.closed&&generation===this.generation&&!signal?.aborted)this.fail(error);}
    }
    onClose() {
      this.closed=true; this.prepareController?.abort();this.clearRender();this.guard?.dispose();this.guard=null;
      this.contentEl.removeEventListener('keydown',this.onKey);this.contentEl.replaceChildren();
      this.slides=[];this.plan=null;
    }
  };
}

module.exports={slidesFromCompilation,createPresentationModal};
